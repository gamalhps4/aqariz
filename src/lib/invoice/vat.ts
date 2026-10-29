/**
 * PropertyPro - VAT on an invoice written line by line
 *
 * Saudi VAT, as the office's own invoices and credit notes carry it: each
 * line is standard-rated (15%), zero-rated, exempt (residential rent) or out
 * of scope (a deposit, an owner's money), with its own rate. The invoice's
 * discount is taken BEFORE VAT — spread over the lines in proportion to their
 * value — so the VAT is charged on what the customer actually pays for. It
 * used to be the other way round: tax was typed in as an amount and the
 * discount came off the total after it.
 *
 * The categories are the ledger's VAT codes (src/lib/accounting/types.ts), so
 * a line and the journal line it later posts to agree.
 *
 * Pure and in halalas (integers) underneath: no database, no rounding drift,
 * shared by the invoice form, the API, the PDFs and the VAT summary.
 */

import { InvoiceType } from "@/types";

/** S standard-rated · Z zero-rated · E exempt · O out of scope. */
export const VAT_CATEGORIES = ["S", "Z", "E", "O"] as const;
export type VatCategory = (typeof VAT_CATEGORIES)[number];

/** The standard rate in Saudi Arabia, percent. */
export const STANDARD_VAT_RATE = 15;

export function isVatCategory(value: unknown): value is VatCategory {
  return (
    typeof value === "string" &&
    (VAT_CATEGORIES as readonly string[]).includes(value)
  );
}

/**
 * A Saudi VAT registration number: fifteen digits, beginning and ending in 3.
 * Spaces are ignored; anything else is not a VAT number.
 */
export function normalizeVatNumber(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, "");
}

export function isSaudiVatNumber(value: string | null | undefined): boolean {
  return /^3\d{13}3$/.test(normalizeVatNumber(value));
}

// ---------------------------------------------------------------------------
// Which treatment a charge starts with
// ---------------------------------------------------------------------------

/** Money held, not a supply: a deposit is out of scope. */
const DEPOSIT_CHARGES = new Set<string>([
  InvoiceType.SECURITY_DEPOSIT,
  InvoiceType.PET_DEPOSIT,
]);

/**
 * Charges that are part of letting the unit — the rent and what is billed
 * with it. They follow the contract: a commercial contract's tax setting
 * makes them standard-rated at its rate, and residential rent is exempt.
 */
const RENT_CHARGES = new Set<string>([
  InvoiceType.RENT,
  InvoiceType.PET_RENT,
  InvoiceType.PARKING_FEE,
  InvoiceType.STORAGE_FEE,
  InvoiceType.LATE_FEE,
  InvoiceType.ELECTRICITY,
  InvoiceType.WATER_SEWER,
  InvoiceType.GAS,
  InvoiceType.TRASH,
  InvoiceType.INTERNET,
  InvoiceType.CABLE,
  InvoiceType.UTILITY,
]);

export interface ContractTax {
  /** The contract's own tax switch (Lease.taxEnabled). */
  taxEnabled?: boolean | null;
  /** Percent (Lease.taxRate). */
  taxRate?: number | string | null;
}

export interface VatTreatment {
  vatCategory: VatCategory;
  /** Percent; 0 unless standard-rated. */
  vatRate: number;
}

/**
 * The treatment a new line starts with, before anyone changes it.
 *
 *  - a deposit is out of scope;
 *  - rent and what is billed with it follow the contract: its tax setting
 *    when it has one (commercial, 15%), exempt otherwise (residential);
 *  - anything else the office charges — its fees, maintenance, management —
 *    is its own service, standard-rated.
 */
export function defaultVatTreatment(
  category: string | null | undefined,
  contract?: ContractTax | null,
): VatTreatment {
  if (category && DEPOSIT_CHARGES.has(category)) {
    return { vatCategory: "O", vatRate: 0 };
  }
  if (category && RENT_CHARGES.has(category)) {
    const rate = Number(contract?.taxRate) || 0;
    return contract?.taxEnabled && rate > 0
      ? { vatCategory: "S", vatRate: rate }
      : { vatCategory: "E", vatRate: 0 };
  }
  return { vatCategory: "S", vatRate: STANDARD_VAT_RATE };
}

/** Only a standard-rated line carries a rate. */
export function effectiveVatRate(category: VatCategory, rate: unknown): number {
  if (category !== "S") return 0;
  const value = Number(rate);
  return Number.isFinite(value) && value > 0 ? value : STANDARD_VAT_RATE;
}

// ---------------------------------------------------------------------------
// The arithmetic
// ---------------------------------------------------------------------------

export interface VatLineInput {
  description: string;
  category?: string | null;
  quantity?: number | null;
  unitPrice: number;
  vatCategory: VatCategory;
  vatRate?: number | null;
}

export interface ComputedVatLine {
  position: number;
  description: string;
  category: string | null;
  quantity: number;
  unitPrice: number;
  /** quantity × unitPrice, before the discount. */
  grossAmount: number;
  /** This line's share of the invoice's discount. */
  discountAmount: number;
  /** What VAT is charged on: gross − discount. */
  netAmount: number;
  vatCategory: VatCategory;
  vatRate: number;
  vatAmount: number;
  /** net + VAT. */
  totalAmount: number;
}

export interface VatTotals {
  /** Every line's gross, before the discount. */
  subtotal: number;
  discountAmount: number;
  /** subtotal − discount: what VAT is charged on, across all categories. */
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
}

export interface VatBreakdownRow {
  vatCategory: VatCategory;
  vatRate: number;
  netAmount: number;
  vatAmount: number;
}

export interface ComputedVatInvoice {
  lines: ComputedVatLine[];
  totals: VatTotals;
  /** One row per category and rate, in S, Z, E, O order. */
  breakdown: VatBreakdownRow[];
}

const toHalalas = (amount: number): number => Math.round(amount * 100);
const fromHalalas = (halalas: number): number => {
  const value = halalas / 100;
  return Object.is(value, -0) ? 0 : value;
};

/**
 * Split `total` halalas over `weights` in proportion, exactly: each share
 * rounded down, the halalas left over handed to the largest remainders.
 */
export function allocateProportionally(
  total: number,
  weights: readonly number[],
): number[] {
  const sum = weights.reduce((acc, weight) => acc + weight, 0);
  if (total === 0 || sum <= 0) return weights.map(() => 0);
  const exact = weights.map((weight) => (total * weight) / sum);
  const shares = exact.map((value) => Math.floor(value));
  let left = total - shares.reduce((acc, share) => acc + share, 0);
  const order = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const { index } of order) {
    if (left <= 0) break;
    shares[index] += 1;
    left -= 1;
  }
  return shares;
}

export class VatInputError extends Error {}

/**
 * The lines with their discount share, VAT and totals, and the invoice's
 * totals. `discount` is an amount off the whole invoice, taken before VAT; it
 * may not exceed the lines' value.
 */
export function computeVatInvoice(
  inputs: readonly VatLineInput[],
  discount = 0,
): ComputedVatInvoice {
  const lines = inputs.map((input, position) => {
    const quantity = Number(input.quantity ?? 1);
    const unitPrice = Number(input.unitPrice);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new VatInputError("A line's quantity must be more than zero");
    }
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      throw new VatInputError("A line's price cannot be negative");
    }
    if (!isVatCategory(input.vatCategory)) {
      throw new VatInputError("Unknown VAT category");
    }
    return {
      position,
      description: input.description,
      category: input.category ?? null,
      quantity,
      unitPrice,
      gross: toHalalas(quantity * unitPrice),
      vatCategory: input.vatCategory,
      vatRate: effectiveVatRate(input.vatCategory, input.vatRate),
    };
  });

  const subtotal = lines.reduce((acc, line) => acc + line.gross, 0);
  const discountHalalas = toHalalas(Number(discount) || 0);
  if (discountHalalas < 0) {
    throw new VatInputError("The discount cannot be negative");
  }
  if (discountHalalas > subtotal) {
    throw new VatInputError("The discount cannot be more than the lines add up to");
  }
  const shares = allocateProportionally(
    discountHalalas,
    lines.map((line) => line.gross),
  );

  const computed: ComputedVatLine[] = lines.map((line, index) => {
    const net = line.gross - shares[index];
    const vat =
      line.vatCategory === "S" ? Math.round((net * line.vatRate) / 100) : 0;
    return {
      position: line.position,
      description: line.description,
      category: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      grossAmount: fromHalalas(line.gross),
      discountAmount: fromHalalas(shares[index]),
      netAmount: fromHalalas(net),
      vatCategory: line.vatCategory,
      vatRate: line.vatRate,
      vatAmount: fromHalalas(vat),
      totalAmount: fromHalalas(net + vat),
    };
  });

  const tax = computed.reduce((acc, line) => acc + toHalalas(line.vatAmount), 0);
  return {
    lines: computed,
    totals: {
      subtotal: fromHalalas(subtotal),
      discountAmount: fromHalalas(discountHalalas),
      netAmount: fromHalalas(subtotal - discountHalalas),
      taxAmount: fromHalalas(tax),
      totalAmount: fromHalalas(subtotal - discountHalalas + tax),
    },
    breakdown: vatBreakdown(computed),
  };
}

/** Per category and rate, the net and the VAT, in S, Z, E, O order. */
export function vatBreakdown(
  lines: ReadonlyArray<
    Pick<ComputedVatLine, "vatCategory" | "vatRate" | "netAmount" | "vatAmount">
  >,
): VatBreakdownRow[] {
  const rows = new Map<string, { row: VatBreakdownRow; net: number; vat: number }>();
  for (const line of lines) {
    const key = `${line.vatCategory}:${line.vatRate}`;
    const entry = rows.get(key) ?? {
      row: {
        vatCategory: line.vatCategory,
        vatRate: line.vatRate,
        netAmount: 0,
        vatAmount: 0,
      },
      net: 0,
      vat: 0,
    };
    entry.net += toHalalas(line.netAmount);
    entry.vat += toHalalas(line.vatAmount);
    rows.set(key, entry);
  }
  return [...rows.values()]
    .map(({ row, net, vat }) => ({
      ...row,
      netAmount: fromHalalas(net),
      vatAmount: fromHalalas(vat),
    }))
    .sort(
      (a, b) =>
        VAT_CATEGORIES.indexOf(a.vatCategory) -
          VAT_CATEGORIES.indexOf(b.vatCategory) || b.vatRate - a.vatRate,
    );
}

/** A credit note's lines and totals: the same figures, stored negative. */
export function negateVatInvoice(invoice: ComputedVatInvoice): ComputedVatInvoice {
  const flip = (value: number) => (value === 0 ? 0 : -value);
  return {
    lines: invoice.lines.map((line) => ({
      ...line,
      unitPrice: flip(line.unitPrice),
      grossAmount: flip(line.grossAmount),
      discountAmount: flip(line.discountAmount),
      netAmount: flip(line.netAmount),
      vatAmount: flip(line.vatAmount),
      totalAmount: flip(line.totalAmount),
    })),
    totals: {
      subtotal: flip(invoice.totals.subtotal),
      discountAmount: flip(invoice.totals.discountAmount),
      netAmount: flip(invoice.totals.netAmount),
      taxAmount: flip(invoice.totals.taxAmount),
      totalAmount: flip(invoice.totals.totalAmount),
    },
    breakdown: invoice.breakdown.map((row) => ({
      ...row,
      netAmount: flip(row.netAmount),
      vatAmount: flip(row.vatAmount),
    })),
  };
}

// ---------------------------------------------------------------------------
// An invoice written before lines had categories
// ---------------------------------------------------------------------------

/**
 * The VAT treatment of an invoice that has no lines of its own — every
 * installment, and every invoice raised before this module. Its tax was one
 * amount for the whole invoice: a deposit is out of scope, an invoice that
 * charged tax is standard-rated at the rate that tax works out to, and one
 * that charged none is exempt (residential rent).
 */
export function legacyInvoiceVat(invoice: {
  category?: string | null;
  subtotal: number;
  discountAmount?: number | null;
  taxAmount: number;
}): VatBreakdownRow {
  const net = Number(invoice.subtotal) - Number(invoice.discountAmount ?? 0);
  const vat = Number(invoice.taxAmount) || 0;
  if (invoice.category && DEPOSIT_CHARGES.has(invoice.category) && vat === 0) {
    return { vatCategory: "O", vatRate: 0, netAmount: net, vatAmount: 0 };
  }
  if (vat !== 0 && net !== 0) {
    // Worked back from rounded amounts, 15% can come out as 14.99%: a rate
    // that close to a whole percent is that percent.
    const exact = (vat / net) * 100;
    const rate =
      Math.abs(exact - Math.round(exact)) < 0.1
        ? Math.round(exact)
        : Math.round(exact * 100) / 100;
    return { vatCategory: "S", vatRate: rate, netAmount: net, vatAmount: vat };
  }
  return { vatCategory: "E", vatRate: 0, netAmount: net, vatAmount: 0 };
}
