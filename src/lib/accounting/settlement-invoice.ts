/**
 * PropertyPro - The office's tax invoice for an owner's settlement
 *
 * The commission on an owner's period is a sale by the office to the owner,
 * and a sale is booked once: by its tax invoice. Closing a settlement issues
 * that invoice (or links the one the office already issued for it), and pays
 * it from what the office holds for the owner; the settlement entry then
 * leaves the commission out (posting/owner.ts). Before, an owner fee invoice
 * posted management fee income and output VAT, and closing the settlement
 * posted the same commission and VAT again out of the owner's payable.
 *
 * The invoice carries the statement's figures to the halala: a line for the
 * commission charged as a percentage of rent and one for a fixed fee, with
 * the statement's VAT shared over them (the statement works the VAT out on
 * the total, so it is shared rather than worked out again per line).
 *
 * Pure: the figures in, the lines out.
 */

import { allocateProportionally, fromHalalas, toHalalas } from "./money";
import { COMMISSION_LINE_CATEGORY } from "./posting/invoice";

export interface SettlementFeeFigures {
  /** Commission charged as a percentage of rent, before VAT. */
  commission: number;
  /** Commission charged as a fixed fee, before VAT. */
  managementFee: number;
  /** VAT on both. */
  commissionVat: number;
}

export interface SettlementFeeLine {
  /** "commission" (percentage) or "management_fee" (fixed). */
  category: string;
  net: number;
  vat: number;
  /** "S" when VAT is charged; "O" for an office that is not VAT-registered. */
  vatCategory: "S" | "O";
  vatRate: number;
}

/** What the owner is charged in all: commission, fixed fee and VAT. */
export function settlementFeeTotal(figures: SettlementFeeFigures): number {
  return fromHalalas(
    Math.max(0, toHalalas(figures.commission)) +
      Math.max(0, toHalalas(figures.managementFee)) +
      Math.max(0, toHalalas(figures.commissionVat)),
  );
}

/** The invoice's lines: one per kind of fee, the VAT shared over them. */
export function settlementFeeLines(
  figures: SettlementFeeFigures,
  vatRate: number,
): SettlementFeeLine[] {
  const parts = [
    { category: COMMISSION_LINE_CATEGORY, net: Math.max(0, toHalalas(figures.commission)) },
    { category: "management_fee", net: Math.max(0, toHalalas(figures.managementFee)) },
  ].filter((part) => part.net > 0);
  if (parts.length === 0) return [];
  const vat = Math.max(0, toHalalas(figures.commissionVat));
  const shares = allocateProportionally(
    vat,
    parts.map((part) => part.net),
  );
  return parts.map((part, index) => ({
    category: part.category,
    net: fromHalalas(part.net),
    vat: fromHalalas(shares[index]),
    vatCategory: vat > 0 ? "S" : "O",
    vatRate: vat > 0 ? vatRate : 0,
  }));
}

/**
 * Whether an invoice the office already issued can stand as a settlement's
 * tax invoice: what is left to pay on it is the settlement's commission and
 * VAT, to the halala.
 */
export function feeInvoiceMatches(balanceRemaining: number, figures: SettlementFeeFigures): boolean {
  return Math.abs(toHalalas(balanceRemaining) - toHalalas(settlementFeeTotal(figures))) <= 1;
}
