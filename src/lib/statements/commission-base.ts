/**
 * PropertyPro - What a management commission is charged on
 *
 * Rent, before VAT (decided 2026-09-29). Before that the commission was a
 * percentage of every payment in the period — the VAT on the rent, the
 * electricity and water billed with it, security deposits and one-off charges
 * included. None of those is the owner's rental income: VAT is passed on to
 * ZATCA, utilities are recharged at cost, and a deposit is the tenant's money,
 * refundable at the end of the contract.
 *
 * A rent payment settles an installment invoice that carries its parts as
 * typed lines — rent, electricity, water — with VAT on top. The rent in a
 * payment is its share of those invoices: the rent lines' part of what they
 * bill, less their tax. A part payment carries the same proportions as the
 * installment it pays.
 *
 * Everything received still counts as collected (إجمالي المحصل) and still
 * belongs to the settlement; only the commission is narrower.
 *
 * Pure, so the arithmetic is pinned by commission-base.test.ts.
 */

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The only payment and invoice-line type the commission is charged on. */
export const COMMISSIONABLE_TYPE = "rent";

export interface BaseInvoice {
  /** "rent" for an installment; the type of a line that carries none. */
  category?: string | null;
  taxAmount: number;
  discountAmount?: number | null;
  totalAmount: number;
  /** `[{ type, amount }]`, as the invoice generators write it. */
  lineItems: unknown;
}

export interface BasePayment {
  type: string;
  /** What was received — `amountPaid`, or `amount` on an older row without it. */
  collected: number;
  invoiceId: string | null;
  /** `[{ invoiceId, amount }]` — where the money was applied. */
  allocations?: unknown;
}

/** A contract's own terms, for a rent payment linked to no invoice. */
export interface BaseLeaseTerms {
  rentAmount: number;
  electricityAmount?: number | null;
  waterAmount?: number | null;
  taxEnabled?: boolean | null;
  taxRate?: number | null;
}

interface Line {
  type: string | null;
  amount: number;
}

function linesOf(invoice: BaseInvoice): Line[] {
  const raw = Array.isArray(invoice.lineItems) ? invoice.lineItems : [];
  return raw.map((item: unknown) => {
    const line = (item ?? {}) as Record<string, unknown>;
    return {
      type: typeof line.type === "string" ? line.type : null,
      // `amount` is what the invoice's subtotal is summed from.
      amount: Number(line.amount ?? line.total ?? 0) || 0,
    };
  });
}

/**
 * The part of an invoice's total that is rent before VAT, from 0 to 1.
 *
 * The rent lines' share of the lines, times the part of the total that is not
 * tax. A line without a type is taken to be what the invoice is — an older
 * rent invoice wrote a single untyped line.
 */
export function invoiceRentShare(invoice: BaseInvoice): number {
  const total = Number(invoice.totalAmount) || 0;
  if (total <= 0) return 0;

  const lines = linesOf(invoice);
  const linesTotal = lines.reduce((sum, line) => sum + line.amount, 0);
  const rentLines = lines
    .filter(
      (line) => (line.type ?? invoice.category ?? null) === COMMISSIONABLE_TYPE,
    )
    .reduce((sum, line) => sum + line.amount, 0);

  const rentOfLines =
    linesTotal > 0
      ? rentLines / linesTotal
      : // No lines to go by: only a rent invoice is rent.
        invoice.category === COMMISSIONABLE_TYPE
        ? 1
        : 0;

  const tax = Number(invoice.taxAmount) || 0;
  const beforeTax = Math.max(0, Math.min(1, (total - tax) / total));
  return Math.max(0, Math.min(1, rentOfLines * beforeTax));
}

/** Rent before VAT on an invoice as billed — the base of a "billed" agreement. */
export function billedRentBase(invoice: BaseInvoice): number {
  return round((Number(invoice.totalAmount) || 0) * invoiceRentShare(invoice));
}

/**
 * The rent in a payment that carries no invoice: its contract's rent over
 * the whole installment, before VAT. Without a contract to read, a rent
 * payment is taken as rent.
 */
export function leaseRentShare(lease: BaseLeaseTerms | null | undefined): number {
  if (!lease) return 1;
  const rent = Number(lease.rentAmount) || 0;
  const installment =
    rent + (Number(lease.electricityAmount) || 0) + (Number(lease.waterAmount) || 0);
  const rentOfInstallment = installment > 0 ? rent / installment : 1;
  const rate = lease.taxEnabled ? Number(lease.taxRate) || 0 : 0;
  return rentOfInstallment / (1 + rate / 100);
}

interface Allocation {
  invoiceId: string;
  amount: number;
}

function allocationsOf(payment: BasePayment): Allocation[] {
  const raw = Array.isArray(payment.allocations) ? payment.allocations : [];
  return raw
    .map((item: unknown) => {
      const allocation = (item ?? {}) as Record<string, unknown>;
      return {
        invoiceId: String(allocation.invoiceId ?? ""),
        amount: Number(allocation.amount) || 0,
      };
    })
    .filter((allocation) => allocation.invoiceId && allocation.amount > 0);
}

/**
 * How much of one payment the commission is charged on.
 *
 * Where the money was applied decides it: each invoice a payment paid
 * contributes its rent share of the amount applied to it. A payment linked to
 * one invoice without recorded allocations applied all of it there. Money
 * applied to nothing — or a payment older than invoices — is judged by the
 * payment's own type and its contract: rent before VAT for a rent payment,
 * nothing for a deposit or a fee.
 */
export function paymentCommissionBase(
  payment: BasePayment,
  invoices: ReadonlyMap<string, BaseInvoice>,
  lease?: BaseLeaseTerms | null,
): number {
  const collected = Number(payment.collected) || 0;
  if (collected <= 0) return 0;

  let applied = allocationsOf(payment).filter((allocation) =>
    invoices.has(allocation.invoiceId),
  );
  if (applied.length === 0 && payment.invoiceId && invoices.has(payment.invoiceId)) {
    applied = [{ invoiceId: payment.invoiceId, amount: collected }];
  }

  const appliedTotal = applied.reduce((sum, allocation) => sum + allocation.amount, 0);
  // Allocations can outlive a correction to the payment; never charge on more
  // than was actually received.
  const scale = appliedTotal > collected ? collected / appliedTotal : 1;

  let base = 0;
  for (const allocation of applied) {
    const invoice = invoices.get(allocation.invoiceId)!;
    base += allocation.amount * scale * invoiceRentShare(invoice);
  }

  const unapplied = collected - appliedTotal * scale;
  if (unapplied > 0.005 && payment.type === COMMISSIONABLE_TYPE) {
    base += unapplied * leaseRentShare(lease);
  }

  return round(base);
}
