/**
 * PropertyPro - Which gateway took a payment, and its reference there
 *
 * `payments.gatewayProvider` + `payments.gatewayPaymentId` (migration
 * 20261004100000_payment_gateway_reference) hold it for every gateway. Rows
 * from before them carry Stripe's or PayPal's own columns, which the backfill
 * (src/scripts/backfill-payment-gateway-refs.ts) copies across; until the
 * migration reaches a database the old columns are all there is, so they
 * stay the fallback here.
 *
 * Pure: the row in, the reference out.
 */

export interface GatewayReferenceRow {
  gatewayProvider?: string | null;
  gatewayPaymentId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  paypalCaptureId?: string | null;
  razorpayPaymentId?: string | null;
  paystackReference?: string | null;
}

export interface GatewayReference {
  provider: string;
  id: string;
}

/** The gateway reference on a payment row — the generic columns first. */
export function gatewayReferenceOf(row: GatewayReferenceRow): GatewayReference | null {
  if (row.gatewayProvider && row.gatewayPaymentId) {
    return { provider: row.gatewayProvider, id: row.gatewayPaymentId };
  }
  if (row.stripePaymentIntentId) return { provider: "stripe", id: row.stripePaymentIntentId };
  if (row.stripeCheckoutSessionId) return { provider: "stripe", id: row.stripeCheckoutSessionId };
  if (row.paypalCaptureId) return { provider: "paypal", id: row.paypalCaptureId };
  if (row.razorpayPaymentId) return { provider: "razorpay", id: row.razorpayPaymentId };
  if (row.paystackReference) return { provider: "paystack", id: row.paystackReference };
  return null;
}

/** What the backfill copies into the generic columns for a pre-migration row. */
export function legacyGatewayReference(row: {
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  paypalCaptureId?: string | null;
  paypalOrderId?: string | null;
}): GatewayReference | null {
  // The payment intent and the capture are what a refund names; the session
  // and the order only stand in when nothing was taken on them.
  if (row.stripePaymentIntentId) return { provider: "stripe", id: row.stripePaymentIntentId };
  if (row.stripeCheckoutSessionId) return { provider: "stripe", id: row.stripeCheckoutSessionId };
  if (row.paypalCaptureId) return { provider: "paypal", id: row.paypalCaptureId };
  if (row.paypalOrderId) return { provider: "paypal", id: row.paypalOrderId };
  return null;
}

/** Stripe's dashboard page for a payment intent — the one gateway link the history shows. */
export function stripeDashboardUrl(reference: GatewayReference | null): string | null {
  if (reference?.provider !== "stripe" || !reference.id.startsWith("pi_")) return null;
  return `https://dashboard.stripe.com/payments/${encodeURIComponent(reference.id)}`;
}
