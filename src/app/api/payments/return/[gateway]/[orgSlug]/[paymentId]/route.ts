/**
 * PropertyPro - Where a gateway sends the payer back
 *
 *   GET|POST /api/payments/return/<gateway>/<org-slug>/<payment-id>?to=<dashboard path>
 *
 * Every gateway's hosted page returns the payer here — Stripe, PayPal, Moyasar
 * and Tap with a GET, PayTabs with a form POST. Nothing the browser brings is
 * trusted: the payment's own stored reference is looked up with the gateway,
 * using the office's credentials, and what the gateway says is recorded
 * through the same path as the webhook (lib/payments/gateway-settle.ts). For
 * PayPal this is also where the approved order is captured.
 *
 * No session is needed or read. A cross-site POST (PayTabs) arrives without
 * the session cookie anyway, and recording what the gateway itself confirms
 * is safe whoever asks; the organization comes from the slug, as for
 * webhooks, and everything after runs under its row-level security.
 *
 * Then a 303 to the dashboard page the checkout named, with
 * `?payment=success|pending|failed|canceled`.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { PaymentStatus } from "@/types";
import { isGatewayId } from "@/lib/payments/gateway-registry";
import { getGatewayAdapter } from "@/lib/payments/adapters";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
import { applyGatewayState } from "@/lib/payments/gateway-settle";
import { safeReturnPath } from "@/lib/payments/gateway-checkout";
import { getStoredGatewayCredentials } from "@/lib/services/payment-config.service";
import { resolveApplicationOrigin } from "@/lib/billing/origin";
import { checkRateLimitByKey } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

type Outcome = "success" | "pending" | "failed" | "canceled";

const RECEIVED: readonly string[] = [PaymentStatus.PAID, PaymentStatus.PARTIAL];

async function handle(
  request: NextRequest,
  context: { params: Promise<{ gateway: string; orgSlug: string; paymentId: string }> },
): Promise<NextResponse> {
  const { gateway, orgSlug, paymentId } = await context.params;
  const query = request.nextUrl.searchParams;
  const to = safeReturnPath(query.get("to"), "/dashboard/payments");
  const origin = resolveApplicationOrigin(request);
  const done = (outcome: Outcome) =>
    NextResponse.redirect(`${origin}${to}?payment=${outcome}`, 303);

  if (!isGatewayId(gateway)) return done("failed");
  if (query.get("outcome") === "cancel") return done("canceled");

  // Each return asks the gateway once; a flood of them asks nobody.
  const limit = await checkRateLimitByKey(`gateway-return:${paymentId}`, 60_000, 20);
  if (!limit.success) return done("pending");

  const organization = await bypassOrgScope(() =>
    db.organization.findFirst({ where: { slug: orgSlug, deletedAt: null }, select: { id: true } }),
  );
  if (!organization) return done("failed");

  return runWithOrgContext({ organizationId: organization.id, isPlatformAdmin: false }, async () => {
    const payment = await db.payment.findFirst({
      where: { id: paymentId },
      omit: await gatewayColumnsOmit(),
    });
    if (!payment) return done("failed");
    if (RECEIVED.includes(payment.status)) return done("success");

    // Only the attempt this payment is waiting on, through the gateway it was opened with.
    const reference =
      payment.gatewayProvider === gateway && payment.gatewayPaymentId ? payment.gatewayPaymentId : null;
    if (!reference) return done("pending");

    let state;
    try {
      const credentials = await getStoredGatewayCredentials(gateway);
      state = await getGatewayAdapter(gateway).confirmPayment({ credentials }, reference);
    } catch (error) {
      // The webhook will record it; the page says it is being confirmed.
      console.error(`${gateway} could not confirm payment ${paymentId} on return`, error);
      return done("pending");
    }
    if (!state) return done("failed");

    try {
      await applyGatewayState(gateway, payment, state);
    } catch (error) {
      console.error(`Recording the ${gateway} payment ${paymentId} on return failed`, error);
      return done("pending");
    }

    const current = await db.payment.findFirst({ where: { id: paymentId }, select: { status: true } });
    if (current && RECEIVED.includes(current.status)) return done("success");
    return done(state.status === "pending" ? "pending" : "failed");
  });
}

export const GET = handle;
export const POST = handle;
