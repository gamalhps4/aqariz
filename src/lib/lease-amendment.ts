/**
 * PropertyPro - Amending a contract after its installments are billed
 *
 * A contract in force has its whole schedule billed the day it starts, and
 * from then on its terms are locked (lib/lease-term-edits.ts): changing the
 * dates or the rent under issued installments left them out of step with
 * the contract. The client asked for an administrator's way round that,
 * short of terminating the contract and writing a new one.
 *
 * An amendment re-bills what nobody has paid yet. Installments with money
 * on them stay exactly as they were billed — the receipt, the ledger and
 * the owner's statement already stand on them. Every other installment is
 * cancelled (its period released for re-billing, its ledger entry reversed)
 * and the contract's schedule is billed again from the amended terms.
 *
 *   correction — nothing has been paid on the contract: every term can
 *     change, the building, unit and tenant included (a wrong pick fixed
 *     the day it was made), and the schedule is billed again in full.
 *   amendment — some installments are paid: they are kept, so the change
 *     must leave their periods as they are. The rent, utilities, tax, due
 *     day and end date can change for the rest of the term; a contract
 *     written as a total spreads what is left of the new total over the
 *     installments still to pay. The building, unit and tenant cannot
 *     change once money has come in: that is a new tenancy.
 *
 * Pure: the service reads, this decides, so the preview the operator
 * confirms and the change that is written are the same calculation.
 */

import {
  leaseInstallmentPlan,
  type KeptRent,
  type PlannedInstallment,
} from "@/lib/lease-installments";
import { leaseContractAmount } from "@/lib/lease-money";
import type { LockedTerm } from "@/lib/lease-term-edits";

/** One of the contract's billed rent installments, as the amendment reads it. */
export interface AmendableInstallment {
  id: string;
  invoiceNumber: string;
  periodStart: Date | string;
  /** Day after the last day it covers (its line items); null when unknown. */
  periodEnd: Date | string | null;
  dueDate: Date | string;
  totalAmount: number;
  amountPaid: number;
  /** The rent it bills: its rent lines, utilities and tax apart. */
  rentAmount: number;
}

/** The contract after the edit — the fields its schedule is planned from. */
export interface AmendedLease {
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
}

export type AmendmentLevel = "correction" | "amendment";

export type AmendmentProblem =
  | { code: "nothing_changed" }
  | { code: "placement_after_payment" }
  | { code: "deposit_billed" }
  | { code: "no_installments" }
  | { code: "paid_period_changed"; invoiceNumber: string; periodStart: string }
  | { code: "total_below_paid"; paidRent: number }
  | { code: "nothing_left_to_bill" };

export interface AmendmentPlan {
  level: AmendmentLevel;
  /** The locked terms the amendment changes. */
  changed: LockedTerm[];
  /** Paid or part paid: left exactly as billed. */
  keep: AmendableInstallment[];
  /** Nothing paid: cancelled, their periods billed again. */
  cancel: AmendableInstallment[];
  /** The installments the amended terms bill in place of `cancel`. */
  create: PlannedInstallment[];
  /** What `terms.amendment.kept` becomes; null clears it. */
  kept: KeptRent | null;
  totals: {
    /** The billed schedule now. */
    before: number;
    /** The schedule once amended: kept plus re-billed. */
    after: number;
    /** Paid so far on the installments kept. */
    paid: number;
  };
  problems: AmendmentProblem[];
  /**
   * Which installments the plan keeps and re-bills, and for how much. The
   * confirmation sends back the one it was shown: if a payment or another
   * change came in meanwhile, the amendment is refused rather than applied
   * to a schedule the operator never saw.
   */
  fingerprint: string;
}

const PLACEMENT_TERMS: readonly LockedTerm[] = ["propertyId", "unitId", "tenantId"];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function time(value: Date | string): number {
  return new Date(value).getTime();
}

function iso(value: Date | string): string {
  return new Date(value).toISOString();
}

function sum<T>(rows: readonly T[], pick: (row: T) => number): number {
  return round(rows.reduce((total, row) => total + pick(row), 0));
}

/** A short, stable digest of a string (djb2) — enough to tell two plans apart. */
function digest(text: string): string {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function planAmendment(input: {
  amended: AmendedLease;
  /** The contract's live rent installments (billed, not cancelled). */
  installments: readonly AmendableInstallment[];
  changed: readonly LockedTerm[];
  /** A deposit is billed or held for this contract. */
  depositBilled: boolean;
  /** Money is recorded on the contract, applied to an installment or not. */
  moneyHeld: boolean;
}): AmendmentPlan {
  const { amended, installments, depositBilled, moneyHeld } = input;
  const changed = [...input.changed];
  const problems: AmendmentProblem[] = [];

  const keep = installments.filter((installment) => installment.amountPaid > 0);
  const cancel = installments.filter((installment) => installment.amountPaid <= 0);
  const level: AmendmentLevel =
    keep.length === 0 && !moneyHeld ? "correction" : "amendment";

  if (changed.length === 0) problems.push({ code: "nothing_changed" });
  if (
    level === "amendment" &&
    changed.some((term) => PLACEMENT_TERMS.includes(term))
  ) {
    problems.push({ code: "placement_after_payment" });
  }
  if (
    depositBilled &&
    changed.some(
      (term) => term === "securityDeposit" || PLACEMENT_TERMS.includes(term),
    )
  ) {
    problems.push({ code: "deposit_billed" });
  }

  // A contract written as a total keeps the rent its paid installments
  // carry, and spreads the rest over the others (planInstallments).
  const total = leaseContractAmount(amended);
  const paidRent = sum(keep, (installment) => installment.rentAmount);
  const kept: KeptRent | null =
    total !== null && keep.length > 0
      ? {
          periodStarts: keep.map((installment) => iso(installment.periodStart)),
          rent: paidRent,
        }
      : null;

  const terms = (amended.terms ?? {}) as Record<string, unknown>;
  const amendment = (terms.amendment ?? {}) as Record<string, unknown>;
  const plan = leaseInstallmentPlan({
    ...amended,
    terms: { ...terms, amendment: { ...amendment, kept } },
  });
  if (plan.length === 0) problems.push({ code: "no_installments" });

  // Each kept installment must still be one of the amended schedule's
  // periods, covering the same days: its money stays where it was paid.
  const planByStart = new Map(plan.map((period) => [period.periodStart.getTime(), period]));
  for (const installment of keep) {
    const period = planByStart.get(time(installment.periodStart));
    const sameEnd =
      !installment.periodEnd ||
      (period && period.periodEnd.getTime() === time(installment.periodEnd));
    if (!period || !sameEnd) {
      problems.push({
        code: "paid_period_changed",
        invoiceNumber: installment.invoiceNumber,
        periodStart: iso(installment.periodStart),
      });
    }
  }

  const keptStarts = new Set(keep.map((installment) => time(installment.periodStart)));
  const create = plan.filter((period) => !keptStarts.has(period.periodStart.getTime()));

  if (total !== null && keep.length > 0) {
    if (total < paidRent) {
      problems.push({ code: "total_below_paid", paidRent });
    } else if (create.length === 0 && Math.round(total * 100) !== Math.round(paidRent * 100)) {
      problems.push({ code: "nothing_left_to_bill" });
    }
  }

  const fingerprint = digest(
    [
      keep.map((installment) => installment.id).sort().join(","),
      cancel.map((installment) => installment.id).sort().join(","),
      create
        .map((period) => `${period.periodStart.toISOString()}:${period.totalAmount}`)
        .join(","),
    ].join("|"),
  );

  return {
    level,
    changed,
    keep,
    cancel,
    create,
    kept,
    totals: {
      before: sum(installments, (installment) => installment.totalAmount),
      after: round(
        sum(keep, (installment) => installment.totalAmount) +
          sum(create, (period) => period.totalAmount),
      ),
      paid: sum(keep, (installment) => installment.amountPaid),
    },
    problems,
    fingerprint,
  };
}

/** What the operator is shown, and what the amendment endpoint answers with. */
export interface AmendmentPreview {
  level: AmendmentLevel;
  changed: LockedTerm[];
  keep: Array<{ invoiceNumber: string; periodStart: string; totalAmount: number; amountPaid: number }>;
  cancelCount: number;
  create: Array<{ periodStart: string; dueDate: string; totalAmount: number }>;
  totals: AmendmentPlan["totals"];
  problems: AmendmentProblem[];
  fingerprint: string;
}

export function previewOf(plan: AmendmentPlan): AmendmentPreview {
  return {
    level: plan.level,
    changed: plan.changed,
    keep: plan.keep.map((installment) => ({
      invoiceNumber: installment.invoiceNumber,
      periodStart: iso(installment.periodStart),
      totalAmount: installment.totalAmount,
      amountPaid: installment.amountPaid,
    })),
    cancelCount: plan.cancel.length,
    create: plan.create.map((period) => ({
      periodStart: period.periodStart.toISOString(),
      dueDate: period.dueDate.toISOString(),
      totalAmount: period.totalAmount,
    })),
    totals: plan.totals,
    problems: plan.problems,
    fingerprint: plan.fingerprint,
  };
}
