/**
 * PropertyPro - Invoice PDF Generator
 * Enhanced PDF generation using jsPDF (client-side, lightweight)
 */

import jsPDF from "jspdf";
import { LeaseResponse } from "@/lib/services/lease.service";
import { buildPrintableInvoiceFromLease } from "@/lib/invoice/invoice-builders";
import { renderInvoicePdf } from "@/lib/invoice/pdf-renderer";
import { loadBrowserPdfFont } from "@/lib/invoice/pdf-text";
import { localizationService } from "@/lib/services/localization.service";
import { isReportLanguage } from "@/lib/reports/labels";

/** The interface's language, as a PDF language. */
function currentPdfLanguage() {
  const code = localizationService.getCurrentLocale().split("-")[0];
  return isReportLanguage(code) ? code : "en";
}
import { DEFAULT_INVOICE_NOTES } from "@/lib/invoice/invoice-shared";

export interface InvoiceGenerationOptions {
  lease: LeaseResponse;
  companyInfo?: {
    name: string;
    address: string;
    phone: string;
    email: string;
    website?: string;
    logo?: string;
  };
  invoiceNumber?: string;
  issueDate?: Date;
  dueDate?: Date;
  includeTerms?: boolean;
  includeNotes?: boolean;
  watermark?: string;
}

export interface InvoiceGenerationResult {
  success: boolean;
  fileUrl?: string;
  fileName?: string;
  error?: string;
  blob?: Blob;
}

/**
 * Generate a professional lease invoice PDF using jsPDF (client-side)
 */
export async function generateLeaseInvoicePDF(
  options: InvoiceGenerationOptions
): Promise<InvoiceGenerationResult> {
  try {
    const {
      lease,
      companyInfo,
      invoiceNumber,
      issueDate = new Date(),
      dueDate,
      includeTerms = true,
      includeNotes = true,
      watermark,
    } = options;
    const baseNotes = includeTerms
      ? [
          DEFAULT_INVOICE_NOTES,
          "• Payment is due on or before the due date specified above.\n• Please include invoice number with your payment.\n• Contact us immediately if you have any questions about this invoice.",
        ]
          .filter(Boolean)
          .join("\n\n")
      : DEFAULT_INVOICE_NOTES;

    const normalized = buildPrintableInvoiceFromLease(lease, {
      companyInfo,
      invoiceNumber,
      issueDate,
      dueDate,
      notes: includeNotes ? baseNotes : DEFAULT_INVOICE_NOTES,
    });

    const pdf = new jsPDF({
      orientation: "portrait",
      unit: "mm",
      format: "a4",
    });

    await renderInvoicePdf(pdf, normalized, {
      includeNotes,
      fontBase64: await loadBrowserPdfFont(),
      lang: currentPdfLanguage(),
    });

    if (watermark) {
      const pageSize = pdf.internal.pageSize;
      const centerX = pageSize.getWidth() / 2;
      const centerY = pageSize.getHeight() / 2;
      pdf.setTextColor(200, 200, 200);
      pdf.setFontSize(48);
      pdf.text(watermark, centerX, centerY, {
        angle: 45,
        align: "center",
      });
    }

    const pdfBlob = pdf.output("blob");
    const safeNumber = (normalized.invoiceNumber || "invoice").replace(
      /[^a-zA-Z0-9]/g,
      "_"
    );
    const fileName = `lease_invoice_${safeNumber}.pdf`;
    const fileUrl = typeof window !== "undefined" ? URL.createObjectURL(pdfBlob) : undefined;

    return {
      success: true,
      fileUrl,
      fileName,
      blob: pdfBlob,
    };
  } catch (error) {
    console.error("Error generating lease invoice PDF:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to generate PDF",
    };
  }
}

/**
 * Download the generated PDF
 */
export function downloadInvoicePDF(result: InvoiceGenerationResult): void {
  if (!result.success || !result.fileUrl || !result.fileName) {
    throw new Error("Invalid PDF generation result");
  }

  const link = document.createElement("a");
  link.href = result.fileUrl;
  link.download = result.fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Clean up the object URL
  URL.revokeObjectURL(result.fileUrl);
}

/**
 * Email the invoice PDF using the API endpoint
 */
export async function emailInvoicePDF(emailOptions: {
  to: string;
  subject?: string;
  message?: string;
  leaseId: string;
  invoiceNumber?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    if (!emailOptions.leaseId) {
      throw new Error("Lease ID is required");
    }

    // Send email via API endpoint (server will generate PDF)
    const response = await fetch("/api/invoices/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        leaseId: emailOptions.leaseId,
        to: emailOptions.to,
        // Left to the route when not given: it words them in `lang`.
        subject: emailOptions.subject || undefined,
        message: emailOptions.message || undefined,
        invoiceNumber: emailOptions.invoiceNumber,
        lang: currentPdfLanguage(),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(
        errorData.error || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    const responseData = await response.json();

    return { success: true };
  } catch (error) {
    console.error("Failed to send invoice email:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to send email",
    };
  }
}

/**
 * Save the PDF to the documents system (mock implementation)
 */
export async function saveInvoiceToDocuments(
  result: InvoiceGenerationResult,
  leaseId: string
): Promise<{ success: boolean; documentId?: string; error?: string }> {
  try {
    if (!result.success || !result.blob) {
      throw new Error("Invalid PDF generation result");
    }

    // Mock document saving

    // Simulate document saving delay
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const documentId = `doc_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 9)}`;

    return {
      success: true,
      documentId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to save document",
    };
  }
}
