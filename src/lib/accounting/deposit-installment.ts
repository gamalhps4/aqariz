/**
 * PropertyPro - A security deposit billed as an installment
 *
 * A contract's deposit is usually billed as an installment of its own — an
 * invoice of category `security_deposit`, or on older contracts a payment row
 * of type `security_deposit` — and paid like one, and that payment puts it in
 * the books (./posting/invoice.ts, ./posting/payment.ts). The deposit card's
 * "Confirm collection" then marked the deposit record collected with no
 * payment behind it, so the record posted a receipt of its own as well: the
 * bank and the deposits held twice over, and on an owner's building their
 * payable too.
 *
 * Two rules close it: collecting a deposit links the payment that paid its
 * installment, and a deposit whose installment took money never posts a
 * receipt of its own. A deposit with no installment at all is still collected
 * on the record and posted from it.
 *
 * Pure; the loaders are in ./deposit-installment.service.ts.
 */

import { InvoiceStatus, InvoiceType, PaymentStatus, PaymentType } from "@/types";
import { paymentAllocations } from "./posting/allocations";

/** The invoice category, and the payment type, of a security deposit. */
export const DEPOSIT_INSTALLMENT_CATEGORY: string = InvoiceType.SECURITY_DEPOSIT;
export const DEPOSIT_PAYMENT_TYPE: string = PaymentType.SECURITY_DEPOSIT;

/** A payment under these holds money it took. */
export const DEPOSIT_HOLDING_STATUSES: readonly string[] = [
  PaymentStatus.PAID,
  PaymentStatus.PARTIAL,
];

/** A deposit installment in these is still waiting to be paid. */
export const OPEN_INVOICE_STATUSES: readonly string[] = [
  InvoiceStatus.SCHEDULED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
];
export const OPEN_PAYMENT_STATUSES: readonly string[] = [
  PaymentStatus.PENDING,
  PaymentStatus.OVERDUE,
];

export interface DepositPaymentFacts {
  id: string;
  type: string;
  status: string;
  invoiceId: string | null;
  allocations: unknown;
  paymentHistory: unknown;
  amount: unknown;
  amountPaid: unknown;
  paidDate: Date | null;
  createdAt: Date;
  deletedAt?: Date | null;
}

function collected(payment: DepositPaymentFacts): number {
  return Number(payment.amountPaid) || Number(payment.amount) || 0;
}

/**
 * The payments that paid a contract's security deposit, latest first: those
 * holding money that are a deposit payment row, or that were applied to one
 * of the contract's deposit installments (`depositInvoiceIds`).
 */
export function depositInstallmentPayments<T extends DepositPaymentFacts>(
  payments: readonly T[],
  depositInvoiceIds: Iterable<string>,
): T[] {
  const installments = new Set(depositInvoiceIds);
  const day = (payment: T) => (payment.paidDate ?? payment.createdAt).getTime();
  return payments
    .filter((payment) => {
      if (payment.deletedAt) return false;
      if (!DEPOSIT_HOLDING_STATUSES.includes(payment.status)) return false;
      if (collected(payment) <= 0) return false;
      if (payment.type === DEPOSIT_PAYMENT_TYPE) return true;
      return paymentAllocations({
        allocations: payment.allocations,
        invoiceId: payment.invoiceId,
        collected: collected(payment),
        paymentHistory: payment.paymentHistory,
      }).some((allocation) => installments.has(allocation.invoiceId));
    })
    .sort((a, b) => day(b) - day(a));
}

/**
 * Whether a collected deposit posts a receipt from its own record. Not when a
 * payment posted it: the one it was collected with, or one that paid its
 * installment.
 */
export function depositPostsOwnReceipt(deposit: {
  collectedPaymentId: string | null;
  installmentPaid?: boolean;
}): boolean {
  return !deposit.collectedPaymentId && !deposit.installmentPaid;
}

export type DepositCollection =
  | { action: "link"; paymentId: string; collectedDate: Date }
  /** No installment at all: the record is the receipt. */
  | { action: "record" }
  | {
      action: "refuse";
      /** An installment is billed and not paid yet: record its payment first. */
      code: "DEPOSIT_INSTALLMENT_UNPAID" | "DEPOSIT_PAYMENT_MISMATCH";
    };

/**
 * What "Confirm collection" does. `paid` is `depositInstallmentPayments` for
 * the contract; `openInstallment` says a deposit installment is still unpaid.
 * A payment the caller names must be one of `paid`.
 */
export function planDepositCollection(input: {
  paid: readonly DepositPaymentFacts[];
  openInstallment: boolean;
  requestedPaymentId?: string | null;
  now: Date;
}): DepositCollection {
  const link = (payment: DepositPaymentFacts): DepositCollection => ({
    action: "link",
    paymentId: payment.id,
    collectedDate: payment.paidDate ?? input.now,
  });
  if (input.requestedPaymentId) {
    const named = input.paid.find((payment) => payment.id === input.requestedPaymentId);
    return named ? link(named) : { action: "refuse", code: "DEPOSIT_PAYMENT_MISMATCH" };
  }
  if (input.paid.length > 0) return link(input.paid[0]);
  if (input.openInstallment) return { action: "refuse", code: "DEPOSIT_INSTALLMENT_UNPAID" };
  return { action: "record" };
}
