/**
 * PropertyPro - Which of a contract's terms an edit changes
 *
 * Once a contract's installments are billed, its terms are what those bills
 * were written from. Changing the dates, the rent, the cycle or the tax
 * afterwards re-plans the schedule under the invoices: periods the office has
 * already billed and collected against stop matching the plan, and the
 * contract page shows them as stray charges beside a fresh set of unbilled
 * ones. The owner's decision (2026-10-01): refuse such edits. Notes, the
 * contract number and documents stay editable; money moves through single
 * installments, or a termination and a new contract — or, since the
 * client's request of 2026-10-29, an amendment, which cancels what nobody
 * has paid and bills it again (lib/lease-amendment.ts).
 *
 * The edit form sends every field on every save, changed or not, so the rule
 * has to compare values: a contract-number fix on an active contract must
 * save, and only a term that really differs is refused.
 */

import { leaseContractAmount, leaseRentAmount, leaseSecurityDeposit } from "@/lib/lease-money";
import { normalizeFrequency } from "@/lib/lease-installments";
import { businessDay } from "@/lib/dates/business-day";

/** The terms that are locked once installments are billed. */
export type LockedTerm =
  | "startDate"
  | "endDate"
  | "paymentFrequency"
  | "rent"
  | "contractAmount"
  | "securityDeposit"
  | "electricityAmount"
  | "waterAmount"
  | "tax"
  | "rentDueDay"
  | "propertyId"
  | "unitId"
  | "tenantId";

/** The contract as stored — only what the comparison reads. */
export interface ContractTerms {
  startDate: Date | string;
  endDate: Date | string;
  paymentFrequency?: unknown;
  rentAmount?: unknown;
  contractAmount?: unknown;
  securityDepositAmount?: unknown;
  electricityAmount?: unknown;
  waterAmount?: unknown;
  taxEnabled?: unknown;
  taxRate?: unknown;
  terms?: unknown;
  propertyId: string;
  unitId: string;
  tenantId: string;
}

/** A validated edit (leaseUpdateSchema's output); absent means "not sent". */
export interface ContractEdit {
  startDate?: Date;
  endDate?: Date;
  paymentFrequency?: string;
  contractAmount?: number | null;
  electricityAmount?: number;
  waterAmount?: number;
  taxEnabled?: boolean;
  taxRate?: number;
  terms?: {
    rentAmount?: number;
    securityDeposit?: number;
    paymentConfig?: { rentDueDay?: number } | null;
  } | null;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
}

function cents(value: unknown): number {
  return Math.round((Number(value) || 0) * 100);
}

/**
 * Whether an edited amount is what the contract already holds. Rent and
 * deposit are stored twice — the column, and the `terms` copy older readers
 * use, which the edit form fills itself from — and on rows written before the
 * columns the two can differ. Matching either is no change.
 */
function sameAmount(edited: unknown, ...stored: unknown[]): boolean {
  return stored.some((value) => cents(value) === cents(edited));
}

/**
 * A contract date is a calendar day (see lease-installments.ts), compared as
 * one: an older row stored with a time of day is the same day the form sends.
 */
function sameDay(a: Date | string, b: Date | string): boolean {
  const left = new Date(a);
  const right = new Date(b);
  if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) {
    return false;
  }
  return businessDay(left) === businessDay(right);
}

/** Unset and the 1st are the same schedule (planInstallments never shifts to the 1st). */
function dueDay(value: unknown): number {
  const day = Number(value);
  return Number.isInteger(day) && day >= 1 && day <= 31 ? day : 1;
}

/** The rate that actually applies: none while tax is off. */
function effectiveTaxRate(enabled: unknown, rate: unknown): number {
  return enabled ? cents(rate) : 0;
}

/**
 * The locked terms this edit would change, in a stable order; empty when it
 * changes none of them.
 */
export function changedTerms(
  current: ContractTerms,
  edit: ContractEdit
): LockedTerm[] {
  const changed: LockedTerm[] = [];
  const currentTerms = (current.terms ?? {}) as Record<string, any>;

  if (edit.startDate !== undefined && !sameDay(edit.startDate, current.startDate)) {
    changed.push("startDate");
  }
  if (edit.endDate !== undefined && !sameDay(edit.endDate, current.endDate)) {
    changed.push("endDate");
  }
  if (
    edit.paymentFrequency !== undefined &&
    normalizeFrequency(edit.paymentFrequency) !==
      normalizeFrequency(current.paymentFrequency)
  ) {
    changed.push("paymentFrequency");
  }

  // How the rent is stated: a total for the term, or an amount per
  // installment. A contract priced by its total derives its rent, so there
  // the total is what can change.
  const currentTotal = leaseContractAmount(current);
  const editedTotal =
    edit.contractAmount !== undefined
      ? leaseContractAmount({ contractAmount: edit.contractAmount })
      : currentTotal;
  if (edit.contractAmount !== undefined) {
    const sameTotal =
      currentTotal === null || editedTotal === null
        ? currentTotal === editedTotal
        : cents(currentTotal) === cents(editedTotal);
    if (!sameTotal) changed.push("contractAmount");
  }
  if (
    editedTotal === null &&
    edit.terms?.rentAmount !== undefined &&
    !sameAmount(
      edit.terms.rentAmount,
      leaseRentAmount(current),
      currentTerms.rentAmount,
    )
  ) {
    changed.push("rent");
  }

  if (
    edit.terms?.securityDeposit !== undefined &&
    !sameAmount(
      edit.terms.securityDeposit,
      leaseSecurityDeposit(current),
      currentTerms.securityDeposit,
    )
  ) {
    changed.push("securityDeposit");
  }
  if (
    edit.electricityAmount !== undefined &&
    cents(edit.electricityAmount) !== cents(current.electricityAmount)
  ) {
    changed.push("electricityAmount");
  }
  if (
    edit.waterAmount !== undefined &&
    cents(edit.waterAmount) !== cents(current.waterAmount)
  ) {
    changed.push("waterAmount");
  }

  if (edit.taxEnabled !== undefined || edit.taxRate !== undefined) {
    const enabled = edit.taxEnabled ?? Boolean(current.taxEnabled);
    const rate = edit.taxRate ?? current.taxRate;
    if (
      Boolean(enabled) !== Boolean(current.taxEnabled) ||
      effectiveTaxRate(enabled, rate) !==
        effectiveTaxRate(current.taxEnabled, current.taxRate)
    ) {
      changed.push("tax");
    }
  }

  const editedDueDay = edit.terms?.paymentConfig?.rentDueDay;
  if (
    editedDueDay !== undefined &&
    dueDay(editedDueDay) !== dueDay(currentTerms.paymentConfig?.rentDueDay)
  ) {
    changed.push("rentDueDay");
  }

  if (edit.propertyId !== undefined && edit.propertyId !== current.propertyId) {
    changed.push("propertyId");
  }
  if (edit.unitId !== undefined && edit.unitId !== current.unitId) {
    changed.push("unitId");
  }
  if (edit.tenantId !== undefined && edit.tenantId !== current.tenantId) {
    changed.push("tenantId");
  }

  return changed;
}

/** Plain names for the refusal message. */
const TERM_NAMES: Record<LockedTerm, string> = {
  startDate: "start date",
  endDate: "end date",
  paymentFrequency: "installment frequency",
  rent: "rent",
  contractAmount: "contract total",
  securityDeposit: "security deposit",
  electricityAmount: "electricity charge",
  waterAmount: "water charge",
  tax: "tax",
  rentDueDay: "rent due day",
  propertyId: "building",
  unitId: "unit",
  tenantId: "tenant",
};

/** Why the edit is refused, naming what it tried to change. */
export function lockedTermsMessage(terms: readonly LockedTerm[]): string {
  const names = terms.map((term) => TERM_NAMES[term]).join(", ");
  return (
    `This contract already has billed installments, so its terms can no longer change (${names}). ` +
    "Amend its terms from the edit form (\"Amend the terms\"), edit single installments on its Installments tab, or terminate it and create a new contract."
  );
}
