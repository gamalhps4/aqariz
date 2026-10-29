/**
 * PropertyPro - Receipt PDF Service
 * Server-side receipt PDF generation using shared renderer
 * Provides consistent receipt PDFs for API routes and email attachments
 */

import jsPDF from "jspdf";
import {
  renderReceiptPdf,
  ReceiptCompanyInfo,
} from "@/lib/invoice/receipt-renderer";
import {
  normalizePaymentToReceipt,
  type ReceiptPaymentData,
} from "@/lib/invoice/receipt-data";
import {
  getCompanyInfoServer,
  getOrgDocumentPreferences,
} from "@/lib/utils/company-info-server";
import type { PdfLanguage } from "@/lib/invoice/pdf-i18n";
import { mergeReceiptCompanyWithDefaults } from "@/lib/invoice/company-info-defaults";
import { reportFontBase64 } from "@/lib/reports/pdf-font";
import { serverLogoDataUrl } from "@/lib/reports/logo-image";

export type { ReceiptPaymentData };

/**
 * Options for receipt PDF generation
 */
export interface ReceiptPdfOptions {
  companyInfo?: Partial<ReceiptCompanyInfo>;
  includeFooter?: boolean;
  /** The reader's language; the office's display language when omitted. */
  lang?: PdfLanguage;
}

/**
 * Generate receipt PDF buffer for server-side use
 * Returns a Buffer that can be used for API responses or email attachments
 */
export async function generateReceiptPdfBuffer(
  paymentData: ReceiptPaymentData,
  options: ReceiptPdfOptions = {}
): Promise<Buffer> {
  try {
    // Fetch company info from settings or use provided/defaults
    let companyInfo: ReceiptCompanyInfo;
    if (options.companyInfo) {
      companyInfo = mergeReceiptCompanyWithDefaults(options.companyInfo);
    } else {
      const serverCompanyInfo = await getCompanyInfoServer();
      companyInfo = mergeReceiptCompanyWithDefaults(serverCompanyInfo || undefined);
    }
    // The logo converted here, where the hosts it may come from are checked;
    // the renderer only draws what it is handed.
    companyInfo = {
      ...companyInfo,
      logo: await serverLogoDataUrl(companyInfo.logo),
    };
    const preferences = await getOrgDocumentPreferences();
    const lang = options.lang ?? preferences.language;

    // Normalize payment data to receipt format
    const normalizedReceipt = normalizePaymentToReceipt(
      paymentData,
      companyInfo,
      lang,
    );

    // Create PDF instance
    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    // Render receipt using shared renderer
    await renderReceiptPdf(pdf, normalizedReceipt, {
      includeFooter: options.includeFooter ?? true,
      fontBase64: reportFontBase64(),
      lang,
      dateFormat: preferences.dateFormat,
    });

    // Convert to buffer
    const pdfArrayBuffer = pdf.output("arraybuffer");
    return Buffer.from(pdfArrayBuffer);
  } catch (error) {
    console.error("Failed to generate receipt PDF buffer:", error);
    throw new Error(
      `Receipt PDF generation failed: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}
