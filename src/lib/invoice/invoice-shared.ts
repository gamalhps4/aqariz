import { InvoiceStatus } from "@/types";
import {
  isVatCategory,
  legacyInvoiceVat,
  vatBreakdown,
  type VatBreakdownRow,
  type VatCategory,
} from "@/lib/invoice/vat";
import { zatcaIssueMoment } from "@/lib/invoice/zatca-qr";
import { businessDay, businessToday, isPastDue } from "@/lib/dates/business-day";

export interface InvoiceCompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  logo?: string;
  /**
   * The office's VAT registration number (Settings → Branding). With it an
   * invoice is a tax invoice and carries the ZATCA QR code.
   */
  vatNumber?: string;
  [key: string]: unknown;
}

export interface InvoiceAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  country?: string;
  line1?: string;
  line2?: string;
  [key: string]: unknown;
}

export interface InvoicePartyInfo {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  name?: string;
  companyName?: string;
  [key: string]: unknown;
}

export interface InvoicePropertyInfo {
  name?: string;
  address?: InvoiceAddress | string;
  unit?: string;
  [key: string]: unknown;
}

export interface InvoiceLineItemInfo {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  amount?: number;
  type?: string;
  dueDate?: Date | null;
  metadata?: Record<string, unknown>;
  /** A line written with its own VAT (lib/invoice/vat.ts); absent on older ones. */
  vatCategory?: VatCategory;
  vatRate?: number;
  vatAmount?: number;
  /** What VAT is charged on: the line less its share of the discount. */
  netAmount?: number;
}

/** Who an invoice is to, as printed on a tax invoice. */
export interface InvoiceBuyerInfo {
  name?: string;
  vatNumber?: string;
  address?: string;
  /** tenant | owner | customer */
  type?: string;
}

export interface InvoiceStatusMeta {
  value: string;
  label: string;
  badgeColor: string;
  badgeBackground: string;
  textColor: string;
  pdfFillColor: [number, number, number];
}

export interface InvoiceTotalsInfo {
  subtotal: number;
  taxAmount: number;
  discountAmount: number;
  shippingAmount: number;
  adjustmentsAmount: number;
  total: number;
  amountPaid: number;
  balanceDue: number;
}

export interface NormalizedInvoice {
  _id?: string;
  invoiceNumber: string;
  /** invoice | credit_note. A credit note prints its figures positive. */
  documentType: "invoice" | "credit_note";
  /** The invoice a credit note corrects. */
  originalInvoiceNumber?: string;
  /** Why a credit note was issued. */
  creditReason?: string;
  /** The buyer: the customer the invoice names, else its tenant. */
  buyer: InvoiceBuyerInfo;
  /** A building an owner's or customer's invoice concerns (not filed under). */
  buildingName?: string;
  /** Per VAT category and rate: what was charged and the VAT on it. */
  vatBreakdown: VatBreakdownRow[];
  /** When the invoice was issued, to the second (the QR code's timestamp). */
  issuedAt: Date;
  issueDate: Date;
  dueDate: Date;
  status: string;
  statusMeta: InvoiceStatusMeta;
  companyInfo: InvoiceCompanyInfo;
  tenant: InvoicePartyInfo;
  property: InvoicePropertyInfo;
  lineItems: InvoiceLineItemInfo[];
  totals: InvoiceTotalsInfo;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  amountPaid: number;
  balanceRemaining: number;
  discountAmount: number;
  shippingAmount: number;
  adjustmentsAmount: number;
  notes: string;
  metadata?: Record<string, unknown>;
  tenantId?: InvoicePartyInfo;
  propertyId?: InvoicePropertyInfo;
  leaseId?: Record<string, unknown>;
  raw?: unknown;
  currencyCode?: string;
}

export interface NormalizeInvoiceOptions {
  companyInfo?: Partial<InvoiceCompanyInfo>;
  defaultNotes?: string;
  fallbackStatus?: InvoiceStatus | string;
  currencyCode?: string;
}

/**
 * Blank on purpose. This used to be a made-up US company — "PropertyPro
 * Management, 123 Business Ave … +1 (555) 123-4567" — which is what an
 * office's tenants saw on every invoice until branding was filled in. The
 * office's own details (or at least its name) come from
 * getCompanyInfo/getCompanyInfoServer; a field nobody filled in is left out.
 */
export const DEFAULT_COMPANY_INFO: InvoiceCompanyInfo = {
  name: "",
  address: "",
  phone: "",
  email: "",
  website: "",
};

/**
 * No boilerplate either: the old default ("Should you need us to add VAT …
 * let us know!") was printed on every invoice without notes of its own.
 */
export const DEFAULT_INVOICE_NOTES = "";

const STATUS_META_MAP: Record<string, InvoiceStatusMeta> = {
  paid: {
    value: "paid",
    label: "Paid",
    badgeBackground: "#dcfce7",
    badgeColor: "#166534",
    textColor: "#166534",
    pdfFillColor: [16, 185, 129],
  },
  partial: {
    value: "partial",
    label: "Partially Paid",
    badgeBackground: "#fef3c7",
    badgeColor: "#b45309",
    textColor: "#b45309",
    pdfFillColor: [234, 179, 8],
  },
  overdue: {
    value: "overdue",
    label: "Overdue",
    badgeBackground: "#fee2e2",
    badgeColor: "#991b1b",
    textColor: "#991b1b",
    pdfFillColor: [239, 68, 68],
  },
  cancelled: {
    value: "cancelled",
    label: "Cancelled",
    badgeBackground: "#e5e7eb",
    badgeColor: "#374151",
    textColor: "#374151",
    pdfFillColor: [156, 163, 175],
  },
  scheduled: {
    value: "scheduled",
    label: "Scheduled",
    badgeBackground: "#dbeafe",
    badgeColor: "#1d4ed8",
    textColor: "#1d4ed8",
    pdfFillColor: [59, 130, 246],
  },
  issued: {
    value: "issued",
    label: "Issued",
    badgeBackground: "#dbeafe",
    badgeColor: "#1d4ed8",
    textColor: "#1d4ed8",
    pdfFillColor: [59, 130, 246],
  },
};

function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined) return fallback;
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function roundCurrency(value: number): number {
  // Round to 2 decimal places; avoid -0 representation
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function parseDate(value: unknown): Date {
  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return new Date();
}

function ensureCompanyInfo(
  invoiceCompanyInfo?: Partial<InvoiceCompanyInfo>,
  overrideCompanyInfo?: Partial<InvoiceCompanyInfo>
): InvoiceCompanyInfo {
  return {
    ...DEFAULT_COMPANY_INFO,
    ...invoiceCompanyInfo,
    ...overrideCompanyInfo,
  };
}

function ensureParty(party: unknown): InvoicePartyInfo {
  if (!party || typeof party !== "object") {
    return {};
  }

  const source = party as Record<string, unknown>;
  const nestedUser = source["userId"];
  const fromNested =
    nestedUser && typeof nestedUser === "object"
      ? ensureParty(nestedUser)
      : undefined;

  const firstName =
    typeof source.firstName === "string"
      ? source.firstName
      : typeof source["first_name"] === "string"
      ? (source["first_name"] as string)
      : fromNested?.firstName;

  const lastName =
    typeof source.lastName === "string"
      ? source.lastName
      : typeof source["last_name"] === "string"
      ? (source["last_name"] as string)
      : fromNested?.lastName;

  const email =
    typeof source.email === "string"
      ? source.email
      : typeof source["contactEmail"] === "string"
      ? (source["contactEmail"] as string)
      : fromNested?.email;

  const phone =
    typeof source.phone === "string"
      ? source.phone
      : typeof source["contactPhone"] === "string"
      ? (source["contactPhone"] as string)
      : fromNested?.phone;

  const name =
    typeof source.name === "string"
      ? source.name
      : typeof source["fullName"] === "string"
      ? (source["fullName"] as string)
      : fromNested?.name;

  return {
    ...fromNested,
    ...source,
    firstName,
    lastName,
    email,
    phone,
    name,
  } as InvoicePartyInfo;
}

function ensureProperty(property: unknown): InvoicePropertyInfo {
  if (!property || typeof property !== "object") {
    return {};
  }

  const source = property as Record<string, unknown>;
  const address = source.address ?? source["propertyAddress"];

  return {
    ...source,
    name:
      typeof source.name === "string"
        ? source.name
        : typeof source["propertyName"] === "string"
        ? (source["propertyName"] as string)
        : undefined,
    address: address as InvoiceAddress | string | undefined,
  } as InvoicePropertyInfo;
}

function normalizeLineItems(items: unknown[]): InvoiceLineItemInfo[] {
  if (!Array.isArray(items) || items.length === 0) {
    return [];
  }

  return items.map((item) => {
    if (!item || typeof item !== "object") {
      return {
        // Left empty: the document words an unnamed line in its own language.
        description: "",
        quantity: 1,
        unitPrice: 0,
        total: 0,
        amount: 0,
      };
    }

    const source = item as Record<string, unknown>;
    const quantityRaw = source.quantity ?? 1;
    const quantity = toNumber(quantityRaw, 1) || 1;
    const unitPriceExplicit = source.unitPrice ?? source["unit_price"];
    const amountRaw = source.amount ?? source["total"];
    const amount = toNumber(amountRaw, 0);
    const unitPriceUnrounded = toNumber(
      unitPriceExplicit,
      quantity > 0 ? amount / quantity : amount
    );
    const unitPrice = roundCurrency(unitPriceUnrounded);
    const totalUnrounded =
      amount !== 0 ? amount : unitPriceUnrounded * quantity;
    const total = roundCurrency(totalUnrounded);

    const dueDate =
      source.dueDate || source["due_date"] || source["due"] || undefined;

    return {
      description:
        typeof source.description === "string"
          ? source.description
          : typeof source["name"] === "string"
          ? (source["name"] as string)
          : "",
      quantity,
      unitPrice,
      total,
      amount: total,
      type:
        typeof source.type === "string"
          ? source.type
          : typeof source["category"] === "string"
          ? (source["category"] as string)
          : undefined,
      dueDate: dueDate ? parseDate(dueDate) : null,
      metadata: source,
      ...(isVatCategory(source.vatCategory)
        ? {
            vatCategory: source.vatCategory,
            vatRate: toNumber(source.vatRate, 0),
            vatAmount: roundCurrency(toNumber(source.vatAmount, 0)),
            netAmount: roundCurrency(toNumber(source.netAmount, total)),
          }
        : {}),
    };
  });
}

/** A credit note's figures as it prints them: positive. */
function positiveLine(item: InvoiceLineItemInfo): InvoiceLineItemInfo {
  return {
    ...item,
    unitPrice: Math.abs(item.unitPrice),
    total: Math.abs(item.total),
    amount: item.amount === undefined ? undefined : Math.abs(item.amount),
    vatAmount: item.vatAmount === undefined ? undefined : Math.abs(item.vatAmount),
    netAmount: item.netAmount === undefined ? undefined : Math.abs(item.netAmount),
  };
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

interface InvoiceStatusInput {
  status?: string;
  documentType?: string | null;
  balanceRemaining?: number;
  amountPaid?: number;
  totalAmount?: number;
  issueDate?: Date | string | null;
  dueDate?: Date | string | null;
}

/**
 * Computes the status an invoice should have *right now* without persisting.
 * Mirrors the transitions in Invoice.updateStatus + pre-save middleware so
 * read paths can surface an accurate status even when nothing has saved the
 * invoice since the due date passed.
 *
 * CANCELLED and PAID are terminal and never transition.
 */
export function computeEffectiveInvoiceStatus(
  invoice: InvoiceStatusInput,
  now: Date = new Date()
): string {
  const status = (invoice.status || "").toString().toLowerCase();
  if (status === InvoiceStatus.CANCELLED) return InvoiceStatus.CANCELLED;
  // A credit note is owed nothing and falls due for nothing: it is issued.
  if (invoice.documentType === "credit_note") return InvoiceStatus.ISSUED;

  const totalAmount = Number(invoice.totalAmount ?? 0);
  const amountPaid = Number(invoice.amountPaid ?? 0);
  const balanceRemaining = Number(
    invoice.balanceRemaining ?? totalAmount - amountPaid
  );

  if (balanceRemaining <= 0 && totalAmount > 0) return InvoiceStatus.PAID;

  // Overdue only after the END of the due date — due dates are stored at
  // midnight, so `now > dueDate` marked invoices overdue all day on the day
  // they were actually due. The day ends at midnight in Riyadh, wherever this
  // runs, and an invoice is issued from the start of its issue day there.
  if (invoice.dueDate && isPastDue(invoice.dueDate, now)) {
    return InvoiceStatus.OVERDUE;
  }
  if (amountPaid > 0) return InvoiceStatus.PARTIAL;
  if (invoice.issueDate && businessDay(invoice.issueDate) <= businessToday(now)) {
    return InvoiceStatus.ISSUED;
  }

  return status || InvoiceStatus.SCHEDULED;
}

/**
 * Returns a shallow copy of the invoice-shaped object with `status` replaced
 * by the effective status. Safe on lean docs, hydrated docs, or plain objects.
 */
export function withEffectiveInvoiceStatus<T extends InvoiceStatusInput>(
  invoice: T,
  now: Date = new Date()
): T & { status: string } {
  const effective = computeEffectiveInvoiceStatus(invoice, now);
  return { ...invoice, status: effective };
}

export function getInvoiceStatusMeta(status?: string): InvoiceStatusMeta {
  const normalized = (status || "issued").toString().toLowerCase();
  const fromMap = STATUS_META_MAP[normalized];

  if (fromMap) {
    return { ...fromMap };
  }

  if (Object.values(InvoiceStatus).includes(normalized as InvoiceStatus)) {
    const fallback = STATUS_META_MAP[normalized] ?? STATUS_META_MAP.issued;
    return { ...fallback };
  }

  return { ...STATUS_META_MAP.issued };
}

export function normalizeInvoiceForPrint(
  invoice: unknown,
  options?: NormalizeInvoiceOptions
): NormalizedInvoice {
  const source = (invoice ?? {}) as Record<string, unknown>;

  const statusMeta = getInvoiceStatusMeta(
    (source.status as string | undefined) || options?.fallbackStatus
  );

  const issueDate = parseDate(
    source.issueDate ?? source["issuedAt"] ?? source["createdAt"]
  );
  const dueDate = parseDate(source.dueDate ?? source["due"] ?? issueDate);

  const documentType =
    source["documentType"] === "credit_note" ? "credit_note" : "invoice";
  const isCredit = documentType === "credit_note";
  const normalizedLines = normalizeLineItems(
    (source.lineItems as unknown[]) ||
      (source["items"] as unknown[]) ||
      (source["line_items"] as unknown[]) ||
      []
  );
  const lineItems = isCredit ? normalizedLines.map(positiveLine) : normalizedLines;
  // A credit note is stored negative; it prints what it credits, positive.
  const sign = (value: number) => (isCredit ? Math.abs(value) : value);

  // Calculate subtotal from line items
  const subtotalFromLines = lineItems.reduce(
    (acc, item) => acc + item.total,
    0
  );
  const subtotalRaw = sign(toNumber(source.subtotal, subtotalFromLines));

  // Extract financial components
  const taxAmountRaw = sign(
    toNumber(source.taxAmount ?? source["tax"] ?? source["tax_total"], 0),
  );
  const discountAmountRaw = toNumber(
    source["discountAmount"] ?? source["discount"] ?? source["discount_total"],
    0
  );
  const shippingAmountRaw = toNumber(
    source["shippingAmount"] ?? source["shipping"] ?? source["shipping_total"],
    0
  );
  const adjustmentsAmountRaw = toNumber(
    source["adjustmentsAmount"] ??
      source["adjustment"] ??
      source["adjustments"] ??
      0,
    0
  );

  // Normalize signs and apply currency rounding for display/consistency
  const subtotal = roundCurrency(subtotalRaw);
  const taxAmount = roundCurrency(taxAmountRaw);
  const shippingAmount = roundCurrency(shippingAmountRaw);
  const discountAmount = roundCurrency(Math.abs(discountAmountRaw)); // discounts reduce total
  const adjustmentsAmount = roundCurrency(adjustmentsAmountRaw); // signed (+charge, -credit)

  // Calculate display total using correct accounting formula
  // Total = Subtotal + Tax + Shipping - Discount + Adjustments
  const computedDisplayTotal = roundCurrency(
    Math.max(
      0,
      subtotal + taxAmount + shippingAmount - discountAmount + adjustmentsAmount
    )
  );

  // Persisted total from source (DB) if present, fall back to computed display total
  const totalAmount = sign(toNumber(source.totalAmount, computedDisplayTotal));

  // Calculate payment status
  const amountPaidRaw = isCredit ? 0 : toNumber(source.amountPaid ?? source["paid"], 0);
  const amountPaid = roundCurrency(amountPaidRaw);
  const computedDisplayBalanceDue = roundCurrency(
    Math.max(0, computedDisplayTotal - amountPaid)
  );

  const balanceRemaining = isCredit
    ? 0
    : toNumber(
        source.balanceRemaining ?? source["balance"] ?? totalAmount - amountPaid,
        totalAmount - amountPaid
      );

  const companyInfoSource = source["companyInfo"] as
    | Partial<InvoiceCompanyInfo>
    | undefined;
  const companyInfo = ensureCompanyInfo(
    companyInfoSource,
    options?.companyInfo
  );

  const tenant = ensureParty(
    source.tenantId ?? source["tenant"] ?? source["customer"]
  );
  const property = ensureProperty(
    source.propertyId ?? source["property"] ?? source["unit"]
  );

  const notesSource =
    typeof source.notes === "string" && source.notes.trim().length > 0
      ? (source.notes as string)
      : options?.defaultNotes ?? DEFAULT_INVOICE_NOTES;

  const derivedCurrencyCode = (
    (source["currency"] as string | undefined) || options?.currencyCode
  )?.toString();

  // The buyer as the tax invoice names them: the customer recorded on it
  // (an owner, a customer, or a tenant with their VAT number), else the
  // tenant.
  const metadataSource = (source.metadata ?? {}) as Record<string, unknown>;
  const tenantName =
    [tenant.firstName, tenant.lastName].filter(Boolean).join(" ") || tenant.name;
  const buyer: InvoiceBuyerInfo = {
    name: text(source["customerName"]) ?? text(tenantName),
    vatNumber: text(source["customerVatNumber"]),
    address: text(source["customerAddress"]),
    type: text(source["customerType"]),
  };
  const building = metadataSource["building"] as { name?: unknown } | undefined;
  const original = source["originalInvoice"] as { invoiceNumber?: unknown } | undefined;

  // VAT by category and rate: from the lines when they carry it, otherwise
  // the invoice's one treatment (an installment, an older invoice).
  const vatRows = lineItems.every((item) => item.vatCategory)
    ? vatBreakdown(
        lineItems.map((item) => ({
          vatCategory: item.vatCategory!,
          vatRate: item.vatRate ?? 0,
          netAmount: item.netAmount ?? item.total,
          vatAmount: item.vatAmount ?? 0,
        })),
      )
    : [];
  const breakdown =
    lineItems.length > 0 && vatRows.length > 0
      ? vatRows
      : [
          legacyInvoiceVat({
            category: text(source["category"]) ?? null,
            subtotal,
            discountAmount,
            taxAmount,
          }),
        ];

  const createdAt = source["createdAt"] ? parseDate(source["createdAt"]) : null;

  const normalized: NormalizedInvoice = {
    documentType,
    originalInvoiceNumber:
      text(original?.invoiceNumber) ?? text(metadataSource["originalInvoiceNumber"]),
    creditReason: isCredit ? text(metadataSource["reason"]) : undefined,
    buyer,
    buildingName: text(building?.name),
    vatBreakdown: breakdown,
    issuedAt: zatcaIssueMoment(issueDate, createdAt),
    _id:
      typeof source._id === "string"
        ? source._id
        : typeof source._id === "object" && source._id !== null
        ? (source._id as { toString?: () => string }).toString?.()
        : undefined,
    invoiceNumber:
      (source.invoiceNumber as string | undefined) ??
      (source["number"] as string | undefined) ??
      (source._id as string | undefined) ??
      "Invoice",
    issueDate,
    dueDate,
    status: statusMeta.value,
    statusMeta,
    companyInfo,
    tenant,
    property,
    lineItems,
    totals: {
      // Display-ready, consistently rounded financial breakdown
      subtotal,
      taxAmount,
      discountAmount,
      shippingAmount,
      adjustmentsAmount,
      total: computedDisplayTotal,
      amountPaid,
      balanceDue: computedDisplayBalanceDue,
    },
    subtotal,
    taxAmount,
    totalAmount,
    amountPaid,
    balanceRemaining,
    discountAmount,
    shippingAmount,
    adjustmentsAmount,
    notes: notesSource,
    metadata:
      (source.metadata as Record<string, unknown> | undefined) || undefined,
    tenantId: tenant,
    propertyId: property,
    leaseId:
      (source.leaseId as Record<string, unknown> | undefined) || undefined,
    raw: invoice,
    currencyCode: derivedCurrencyCode,
  };

  return normalized;
}
