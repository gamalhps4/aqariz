/**
 * PropertyPro - What an installment is for
 *
 * The rent registers (overdue tenants, due rent, overdue rent) listed every
 * open invoice, so a security deposit read exactly like a month's rent: in
 * the rows, in the totals and in who counted as a late tenant. A deposit is
 * the tenant's own money held against the unit, not rent that has gone
 * unpaid, and the client asks for these reports by the name "rent".
 *
 * So an invoice falls in one of three groups:
 *
 *   rent     — a rent installment. The electricity and water the contract
 *              bills with its rent are lines on that same invoice, so they
 *              come with it: what the tenant owes for the period is one sum.
 *   deposit  — a security or pet deposit.
 *   other    — anything else billed on its own: a fee, a repair, a utility
 *              charged separately from the rent.
 *
 * The registers read "rent" unless asked otherwise, and report the other two
 * beside it rather than dropping them.
 *
 * No database here, so the grouping is pinned by charge-category.test.ts.
 */

import { InvoiceType } from "@/types";

export type ChargeGroup = "rent" | "deposit" | "other";

/** A group, or every charge at once. */
export type ChargeFilter = ChargeGroup | "all";

export const CHARGE_GROUPS: readonly ChargeGroup[] = ["rent", "deposit", "other"];

export const CHARGE_FILTERS: readonly ChargeFilter[] = [
  "rent",
  "deposit",
  "other",
  "all",
];

/** What the rent registers read when nothing else is asked for. */
export const DEFAULT_CHARGE_FILTER: ChargeFilter = "rent";

const RENT_CATEGORIES: readonly string[] = [InvoiceType.RENT];

const DEPOSIT_CATEGORIES: readonly string[] = [
  InvoiceType.SECURITY_DEPOSIT,
  InvoiceType.PET_DEPOSIT,
];

/** Line types that are a utility, on a rent installment or on their own. */
const UTILITY_TYPES: ReadonlySet<string> = new Set([
  InvoiceType.ELECTRICITY,
  InvoiceType.WATER_SEWER,
  InvoiceType.GAS,
  InvoiceType.TRASH,
  InvoiceType.INTERNET,
  InvoiceType.CABLE,
  InvoiceType.UTILITY,
]);

export function isChargeFilter(value: unknown): value is ChargeFilter {
  return CHARGE_FILTERS.includes(value as ChargeFilter);
}

/** The group an invoice's category belongs to. */
export function chargeGroup(category: string | null | undefined): ChargeGroup {
  if (category && RENT_CATEGORIES.includes(category)) return "rent";
  if (category && DEPOSIT_CATEGORIES.includes(category)) return "deposit";
  return "other";
}

/** Whether an invoice of this category belongs on a register read for `filter`. */
export function inChargeFilter(
  category: string | null | undefined,
  filter: ChargeFilter,
): boolean {
  return filter === "all" || chargeGroup(category) === filter;
}

/**
 * The same choice as a condition on `Invoice.category`, for a query that
 * aggregates in the database — the dashboard's figures, the menu's badge —
 * and so has to pick exactly the rows the register would.
 */
export function chargeCategoryWhere(
  filter: ChargeFilter,
): { category?: { in: string[] } | { notIn: string[] } } {
  switch (filter) {
    case "rent":
      return { category: { in: [...RENT_CATEGORIES] } };
    case "deposit":
      return { category: { in: [...DEPOSIT_CATEGORIES] } };
    case "other":
      return {
        category: { notIn: [...RENT_CATEGORIES, ...DEPOSIT_CATEGORIES] },
      };
    case "all":
      return {};
  }
}

/**
 * The utilities billed on an invoice — the electricity and water lines a
 * rent installment carries — before tax. Zero when it has none.
 */
export function utilitiesOnInvoice(lineItems: unknown): number {
  const lines = Array.isArray(lineItems) ? lineItems : [];
  const total = lines.reduce((sum: number, item: unknown) => {
    const line = (item ?? {}) as { type?: unknown; amount?: unknown };
    return typeof line.type === "string" && UTILITY_TYPES.has(line.type)
      ? sum + (Number(line.amount) || 0)
      : sum;
  }, 0);
  return Math.round(total * 100) / 100;
}
