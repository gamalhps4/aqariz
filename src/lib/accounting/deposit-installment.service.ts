/**
 * PropertyPro - Reading a contract's security deposit installments
 *
 * The rules are in ./deposit-installment.ts; this reads what they judge: the
 * contract's deposit installments and the payments that paid them. Used by
 * the deposit card's "Confirm collection" and by every path that posts a
 * deposit (the document hook and the ledger sweep).
 */

import { db } from "@/lib/db/prisma";
import {
  DEPOSIT_HOLDING_STATUSES,
  DEPOSIT_INSTALLMENT_CATEGORY,
  DEPOSIT_PAYMENT_TYPE,
  OPEN_INVOICE_STATUSES,
  OPEN_PAYMENT_STATUSES,
  depositInstallmentPayments,
  type DepositPaymentFacts,
} from "./deposit-installment";

const DEPOSIT_PAYMENT_SELECT = {
  id: true,
  leaseId: true,
  type: true,
  status: true,
  invoiceId: true,
  allocations: true,
  paymentHistory: true,
  amount: true,
  amountPaid: true,
  paidDate: true,
  createdAt: true,
  deletedAt: true,
} as const;

export interface DepositInstallments {
  /** The payments that paid the deposit, latest first. */
  paid: DepositPaymentFacts[];
  /** A deposit installment is billed and still waiting to be paid. */
  open: boolean;
}

/** Each contract's deposit installments, as the rules need them. */
export async function depositInstallmentsByLease(
  leaseIds: readonly string[],
): Promise<Map<string, DepositInstallments>> {
  const ids = [...new Set(leaseIds.filter(Boolean))];
  const result = new Map<string, DepositInstallments>();
  if (ids.length === 0) return result;

  const [invoices, payments] = await Promise.all([
    db.invoice.findMany({
      // Archived installments too: a payment applied to one still paid it.
      where: { leaseId: { in: ids }, category: DEPOSIT_INSTALLMENT_CATEGORY, deletedAt: undefined },
      select: { id: true, leaseId: true, status: true, deletedAt: true },
    }),
    db.payment.findMany({
      where: {
        leaseId: { in: ids },
        OR: [
          { status: { in: [...DEPOSIT_HOLDING_STATUSES] } },
          { type: DEPOSIT_PAYMENT_TYPE, status: { in: [...OPEN_PAYMENT_STATUSES] } },
        ],
      },
      select: DEPOSIT_PAYMENT_SELECT,
    }),
  ]);

  for (const leaseId of ids) {
    const installments = invoices.filter((invoice) => invoice.leaseId === leaseId);
    const own = payments.filter((payment) => payment.leaseId === leaseId);
    result.set(leaseId, {
      paid: depositInstallmentPayments(
        own as DepositPaymentFacts[],
        installments.map((invoice) => invoice.id),
      ),
      open:
        installments.some(
          (invoice) => !invoice.deletedAt && OPEN_INVOICE_STATUSES.includes(invoice.status),
        ) ||
        own.some(
          (payment) =>
            payment.type === DEPOSIT_PAYMENT_TYPE && OPEN_PAYMENT_STATUSES.includes(payment.status),
        ),
    });
  }
  return result;
}

/** The contracts among `leaseIds` whose deposit a payment has paid. */
export async function paidDepositLeaseIds(leaseIds: readonly string[]): Promise<Set<string>> {
  const byLease = await depositInstallmentsByLease(leaseIds);
  return new Set(
    [...byLease].filter(([, installments]) => installments.paid.length > 0).map(([id]) => id),
  );
}
