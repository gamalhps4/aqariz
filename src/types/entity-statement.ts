/**
 * PropertyPro - Compound, building and unit statement types
 *
 * Mirrors `/api/properties/reports?type=<kind>-statement`. Kept out of the
 * service module so the screen and the pure statement modules can read them
 * without pulling the Prisma client into the browser bundle.
 */

import type { FeeParts } from "@/lib/agreement-math";
import type { Settlement } from "@/lib/statements/settlement";
import type {
  StatementExpenseRow,
  StatementLetterhead,
  StatementPaymentRow,
} from "@/types/owner";

export const STATEMENT_SUBJECT_KINDS = ["compound", "property", "unit"] as const;

export type StatementSubjectKind = (typeof STATEMENT_SUBJECT_KINDS)[number];

export interface StatementSubject {
  kind: StatementSubjectKind;
  id: string;
  /** Compound name, building name, or unit number. */
  name: string;
  /** Compound code, where one was given. */
  code: string | null;
  /** The building a unit sits in; the compound a building belongs to. */
  parentName: string | null;
  ownerName: string | null;
  address: string | null;
}

/** An agreement that held one of the subject's buildings inside the period. */
export interface StatementAgreementRef {
  id: string;
  number: string | null;
  kind: "management" | "investment";
  fee: FeeParts;
  /** "collected" or "billed" — what a percentage was charged on. */
  commissionBasis: string;
}

export interface EntityStatementTotals {
  /** إجمالي المحصل — every payment the statement lists. */
  rentCollected: number;
  /** Everything invoiced to fall due in the period. */
  rentBilled: number;
  /** Still owed on the subject at the close of the period. */
  outstanding: number;
  expenses: number;
  /** Rent before VAT the commission was charged on. */
  commissionBase: number;
  commission: number;
}

/**
 * One row of the breakdown — a building of a compound, or a unit of a
 * building. The rows add up to the statement: what a building holds that no
 * current unit of it does (its own expenses, money received without a
 * contract) is a row of its own, `level: "building"`.
 */
export interface EntityStatementBreakdownRow {
  id: string;
  level: "property" | "unit" | "building";
  /** Building name, or unit number; the building's name on its own row. */
  label: string;
  /** A unit's stored status ("occupied"), for a unit row. */
  status: string | null;
  rentBilled: number;
  rentCollected: number;
  collectedByOwner: number;
  expenses: number;
  commission: number;
  commissionTax: number;
  investmentRent: number;
  /** collected − expenses − commission − VAT + investment rent. */
  ownerShare: number;
}

export interface EntityStatement {
  subject: StatementSubject;
  period: { startDate: string; endDate: string };
  currency: string;
  /** Buildings covered — 1 for a building or unit statement. */
  propertyCount: number;
  unitCount: number;
  occupiedUnits: number;
  vacantUnits: number;
  /** "agreements" when a management agreement charged the subject. */
  commissionSource: "none" | "agreements";
  /** The single percentage charged, for the summary's commission label. */
  commissionPercentage: number | null;
  /** Every agreement that held the subject's buildings in the period. */
  agreements: StatementAgreementRef[];
  /**
   * A unit statement only: how many units share the building's flat fee or
   * investment rent equally, where one applied. Null otherwise.
   */
  sharedBetweenUnits: number | null;
  totals: EntityStatementTotals;
  /** Who owes whom — see lib/statements/settlement.ts. */
  settlement: Settlement;
  /** Every payment received on the subject in the period. */
  payments: StatementPaymentRow[];
  /** Every expense deducted in the period. */
  expenses: StatementExpenseRow[];
  breakdownKind: "property" | "unit" | "none";
  breakdown: EntityStatementBreakdownRow[];
  /** The office's letterhead — sent with the screen's copy only. */
  letterhead?: StatementLetterhead | null;
}
