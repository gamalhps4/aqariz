/**
 * PropertyPro - Money held as a tenant's credit
 *
 * A gateway can take money the payment it was raised for no longer needs —
 * most often a tenant who opened the online checkout, paid at the desk, and
 * then finished the gateway's page anyway. That money is never dropped: it is
 * recorded as a payment of its own (type "other", paid, applied to no
 * installment), marked by a "credit" entry in its history, with the payment
 * it came in for as its parent. The office refunds it from there (through the
 * same gateway) or keeps it on account.
 *
 * In the books it is the tenant's credit, not income: the money is received
 * and the tenant's receivable credited (lib/accounting/posting/payment.ts).
 *
 * Pure: the history in, the answer out.
 */

/** The history event that marks a payment as a held credit. */
export const TENANT_CREDIT_EVENT = "credit";

/** Why gateway money could not settle the payment it was raised for. */
export type TenantCreditReason = "paid-at-desk" | "closed-payment" | "other-payment";

export interface TenantCreditEntry {
  event: typeof TENANT_CREDIT_EVENT;
  amount: number;
  paymentMethod: string;
  paidDate: string;
  at: string;
  /** The payment the money came in for. */
  creditOf: string;
  reason: TenantCreditReason;
  gateway: string;
  transactionId: string;
  notes: string;
}

/** Whether a payment is money held as the tenant's credit. */
export function isTenantCreditPayment(paymentHistory: unknown): boolean {
  return (
    Array.isArray(paymentHistory) &&
    paymentHistory.some(
      (entry) =>
        Boolean(entry) &&
        typeof entry === "object" &&
        (entry as { event?: unknown }).event === TENANT_CREDIT_EVENT,
    )
  );
}

const REASON_NOTES: Record<TenantCreditReason, string> = {
  "paid-at-desk": "the payment had already been recorded at the office",
  "closed-payment": "the payment was already settled, refunded or cancelled",
  "other-payment": "the gateway named another payment",
};

/** The history entry a held credit starts with. */
export function tenantCreditEntry(input: {
  amount: number;
  paymentMethod: string;
  at: Date;
  creditOf: string;
  reason: TenantCreditReason;
  gateway: string;
  gatewayName: string;
  transactionId: string;
}): TenantCreditEntry {
  return {
    event: TENANT_CREDIT_EVENT,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    paidDate: input.at.toISOString(),
    at: input.at.toISOString(),
    creditOf: input.creditOf,
    reason: input.reason,
    gateway: input.gateway,
    transactionId: input.transactionId,
    notes: `Paid through ${input.gatewayName} after ${REASON_NOTES[input.reason]}: held as the tenant's credit.`,
  };
}
