/**
 * PropertyPro - A tenant's ledger, from their invoices and payments
 *
 * What the tenant ledger got wrong, and the rule that replaced it:
 *
 *  - Its window was on `createdAt`, so an installment generated in January
 *    for June sat in January, and a payment recorded today for last month's
 *    transfer sat today. A charge is now dated by its issue date and a
 *    payment by the day the money was received.
 *  - Every period started at zero, as if nothing were owed before it. The
 *    balance carried in — every charge before the window less every receipt
 *    before it — now opens the ledger and the running balance starts there.
 *  - Charges were the line items before VAT. Each invoice now charges its
 *    lines, its discount (a credit) and its VAT, which add up to its total;
 *    a credit note is a credit.
 *  - Every payment row was a credit, pending and failed ones included.
 *    Only money received is now: paid and part-paid payments, at what they
 *    brought in.
 *
 * Pure: the service reads the rows (tenant-ledger.service.ts).
 */

export interface LedgerEntry {
  id: string;
  date: Date;
  type: "debit" | "credit";
  // Category keys mirror the breakdown buckets (e.g. "securityDeposit",
  // "lateFees", "utilities") plus "rent" | "payment" | "vat" | "discount" |
  // "creditNote" | "opening" | "other".
  category: string;
  description: string;
  reference: string; // Invoice number or payment number
  debitAmount: number;
  creditAmount: number;
  runningBalance: number;
  relatedId: string; // Invoice or Payment ID
  status: string;
  /**
   * The billing period of a generated rent line, as its invoice stored it:
   * what tells twelve "Monthly Rent" lines apart.
   */
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface LedgerInvoiceRow {
  id: string;
  invoiceNumber: string;
  issueDate: Date;
  category: string;
  status: string;
  documentType?: string | null;
  discountAmount: number;
  taxAmount: number;
  totalAmount: number;
  lineItems: unknown;
}

export interface LedgerPaymentRow {
  id: string;
  /** The day the money was received. */
  paidDate: Date;
  amount: number;
  amountPaid: number;
  status: string;
  paymentMethod: string | null;
  description: string | null;
  /** RCP-000123, when it has one. */
  reference: string;
}

/** What a payment brought in: `amountPaid`, or `amount` on an older row. */
export function receivedAmount(payment: Pick<LedgerPaymentRow, "amount" | "amountPaid">): number {
  const paid = Number(payment.amountPaid) || 0;
  return round(paid > 0 ? paid : Number(payment.amount) || 0);
}

const round = (value: number) => {
  const result = Math.round(value * 100) / 100;
  return Object.is(result, -0) ? 0 : result;
};

const CATEGORY_BY_TYPE: Record<string, string> = {
  rent: "rent",
  security_deposit: "securityDeposit",
  pet_deposit: "securityDeposit",
  late_fee: "lateFees",
  utility: "utilities",
  electricity: "utilities",
  water_sewer: "utilities",
  gas: "utilities",
  maintenance: "maintenance",
  repair: "maintenance",
};

/** The ledger's category for an invoice line type. */
export function ledgerCategory(type: string | null | undefined): string {
  return (type && CATEGORY_BY_TYPE[type]) || "other";
}

/** The amount of one JSON line item, before the discount and VAT. */
function lineAmount(item: Record<string, unknown>): number {
  const amount = Number(item.amount);
  if (Number.isFinite(amount)) return amount;
  const quantity = Number(item.quantity ?? 1) || 1;
  return quantity * (Number(item.unitPrice) || 0);
}

/**
 * One invoice's entries: a debit per line, a credit for its discount and a
 * debit for its VAT — together its total. A credit note is one credit of
 * its total.
 */
export function invoiceEntries(invoice: LedgerInvoiceRow): Omit<LedgerEntry, "runningBalance">[] {
  const base = {
    date: invoice.issueDate,
    reference: invoice.invoiceNumber,
    relatedId: invoice.id,
    status: invoice.status,
  };
  if (invoice.documentType === "credit_note") {
    return [
      {
        ...base,
        id: `invoice-${invoice.id}`,
        type: "credit",
        category: "creditNote",
        description: `Credit note ${invoice.invoiceNumber}`,
        debitAmount: 0,
        creditAmount: round(Math.abs(Number(invoice.totalAmount))),
      },
    ];
  }

  const items = Array.isArray(invoice.lineItems)
    ? (invoice.lineItems as Array<Record<string, unknown>>)
    : [];
  const entries: Omit<LedgerEntry, "runningBalance">[] = items.map((item, index) => ({
    ...base,
    id: `invoice-${invoice.id}-${index}`,
    type: "debit",
    category: ledgerCategory(typeof item.type === "string" ? item.type : invoice.category),
    description: typeof item.description === "string" ? item.description : invoice.category,
    debitAmount: round(lineAmount(item)),
    creditAmount: 0,
    periodStart: typeof item.periodStart === "string" ? item.periodStart : null,
    periodEnd: typeof item.periodEnd === "string" ? item.periodEnd : null,
  }));

  // An invoice without lines is charged its total less its VAT as one line.
  if (entries.length === 0) {
    entries.push({
      ...base,
      id: `invoice-${invoice.id}`,
      type: "debit",
      category: ledgerCategory(invoice.category),
      description: invoice.category,
      debitAmount: round(
        Number(invoice.totalAmount) - Number(invoice.taxAmount) + Number(invoice.discountAmount),
      ),
      creditAmount: 0,
    });
  }
  const discount = round(Number(invoice.discountAmount) || 0);
  if (discount > 0) {
    entries.push({
      ...base,
      id: `invoice-${invoice.id}-discount`,
      type: "credit",
      category: "discount",
      description: "Discount",
      debitAmount: 0,
      creditAmount: discount,
    });
  }
  const vat = round(Number(invoice.taxAmount) || 0);
  if (vat !== 0) {
    entries.push({
      ...base,
      id: `invoice-${invoice.id}-vat`,
      type: "debit",
      category: "vat",
      description: "VAT",
      debitAmount: vat,
      creditAmount: 0,
    });
  }
  return entries;
}

export function paymentEntry(payment: LedgerPaymentRow): Omit<LedgerEntry, "runningBalance"> {
  return {
    id: `payment-${payment.id}`,
    date: payment.paidDate,
    type: "credit",
    category: "payment",
    description:
      payment.description || `Payment - ${payment.paymentMethod ?? ""}`.trim(),
    reference: payment.reference,
    debitAmount: 0,
    creditAmount: receivedAmount(payment),
    relatedId: payment.id,
    status: payment.status,
  };
}

/** What a document adds to the balance: its debits less its credits. */
export function invoiceBalanceEffect(invoice: LedgerInvoiceRow): number {
  return round(
    invoiceEntries(invoice).reduce(
      (sum, entry) => sum + entry.debitAmount - entry.creditAmount,
      0,
    ),
  );
}

/**
 * The period's entries in date order (charges before payments on the same
 * day), each with the balance after it, starting from `openingBalance`.
 */
export function buildLedgerEntries(
  invoices: readonly LedgerInvoiceRow[],
  payments: readonly LedgerPaymentRow[],
  openingBalance: number,
): LedgerEntry[] {
  const unsorted = [
    ...invoices.flatMap(invoiceEntries),
    ...payments.map(paymentEntry),
  ];
  const sorted = unsorted
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        new Date(a.entry.date).getTime() - new Date(b.entry.date).getTime() ||
        Number(a.entry.category === "payment") - Number(b.entry.category === "payment") ||
        a.index - b.index,
    )
    .map(({ entry }) => entry);

  let balance = round(openingBalance);
  return sorted.map((entry) => {
    balance = round(balance + entry.debitAmount - entry.creditAmount);
    return { ...entry, runningBalance: balance };
  });
}
