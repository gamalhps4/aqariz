/**
 * PropertyPro - Entries written by hand: journals, opening balances, reversals
 *
 * A manual journal is whatever balanced lines the accountant types (checked
 * by lib/accounting/journal-validation.ts, the same check the form runs).
 *
 * Opening balances are the books on the cut-over day: each account's balance
 * as it stood, dated the cut-over date. They need not balance as typed — the
 * difference goes to opening-balance equity, the usual home for it until the
 * office reclassifies it.
 *
 * A reversal is an entry's lines turned around, dated the day it is reversed
 * on; the original stays in the books, marked reversed, so the trail shows
 * both.
 */

import { checkJournalLines } from "../journal-validation";
import type { Halalas } from "../money";
import type { PartyType, PlannedLine, PostingPlan, SourceType } from "../types";
import { credit, debit, finishPlan, LedgerRuleError } from "./common";

export interface ManualLineInput {
  accountId: string;
  debit?: number | string | null;
  credit?: number | string | null;
  memo?: string | null;
  partyType?: PartyType | null;
  partyId?: string | null;
  propertyId?: string | null;
}

const ISSUE_MESSAGES: Record<string, string> = {
  LINE_NO_ACCOUNT: "Choose an account for every line",
  LINE_BAD_AMOUNT: "Amounts must be numbers with at most two decimals",
  LINE_BOTH_SIDES: "A line takes a debit or a credit, not both",
  LINE_NO_AMOUNT: "Every line needs an amount",
  TOO_FEW_LINES: "A journal needs at least two lines",
  UNBALANCED: "Debits and credits must be equal",
  ZERO_TOTAL: "A journal must move an amount above zero",
};

function linesFrom(
  input: readonly ManualLineInput[],
  options: { allowUnbalanced?: boolean } = {},
): PlannedLine[] {
  const check = checkJournalLines(input, options);
  const issue = check.issues[0];
  if (issue) {
    const where = issue.index === null ? "" : ` (line ${issue.index + 1})`;
    throw new LedgerRuleError(
      `LEDGER_${issue.code}`,
      `${ISSUE_MESSAGES[issue.code] ?? "The journal is not valid"}${where}`,
    );
  }
  const lines: PlannedLine[] = [];
  input.forEach((line, index) => {
    const amounts = check.amounts[index];
    const debitAmount = amounts?.debit ?? 0;
    const creditAmount = amounts?.credit ?? 0;
    if (!line.accountId || (debitAmount === 0 && creditAmount === 0)) return;
    const party =
      line.partyType && line.partyId
        ? { partyType: line.partyType, partyId: line.partyId }
        : {};
    const extras = {
      ...party,
      propertyId: line.propertyId || null,
      memo: line.memo?.trim() || null,
    };
    lines.push(
      debitAmount > 0
        ? debit({ id: line.accountId }, debitAmount, extras)
        : credit({ id: line.accountId }, creditAmount, extras),
    );
  });
  return lines;
}

export interface ManualJournalInput {
  date: Date;
  memo?: string | null;
  reference?: string | null;
  lines: readonly ManualLineInput[];
}

export function planManualJournal(input: ManualJournalInput): PostingPlan {
  const plan = finishPlan({
    sourceType: "manual",
    sourceId: null,
    sourceRef: input.reference?.trim() || null,
    date: input.date,
    memo: input.memo?.trim() || null,
    lines: linesFrom(input.lines),
  });
  if (!plan) {
    throw new LedgerRuleError("LEDGER_ZERO_TOTAL", ISSUE_MESSAGES.ZERO_TOTAL);
  }
  return plan;
}

export interface OpeningBalancesInput {
  /** The cut-over day. */
  date: Date;
  memo?: string | null;
  lines: readonly ManualLineInput[];
}

export function planOpeningBalances(input: OpeningBalancesInput): PostingPlan {
  const lines = linesFrom(input.lines, { allowUnbalanced: true });
  let difference = 0;
  for (const line of lines) difference += line.debit - line.credit;
  if (difference > 0) lines.push(credit("opening_balance_equity", difference));
  if (difference < 0) lines.push(debit("opening_balance_equity", -difference));

  const plan = finishPlan({
    sourceType: "opening_balance",
    sourceId: null,
    date: input.date,
    memo: input.memo?.trim() || null,
    lines,
  });
  if (!plan) {
    throw new LedgerRuleError("LEDGER_ZERO_TOTAL", ISSUE_MESSAGES.ZERO_TOTAL);
  }
  return plan;
}

/** A line of an entry as it was written to the books. */
export interface WrittenLine {
  accountId: string;
  debit: Halalas;
  credit: Halalas;
  partyType?: string | null;
  partyId?: string | null;
  propertyId?: string | null;
  unitId?: string | null;
  leaseId?: string | null;
  agreementId?: string | null;
  vatCode?: string | null;
  memo?: string | null;
}

export interface WrittenEntry {
  sourceType: SourceType;
  sourceId: string | null;
  sourceRef?: string | null;
  number: number;
  lines: readonly WrittenLine[];
}

/** The entry that undoes `entry`, dated `date`. */
export function planReversal(
  entry: WrittenEntry,
  date: Date,
  memo?: string | null,
): PostingPlan {
  const plan = finishPlan({
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceRef: entry.sourceRef ?? null,
    date,
    memo: memo?.trim() || null,
    lines: entry.lines.map((line) => ({
      account: { id: line.accountId },
      debit: line.credit,
      credit: line.debit,
      partyType: (line.partyType as PartyType | null) ?? null,
      partyId: line.partyId ?? null,
      propertyId: line.propertyId ?? null,
      unitId: line.unitId ?? null,
      leaseId: line.leaseId ?? null,
      agreementId: line.agreementId ?? null,
      vatCode: (line.vatCode as PlannedLine["vatCode"]) ?? null,
      memo: line.memo ?? null,
    })),
  });
  if (!plan) {
    throw new LedgerRuleError("LEDGER_EMPTY_ENTRY", "This entry has nothing to reverse");
  }
  return plan;
}
