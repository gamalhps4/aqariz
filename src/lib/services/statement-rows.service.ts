/**
 * PropertyPro - The rows of a statement
 *
 * Every payment received in a period, one row each with its date, note and
 * receipt, and every expense deducted — as the owner statement, the
 * agreement statement and the agreement report print them. The client asked
 * for exactly this: "each payment, its notes and its date … rather than as a
 * total amount". One loader, so the three can never list the same payment
 * differently.
 */

import { db } from "@/lib/db/prisma";
import { ExpenseStatus, PaymentStatus } from "@/types";
import { isReceivedByOwner } from "@/lib/payments/methods";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import {
  leaseInstallmentPlan,
  normalizeFrequency,
  summarizeInstallments,
} from "@/lib/lease-installments";
import type {
  StatementExpenseRow,
  StatementPaymentRow,
} from "@/types/owner";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * The expenses a statement deducts from the owner's share: approved and paid
 * (decided 2026-09-29). A pending expense is a request nobody has approved
 * yet, and a cancelled one was never spent.
 */
export const DEDUCTED_EXPENSE_STATUSES: readonly string[] = [
  ExpenseStatus.APPROVED,
  ExpenseStatus.PAID,
];

/** What the money was received against — the payment reads it all at once. */
const PAYMENT_ROW_SELECT = {
  id: true,
  propertyId: true,
  leaseId: true,
  paidDate: true,
  createdAt: true,
  amount: true,
  amountPaid: true,
  currency: true,
  type: true,
  paymentMethod: true,
  notes: true,
  tenant: { select: { firstName: true, lastName: true } },
  property: { select: { name: true } },
  receipt: { select: { receiptNumber: true } },
  lease: {
    select: {
      contractNumber: true,
      paymentFrequency: true,
      startDate: true,
      endDate: true,
      rentAmount: true,
      contractAmount: true,
      electricityAmount: true,
      waterAmount: true,
      taxEnabled: true,
      taxRate: true,
      terms: true,
      unitId: true,
      unit: { select: { unitNumber: true } },
    },
  },
} as const;

export interface StatementRowsScope {
  propertyIds: readonly string[];
  startDate: Date;
  endDate: Date;
  /**
   * One unit: only the payments of the contracts written on it, only the
   * expenses spent on it. A payment reaches a unit through its contract —
   * the payment itself names a building and a lease, never a unit.
   */
  unitId?: string;
}

/**
 * Every payment received in the period, oldest first. Money that landed in
 * the period belongs to it, whenever it was recorded — the same paid-date
 * rule every statement total uses.
 */
export async function loadStatementPayments(
  scope: StatementRowsScope,
): Promise<StatementPaymentRow[]> {
  if (scope.propertyIds.length === 0) return [];

  const payments = await db.payment.findMany({
    where: {
      propertyId: { in: [...scope.propertyIds] },
      deletedAt: null,
      status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
      paidDate: { gte: scope.startDate, lte: scope.endDate },
      ...(scope.unitId ? { lease: { unitId: scope.unitId } } : {}),
    },
    // The payment number is the السند, once the database has numbers.
    select: { ...PAYMENT_ROW_SELECT, number: await paymentNumbersAvailable() },
    orderBy: [{ paidDate: "asc" }, { createdAt: "asc" }],
  });

  // A contract's value is planned once, however many of its payments fell in
  // the period.
  const contractTotals = new Map<string, number>();

  return payments.map((payment) => {
    const lease = payment.lease;
    let contractTotal: number | null = null;
    if (lease && payment.leaseId) {
      if (!contractTotals.has(payment.leaseId)) {
        // The same planner that bills the contract, so this figure and the
        // installment schedule can never disagree.
        contractTotals.set(
          payment.leaseId,
          summarizeInstallments(leaseInstallmentPlan(lease)).totalAmount,
        );
      }
      contractTotal = contractTotals.get(payment.leaseId) ?? null;
    }

    const tenantName =
      `${payment.tenant?.firstName ?? ""} ${payment.tenant?.lastName ?? ""}`.trim();

    return {
      paymentId: payment.id,
      date: (payment.paidDate ?? payment.createdAt).toISOString(),
      tenantName: tenantName || "—",
      propertyId: payment.propertyId,
      propertyName: payment.property?.name ?? "",
      unitId: lease?.unitId ?? null,
      unitNumber: lease?.unit?.unitNumber ?? null,
      leaseId: payment.leaseId,
      contractNumber: lease?.contractNumber ?? null,
      frequency: lease ? normalizeFrequency(lease.paymentFrequency) : null,
      contractTotal,
      receivedBy: isReceivedByOwner(payment.paymentMethod) ? "owner" : "office",
      paymentMethod: payment.paymentMethod,
      paymentType: payment.type,
      amount: round(Number(payment.amountPaid) || Number(payment.amount) || 0),
      currency: payment.currency,
      notes: payment.notes?.trim() || null,
      receiptNumber: receiptNumberFor(
        payment.id,
        payment.receipt?.receiptNumber,
        (payment as { number?: number | null }).number,
      ),
    };
  });
}

/** Every expense deducted in the period, oldest first. */
export async function loadStatementExpenses(
  scope: StatementRowsScope,
): Promise<StatementExpenseRow[]> {
  if (scope.propertyIds.length === 0) return [];

  const expenses = await db.expense.findMany({
    where: {
      propertyId: { in: [...scope.propertyIds] },
      ...(scope.unitId ? { unitId: scope.unitId } : {}),
      deletedAt: null,
      status: { in: [...DEDUCTED_EXPENSE_STATUSES] },
      date: { gte: scope.startDate, lte: scope.endDate },
    },
    select: {
      id: true,
      propertyId: true,
      unitId: true,
      date: true,
      amount: true,
      category: true,
      description: true,
      referenceNumber: true,
      expenseNumber: true,
      property: { select: { name: true } },
    },
    orderBy: { date: "asc" },
  });

  return expenses.map((expense) => ({
    expenseId: expense.id,
    date: expense.date.toISOString(),
    propertyId: expense.propertyId,
    unitId: expense.unitId,
    propertyName: expense.property?.name ?? "",
    category: expense.category,
    description: expense.description,
    reference: expense.referenceNumber || expense.expenseNumber || null,
    amount: round(Number(expense.amount) || 0),
  }));
}
