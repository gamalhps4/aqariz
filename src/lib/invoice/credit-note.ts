/**
 * PropertyPro - What a credit note does
 *
 * Pure rules shared by the service that writes credit notes
 * (custom-invoice.service.ts) and the invoice screen that starts one.
 */

import { InvoiceStatus } from "@/types";
import { legacyInvoiceVat, type VatCategory } from "@/lib/invoice/vat";

const round2 = (value: number) => Math.round(value * 100) / 100;

/** What a credit note does to the invoice it corrects. */
export function applyCredit(
  original: { totalAmount: number; amountPaid: number; creditedAmount: number; status: string },
  credit: number,
): {
  creditedAmount: number;
  balanceRemaining: number;
  refundDue: number;
  status: string | null;
} {
  const creditedAmount = round2(original.creditedAmount + credit);
  const owed = round2(original.totalAmount - creditedAmount);
  const balanceRemaining = Math.max(0, round2(owed - original.amountPaid));
  const refundDue = Math.max(0, round2(original.amountPaid - owed));
  // Settled once nothing is left: by payment, by credit, or both. Not
  // cancelled — a cancelled invoice drops out of what was billed, and its
  // credit note would then be taken off twice.
  const status = balanceRemaining === 0 ? InvoiceStatus.PAID : null;
  return { creditedAmount, balanceRemaining, refundDue, status };
}

/**
 * The lines a credit note starts from: the invoice's own lines, or — for an
 * invoice written before lines had categories — one line per JSON line item
 * with the invoice's overall treatment.
 */
export function creditableLines(invoice: {
  category: string;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  lineItems: unknown;
  lines?: ReadonlyArray<{
    description: string;
    category: string | null;
    quantity: number;
    unitPrice: number;
    discountAmount: number;
    vatCategory: string;
    vatRate: number;
  }>;
}): Array<{
  description: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  vatCategory: VatCategory;
  vatRate: number;
}> {
  if (invoice.lines && invoice.lines.length > 0) {
    return invoice.lines.map((line) => ({
      description: line.description,
      category: line.category,
      // Credited at what was charged after the discount: the credit note
      // carries no discount of its own.
      quantity: 1,
      unitPrice: round2(Math.abs(line.quantity * line.unitPrice) - Math.abs(line.discountAmount)),
      vatCategory: line.vatCategory as VatCategory,
      vatRate: line.vatRate,
    }));
  }
  const treatment = legacyInvoiceVat(invoice);
  const items = Array.isArray(invoice.lineItems)
    ? (invoice.lineItems as Array<Record<string, unknown>>)
    : [];
  const discountShare =
    invoice.subtotal > 0 ? (invoice.subtotal - invoice.discountAmount) / invoice.subtotal : 1;
  return items.map((item) => ({
    description: String(item.description ?? invoice.category),
    category: typeof item.type === "string" ? item.type : invoice.category,
    quantity: 1,
    unitPrice: round2(Number(item.amount ?? 0) * discountShare),
    vatCategory: treatment.vatCategory,
    vatRate: treatment.vatRate,
  }));
}


// ---------------------------------------------------------------------------
// What is left to credit, per VAT category
// ---------------------------------------------------------------------------

/** An invoice's or a credit note's amounts in one VAT category (credit notes may be negative). */
export interface VatCategoryAmount {
  vatCategory: string;
  net: number;
  vat: number;
}

const CATEGORY_NAMES: Record<string, string> = {
  S: "standard-rated",
  Z: "zero-rated",
  E: "exempt",
  O: "out-of-scope",
};

const halalas = (value: number) => Math.round(Math.abs(Number(value) || 0) * 100);

function byCategory(rows: readonly VatCategoryAmount[]): Map<string, { net: number; vat: number }> {
  const out = new Map<string, { net: number; vat: number }>();
  for (const row of rows) {
    const entry = out.get(row.vatCategory) ?? { net: 0, vat: 0 };
    entry.net += halalas(row.net);
    entry.vat += halalas(row.vat);
    out.set(row.vatCategory, entry);
  }
  return out;
}

/**
 * Why a credit note cannot be issued, or null when it fits.
 *
 * A credit note corrects what the invoice charged, category by category: it
 * may not take more off its standard-rated lines than they charged, nor turn
 * exempt rent into a VAT refund. Checked against the invoice's lines less
 * every credit note already issued against it; the total alone let 1,100 of
 * a 1,000 standard-rated line be credited because the invoice also had 500
 * of exempt rent. A halala either way is rounding (VAT worked out per line).
 */
export function creditExceedsCategory(
  original: readonly VatCategoryAmount[],
  credited: readonly VatCategoryAmount[],
  note: readonly VatCategoryAmount[],
): string | null {
  const charged = byCategory(original);
  const taken = byCategory(credited);
  const asked = byCategory(note);
  for (const [category, want] of asked) {
    const had = charged.get(category) ?? { net: 0, vat: 0 };
    const gone = taken.get(category) ?? { net: 0, vat: 0 };
    const left = { net: Math.max(0, had.net - gone.net), vat: Math.max(0, had.vat - gone.vat) };
    if (want.net > left.net + 1 || want.vat > left.vat + 1) {
      const name = CATEGORY_NAMES[category] ?? category;
      const money = (value: number) => (value / 100).toFixed(2);
      return left.net === 0 && left.vat === 0
        ? `This invoice has no ${name} lines left to credit.`
        : `The credit on the ${name} lines (${money(want.net)} + VAT ${money(want.vat)}) is more than what is left of them on this invoice (${money(left.net)} + VAT ${money(left.vat)}).`;
    }
  }
  return null;
}

/**
 * What a refund paid back does to an invoice a credit note left overpaid:
 * what was paid on it, and the refund still due, both come down by it.
 */
export function applyRefund(
  invoice: { amountPaid: number; refundDue: number },
  refund: number,
): { amountPaid: number; refundDue: number } {
  return {
    amountPaid: Math.max(0, round2(invoice.amountPaid - refund)),
    refundDue: Math.max(0, round2(invoice.refundDue - refund)),
  };
}
