/**
 * PropertyPro - What every posting rule shares
 *
 * Lines are built with `debit` / `credit`, tidied by `finalizeLines` (zero
 * lines dropped, lines that say the same thing merged) and checked by
 * `assertBalanced` before a plan leaves a rule. The database checks the same
 * thing again when the entry commits (the deferred trigger in the ledger
 * migration); this is what lets a rule fail with a reason instead of a
 * constraint violation.
 *
 * Pure: no database, no clock.
 */

import type { Halalas } from "../money";
import type { SystemKey } from "../system-keys";
import type { AccountRef, PlannedLine, PostingPlan } from "../types";

/** A rule refusing its input — the API answers it with 400/409 as given. */
export class LedgerRuleError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "LedgerRuleError";
  }
}

type LineExtras = Omit<PlannedLine, "account" | "debit" | "credit">;

function ref(account: SystemKey | AccountRef): AccountRef {
  return typeof account === "string" ? { key: account } : account;
}

export function debit(
  account: SystemKey | AccountRef,
  amount: Halalas,
  extras: LineExtras = {},
): PlannedLine {
  return { account: ref(account), debit: amount, credit: 0, ...extras };
}

export function credit(
  account: SystemKey | AccountRef,
  amount: Halalas,
  extras: LineExtras = {},
): PlannedLine {
  return { account: ref(account), debit: 0, credit: amount, ...extras };
}

function accountKey(account: AccountRef): string {
  return "key" in account ? `k:${account.key}` : `i:${account.id}`;
}

/** Everything that makes two lines the same line, bar the amount. */
function identity(line: PlannedLine): string {
  return [
    accountKey(line.account),
    line.debit > 0 ? "D" : "C",
    line.partyType ?? "",
    line.partyId ?? "",
    line.propertyId ?? "",
    line.unitId ?? "",
    line.leaseId ?? "",
    line.agreementId ?? "",
    line.vatCode ?? "",
    line.memo ?? "",
  ].join("|");
}

/**
 * Drop lines that carry nothing and merge lines that say the same thing.
 *
 * A line with a negative amount is turned around rather than kept: a
 * negative debit is a credit. Order is kept — first occurrence wins — so an
 * entry reads in the order the rule wrote it.
 */
export function finalizeLines(lines: readonly PlannedLine[]): PlannedLine[] {
  const merged = new Map<string, PlannedLine>();
  for (const raw of lines) {
    // A negative debit is a credit, a negative credit a debit, and a line
    // with both sides is netted to the larger one.
    let debitAmount = raw.debit;
    let creditAmount = raw.credit;
    if (debitAmount < 0) {
      creditAmount += -debitAmount;
      debitAmount = 0;
    }
    if (creditAmount < 0) {
      debitAmount += -creditAmount;
      creditAmount = 0;
    }
    const net = debitAmount - creditAmount;
    if (net === 0) continue;
    const line: PlannedLine = {
      ...raw,
      debit: Math.max(0, net),
      credit: Math.max(0, -net),
    };
    const key = identity(line);
    const existing = merged.get(key);
    if (existing) {
      existing.debit += line.debit;
      existing.credit += line.credit;
    } else {
      merged.set(key, { ...line });
    }
  }
  return [...merged.values()];
}

export function totals(lines: readonly PlannedLine[]): { debit: Halalas; credit: Halalas } {
  let debitTotal = 0;
  let creditTotal = 0;
  for (const line of lines) {
    debitTotal += line.debit;
    creditTotal += line.credit;
  }
  return { debit: debitTotal, credit: creditTotal };
}

/** Throw unless the lines make a valid entry: some lines, balanced, above zero. */
export function assertBalanced(lines: readonly PlannedLine[]): void {
  if (lines.length === 0) {
    throw new LedgerRuleError("LEDGER_EMPTY_ENTRY", "A journal entry needs at least one line");
  }
  for (const line of lines) {
    if (
      !Number.isInteger(line.debit) ||
      !Number.isInteger(line.credit) ||
      line.debit < 0 ||
      line.credit < 0 ||
      (line.debit > 0) === (line.credit > 0)
    ) {
      throw new LedgerRuleError(
        "LEDGER_INVALID_LINE",
        "Each line must carry either a debit or a credit above zero",
      );
    }
  }
  const sums = totals(lines);
  if (sums.debit !== sums.credit) {
    throw new LedgerRuleError(
      "LEDGER_UNBALANCED",
      `Debits (${sums.debit / 100}) and credits (${sums.credit / 100}) must be equal`,
    );
  }
  if (sums.debit <= 0) {
    throw new LedgerRuleError("LEDGER_EMPTY_ENTRY", "A journal entry must move an amount above zero");
  }
}

/**
 * Finish a plan: tidy its lines and check them. Returns null when nothing is
 * left to post — a document whose amounts all came to zero posts nothing.
 */
export function finishPlan(plan: PostingPlan): PostingPlan | null {
  const lines = finalizeLines(plan.lines);
  if (lines.length === 0) return null;
  assertBalanced(lines);
  return { ...plan, lines };
}

/** The same lines turned around: what undoes an entry. */
export function mirrorLines(lines: readonly PlannedLine[]): PlannedLine[] {
  return lines.map((line) => ({ ...line, debit: line.credit, credit: line.debit }));
}

/**
 * Debits and credits per account (`k:<key>` or `i:<id>`), for previews and
 * for reading a plan at a glance.
 */
export function totalsByAccount(
  lines: readonly PlannedLine[],
): Map<string, { debit: Halalas; credit: Halalas }> {
  const out = new Map<string, { debit: Halalas; credit: Halalas }>();
  for (const line of lines) {
    const key = accountKey(line.account);
    const entry = out.get(key) ?? { debit: 0, credit: 0 };
    entry.debit += line.debit;
    entry.credit += line.credit;
    out.set(key, entry);
  }
  return out;
}
