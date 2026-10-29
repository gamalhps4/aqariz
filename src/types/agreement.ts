/**
 * PropertyPro - Agreement client types
 *
 * Mirrors `/api/agreements` and `/api/agreements/reports`. Kept out of the
 * service modules so client components do not pull the Prisma client into the
 * browser bundle through a type import.
 */

import type {
  OwnerStatement,
  StatementLetterhead,
  StatementPaymentRow,
} from "@/types/owner";

/**
 * "management": the office manages the buildings for a commission.
 * "investment" (عقد استثمار): the office rents the buildings from the owner
 * for a fixed amount and keeps the rent it collects.
 */
export type AgreementKind = "management" | "investment";
export type AgreementFeeType = "percentage" | "fixed";
export type CommissionBasis = "collected" | "billed";
export type AgreementStatus = "draft" | "active" | "expired" | "terminated";
export type AgreementScopeType = "property" | "compound" | "portfolio";

export interface AgreementParty {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
}

export interface Agreement {
  id: string;
  kind: string;
  agreementNumber: string | null;
  ownerId: string;
  owner: AgreementParty | null;
  propertyId: string | null;
  property: { id: string; name: string } | null;
  compoundId: string | null;
  compound: { id: string; name: string } | null;
  feeType: AgreementFeeType;
  feePercentage: number;
  feeAmount: number;
  feeFrequency: string;
  /** Derived server-side, e.g. "5%" or "3000 / monthly". */
  feeLabel: string;
  /** Derived server-side from which scope field is set. */
  scopeType: AgreementScopeType;
  commissionBasis: CommissionBasis;
  currency: string;
  startDate: string;
  endDate: string | null;
  status: AgreementStatus;
  notes: string | null;
  documents: string[];
  terminatedDate: string | null;
  terminationReason: string | null;
  createdAt: string;
}

export interface AgreementDetail extends Agreement {
  /** Properties this agreement governs today, after precedence. */
  covers: Array<{ id: string; name: string }>;
}

export interface AgreementReportRow {
  agreementId: string;
  agreementNumber: string | null;
  kind: string;
  ownerId: string;
  ownerName: string;
  scopeLabel: string;
  scopeType: AgreementScopeType;
  /** Kept for the agreement's own statement; the report never prints it. */
  feeType: string;
  feeLabel: string;
  commissionBasis: string;
  status: string;
  startDate: string;
  endDate: string | null;
  currency: string;
  propertyCount: number;
  /** Rent the commission was charged on — before VAT. */
  totalRent: number;
  /** Everything received on the agreement's buildings. */
  rentCollected: number;
  rentBilled: number;
  commission: number;
  /** The settlement, as on the owner's statement — see agreement-reports.service. */
  commissionTax: number;
  commissionTaxRate: number;
  expenses: number;
  collectedByOwner: number;
  collectedByOperator: number;
  /** An investment agreement's fixed rent for the period — zero otherwise. */
  investmentRent: number;
  ownerShare: number;
  dueToOwner: number;
  dueToOperator: number;
}

/** A payment behind the report's figures, and the agreement it counted under. */
export interface AgreementReportPayment extends StatementPaymentRow {
  agreementId: string;
  agreementNumber: string | null;
}

export interface AgreementReport {
  rows: AgreementReportRow[];
  /** Every payment behind the figures, one row each, with its date and note. */
  payments: AgreementReportPayment[];
  summary: {
    agreementCount: number;
    ownerCount: number;
    propertyCount: number;
    totalRent: number;
    totalCollected: number;
    totalCommission: number;
    totalCommissionTax: number;
    totalExpenses: number;
    totalInvestmentRent: number;
    totalCollectedByOwner: number;
    totalCollectedByOperator: number;
    totalDueToOwner: number;
    totalDueToOperator: number;
    /** Properties earning rent that no agreement governs. */
    unmanagedProperties: number;
    unmanagedRent: number;
  };
}

/**
 * One management agreement's statement — mirrors
 * `/api/agreements/[id]/statement`. The statement itself is the owner's
 * statement read over the buildings this agreement covers, for the part of
 * the period asked for that it held them: `statement.period` is that part,
 * shorter than the dates asked for when the agreement started, ended or was
 * renewed between them.
 */
export interface AgreementStatement {
  agreement: {
    id: string;
    agreementNumber: string | null;
    kind: string;
    ownerId: string;
    ownerName: string;
    scopeType: AgreementScopeType;
    scopeName: string | null;
    feeLabel: string;
    /** The fee as data, worded in the reader's language on the details line. */
    fee: {
      type: "fixed" | "percentage";
      percentage: number;
      amount: number;
      frequency: string;
    };
    commissionBasis: string;
    status: string;
    startDate: string;
    endDate: string | null;
    currency: string;
  };
  properties: Array<{ id: string; name: string }>;
  statement: OwnerStatement;
  /** The office's name, registration and logo, as the export prints them. */
  letterhead?: StatementLetterhead | null;
}
