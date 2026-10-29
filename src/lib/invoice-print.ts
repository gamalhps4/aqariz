/**
 * PropertyPro - Downloading, printing and previewing an invoice
 *
 * Every invoice screen downloads, prints and previews the same document: the
 * jsPDF drawing in pdf-renderer.ts, in the reader's language — Arabic right
 * to left — with the office's logo, a line between every row and field, and
 * the printed-on date and "page 1 of 2" at the foot of every page. It is also
 * the file an emailed invoice carries, so what a tenant is sent and what the
 * office prints and looks at are one design.
 *
 * This replaced an HTML template: shown in a window, printed by the browser,
 * or turned into a picture (html2canvas) squeezed onto a single A4 page for a
 * download — none of which could number its pages or keep a footer.
 */

import type jsPDF from "jspdf";
import {
  InvoiceAddress,
  InvoiceCompanyInfo,
  InvoiceLineItemInfo,
  InvoicePartyInfo,
  InvoicePropertyInfo,
  NormalizeInvoiceOptions,
  NormalizedInvoice,
  normalizeInvoiceForPrint,
} from "@/lib/invoice/invoice-shared";
import { localizationService } from "@/lib/services/localization.service";
import { loadBrowserPdfFont } from "@/lib/invoice/pdf-text";
import { interfacePdfLanguage } from "@/lib/invoice/pdf-i18n";
import { openPdfWindow } from "@/lib/pdf-window";

export type PrintableInvoiceAddress = InvoiceAddress;
export type PrintableInvoiceLineItem = InvoiceLineItemInfo;
export type PrintableInvoiceParty = InvoicePartyInfo;
export type PrintableInvoiceProperty = InvoicePropertyInfo;
export type PrintableInvoice = NormalizedInvoice;

function ensurePrintableInvoice(
  invoice: PrintableInvoice | unknown,
  options?: NormalizeInvoiceOptions
): NormalizedInvoice {
  if (
    invoice &&
    typeof invoice === "object" &&
    (invoice as NormalizedInvoice).statusMeta &&
    (invoice as NormalizedInvoice).totals
  ) {
    if (options?.companyInfo) {
      return normalizeInvoiceForPrint(invoice, options);
    }

    return invoice as NormalizedInvoice;
  }

  return normalizeInvoiceForPrint(invoice, options);
}

/** The invoice drawn as a PDF, and the name to save it under. */
async function renderInvoiceDocument(
  invoice: PrintableInvoice | unknown,
  companyInfo?: Partial<InvoiceCompanyInfo>,
): Promise<{ pdf: jsPDF; fileName: string }> {
  const normalized = ensurePrintableInvoice(invoice, { companyInfo });
  const [{ default: JsPDF }, { renderInvoicePdf }, fontBase64] =
    await Promise.all([
      import("jspdf"),
      import("@/lib/invoice/pdf-renderer"),
      loadBrowserPdfFont(),
    ]);

  const pdf = new JsPDF({
    orientation: "portrait",
    unit: "mm",
    format: "a4",
  });

  await renderInvoicePdf(pdf, normalized, {
    includeNotes: true,
    fontBase64,
    lang: interfacePdfLanguage(),
  });

  const fileName = `invoice-${(
    normalized.invoiceNumber ||
    normalized._id ||
    Date.now()
  ).toString()}.pdf`;
  return { pdf, fileName };
}

/** Download the invoice as a PDF. */
export async function downloadInvoiceAsPDF(
  invoice: PrintableInvoice | unknown,
  companyInfo?: Partial<InvoiceCompanyInfo>,
): Promise<void> {
  const { pdf, fileName } = await renderInvoiceDocument(invoice, companyInfo);
  pdf.save(fileName);
}

/** `downloadInvoiceAsPDF`, kept for the components that call it by this name. */
export async function downloadInvoiceAsPDFDirect(
  invoice: PrintableInvoice | unknown,
  companyInfo?: Partial<InvoiceCompanyInfo>,
): Promise<void> {
  try {
    await downloadInvoiceAsPDF(invoice, companyInfo);
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    throw new Error(
      `PDF generation failed: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}

/** What the new window says while the invoice is being drawn. */
function preparing(): string {
  return localizationService.translate("leases.invoicePrint.preparing", {
    defaultValue: "Preparing the invoice…",
  });
}

/**
 * Print the invoice: the PDF opens in a new window and asks to print itself.
 * Called from a click, so the window is opened before anything is awaited.
 */
export function printInvoice(
  invoice: PrintableInvoice | unknown,
  companyInfo?: Partial<InvoiceCompanyInfo>,
): void {
  openPdfWindow(
    async () => (await renderInvoiceDocument(invoice, companyInfo)).pdf,
    { print: true, waiting: preparing() },
  );
}

/** `printInvoice`, kept for the components that call it by this name. */
export async function printInvoiceDirect(
  invoice: PrintableInvoice | unknown,
  companyInfo?: Partial<InvoiceCompanyInfo>,
): Promise<void> {
  printInvoice(invoice, companyInfo);
}

/**
 * Show the invoice: the same PDF as the download and the printout, in a new
 * window — what the office looks at is what the tenant receives.
 */
export function previewInvoice(
  invoice: PrintableInvoice | unknown,
  companyInfo?: Partial<InvoiceCompanyInfo>,
): void {
  openPdfWindow(
    async () => (await renderInvoiceDocument(invoice, companyInfo)).pdf,
    { print: false, waiting: preparing() },
  );
}
