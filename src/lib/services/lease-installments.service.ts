/**
 * PropertyPro - Lease installment schedule assembly
 *
 * The contract page must show every installment, its due date, and which are
 * paid or overdue. That view is assembled here from the lease's own invoices,
 * so the schedule and the ledger can never disagree: an installment IS an
 * invoice, not a parallel record that has to be kept in step.
 *
 * Installments the contract calls for but that have not been generated yet
 * are returned as `planned` rows, so a draft contract still shows the tenant
 * what the term will cost.
 */

import { db } from "@/lib/db/prisma";
import { InvoiceStatus, InvoiceType } from "@/types";
import { assembleInstallmentSchedule } from "@/lib/lease-schedule";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";
import type { InstallmentSchedule } from "@/types/installment";
import { isPastDue } from "@/lib/dates/business-day";

export type {
  InstallmentRow,
  InstallmentSchedule,
  InstallmentScheduleSummary,
  InstallmentState,
} from "@/types/installment";

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Build the contract's installment schedule: its installments numbered by
 * period, and its other charges apart (see lib/lease-schedule.ts).
 */
export async function getInstallmentSchedule(
  leaseId: string,
  now: Date = new Date(),
): Promise<Omit<InstallmentSchedule, "viewer"> | null> {
  const lease = await db.lease.findFirst({ where: { id: leaseId } });
  if (!lease) return null;

  const invoices = await db.invoice.findMany({
    where: {
      leaseId,
      category: { in: [InvoiceType.RENT, InvoiceType.LATE_FEE] },
      deletedAt: null,
    },
    orderBy: { dueDate: "asc" },
  });

  return assembleInstallmentSchedule(lease, invoices, now);
}

export interface OutstandingSummary {
  outstandingTotal: number;
  overdueTotal: number;
  overdueCount: number;
  openInstallments: number;
  /** Installments whose period starts after a given date — not yet earned. */
  futureInstallments: number;
  futureTotal: number;
  currency: string;
}

/**
 * What a tenant still owes on a contract, split at a cut-off date.
 *
 * Termination uses this twice: to warn before ending a contract with money
 * outstanding, and to decide which installments are genuinely not owed
 * (those covering time after the tenancy ends) versus which must survive as
 * a payable.
 */
export async function getOutstandingForLease(
  leaseId: string,
  cutoff: Date,
): Promise<OutstandingSummary> {
  const lease = await db.lease.findFirst({
    where: { id: leaseId },
    select: { currency: true },
  });

  const openInvoices = await db.invoice.findMany({
    where: {
      leaseId,
      deletedAt: null,
      status: {
        in: [
          InvoiceStatus.SCHEDULED,
          InvoiceStatus.ISSUED,
          InvoiceStatus.PARTIAL,
          InvoiceStatus.OVERDUE,
        ],
      },
    },
    select: {
      id: true,
      dueDate: true,
      periodStart: true,
      balanceRemaining: true,
      status: true,
    },
  });

  const now = new Date();
  let outstandingTotal = 0;
  let overdueTotal = 0;
  let overdueCount = 0;
  let futureInstallments = 0;
  let futureTotal = 0;

  for (const invoice of openInvoices) {
    const balance = invoice.balanceRemaining;
    if (balance <= 0) continue;

    // An installment covering time after the cut-off has not been earned.
    // Fall back to the due date when the invoice carries no period (manual
    // one-offs), which is the only date it has.
    const coverageStart = invoice.periodStart ?? invoice.dueDate;
    if (new Date(coverageStart) >= cutoff) {
      futureInstallments += 1;
      futureTotal = round(futureTotal + balance);
      continue;
    }

    outstandingTotal = round(outstandingTotal + balance);

    if (isPastDue(invoice.dueDate, now)) {
      overdueTotal = round(overdueTotal + balance);
      overdueCount += 1;
    }
  }

  return {
    outstandingTotal,
    overdueTotal,
    overdueCount,
    openInstallments: openInvoices.filter((i) => i.balanceRemaining > 0).length,
    futureInstallments,
    futureTotal,
    currency: lease?.currency ?? DEFAULT_CURRENCY,
  };
}
