/**
 * PropertyPro - Which tax document an invoice is
 *
 * An office with a VAT number issues tax invoices: to a buyer who gives
 * theirs, a tax invoice (فاتورة ضريبية); otherwise a simplified tax invoice
 * (فاتورة ضريبية مبسطة), the B2C document of ZATCA phase 1. Without a VAT
 * number it issues a plain invoice, as before. A credit note is a credit
 * note (إشعار دائن). Shared by the PDF and the invoice screen.
 */

export interface TaxDocumentTitle {
  /** The catalogue key of the title in the reader's language. */
  key: string;
  english: string;
  /** The Arabic title, printed under another language's. */
  arabic: string;
}

export function taxDocumentTitle(input: {
  documentType?: string | null;
  sellerVatNumber?: string | null;
  buyerVatNumber?: string | null;
}): TaxDocumentTitle {
  if (input.documentType === "credit_note") {
    return { key: "leases.invoicePrint.creditNote", english: "Credit note", arabic: "إشعار دائن" };
  }
  if (!input.sellerVatNumber?.trim()) {
    return { key: "leases.invoiceView.heading", english: "Invoice", arabic: "فاتورة" };
  }
  return input.buyerVatNumber?.trim()
    ? { key: "leases.invoicePrint.taxInvoice", english: "Tax invoice", arabic: "فاتورة ضريبية" }
    : {
        key: "leases.invoicePrint.simplifiedTaxInvoice",
        english: "Simplified tax invoice",
        arabic: "فاتورة ضريبية مبسطة",
      };
}
