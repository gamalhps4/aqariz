/**
 * PropertyPro - Who recorded a payment
 *
 * The client asked to see which employee recorded each payment. Every staff
 * recording path stamps `recordedById`. An online payment has no person behind
 * it — the gateway captured the money — so it reads "Online". Rows written
 * before the column existed, and not recovered by the backfill, have nobody on
 * record.
 */

/** What the API reads from the recorder's user row. */
export const PAYMENT_RECORDER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
} as const;

export interface PaymentRecorderFields {
  recordedBy?: { firstName?: string | null; lastName?: string | null } | null;
  /** The member of staff who recorded it, where the read selected the column. */
  recordedById?: string | null;
  /** Any gateway's reference (lib/payments/gateway-reference.ts); read where selected. */
  gatewayPaymentId?: string | null;
  stripePaymentIntentId?: string | null;
  stripeCheckoutSessionId?: string | null;
  paypalCaptureId?: string | null;
  razorpayPaymentId?: string | null;
  paystackReference?: string | null;
}

/**
 * Taken by a payment gateway rather than recorded at the desk. The same
 * references `deleteRecordedPayment` treats as "collected online": any
 * gateway's, or Stripe's and PayPal's own columns on rows from before it.
 *
 * A person wins over the reference: a checkout opened and abandoned, then
 * paid by card at the office's terminal, keeps the checkout's reference but
 * the money is the terminal's (POS clearing in the books, not the gateway's).
 */
export function isOnlinePayment(payment: PaymentRecorderFields): boolean {
  if (payment.recordedById || recorderName(payment)) return false;
  return Boolean(
    payment.gatewayPaymentId ||
      payment.stripePaymentIntentId ||
      payment.stripeCheckoutSessionId ||
      payment.paypalCaptureId ||
      payment.razorpayPaymentId ||
      payment.paystackReference,
  );
}

/** The recorder's name, or null when no person is on record. */
export function recorderName(payment: PaymentRecorderFields): string | null {
  const name = [payment.recordedBy?.firstName, payment.recordedBy?.lastName]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(" ");
  return name || null;
}

/**
 * What a "Recorded by" cell shows: the employee; `onlineLabel` for a gateway
 * payment; null when nobody is on record. A person wins over the gateway —
 * staff can record by hand a payment that was first opened as a checkout.
 */
export function recordedByText(
  payment: PaymentRecorderFields,
  onlineLabel: string,
): string | null {
  return (
    recorderName(payment) ?? (isOnlinePayment(payment) ? onlineLabel : null)
  );
}
