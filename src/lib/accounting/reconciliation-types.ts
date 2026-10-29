/**
 * PropertyPro - What the bank reconciliation screen is told
 *
 * The shapes the reconciliation route answers with and the screen reads, and
 * the query the service takes. Pure — no database, nothing server-only — so
 * the screen imports it too.
 */

export const RECONCILIATION_STATUSES = ["unreconciled", "reconciled", "all"] as const;
export type ReconciliationStatus = (typeof RECONCILIATION_STATUSES)[number];

export interface ReconciliationQuery {
  bankAccountId: string;
  /** The day the balances are read at; today when left out. */
  asOf?: Date | null;
  /** The first day of the lines listed; the first line when left out. */
  from?: Date | null;
  status?: ReconciliationStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface ReconciliationLine {
  id: string;
  date: string;
  entryId: string;
  entryNumber: number;
  sourceType: string;
  sourceId: string | null;
  sourceRef: string | null;
  memo: string | null;
  partyType: string | null;
  partyName: string | null;
  debit: number;
  credit: number;
  /** The entry has been reversed. */
  reversed: boolean;
  /** The entry is itself a reversal. */
  isReversal: boolean;
  /** The day the bank cleared it, once ticked. */
  reconciledOn: string | null;
}

export interface ReconciliationView {
  bank: {
    id: string;
    name: string;
    kind: string;
    currency: string;
    ledgerAccount: { id: string; code: string; nameAr: string; nameEn: string };
  };
  asOf: string;
  summary: {
    /** Every line up to the day: debits less credits. */
    bookBalance: number;
    /** Only the lines the bank had cleared by the day. */
    reconciledBalance: number;
    /** What the books hold that was not yet cleared on the day: book less reconciled. */
    unreconciledBalance: number;
    unreconciledCount: number;
    reconciledCount: number;
    /** The latest day a line was cleared on, up to the day asked for. */
    lastReconciledOn: string | null;
  };
  lines: ReconciliationLine[];
  total: number;
}
