/**
 * PropertyPro - The sales and purchases registers
 *
 * Two chronological lists of documents, each drawn from more than one table:
 *
 *   Sales & Receipts       the invoices and credit notes the office issued,
 *                          and the receipts it gave — a tenant's payment (with
 *                          its voucher number), and what an owner or a
 *                          customer paid on their invoice;
 *   Purchases & Payments   the supplier bills the office entered, and the
 *                          payment vouchers it wrote.
 *
 * A page of such a list is a merge of the sources' own pages. Each source is
 * read in the register's order, up to the end of the page asked for, and the
 * merge here puts them in one order and cuts the page — so a page costs what
 * its position costs, not a read of everything.
 *
 * Pure: the shapes the routes answer with and the screens and exports read,
 * and the merge. No database.
 */

export type RegisterOrder = "asc" | "desc";

/**
 * What orders the rows of a register, whatever table they came from: the
 * instant the document is dated, then which kind of document it is, then its
 * id. Every source is read from the database in exactly this order (its date
 * column, then its id), so the merge and the database agree on where a page
 * ends — a row can neither repeat on the next page nor go missing between
 * two.
 */
export interface RegisterOrdering {
  /** The instant the document is dated, as an ISO timestamp. */
  at: string;
  /** Breaks a tie of instants: an invoice before the receipt that paid it. */
  rank: number;
  /** `<kind>:<id>`; the id's order is the database's, a cuid being lower-case letters and digits. */
  key: string;
}

export function compareRegisterRows(a: RegisterOrdering, b: RegisterOrdering, order: RegisterOrder): number {
  const forward = compareKeys(a.at, b.at) || a.rank - b.rank || compareKeys(a.key, b.key);
  return order === "asc" ? forward : -forward;
}

/** Plain code-unit order: what a cuid column sorts as, and what a fixed-width ISO timestamp is. */
function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The rows `skip` to `skip + limit` of the sources taken together, in order.
 * Each source must hold at least its first `skip + limit` rows in that order
 * (or all it has).
 */
export function mergeRegisterRows<T extends RegisterOrdering>(
  sources: ReadonlyArray<readonly T[]>,
  order: RegisterOrder,
  skip: number,
  limit: number,
): T[] {
  return sources
    .flat()
    .sort((a, b) => compareRegisterRows(a, b, order))
    .slice(skip, skip + limit);
}

// ---------------------------------------------------------------------------
// Sales & Receipts
// ---------------------------------------------------------------------------

export const SALES_KINDS = ["invoice", "credit_note", "receipt"] as const;
export type SalesRowKind = (typeof SALES_KINDS)[number];

/** Which kinds a register query asks for. */
export const SALES_KIND_FILTERS = ["all", "invoices", "credit_notes", "receipts"] as const;
export type SalesKindFilter = (typeof SALES_KIND_FILTERS)[number];

export interface SalesRegisterRow extends RegisterOrdering {
  kind: SalesRowKind;
  /** The office's calendar day the document is dated, `YYYY-MM-DD`. */
  date: string;
  /** The invoice's or the payment's id; the screens link to it. */
  id: string;
  /** The invoice number, or the receipt's voucher number (RCP-000123); empty when there is none. */
  documentNumber: string;
  customerType: "tenant" | "owner" | "customer";
  customerName: string;
  /** A receipt's invoices, a charge's kind: what the row is about. */
  reference: string | null;
  building: string | null;
  /** What was billed, VAT included; negative on a credit note. */
  invoiced: number;
  /** The VAT inside it; negative on a credit note. */
  vat: number;
  /** What was received (a receipt only). */
  received: number;
  /** The document's own status. */
  status: string;
  /** How a receipt was paid. */
  method: string | null;
  /** Where the document opens, or null when it has no page of its own. */
  href: string | null;
}

export interface SalesRegisterTotals {
  /** Invoices, VAT included, cancelled ones left out. */
  invoiced: number;
  /** Credit notes, a negative sum. */
  creditNotes: number;
  /** Invoiced less credited. */
  netInvoiced: number;
  /** The VAT in what was billed, net of credit notes. */
  vat: number;
  /** Receipts, refunded ones left out. */
  received: number;
}

export interface SalesRegisterQuery {
  from?: Date | null;
  to?: Date | null;
  kind?: SalesKindFilter;
  /** An invoice status, or a payment's for receipts. */
  status?: string;
  tenantId?: string;
  ownerId?: string;
  propertyId?: string;
  search?: string;
  page: number;
  limit: number;
  order?: RegisterOrder;
}

export interface SalesRegister {
  rows: SalesRegisterRow[];
  total: number;
  totals: SalesRegisterTotals;
}

// ---------------------------------------------------------------------------
// Purchases & Payments
// ---------------------------------------------------------------------------

export const PURCHASE_KINDS = ["bill", "payment"] as const;
export type PurchaseRowKind = (typeof PURCHASE_KINDS)[number];

export const PURCHASE_KIND_FILTERS = ["all", "bills", "payments"] as const;
export type PurchaseKindFilter = (typeof PURCHASE_KIND_FILTERS)[number];

export interface PurchaseRegisterRow extends RegisterOrdering {
  kind: PurchaseRowKind;
  /** `YYYY-MM-DD`. */
  date: string;
  id: string;
  /** BILL-000012 or PV-000045. */
  documentNumber: string;
  supplierId: string;
  supplierName: string;
  /** A bill's supplier invoice number, or a voucher's cheque or transfer number. */
  reference: string | null;
  /** A bill's due day. */
  dueDate: string | null;
  /** What was billed, VAT included (a bill only). */
  billed: number;
  vat: number;
  /** What was paid out (a voucher only). */
  paid: number;
  status: string;
  /** How a voucher was paid. */
  method: string | null;
  /**
   * The bank or cash account a voucher was drawn on. `name` is empty on the
   * accounts set-up opened: show `name || nameAr / nameEn` for the reader
   * (`bankDisplayName` in purchases/types.ts takes this shape).
   */
  account: { name: string; ledgerAccount: { nameAr: string; nameEn: string } } | null;
  href: string;
}

export interface PurchaseRegisterTotals {
  /** Bills owed — approved, partly paid and paid. */
  billed: number;
  vat: number;
  /** Bills still waiting for approval. */
  pending: number;
  /** Vouchers posted. */
  paid: number;
}

export interface PurchaseRegisterQuery {
  from?: Date | null;
  to?: Date | null;
  kind?: PurchaseKindFilter;
  /** A bill status, `posted` or `cancelled` for vouchers, or `all`. */
  status?: string;
  supplierId?: string;
  propertyId?: string;
  search?: string;
  page: number;
  limit: number;
  order?: RegisterOrder;
}

export interface PurchaseRegister {
  rows: PurchaseRegisterRow[];
  total: number;
  totals: PurchaseRegisterTotals;
}
