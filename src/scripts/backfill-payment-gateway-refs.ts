/**
 * PropertyPro - Backfill the generic gateway reference on payments
 *
 * Dry run (reads only):
 *   NODE_OPTIONS=--conditions=react-server node_modules/.bin/tsx \
 *     --env-file=.env.local --tsconfig tsconfig.json \
 *     src/scripts/backfill-payment-gateway-refs.ts
 * Write: the same command with `--apply`. A second dry run must report 0.
 *
 * Migration 20261004140000_payment_gateway_reference adds
 * `payments.gatewayProvider` + `payments.gatewayPaymentId`, empty on every
 * existing row. This copies each row's Stripe or PayPal reference across, as
 * lib/payments/gateway-reference.ts `legacyGatewayReference` chooses it: the
 * payment intent over the checkout session, the capture over the order —
 * what a refund names.
 *
 * Only empty rows are written, archived ones included. A reference already
 * held by another payment (the pair is unique) is reported and left alone, as
 * is the second of two rows naming the same one. Raw SQL, so `updatedAt`
 * keeps its value: "last updated" still means a change someone made.
 */

import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";
import { legacyGatewayReference } from "@/lib/payments/gateway-reference";

const APPLY = process.argv.includes("--apply");

interface Candidate {
  id: string;
  organizationId: string;
  createdAt: Date;
  stripePaymentIntentId: string | null;
  stripeCheckoutSessionId: string | null;
  paypalCaptureId: string | null;
  paypalOrderId: string | null;
}

async function columnsPresent(): Promise<boolean> {
  const rows = await db.$queryRaw<Array<{ present: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = current_schema()
         AND table_name = 'payments'
         AND column_name = 'gatewayPaymentId'
    ) AS present`;
  return Boolean(rows[0]?.present);
}

async function main(): Promise<void> {
  await bypassOrgScope(async () => {
    if (!(await columnsPresent())) {
      throw new Error(
        "payments.gatewayPaymentId does not exist: apply migration 20261004140000_payment_gateway_reference first.",
      );
    }

    const candidates = await db.$queryRaw<Candidate[]>`
      SELECT id, "organizationId", "createdAt",
             "stripePaymentIntentId", "stripeCheckoutSessionId",
             "paypalCaptureId", "paypalOrderId"
        FROM payments
       WHERE "gatewayPaymentId" IS NULL
         AND ("stripePaymentIntentId" IS NOT NULL
           OR "stripeCheckoutSessionId" IS NOT NULL
           OR "paypalCaptureId" IS NOT NULL
           OR "paypalOrderId" IS NOT NULL)
       ORDER BY "createdAt" ASC, id ASC`;

    const held = await db.$queryRaw<Array<{ id: string; provider: string; reference: string }>>`
      SELECT id, "gatewayProvider" AS provider, "gatewayPaymentId" AS reference
        FROM payments
       WHERE "gatewayPaymentId" IS NOT NULL`;
    const holder = new Map(held.map((row) => [`${row.provider}:${row.reference}`, row.id]));

    const organizations = await db.organization.findMany({
      where: { deletedAt: undefined },
      select: { id: true, name: true, slug: true },
    });
    const orgName = new Map(organizations.map((org) => [org.id, `${org.name} (${org.slug})`]));

    const planned: Array<{ id: string; organizationId: string; provider: string; reference: string }> = [];
    const skipped: string[] = [];
    const tally = new Map<string, { organization: string; stripe: number; paypal: number; skipped: number }>();
    const countFor = (orgId: string) => {
      let entry = tally.get(orgId);
      if (!entry) {
        entry = { organization: orgName.get(orgId) ?? orgId, stripe: 0, paypal: 0, skipped: 0 };
        tally.set(orgId, entry);
      }
      return entry;
    };

    for (const row of candidates) {
      const reference = legacyGatewayReference(row);
      if (!reference) continue;
      const key = `${reference.provider}:${reference.id}`;
      const counts = countFor(row.organizationId);
      const owner = holder.get(key);
      if (owner && owner !== row.id) {
        counts.skipped += 1;
        skipped.push(`${row.id}: ${key} is already on payment ${owner}`);
        continue;
      }
      holder.set(key, row.id);
      planned.push({ id: row.id, organizationId: row.organizationId, provider: reference.provider, reference: reference.id });
      if (reference.provider === "stripe") counts.stripe += 1;
      else counts.paypal += 1;
    }

    console.log(`Payments with a Stripe/PayPal reference and no generic one: ${candidates.length}`);
    if (tally.size > 0) console.table([...tally.values()]);
    for (const line of skipped) console.log(`Left alone: ${line}`);

    if (!APPLY) {
      console.log(
        `Dry run — nothing written. ${planned.length} payment(s) would be filled; re-run with --apply to write.`,
      );
      return;
    }

    const written = new Map<string, string[]>();
    let changedSinceRead = 0;
    for (const item of planned) {
      const count = await db.$executeRaw`
        UPDATE payments
           SET "gatewayProvider" = ${item.provider},
               "gatewayPaymentId" = ${item.reference}
         WHERE id = ${item.id}
           AND "gatewayPaymentId" IS NULL`;
      if (count !== 1) {
        changedSinceRead += 1;
        continue;
      }
      const list = written.get(item.organizationId) ?? [];
      list.push(item.id);
      written.set(item.organizationId, list);
    }

    let total = 0;
    for (const [orgId, ids] of written) {
      total += ids.length;
      await recordPlatformAudit({
        actor: SYSTEM_ACTOR,
        action: "payment.gateway_refs_backfilled",
        targetType: "organization",
        targetId: orgId,
        targetName: orgName.get(orgId) ?? orgId,
        organizationId: orgId,
        summary: `Copied the Stripe/PayPal reference of ${ids.length} payment(s) into the gateway reference`,
        metadata: { script: "src/scripts/backfill-payment-gateway-refs.ts", payments: ids },
      });
    }

    console.log(
      `Wrote ${total} payment(s).` +
        (changedSinceRead
          ? ` ${changedSinceRead} changed since they were read and were left alone — run again to pick them up.`
          : ""),
    );
  });
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
