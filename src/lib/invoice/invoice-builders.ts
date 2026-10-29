import { LeaseResponse } from "@/lib/services/lease.service";
import {
  InvoiceLineItemInfo,
  InvoiceCompanyInfo,
  NormalizedInvoice,
  normalizeInvoiceForPrint,
  NormalizeInvoiceOptions,
  DEFAULT_INVOICE_NOTES,
} from "@/lib/invoice/invoice-shared";

export interface LeaseInvoiceLineItemInput
  extends Partial<InvoiceLineItemInfo> {
  description: string;
  amount: number;
  type?: string;
}

export interface LeaseInvoiceBuildOptions {
  invoiceNumber?: string;
  issueDate?: Date;
  dueDate?: Date;
  status?: string;
  companyInfo?: Partial<InvoiceCompanyInfo>;
  notes?: string;
  amountPaid?: number;
  taxAmount?: number;
  additionalLineItems?: LeaseInvoiceLineItemInput[];
  overrides?: Partial<NormalizeInvoiceOptions>;
}

function buildDefaultLineItems(
  lease: LeaseResponse
): InvoiceLineItemInfo[] {
  const items: InvoiceLineItemInfo[] = [];

  if (lease.terms?.rentAmount) {
    items.push({
      description: `Monthly Rent - ${lease.propertyId?.name || "Property"}`,
      quantity: 1,
      unitPrice: lease.terms.rentAmount,
      total: lease.terms.rentAmount,
      amount: lease.terms.rentAmount,
      type: "rent",
    });
  }

  if (lease.terms?.securityDeposit) {
    items.push({
      description: "Security Deposit",
      quantity: 1,
      unitPrice: lease.terms.securityDeposit,
      total: lease.terms.securityDeposit,
      amount: lease.terms.securityDeposit,
      type: "security_deposit",
    });
  }

  if (lease.terms?.petDeposit) {
    items.push({
      description: "Pet Deposit",
      quantity: 1,
      unitPrice: lease.terms.petDeposit,
      total: lease.terms.petDeposit,
      amount: lease.terms.petDeposit,
      type: "pet_deposit",
    });
  }

  return items;
}

function mergeLineItems(
  baseItems: InvoiceLineItemInfo[],
  additionalItems?: LeaseInvoiceLineItemInput[]
): InvoiceLineItemInfo[] {
  if (!additionalItems || additionalItems.length === 0) {
    return baseItems;
  }

  const extras = additionalItems.map((item) => {
    const quantity = item.quantity ?? 1;
    const unitPrice =
      item.unitPrice ??
      (quantity && quantity > 0 ? item.amount / quantity : item.amount);
    const total = item.amount ?? unitPrice * quantity;
    return {
      description: item.description,
      quantity,
      unitPrice,
      total,
      amount: total,
      type: item.type,
    } as InvoiceLineItemInfo;
  });

  return [...baseItems, ...extras];
}

export function buildPrintableInvoiceFromLease(
  lease: LeaseResponse,
  options: LeaseInvoiceBuildOptions = {}
): NormalizedInvoice {
  const {
    invoiceNumber,
    issueDate,
    dueDate,
    status = "issued",
    companyInfo,
    notes,
    amountPaid = 0,
    taxAmount = 0,
    additionalLineItems,
    overrides,
  } = options;

  const leaseIdString =
    typeof lease._id === "string"
      ? lease._id
      : typeof lease._id === "object" && lease._id !== null
      ? (lease._id as { toString?: () => string }).toString?.() ?? ""
      : "";

  const generatedInvoiceNumber =
    invoiceNumber ||
    `INV-${leaseIdString.slice(-8).toUpperCase() || "LEASE"}-${new Date().getFullYear()}`;

  const calculatedIssueDate = issueDate || new Date();
  const calculatedDueDate =
    dueDate ||
    new Date(
      calculatedIssueDate.getTime() + 30 * 24 * 60 * 60 * 1000
    );

  const lineItems = mergeLineItems(
    buildDefaultLineItems(lease),
    additionalLineItems
  );

  const subtotal = lineItems.reduce((acc, item) => acc + (item.total || 0), 0);
  const totalAmount = subtotal + taxAmount;
  const balanceRemaining = Math.max(totalAmount - amountPaid, 0);

  const tenantInfo = (lease as any).tenantId || {};
  const propertyInfo = lease.propertyId || {};

  const rawInvoice = {
    invoiceNumber: generatedInvoiceNumber,
    issueDate: calculatedIssueDate,
    dueDate: calculatedDueDate,
    status,
    subtotal,
    taxAmount,
    totalAmount,
    amountPaid,
    balanceRemaining,
    notes: notes ?? DEFAULT_INVOICE_NOTES,
    companyInfo,
    tenantId: tenantInfo,
    propertyId: propertyInfo,
    leaseId: { _id: lease._id, propertyId: propertyInfo },
    lineItems,
  };

  return normalizeInvoiceForPrint(rawInvoice, {
    companyInfo,
    defaultNotes: notes,
    fallbackStatus: status,
    ...overrides,
  });
}
