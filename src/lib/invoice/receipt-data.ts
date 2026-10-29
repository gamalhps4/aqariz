/**
 * PropertyPro - A payment, as a receipt
 *
 * The receipt a tenant downloads from the portal (drawn on the server) and
 * the one the office downloads or prints from the payment screen (drawn in
 * the browser) are made from a payment the same way, here. No database and
 * nothing server-only, so both sides can import it.
 */

import type {
  NormalizedReceipt,
  ReceiptCompanyInfo,
} from "@/lib/invoice/receipt-renderer";
import type { PdfLanguage } from "@/lib/invoice/pdf-i18n";
import { describeCharge } from "@/lib/i18n/charge-description";
import { receiptNumberFor } from "@/lib/payments/receipt-number";

type Id = string | { toString: () => string };

interface ReceiptPerson {
  _id?: Id;
  firstName?: string;
  lastName?: string;
  email?: string;
  /** The older shape some screens still describe: the person under `userId`. */
  userId?: { firstName?: string; lastName?: string; email?: string };
}

/**
 * Payment data a receipt is made from — the payment API's shape, with the
 * tenant and property populated.
 */
export interface ReceiptPaymentData {
  _id?: Id;
  receiptNumber?: string;
  amount: number;
  /** ISO code the payment was taken in. */
  currency?: string | null;
  paymentMethod?: string;
  paymentDate?: Date;
  paidDate?: Date;
  createdAt?: Date;
  description?: string;
  type?: string;
  tenantId?: ReceiptPerson;
  propertyId?: {
    _id?: Id;
    name?: string;
    address?:
      | string
      | {
          street?: string;
          city?: string;
          state?: string;
          zipCode?: string;
        };
  };
  invoiceApplications?: Array<{
    invoiceNumber: string;
    amountApplied: number;
  }>;
  /** The VAT inside the amount, when the caller knows it. */
  vatAmount?: number | null;
  /**
   * The invoice it paid, with its tax and total: the VAT inside the payment
   * is its share of the invoice's tax.
   */
  invoice?: { taxAmount?: number | null; totalAmount?: number | null } | null;
  /** The payer's VAT number, when they gave one. */
  buyerVatNumber?: string | null;
}

/**
 * The VAT inside a payment: what the caller says, else the payment's share
 * of the tax on the invoice it paid, else unknown (null).
 */
export function receiptVatAmount(payment: ReceiptPaymentData): number | null {
  if (typeof payment.vatAmount === "number") return payment.vatAmount;
  const tax = Number(payment.invoice?.taxAmount);
  const total = Number(payment.invoice?.totalAmount);
  if (!Number.isFinite(tax) || !Number.isFinite(total) || total <= 0) return null;
  return Math.round(((Number(payment.amount) * tax) / total) * 100) / 100;
}

/** What a receipt prints where a detail is unknown — the same in every language. */
const UNKNOWN = "—";

/**
 * The receipt for a payment, in `lang`.
 *
 * A detail the payment does not carry prints as a dash. It used to print as
 * "Unknown Tenant", "Address not available" or "N/A" — English in the middle
 * of an Arabic receipt.
 */
export function normalizePaymentToReceipt(
  payment: ReceiptPaymentData,
  company: ReceiptCompanyInfo,
  lang: PdfLanguage = "en",
): NormalizedReceipt {
  const paymentId =
    typeof payment._id === "string"
      ? payment._id
      : payment._id?.toString() || "";
  const receiptNumber = receiptNumberFor(paymentId, payment.receiptNumber);

  const paymentDate =
    payment.paymentDate || payment.paidDate || payment.createdAt || new Date();

  // The payment API sends the tenant flat; older screens nest it in `userId`.
  const person = payment.tenantId?.userId ?? payment.tenantId;
  const tenantName = [person?.firstName, person?.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  const address = payment.propertyId?.address;
  const propertyAddress =
    typeof address === "string"
      ? address
      : [address?.street, address?.city, address?.state, address?.zipCode]
          .filter(Boolean)
          .join(", ");

  // A payment without a description of its own is described by its type, in
  // the receipt's language ("Rent", "إيجار"); with neither, the renderer
  // writes "Payment received".
  // A generated description ("Monthly rent - September 2026") is said in the
  // receipt's language too; one the office typed stays as typed.
  const description = describeCharge(
    { description: payment.description, type: payment.type },
    lang,
  );

  return {
    receiptNumber,
    paymentId,
    paymentDate,
    paymentMethod: payment.paymentMethod || UNKNOWN,
    amount: payment.amount,
    currency: payment.currency,
    description,
    invoiceApplications: payment.invoiceApplications || [],
    vatAmount: receiptVatAmount(payment),
    buyerVatNumber: payment.buyerVatNumber ?? null,
    tenant: {
      name: tenantName || UNKNOWN,
      email: person?.email || "",
    },
    property: {
      name: payment.propertyId?.name || UNKNOWN,
      address: propertyAddress || UNKNOWN,
    },
    company,
  };
}
