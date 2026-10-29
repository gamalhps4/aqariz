/**
 * PropertyPro - A contract's installment table
 *
 * The contract page shows the contract's installments — due date, amount,
 * paid, remaining, status — and nothing else of anyone else's. This builds
 * that table from the contract's terms and its invoices, as plain judgement:
 * `services/lease-installments.service.ts` does the reading and hands both
 * here, the way `lease-installment-state.ts` keeps the state rules apart from
 * their service.
 *
 * An installment is numbered by its place in the schedule the terms produce:
 * the rent for the third period is "Installment 3" for as long as the
 * contract lasts. The number used to be the row's position among everything
 * billed on the contract, sorted by date, so adding a one-off charge — or
 * removing an installment — renumbered every row after it, and a receipt that
 * said "Installment 5" no longer matched the screen. Charges added by hand
 * are not installments of the schedule at all: they are listed on their own,
 * and a cancelled installment keeps its number.
 */

import {
  classifyInstallment,
  isOverdue,
  isPastDueDate,
} from "@/lib/lease-installment-state";
import {
  leaseInstallmentPlan,
  normalizeFrequency,
} from "@/lib/lease-installments";
import type {
  InstallmentRow,
  InstallmentSchedule,
  InstallmentScheduleSummary,
} from "@/types/installment";

/** The contract fields the table reads. */
export interface ScheduleLease {
  startDate: Date | string;
  endDate: Date | string;
  rentAmount?: unknown;
  contractAmount?: unknown;
  electricityAmount?: unknown;
  waterAmount?: unknown;
  paymentFrequency?: unknown;
  taxEnabled?: unknown;
  taxRate?: unknown;
  terms?: unknown;
  currency: string;
}

/** One of the contract's invoices, money already as numbers. */
export interface ScheduleInvoice {
  id: string;
  invoiceNumber: string;
  periodStart: Date | string | null;
  dueDate: Date | string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  status: string;
  lineItems?: unknown;
  metadata?: unknown;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

function firstLineDescription(invoice: ScheduleInvoice): string | undefined {
  const lines = invoice.lineItems;
  if (!Array.isArray(lines)) return undefined;
  const description = (lines[0] as { description?: unknown } | undefined)
    ?.description;
  return typeof description === "string" && description ? description : undefined;
}

/** Cancelled by an amendment of the contract (lib/lease-amendment.ts). */
function supersededByAmendment(invoice: ScheduleInvoice): boolean {
  const metadata = invoice.metadata as { supersededByAmendment?: unknown } | null;
  return invoice.status === "cancelled" && Boolean(metadata?.supersededByAmendment);
}

function sum(rows: readonly InstallmentRow[], pick: (row: InstallmentRow) => number) {
  return round(rows.reduce((total, row) => total + pick(row), 0));
}

/**
 * The contract's installment table: its schedule, numbered by period, and
 * everything else billed on it, listed apart.
 *
 * Invoices are matched to the schedule by the first day of the period they
 * bill — the key the database keeps unique per contract. An invoice with no
 * period is a charge added by hand; one whose period the current terms no
 * longer have (they changed after billing) is kept too, with the charges,
 * because that money was really billed and may already be paid.
 */
export function assembleInstallmentSchedule(
  lease: ScheduleLease,
  invoices: readonly ScheduleInvoice[],
  now: Date,
): Omit<InstallmentSchedule, "viewer"> {
  const byPeriod = new Map<number, ScheduleInvoice>();
  const unperiodized: ScheduleInvoice[] = [];
  for (const invoice of invoices) {
    // An installment an amendment replaced is history, not a charge: it is
    // in the invoice register as cancelled, and the one billed in its place
    // is on the schedule.
    if (supersededByAmendment(invoice)) continue;
    if (invoice.periodStart) byPeriod.set(time(invoice.periodStart), invoice);
    else unperiodized.push(invoice);
  }

  const installments: InstallmentRow[] = leaseInstallmentPlan(lease).map(
    (planned) => {
      const invoice = byPeriod.get(planned.periodStart.getTime());
      if (!invoice) {
        // Called for by the contract, not billed yet.
        return {
          invoiceId: null,
          invoiceNumber: null,
          index: planned.index,
          periodStart: iso(planned.periodStart),
          periodEnd: iso(planned.periodEnd),
          dueDate: iso(planned.dueDate)!,
          subtotal: planned.subtotal,
          taxAmount: planned.taxAmount,
          totalAmount: planned.totalAmount,
          amountPaid: 0,
          balanceRemaining: planned.totalAmount,
          state: "planned",
          source: "planned",
          prorated: planned.prorated,
          description: planned.prorated ? "Rent (prorated)" : "Rent",
          dueDatePassed: isPastDueDate(planned.dueDate, now),
        };
      }

      byPeriod.delete(planned.periodStart.getTime());
      return {
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        index: planned.index,
        periodStart: iso(invoice.periodStart),
        periodEnd: iso(planned.periodEnd),
        dueDate: iso(invoice.dueDate)!,
        subtotal: invoice.subtotal,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        amountPaid: invoice.amountPaid,
        balanceRemaining: invoice.balanceRemaining,
        state: classifyInstallment(
          { ...invoice, dueDate: new Date(invoice.dueDate) },
          now,
        ),
        source: "generated",
        prorated: planned.prorated,
        description: firstLineDescription(invoice) ?? "Rent",
        dueDatePassed: isPastDueDate(invoice.dueDate, now),
      };
    },
  );

  const orphaned = new Set([...byPeriod.values()].map((invoice) => invoice.id));
  const charges: InstallmentRow[] = [...byPeriod.values(), ...unperiodized]
    .sort((a, b) => time(a.dueDate) - time(b.dueDate))
    .map((invoice, position) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      index: position + 1,
      periodStart: iso(invoice.periodStart),
      periodEnd: null,
      dueDate: iso(invoice.dueDate)!,
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
      amountPaid: invoice.amountPaid,
      balanceRemaining: invoice.balanceRemaining,
      state: classifyInstallment(
        { ...invoice, dueDate: new Date(invoice.dueDate) },
        now,
      ),
      source: orphaned.has(invoice.id) ? "orphaned" : "manual",
      prorated: false,
      description: firstLineDescription(invoice) ?? "Additional charge",
      dueDatePassed: isPastDueDate(invoice.dueDate, now),
    }));

  const standing = (row: InstallmentRow) => row.state !== "cancelled";
  const liveInstallments = installments.filter(standing);
  const liveCharges = charges.filter(standing);
  const everything = [...liveInstallments, ...liveCharges];
  const billed = everything.filter((row) => row.invoiceId);
  const late = everything.filter((row) => isOverdue(row, now));

  const summary: InstallmentScheduleSummary = {
    frequency: normalizeFrequency(lease.paymentFrequency),
    taxEnabled: Boolean(lease.taxEnabled),
    taxRate: Number(lease.taxRate) || 0,
    currency: lease.currency,
    totalInstallments: liveInstallments.length,
    generatedInstallments: liveInstallments.filter((row) => row.invoiceId)
      .length,
    paidCount: liveInstallments.filter((row) => row.state === "paid").length,
    // By date, not by badge: a partly paid installment is still overdue money.
    overdueCount: late.length,
    upcomingCount: liveInstallments.filter((row) =>
      ["upcoming", "due", "planned"].includes(row.state),
    ).length,
    contractValue: sum(liveInstallments, (row) => row.totalAmount),
    chargesCount: liveCharges.length,
    chargesTotal: sum(liveCharges, (row) => row.totalAmount),
    billedTotal: sum(billed, (row) => row.totalAmount),
    collectedTotal: sum(everything, (row) => row.amountPaid),
    outstandingTotal: sum(billed, (row) => row.balanceRemaining),
    overdueTotal: sum(late, (row) => row.balanceRemaining),
  };

  return { summary, installments, charges };
}
