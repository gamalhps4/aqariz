/**
 * PropertyPro - Errors the ledger answers with
 *
 * One error type for the whole ledger: a machine code the screens translate
 * (`ledger.errors.<code>` in the accounting locale files), an English message
 * for everything else, and the HTTP status `handleApiError` (lib/api-utils)
 * reads off it.
 */

import { LedgerRuleError } from "./posting/common";
import type { RuleResult } from "./coa-rules";

export { LedgerRuleError as LedgerError };

export function ledgerError(code: string, message: string, statusCode = 400): LedgerRuleError {
  return new LedgerRuleError(code, message, statusCode);
}

/** Throw the refusal a rule returned, if it returned one. */
export function assertRule(result: RuleResult, statusCode = 409): void {
  if (!result.ok) throw new LedgerRuleError(result.code, result.message, statusCode);
}

export function isLedgerError(error: unknown): error is LedgerRuleError {
  return error instanceof LedgerRuleError;
}

export const NOT_SET_UP = () =>
  ledgerError(
    "LEDGER_NOT_SET_UP",
    "Accounting is not set up for this office yet. Open Accounting setup first.",
    409,
  );
