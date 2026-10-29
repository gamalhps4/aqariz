/**
 * PropertyPro - The accounts the posting rules use
 *
 * A posting rule never names an account by code or id: it names the job the
 * account does — "the tenants' receivable", "VAT charged on sales" — and the
 * organization's account map says which of its accounts does that job. The
 * template creates one account per key and marks it with the key
 * (`LedgerAccount.systemKey`); the office may rename and move those accounts,
 * or point a key at another account of the same kind, but never delete one
 * that a key still reaches (lib/accounting/coa-rules.ts).
 *
 * The books are the office's own: rent it collects for an owner is the
 * owner's money and sits in a liability, and the office's income is its
 * commission, plus the rent of its own buildings and of the buildings it holds
 * under investment agreements.
 */

import type { AccountType } from "./types";

export const SYSTEM_KEYS = [
  // Where money is held
  "cash_on_hand",
  "bank",
  "pos_clearing",
  "gateway_clearing",
  // What others owe the office
  "tenant_receivables",
  "customer_receivables",
  "input_vat",
  // What the office owes
  "owner_uncollected_rent",
  "owner_payable",
  "security_deposits",
  "output_vat",
  "supplier_payables",
  "accrued_expenses",
  // Equity
  "opening_balance_equity",
  "retained_earnings",
  // The office's income
  "commission_income",
  "management_fee_income",
  "rent_income",
  "investment_rent_income",
  "other_income",
  // The office's costs
  "investment_rent_expense",
  "expense_maintenance",
  "expense_repair",
  "expense_utilities",
  "expense_insurance",
  "expense_taxes",
  "expense_management_fee",
  "expense_advertising",
  "expense_legal",
  "expense_supplies",
  "expense_landscaping",
  "expense_cleaning",
  "expense_capital_improvement",
  "expense_other",
] as const;

export type SystemKey = (typeof SYSTEM_KEYS)[number];

/**
 * Heading accounts the code has to find, not post to: a new bank or cash
 * account is opened beneath the cash heading. Marked with a system key so
 * they cannot be deleted, but never part of the account map.
 */
export const GROUP_KEYS = ["group_cash"] as const;
export type GroupKey = (typeof GROUP_KEYS)[number];

export function isSystemKey(value: unknown): value is SystemKey {
  return (
    typeof value === "string" && (SYSTEM_KEYS as readonly string[]).includes(value)
  );
}

/**
 * The kind of account each key may point at. Pointing the bank key at an
 * income account would post every receipt as revenue, so the map refuses it.
 * Capital improvements on the office's own premises are an asset, not a cost
 * of the year, which is why that one key takes either.
 */
export const SYSTEM_KEY_TYPES: Readonly<Record<SystemKey, readonly AccountType[]>> = {
  cash_on_hand: ["asset"],
  bank: ["asset"],
  pos_clearing: ["asset"],
  gateway_clearing: ["asset"],
  tenant_receivables: ["asset"],
  customer_receivables: ["asset"],
  input_vat: ["asset"],
  owner_uncollected_rent: ["liability"],
  owner_payable: ["liability"],
  security_deposits: ["liability"],
  output_vat: ["liability"],
  supplier_payables: ["liability"],
  accrued_expenses: ["liability"],
  opening_balance_equity: ["equity"],
  retained_earnings: ["equity"],
  commission_income: ["income"],
  management_fee_income: ["income"],
  rent_income: ["income"],
  investment_rent_income: ["income"],
  other_income: ["income"],
  investment_rent_expense: ["expense"],
  expense_maintenance: ["expense"],
  expense_repair: ["expense"],
  expense_utilities: ["expense"],
  expense_insurance: ["expense"],
  expense_taxes: ["expense"],
  expense_management_fee: ["expense"],
  expense_advertising: ["expense"],
  expense_legal: ["expense"],
  expense_supplies: ["expense"],
  expense_landscaping: ["expense"],
  expense_cleaning: ["expense"],
  expense_capital_improvement: ["asset", "expense"],
  expense_other: ["expense"],
};

/**
 * Which key an expense category is charged to. The categories are the ones
 * the expense form offers (ExpenseCategory); anything else — an older free
 * text category — lands in "other expenses" rather than failing the posting.
 */
const EXPENSE_CATEGORY_KEYS: Readonly<Record<string, SystemKey>> = {
  maintenance: "expense_maintenance",
  repair: "expense_repair",
  utilities: "expense_utilities",
  insurance: "expense_insurance",
  taxes: "expense_taxes",
  management_fee: "expense_management_fee",
  advertising: "expense_advertising",
  legal: "expense_legal",
  supplies: "expense_supplies",
  landscaping: "expense_landscaping",
  cleaning: "expense_cleaning",
  capital_improvement: "expense_capital_improvement",
  other: "expense_other",
};

export function expenseKeyForCategory(category: string | null | undefined): SystemKey {
  const normalized = (category ?? "").trim().toLowerCase();
  return EXPENSE_CATEGORY_KEYS[normalized] ?? "expense_other";
}

/** The accounts a receipt can land in — the bank and cash family. */
export const MONEY_KEYS: readonly SystemKey[] = [
  "cash_on_hand",
  "bank",
  "pos_clearing",
  "gateway_clearing",
];
