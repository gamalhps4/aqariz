/**
 * Stripe smoke test (test mode) — exercises the real money path end to end:
 * per-org encrypted creds → createPaymentIntent → test-card confirm →
 * settlement → invoice application → idempotent replay → out-of-order
 * webhook guard → receipt (+ R2 PDF). Refuses to run against a live key.
 *
 *   pnpm smoke:stripe
 *
 * Mutates demo data: pays one open demo invoice and (once) stores the
 * test-mode Stripe gateway config on the demo org. Reset with db:reset.
 */
import "../lib/env/load-dotenv";
import { authDb, db } from "../lib/db/prisma";
import { runWithOrgContext } from "../lib/tenancy/context";

async function main() {
  const results: Array<{ step: string; ok: boolean; detail: string }> = [];
  const record = (step: string, ok: boolean, detail: string) => {
    results.push({ step, ok, detail });
    console.log(`${ok ? "✅" : "❌"} ${step}: ${detail}`);
  };

  const org = await authDb.organization.findFirst({
    where: { slug: "propertypro-demo" },
  });
  if (!org) throw new Error("demo org not found");

  await runWithOrgContext(
    { organizationId: org.id, isPlatformAdmin: false },
    async () => {
      // 0. Ensure the demo org has a Stripe gateway config (what a real org
      // does in Settings → Payments) — the per-org rail has NO env fallback
      // by design.
      const { encryptSensitiveValue } = await import(
        "../lib/security/field-encryption"
      );
      const secretKey = process.env.STRIPE_SECRET_KEY;
      const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
      if (!secretKey?.startsWith("sk_test_")) {
        throw new Error("refusing to run: STRIPE_SECRET_KEY is not a test key");
      }
      const settingsRow = await db.systemSettings.findFirst({
        where: { organizationId: org.id },
      });
      const gateways = ((settingsRow?.paymentGateways as any) ?? {}) as Record<
        string,
        unknown
      >;
      if (!(gateways.stripe as any)?.enabled) {
        const stripeGateway = {
          enabled: true,
          publishableKey: publishableKey ?? "",
          secretKey: encryptSensitiveValue(secretKey),
        };
        if (settingsRow) {
          await db.systemSettings.update({
            where: { id: settingsRow.id },
            data: {
              paymentGateways: { ...gateways, stripe: stripeGateway } as any,
            },
          });
        } else {
          await db.systemSettings.create({
            data: {
              organizationId: org.id,
              paymentGateways: { stripe: stripeGateway } as any,
            },
          });
        }
        record("seed gateway config", true, "stripe test-mode creds stored (encrypted)");
      } else {
        record("gateway config", true, "already configured");
      }

      const { stripePaymentService } = await import(
        "../lib/services/stripe-payment.service"
      );
      const { getStripeClient } = await import(
        "../lib/services/payment-config.service"
      );
      const { confirmPayment, handleWebhookEvent } = await import(
        "../lib/stripe"
      );
      const { receiptGenerationService } = await import(
        "../lib/services/receipt-generation.service"
      );

      // 1. Pick the smallest unpaid invoice with a tenant.
      const invoice = await db.invoice.findFirst({
        where: {
          balanceRemaining: { gt: 0 },
          status: { in: ["issued", "overdue", "partial"] },
          deletedAt: null,
        },
        orderBy: { balanceRemaining: "asc" },
        include: {
          tenant: { select: { id: true, email: true, firstName: true, lastName: true } },
        },
      });
      if (!invoice || !invoice.tenant?.email || !invoice.tenantId || !invoice.propertyId) {
        throw new Error("no unpaid invoice with tenant email found");
      }
      const before = {
        amountPaid: Number(invoice.amountPaid),
        balance: Number(invoice.balanceRemaining),
        status: invoice.status,
        version: invoice.version,
        paymentIds: invoice.paymentIds?.length ?? 0,
      };
      const amount = Number(invoice.balanceRemaining);
      record(
        "pick invoice",
        true,
        `${invoice.invoiceNumber} balance=${amount} status=${invoice.status}`
      );

      // 2. Stripe connectivity + customer (per-org creds resolution).
      const customer = await stripePaymentService.createOrGetCustomer(
        invoice.tenant.id,
        invoice.tenant.email,
        `${invoice.tenant.firstName ?? ""} ${invoice.tenant.lastName ?? ""}`.trim()
      );
      record("stripe customer", customer.id.startsWith("cus_"), customer.id);

      // 3. Payment intent through the app's function (currency-aware units).
      const intent = await stripePaymentService.createPaymentIntent(
        amount,
        customer.id,
        undefined,
        { invoiceId: invoice.id, smoke: "true" },
        String(invoice.currency ?? "USD").toLowerCase()
      );
      const unitsOk = Math.round(amount * 100) === Math.round(intent.amount * 100);
      record(
        "create intent",
        intent.id.startsWith("pi_") && unitsOk,
        `${intent.id} amount=${intent.amount} ${intent.currency} (expected ${amount})`
      );

      // 4. PENDING payment row, like the invoice stripe-payment route.
      const payment = await db.payment.create({
        data: {
          organizationId: org.id,
          invoiceId: invoice.id,
          tenantId: invoice.tenantId,
          propertyId: invoice.propertyId,
          leaseId: invoice.leaseId,
          amount,
          type: "invoice",
          status: "pending",
          paymentMethod: "credit_card",
          dueDate: invoice.dueDate,
          description: `SMOKE TEST payment for ${invoice.invoiceNumber}`,
          stripePaymentIntentId: intent.id,
        },
      });
      record("payment row", true, payment.id);

      // 5. Confirm with the Stripe test card.
      const stripe = await getStripeClient();
      const confirmed = await stripe.paymentIntents.confirm(intent.id, {
        payment_method: "pm_card_visa",
        return_url: "https://example.com/return",
      });
      record(
        "confirm test card",
        confirmed.status === "succeeded",
        `status=${confirmed.status}`
      );

      // 6. Settle exactly the way the app does after confirmation.
      const settled = await confirmPayment(intent.id);
      const paidPayment = await db.payment.findFirst({ where: { id: payment.id } });
      record(
        "settlement",
        settled === true && paidPayment?.status === "paid" &&
          Number(paidPayment?.amountPaid) === amount,
        `payment.status=${paidPayment?.status} amountPaid=${paidPayment?.amountPaid} version=${paidPayment?.version}`
      );

      // 7. Invoice application.
      const after = await db.invoice.findFirst({ where: { id: invoice.id } });
      const applied =
        Number(after?.amountPaid) === before.amountPaid + amount &&
        Number(after?.balanceRemaining) === 0 &&
        after?.status === "paid" &&
        (after?.paymentIds ?? []).includes(payment.id) &&
        (after?.version ?? 0) > before.version;
      record(
        "invoice applied",
        applied,
        `amountPaid ${before.amountPaid}→${after?.amountPaid}, balance ${before.balance}→${after?.balanceRemaining}, status ${before.status}→${after?.status}, version ${before.version}→${after?.version}`
      );

      // 8. Idempotency: settle again + replay the webhook event shape.
      await confirmPayment(intent.id);
      await handleWebhookEvent({
        id: "evt_smoke_replay",
        type: "payment_intent.succeeded",
        data: { object: confirmed },
      } as any);
      const replay = await db.invoice.findFirst({ where: { id: invoice.id } });
      const idempotent =
        Number(replay?.amountPaid) === Number(after?.amountPaid) &&
        (replay?.paymentIds ?? []).length === (after?.paymentIds ?? []).length;
      record(
        "idempotent replay",
        idempotent,
        `amountPaid stays ${replay?.amountPaid}, paymentIds stays ${(replay?.paymentIds ?? []).length}`
      );

      // 9. Out-of-order guard: a late `processing` event must not regress PAID.
      await handleWebhookEvent({
        id: "evt_smoke_late_processing",
        type: "payment_intent.processing",
        data: { object: { ...confirmed, status: "processing" } },
      } as any);
      const afterLate = await db.payment.findFirst({ where: { id: payment.id } });
      record(
        "out-of-order guard",
        afterLate?.status === "paid",
        `late processing event → payment.status=${afterLate?.status}`
      );

      // 10. Receipt generation, twice (idempotent).
      const r1 = await receiptGenerationService.generateReceiptForPayment(
        payment.id,
        false
      );
      const r2 = await receiptGenerationService.generateReceiptForPayment(
        payment.id,
        false
      );
      record(
        "receipt idempotent",
        Boolean(r1.success && r2.success && r1.receiptId === r2.receiptId),
        `receipt=${r1.receiptNumber} (second run returned same: ${r1.receiptId === r2.receiptId}) pdf=${r1.pdfPath ?? "null (R2 not configured)"}`
      );
    }
  );

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n${failed.length === 0 ? "ALL PASSED" : `${failed.length} FAILED`} (${results.length} checks)`
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("SMOKE TEST ERROR:", error);
  process.exit(1);
});
