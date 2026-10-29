/**
 * PropertyPro - Whether a payment may be paid online right now
 *
 * A card charge is only worth raising if the books can take the money
 * afterwards. POST /api/payments/create-intent raised one for any payment
 * that was not already paid: a refunded or cancelled one, a part-paid one
 * (for the full amount again), one whose installment the office had since
 * settled at the desk. The tenant was charged, and the charge then could not
 * be recorded — or was recorded on top of money already there.
 *
 * These are the rules `recordInstallmentPayment` applies when it records the
 * money (lib/services/payment-invoice-linking.service.ts), asked before the
 * tenant is charged instead of after.
 */

import { InvoiceStatus, PaymentStatus } from "@/types";

/** What the rules read from the payment row. */
export interface PayablePayment {
  status: string;
  amount: number;
  amountPaid?: number | null;
}

/** What the rules read from the installment (invoice) the payment belongs to. */
export interface PayableInstallment {
  status: string;
  balanceRemaining: number;
}

/**
 * The statuses a payment can be in while no money has been recorded on it —
 * the ones `recordInstallmentPayment` will turn into a receipt. A refunded,
 * cancelled or part-paid row is history, not a bill.
 */
const AWAITING_MONEY: readonly string[] = [
  PaymentStatus.PENDING,
  PaymentStatus.OVERDUE,
  PaymentStatus.FAILED,
];

/** A payment still waiting for all of its money. */
export function isAwaitingMoney(payment: PayablePayment): boolean {
  return (
    AWAITING_MONEY.includes(payment.status) &&
    Number(payment.amountPaid ?? 0) === 0
  );
}

/**
 * Why this payment cannot be paid online, worded to finish the sentence
 * "This payment cannot be paid online: …" — or null when it can.
 *
 * `installment` is the invoice the payment belongs to: leave it out for a
 * payment that has none, pass null for one whose invoice is gone.
 */
export function onlinePaymentRefusal(
  payment: PayablePayment,
  installment?: PayableInstallment | null,
): string | null {
  if (!AWAITING_MONEY.includes(payment.status)) {
    return payment.status === PaymentStatus.PARTIAL
      ? "it is part-paid"
      : `it is ${payment.status}`;
  }
  if (Number(payment.amountPaid ?? 0) !== 0) {
    return "money is already recorded against it";
  }

  if (installment === undefined) return null;
  if (installment === null) {
    return "its installment no longer exists";
  }
  if (installment.status === InvoiceStatus.CANCELLED) {
    return "its installment is cancelled";
  }
  if (installment.balanceRemaining <= 0) {
    return "its installment is already fully paid";
  }
  // The half-halala of slack recordInstallmentPayment allows.
  if (payment.amount > installment.balanceRemaining + 0.005) {
    return `only ${installment.balanceRemaining.toFixed(2)} is left on its installment`;
  }

  return null;
}
