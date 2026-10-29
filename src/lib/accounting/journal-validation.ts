/**
 * PropertyPro - Checking a journal typed by hand
 *
 * The manual journal form and the API ask the same questions of the same
 * lines: does each line name an account and carry an amount on one side
 * only, and do the debits equal the credits? Kept free of anything
 * server-side so the form can show the difference as it is typed, and the
 * route refuses exactly what the form would have.
 */

import type { Halalas } from "./money";

export interface JournalLineDraft {
  accountId?: string | null;
  debit?: number | string | null;
  credit?: number | string | null;
}

export type JournalIssueCode =
  | "LINE_NO_ACCOUNT"
  | "LINE_BAD_AMOUNT"
  | "LINE_BOTH_SIDES"
  | "LINE_NO_AMOUNT"
  | "TOO_FEW_LINES"
  | "UNBALANCED"
  | "ZERO_TOTAL";

export interface JournalIssue {
  /** The line it is about; null for the entry as a whole. */
  index: number | null;
  code: JournalIssueCode;
}

export interface JournalCheck {
  totalDebit: Halalas;
  totalCredit: Halalas;
  /** Debits less credits. */
  difference: Halalas;
  balanced: boolean;
  issues: JournalIssue[];
  /** Each line's amounts in halalas, null where unreadable. */
  amounts: Array<{ debit: Halalas | null; credit: Halalas | null }>;
}

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

function asciiDigits(value: string): string {
  return value.replace(ARABIC_INDIC, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

/**
 * An amount as typed — "1,250.5", "١٢٥٠٫٥", 1250.5 — in halalas. Null for
 * blank, NaN for anything that is not a non-negative amount with at most two
 * decimals.
 */
export function parseAmount(value: number | string | null | undefined): Halalas | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return Number.NaN;
    const halalas = Math.round(value * 100);
    // More than two decimals is a typing mistake, not a rounding to make.
    return Math.abs(halalas - value * 100) > 1e-6 ? Number.NaN : halalas;
  }
  const cleaned = asciiDigits(value.trim())
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/[,٬\s]/g, "");
  if (cleaned === "") return null;
  if (!AMOUNT_PATTERN.test(cleaned)) return Number.NaN;
  const [whole, fraction = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/**
 * Check a journal's lines.
 *
 * `allowUnbalanced` is for opening balances, where the difference is posted
 * to opening-balance equity rather than refused; one line is then enough.
 */
export function checkJournalLines(
  lines: readonly JournalLineDraft[],
  options: { allowUnbalanced?: boolean } = {},
): JournalCheck {
  const issues: JournalIssue[] = [];
  const amounts: JournalCheck["amounts"] = [];
  let totalDebit = 0;
  let totalCredit = 0;
  let usable = 0;

  lines.forEach((line, index) => {
    const debitAmount = parseAmount(line.debit ?? null);
    const creditAmount = parseAmount(line.credit ?? null);
    amounts.push({
      debit: debitAmount === null || Number.isNaN(debitAmount) ? null : debitAmount,
      credit: creditAmount === null || Number.isNaN(creditAmount) ? null : creditAmount,
    });

    const blank =
      !line.accountId && (debitAmount ?? 0) === 0 && (creditAmount ?? 0) === 0;
    // A line left completely empty is ignored, as a form adds spare rows.
    if (blank && !Number.isNaN(debitAmount) && !Number.isNaN(creditAmount)) return;

    if (Number.isNaN(debitAmount) || Number.isNaN(creditAmount)) {
      issues.push({ index, code: "LINE_BAD_AMOUNT" });
      return;
    }
    if (!line.accountId) issues.push({ index, code: "LINE_NO_ACCOUNT" });
    const hasDebit = (debitAmount ?? 0) > 0;
    const hasCredit = (creditAmount ?? 0) > 0;
    if (hasDebit && hasCredit) issues.push({ index, code: "LINE_BOTH_SIDES" });
    else if (!hasDebit && !hasCredit) issues.push({ index, code: "LINE_NO_AMOUNT" });
    totalDebit += debitAmount ?? 0;
    totalCredit += creditAmount ?? 0;
    usable += 1;
  });

  const minimum = options.allowUnbalanced ? 1 : 2;
  if (usable < minimum) issues.push({ index: null, code: "TOO_FEW_LINES" });
  const difference = totalDebit - totalCredit;
  if (!options.allowUnbalanced && difference !== 0) {
    issues.push({ index: null, code: "UNBALANCED" });
  }
  if (totalDebit === 0 && totalCredit === 0 && usable > 0) {
    issues.push({ index: null, code: "ZERO_TOTAL" });
  }

  return {
    totalDebit,
    totalCredit,
    difference,
    balanced: difference === 0 && totalDebit > 0,
    issues,
    amounts,
  };
}
