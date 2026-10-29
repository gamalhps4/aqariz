/**
 * PropertyPro - Receipt PDF Renderer
 * Shared receipt PDF rendering logic using jsPDF
 * Provides consistent receipt layout across the application
 */

import type jsPDF from "jspdf";
import {
  deriveCompanyInitials,
  fitLogo,
  loadDocumentLogo,
} from "@/lib/invoice/logo-utils";
import { embedPdfFont, formatPdfMoney } from "@/lib/invoice/pdf-text";
import {
  arabicAwarePdf,
  formatPdfDate,
  isRtlLanguage,
  mirroredPdf,
  pdfLabel,
  type PdfLanguage,
} from "@/lib/invoice/pdf-i18n";
import { drawPageFooters, formatPrintDate } from "@/lib/reports/page-footer";
import { localizationService } from "@/lib/services/localization.service";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { describeCharge } from "@/lib/i18n/charge-description";
import {
  canCarryZatcaQr,
  drawQrCode,
  zatcaQrPayload,
} from "@/lib/invoice/zatca-qr";

/** A4 portrait, in millimetres. */
const PAGE_HEIGHT = 297;
const MARGIN_X = 15;
const MARGIN_TOP = 20;
/** The lowest line content may reach; the footer sits below it. */
const CONTENT_BOTTOM = 277;

export interface ReceiptCompanyInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
  website?: string;
  logo?: string;
  /** The office's VAT registration number (Settings → Branding). */
  vatNumber?: string;
}

export interface ReceiptTenantInfo {
  name: string;
  email: string;
  address?: string;
}

export interface ReceiptPropertyInfo {
  name: string;
  address: string;
}

export interface ReceiptInvoiceApplication {
  invoiceNumber: string;
  amountApplied: number;
}

export interface NormalizedReceipt {
  receiptNumber: string;
  paymentId: string;
  paymentDate: Date;
  paymentMethod: string;
  amount: number;
  description: string;
  invoiceApplications: ReceiptInvoiceApplication[];
  tenant: ReceiptTenantInfo;
  property: ReceiptPropertyInfo;
  company: ReceiptCompanyInfo;
  /** ISO code the amount is in; the organization's currency when absent. */
  currency?: string | null;
  /**
   * The VAT inside the amount, when known (its share of the invoice it
   * paid). With the office's VAT number it puts the ZATCA QR on the receipt.
   */
  vatAmount?: number | null;
  /** The payer's VAT number, when they gave one. */
  buyerVatNumber?: string | null;
}

export interface ReceiptPdfRenderOptions {
  includeFooter?: boolean;
  /**
   * The Arabic-capable face, base64 (see lib/invoice/pdf-text.ts). Without
   * it the receipt is set in Helvetica, and Arabic names do not print.
   */
  fontBase64?: string | null;
  /**
   * The language to write the receipt in; Arabic is also drawn right to
   * left (see pdf-i18n.ts). English when omitted.
   */
  lang?: PdfLanguage;
  /**
   * The office's date-format setting, for the printed-on date in the footer.
   * Server callers pass it; in the browser it defaults to the office's own
   * setting as the app loaded it.
   */
  dateFormat?: string | null;
  /** When the receipt counts as printed. Now, unless a test pins it. */
  printedAt?: Date;
}

/**
 * Render a professional payment receipt PDF
 * Uses consistent styling with invoice renderer
 */
export async function renderReceiptPdf(
  target: jsPDF,
  receipt: NormalizedReceipt,
  options: ReceiptPdfRenderOptions = {}
): Promise<jsPDF> {
  try {
    const includeFooter = options.includeFooter ?? true;
    const lang = options.lang ?? "en";
    if (options.fontBase64) {
      embedPdfFont(target, options.fontBase64);
    }
    // An Arabic receipt is the same layout drawn through a mirror; either way
    // an Arabic line (a name, an address) is laid out right to left.
    const pdf = isRtlLanguage(lang)
      ? mirroredPdf(target)
      : arabicAwarePdf(target);
    const label = (
      key: string,
      english: string,
      values?: Record<string, string | number>,
    ) => pdfLabel(lang, key, english, values);
    const money = (amount: number) => formatPdfMoney(amount, receipt.currency);

    // ========================================================================
    // COLORS - Professional color scheme
    // ========================================================================
    const primaryColor = [16, 185, 129] as [number, number, number]; // Green (matches invoice)
    const textColor = [17, 24, 39] as [number, number, number]; // Dark gray
    const grayColor = [107, 114, 128] as [number, number, number]; // Medium gray
    const borderColor = [229, 231, 235] as [number, number, number]; // Separator gray

    /** A hairline between two fields. */
    const separator = (x1: number, x2: number, lineY: number) => {
      pdf.setDrawColor(...borderColor);
      pdf.setLineWidth(0.2);
      pdf.line(x1, lineY, x2, lineY);
    };

    // ========================================================================
    // HEADER - Company Logo & Info
    // ========================================================================
    const companyInitials = deriveCompanyInitials(receipt.company.name);
    let logoWidth = 0;

    // The office's logo, in proportion — a wide logo drawn into the square
    // came out squashed.
    const logo = await loadDocumentLogo(receipt.company.logo);
    if (logo) {
      try {
        const { width, height } = pdf.getImageProperties(logo.dataUrl);
        const size = fitLogo(width, height, { width: 30, height: 20 });
        pdf.addImage(
          logo.dataUrl,
          logo.format,
          15,
          15,
          size.width,
          size.height,
          undefined,
          "FAST"
        );
        logoWidth = size.width;
      } catch (error) {
        if (process.env.NODE_ENV !== "production") {
          console.warn("Failed to render company logo in receipt PDF", error);
        }
      }
    }

    // Fallback to initials if logo not rendered
    if (!logoWidth) {
      pdf.setFillColor(...primaryColor);
      pdf.rect(15, 15, 20, 20, "F");
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(12);
      pdf.setFont(pdf.getFont().fontName, "bold");
      pdf.text(companyInitials, 25, 26, { align: "center" });
      pdf.setFont(pdf.getFont().fontName, "normal");
      logoWidth = 20;
    }

    // Company info (left side)
    const companyX = 15 + logoWidth + 3;
    pdf.setTextColor(...textColor);
    pdf.setFontSize(14);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(receipt.company.name, companyX, 20);
    pdf.setFont(pdf.getFont().fontName, "normal");

    pdf.setFontSize(9);
    pdf.setTextColor(...grayColor);
    // Only the details the office has filled in, without gaps between them.
    [
      receipt.company.address,
      receipt.company.phone,
      receipt.company.email,
      receipt.company.website,
      receipt.company.vatNumber
        ? label("leases.invoicePrint.vatNumber", "VAT No. {number}", {
            number: receipt.company.vatNumber,
          })
        : "",
    ]
      .filter((line): line is string => Boolean(line))
      .forEach((line, index) => {
        pdf.text(line, companyX, 26 + index * 5);
      });

    // Receipt meta info (right side) - Better aligned
    pdf.setFontSize(9);
    pdf.setTextColor(...grayColor);
    const labelX = 130;
    const valueX = 195;

    pdf.text(label("payments.receiptPdf.number", "Receipt no."), labelX, 20);
    pdf.text(label("payments.receiptPdf.date", "Payment date"), labelX, 26);
    pdf.text(label("payments.receiptPdf.method", "Payment method"), labelX, 32);
    // A hairline between each label/value pair.
    separator(labelX, valueX, 22);
    separator(labelX, valueX, 28);

    pdf.setTextColor(...textColor);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(receipt.receiptNumber, valueX, 20, { align: "right" });
    pdf.text(formatPdfDate(receipt.paymentDate, lang), valueX, 26, {
      align: "right",
    });
    // Stored methods ("bank_transfer") read in the receipt's language.
    const methodCode =
      receipt.paymentMethod.toLowerCase() === "unknown"
        ? "unspecified"
        : receipt.paymentMethod;
    pdf.text(
      label(
        `exports.value.${methodCode}`,
        // A method the export table lacks (a gateway's) has its own label.
        paymentMethodLabel(methodCode, (key, options) =>
          label(key, options?.defaultValue ?? methodCode),
        ),
      ),
      valueX,
      32,
      { align: "right" },
    );
    pdf.setFont(pdf.getFont().fontName, "normal");

    // ========================================================================
    // RECEIPT TITLE - Centered and prominent
    // ========================================================================
    let y = 55;

    /** Start a new page when the next `height` millimetres would not fit. */
    const ensureSpace = (height: number) => {
      if (y + height > CONTENT_BOTTOM) {
        pdf.addPage();
        y = MARGIN_TOP;
      }
    };
    pdf.setTextColor(...textColor);
    pdf.setFontSize(22);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(
      label("payments.receiptPdf.title", "Payment receipt").toUpperCase(),
      105,
      y,
      { align: "center" },
    );
    pdf.setFont(pdf.getFont().fontName, "normal");

    // Decorative line under title
    y += 5;
    pdf.setDrawColor(...primaryColor);
    pdf.setLineWidth(1);
    pdf.line(70, y, 140, y);

    // ========================================================================
    // TENANT SECTION - "Received From"
    // ========================================================================
    y += 12;
    pdf.setFontSize(10);
    pdf.setTextColor(...grayColor);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(
      label("payments.receiptPdf.from", "Received from").toUpperCase(),
      15,
      y,
    );
    pdf.setFont(pdf.getFont().fontName, "normal");

    y += 6;
    pdf.setTextColor(...textColor);
    pdf.setFontSize(10);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(receipt.tenant.name, 15, y);
    pdf.setFont(pdf.getFont().fontName, "normal");

    y += 5;
    pdf.setFontSize(9);
    pdf.setTextColor(...grayColor);
    pdf.text(receipt.tenant.email, 15, y);
    if (receipt.buyerVatNumber) {
      y += 5;
      pdf.text(
        label("leases.invoicePrint.vatNumber", "VAT No. {number}", {
          number: receipt.buyerVatNumber,
        }),
        15,
        y,
      );
    }

    if (receipt.tenant.address) {
      y += 5;
      const addressLines = pdf.splitTextToSize(receipt.tenant.address, 85);
      pdf.text(addressLines, 15, y);
      y += addressLines.length * 5;
    }

    // ========================================================================
    // PROPERTY SECTION
    // ========================================================================
    y += 10;
    pdf.setFontSize(10);
    pdf.setTextColor(...grayColor);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(
      label("payments.receiptPdf.property", "Property").toUpperCase(),
      15,
      y,
    );
    pdf.setFont(pdf.getFont().fontName, "normal");

    y += 6;
    pdf.setTextColor(...textColor);
    pdf.setFontSize(10);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(receipt.property.name, 15, y);
    pdf.setFont(pdf.getFont().fontName, "normal");

    y += 5;
    pdf.setFontSize(9);
    pdf.setTextColor(...grayColor);
    const propertyAddressLines = pdf.splitTextToSize(
      receipt.property.address,
      85
    );
    pdf.text(propertyAddressLines, 15, y);
    y += propertyAddressLines.length * 5;

    // ========================================================================
    // PAYMENT DETAILS SECTION - Professional table layout
    // ========================================================================
    y += 15;
    pdf.setFontSize(12);
    pdf.setTextColor(...textColor);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(
      label("payments.receiptPdf.details", "Payment details").toUpperCase(),
      15,
      y,
    );
    pdf.setFont(pdf.getFont().fontName, "normal");

    // Table header with better styling
    y += 8;
    pdf.setFillColor(243, 244, 246); // Light gray background
    pdf.rect(15, y, 180, 10, "F");
    pdf.setDrawColor(229, 231, 235);
    pdf.setLineWidth(0.5);
    pdf.rect(15, y, 180, 10);

    pdf.setFontSize(9);
    pdf.setTextColor(...grayColor);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.text(
      label("leases.invoicePrint.description", "Description"),
      20,
      y + 6.5,
    );
    pdf.text(
      label("payments.receiptPdf.amount", "Amount"),
      188,
      y + 6.5,
      { align: "right" },
    );
    pdf.setFont(pdf.getFont().fontName, "normal");

    // Table content with proper spacing
    y += 12;
    pdf.setTextColor(...textColor);
    pdf.setFontSize(9);

    if (receipt.invoiceApplications.length > 0) {
      // Show invoice applications
      receipt.invoiceApplications.forEach((app, index) => {
        // A payment spread over many invoices runs onto another page rather
        // than off the bottom of this one.
        ensureSpace(10);
        pdf.text(
          label("payments.receiptPdf.forInvoice", "Payment for invoice {number}", { number: app.invoiceNumber }),
          20,
          y + 3,
        );
        pdf.setFont(pdf.getFont().fontName, "bold");
        pdf.text(money(app.amountApplied), 188, y + 3, {
          align: "right",
        });
        pdf.setFont(pdf.getFont().fontName, "normal");

        // Row separator (except for last row, which the total's rule follows)
        if (index < receipt.invoiceApplications.length - 1) {
          separator(15, 195, y + 7);
        }
        y += 10;
      });
    } else {
      // Show general payment description
      // Whoever built the receipt, a generated wording ("Payment for
      // security_deposit") is said in the receipt's language.
      const description =
        describeCharge({ description: receipt.description }, lang) ||
        label("payments.receiptPdf.received", "Payment received");
      const descLines = pdf.splitTextToSize(description, 140);
      pdf.text(descLines, 20, y + 3);
      pdf.setFont(pdf.getFont().fontName, "bold");
      pdf.text(money(receipt.amount), 188, y + 3, {
        align: "right",
      });
      pdf.setFont(pdf.getFont().fontName, "normal");
      // A description that wraps pushes the total down with it.
      y += Math.max(10, descLines.length * 4 + 6);
    }

    // Total separator line
    ensureSpace(30);
    y += 5;
    pdf.setDrawColor(...textColor);
    pdf.setLineWidth(0.8);
    pdf.line(15, y, 195, y);

    // Total amount - Emphasized
    y += 10;
    pdf.setFillColor(16, 185, 129); // Green background
    pdf.rect(15, y - 5, 180, 14, "F");

    pdf.setFontSize(12);
    pdf.setFont(pdf.getFont().fontName, "bold");
    pdf.setTextColor(255, 255, 255); // White text
    pdf.text(
      label("payments.receiptPdf.totalPaid", "Total paid").toUpperCase(),
      20,
      y + 3,
    );
    pdf.setFontSize(14);
    pdf.text(money(receipt.amount), 188, y + 3, { align: "right" });
    pdf.setFont(pdf.getFont().fontName, "normal");

    // The ZATCA QR code, when the office is registered for VAT and the VAT
    // inside this payment is known; drawn on the document itself, so an
    // Arabic receipt does not reflect it.
    if (
      receipt.vatAmount !== undefined &&
      receipt.vatAmount !== null &&
      canCarryZatcaQr(receipt.company.name, receipt.company.vatNumber)
    ) {
      const size = 28;
      y += 14;
      ensureSpace(size + 4);
      pdf.setFontSize(9);
      pdf.setTextColor(...grayColor);
      pdf.text(
        `${label("leases.invoicePrint.vat", "VAT")}: ${money(receipt.vatAmount)}`,
        15 + size + 4,
        y + 6,
      );
      const pageWidth = target.internal.pageSize.getWidth();
      drawQrCode(
        target,
        zatcaQrPayload({
          sellerName: receipt.company.name,
          vatNumber: String(receipt.company.vatNumber),
          timestamp: receipt.paymentDate,
          total: receipt.amount,
          vatTotal: receipt.vatAmount,
        }),
        isRtlLanguage(lang) ? pageWidth - 15 - size : 15,
        y,
        size,
      );
      y += size;
    }

    // ========================================================================
    // FOOTER - Thank you message, then the date and page count on every page
    // ========================================================================
    if (includeFooter) {
      y += 25;
      ensureSpace(12);

      // Thank you message
      pdf.setFontSize(11);
      pdf.setTextColor(...textColor);
      pdf.setFont(pdf.getFont().fontName, "bold");
      pdf.text(
        label("payments.receiptPdf.thanks", "Thank you for your payment."),
        105,
        y,
        { align: "center" },
      );
      pdf.setFont(pdf.getFont().fontName, "normal");

      y += 8;
      pdf.setFontSize(9);
      pdf.setTextColor(...grayColor);
      pdf.text(
        label("payments.receiptPdf.confirms", "This receipt confirms that your payment has been received."),
        105,
        y,
        { align: "center" }
      );

      // The printed-on date and "page 1 of 2", on every page, with the office
      // that issued the receipt between them. Drawn on the document itself,
      // not the mirror: the footer mirrors itself.
      target.setFont(target.getFont().fontName, "normal");
      drawPageFooters(
        target,
        {
          lang,
          rtl: isRtlLanguage(lang),
          printedOn: formatPrintDate(
            options.printedAt ?? new Date(),
            options.dateFormat ?? localizationService.getDateFormat(),
          ),
          note: receipt.company.name,
        },
        {
          marginX: MARGIN_X,
          baseline: PAGE_HEIGHT - 11,
          ruleY: PAGE_HEIGHT - 16,
          ruleWidth: 0.2,
          fontSize: 8,
          textColor: grayColor,
          ruleColor: borderColor,
        },
      );
    }

    return target;
  } catch (error) {
    console.error("Receipt PDF rendering failed:", error);
    throw new Error(
      `Failed to render receipt PDF: ${
        error instanceof Error ? error.message : "Unknown error"
      }`
    );
  }
}
