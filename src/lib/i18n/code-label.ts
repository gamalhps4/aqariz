/**
 * PropertyPro - A stored code, in the reader's language
 *
 * Statuses, categories, types and methods are stored as English codes
 * ("capital_improvement", "partially_paid", "bank_transfer"). Screens, PDFs,
 * exports and messages say them from the catalogue, never by swapping the
 * underscore for a space — which is English whatever the reader's language.
 *
 * Several tables name the same code (`expenses.categories.*` for an
 * expense's category, `transactions.categories.*` for a ledger line's,
 * `exports.value.*` for any code a file may carry), so a lookup walks the
 * prefixes of the tables that apply, in order, and takes the first entry the
 * catalogue has.
 *
 * No React and no database: a screen, a PDF and a server message all use it.
 */

import { translateFor } from "./translate";

/** An expense's category: its own table, the ledger's, then the shared one. */
export const EXPENSE_CATEGORY_TABLES = [
  "expenses.categories.",
  "transactions.categories.",
  "exports.value.",
] as const;

/** A ledger line's category (a payment type, an invoice line type, an expense category). */
export const TRANSACTION_CATEGORY_TABLES = [
  "transactions.categories.",
  "expenses.categories.",
  "exports.value.",
] as const;

/** Any status a file or a screen may carry. */
export const STATUS_TABLES = ["exports.value."] as const;

/**
 * `code` in `language`, from the first of `tables` that names it. A code the
 * catalogue does not know comes back as stored (a code somebody typed into a
 * free-text column stays as typed); empty for no code at all.
 */
export function codeLabel(
  language: string,
  code: string | null | undefined,
  tables: readonly string[],
): string {
  const stored = code?.trim();
  if (!stored) return "";
  const key = stored.toLowerCase();
  for (const table of tables) {
    const found = translateFor(language, `${table}${key}`, undefined, "");
    if (found) return found;
  }
  return stored;
}
