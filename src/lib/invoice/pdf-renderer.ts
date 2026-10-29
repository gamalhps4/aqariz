/**
 * PropertyPro - Invoice PDF Renderer
 * Professional invoice PDF rendering using jsPDF
 * Features: Modern design, proper typography, accurate data mapping
 */

import type jsPDF from "jspdf";
import {
  NormalizedInvoice,
  InvoiceLineItemInfo,
} from "@/lib/invoice/invoice-shared";
import {
  deriveCompanyInitials,
  fitLogo,
  loadDocumentLogo,
} from "@/lib/invoice/logo-utils";
import { embedPdfFont, formatPdfMoney, setPdfFont } from "@/lib/invoice/pdf-text";
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
import { describeCharge } from "@/lib/i18n/charge-description";
import {
  canCarryZatcaQr,
  drawQrCode,
  zatcaQrPayload,
} from "@/lib/invoice/zatca-qr";
import type { VatCategory } from "@/lib/invoice/vat";
import { taxDocumentTitle, type TaxDocumentTitle } from "@/lib/invoice/tax-document";

// ============================================================================
// CONFIGURATION & CONSTANTS
// ============================================================================

/** Page layout constants (A4 in mm) */
const PAGE = {
  WIDTH: 210,
  HEIGHT: 297,
  MARGIN_LEFT: 20,
  MARGIN_RIGHT: 20,
  MARGIN_TOP: 20,
  MARGIN_BOTTOM: 20,
  CONTENT_WIDTH: 170, // WIDTH - MARGIN_LEFT - MARGIN_RIGHT
} as const;

/** Color palette - Professional grayscale with accent */
const COLORS = {
  // Text colors
  PRIMARY: [17, 24, 39] as [number, number, number], // Near black
  SECONDARY: [75, 85, 99] as [number, number, number], // Medium gray
  MUTED: [107, 114, 128] as [number, number, number], // Light gray
  // Background colors
  HEADER_BG: [249, 250, 251] as [number, number, number], // Very light gray
  BORDER: [229, 231, 235] as [number, number, number], // Border gray
  ACCENT: [16, 185, 129] as [number, number, number], // Emerald green
  WHITE: [255, 255, 255] as [number, number, number],
} as const;

/** Typography configuration */
const FONTS = {
  // The face itself is chosen per document — see setPdfFont.
  SIZES: {
    TITLE: 24,
    HEADING: 14,
    SUBHEADING: 11,
    BODY: 10,
    SMALL: 9,
    TINY: 8,
  },
  LINE_HEIGHT: 1.4,
} as const;

// ============================================================================
// TYPES
// ============================================================================

export interface InvoicePdfRenderOptions {
  includeNotes?: boolean;
  includePaymentInstructions?: boolean;
  /**
   * The Arabic-capable face, base64 (see lib/invoice/pdf-text.ts). Without
   * it the document is set in Helvetica, and any Arabic in it — a tenant's
   * name, a building, the office itself — does not print.
   */
  fontBase64?: string | null;
  /**
   * The language to write the invoice in. Arabic is also drawn right to left
   * (see pdf-i18n.ts). English when omitted.
   */
  lang?: PdfLanguage;
  /**
   * The office's date-format setting, for the printed-on date in the footer.
   * In the browser it defaults to the office's own setting as the app loaded
   * it; server callers pass it, since the server has no one office.
   */
  dateFormat?: string | null;
  /** When the invoice counts as printed. Now, unless a test pins it. */
  printedAt?: Date;
}

interface RenderContext {
  pdf: jsPDF;
  /** The document itself, never mirrored: for what must not be reflected. */
  page: jsPDF;
  y: number;
  lang: PdfLanguage;
}

/** The QR code's side, in millimetres. */
const QR_SIZE = 30;

/** Which tax document this is (tax-document.ts). */
export function invoiceTitle(
  normalized: Pick<NormalizedInvoice, "documentType" | "buyer" | "companyInfo">,
): TaxDocumentTitle {
  return taxDocumentTitle({
    documentType: normalized.documentType,
    sellerVatNumber: normalized.companyInfo.vatNumber,
    buyerVatNumber: normalized.buyer?.vatNumber,
  });
}

/** How a line's VAT reads in the table: its rate, or what it is instead. */
function vatTreatmentLabel(
  ctx: { lang: PdfLanguage },
  category: VatCategory | undefined,
  rate: number | undefined,
): string {
  switch (category) {
    case "S":
      return `${Number(rate ?? 0)}%`;
    case "Z":
      return label(ctx, "invoices.vat.category.Z", "Zero-rated");
    case "E":
      return label(ctx, "invoices.vat.category.E", "Exempt");
    case "O":
      return label(ctx, "invoices.vat.category.O", "Out of scope");
    default:
      return "";
  }
}

/** The logo's box beside the office's name: tall enough to read, never wider. */
const LOGO_BOX = { width: 40, height: 22 };

/** The footer's hairline and baseline, below the last line a page holds. */
const FOOTER = {
  RULE_Y: PAGE.HEIGHT - PAGE.MARGIN_BOTTOM + 4,
  BASELINE: PAGE.HEIGHT - PAGE.MARGIN_BOTTOM + 9,
} as const;

/** A label in this invoice's language. */
function label(
  ctx: { lang: PdfLanguage },
  key: string,
  english: string,
  values?: Record<string, string | number>,
): string {
  return pdfLabel(ctx.lang, key, english, values);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function isApproximatelyZero(value: number): boolean {
  return Math.abs(value) < 1e-6;
}

function formatDisplayCurrency(amount: number, currencyCode?: string): string {
  return formatPdfMoney(isApproximatelyZero(amount) ? 0 : amount, currencyCode);
}

/** Set text color from RGB tuple */
function setTextColor(
  pdf: jsPDF,
  color: readonly [number, number, number]
): void {
  pdf.setTextColor(color[0], color[1], color[2]);
}

/** Set fill color from RGB tuple */
function setFillColor(
  pdf: jsPDF,
  color: readonly [number, number, number]
): void {
  pdf.setFillColor(color[0], color[1], color[2]);
}

/** Set draw color from RGB tuple */
function setDrawColor(
  pdf: jsPDF,
  color: readonly [number, number, number]
): void {
  pdf.setDrawColor(color[0], color[1], color[2]);
}

/** Check if we need a new page and add one if necessary */
function ensureSpace(ctx: RenderContext, requiredHeight: number): void {
  const maxY = PAGE.HEIGHT - PAGE.MARGIN_BOTTOM;
  if (ctx.y + requiredHeight > maxY) {
    ctx.pdf.addPage();
    ctx.y = PAGE.MARGIN_TOP;
  }
}

/** A hairline between two fields, from x1 to x2. */
function drawSeparator(pdf: jsPDF, x1: number, x2: number, y: number): void {
  setDrawColor(pdf, COLORS.BORDER);
  pdf.setLineWidth(0.2);
  pdf.line(x1, y, x2, y);
}

/** Render a section header with optional underline */
function renderSectionHeader(
  ctx: RenderContext,
  title: string,
  options: { uppercase?: boolean; underline?: boolean } = {}
): void {
  const { uppercase = true, underline = false } = options;

  setPdfFont(ctx.pdf, "bold");
  ctx.pdf.setFontSize(FONTS.SIZES.SUBHEADING);
  setTextColor(ctx.pdf, COLORS.SECONDARY);

  const displayTitle = uppercase ? title.toUpperCase() : title;
  ctx.pdf.text(displayTitle, PAGE.MARGIN_LEFT, ctx.y);

  if (underline) {
    setDrawColor(ctx.pdf, COLORS.BORDER);
    ctx.pdf.setLineWidth(0.3);
    ctx.pdf.line(
      PAGE.MARGIN_LEFT,
      ctx.y + 2,
      PAGE.MARGIN_LEFT + PAGE.CONTENT_WIDTH,
      ctx.y + 2
    );
  }

  ctx.y += 8;
  setPdfFont(ctx.pdf, "normal");
}

/** Render party information (Invoice from / Invoice to) */
function renderPartySection(
  pdf: jsPDF,
  x: number,
  y: number,
  title: string,
  lines: string[],
  maxWidth: number = 75
): number {
  // Section title
  setPdfFont(pdf, "bold");
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.SECONDARY);
  pdf.text(title.toUpperCase(), x, y);
  setPdfFont(pdf, "normal");

  // Content lines
  setTextColor(pdf, COLORS.PRIMARY);
  pdf.setFontSize(FONTS.SIZES.SMALL);

  let currentY = y + 6;
  const filteredLines = lines.filter(Boolean);

  filteredLines.forEach((line, index) => {
    // First line (name) is bold
    if (index === 0) {
      setPdfFont(pdf, "bold");
    } else {
      setPdfFont(pdf, "normal");
    }

    const wrappedLines = pdf.splitTextToSize(String(line), maxWidth);
    wrappedLines.forEach((wrappedLine: string) => {
      pdf.text(wrappedLine, x, currentY);
      currentY += 4.5;
    });
  });

  setPdfFont(pdf, "normal");
  return currentY;
}

// ============================================================================
// MAIN RENDER FUNCTION
// ============================================================================

/**
 * Render a professional invoice PDF
 * @param pdf - jsPDF instance to render to
 * @param normalized - Normalized invoice data
 * @param options - Rendering options
 * @returns The jsPDF instance with rendered content
 */
export async function renderInvoicePdf(
  pdf: jsPDF,
  normalized: NormalizedInvoice,
  options: InvoicePdfRenderOptions = {}
): Promise<jsPDF> {
  const { includeNotes = true, fontBase64 } = options;
  const lang = options.lang ?? "en";

  if (fontBase64) {
    embedPdfFont(pdf, fontBase64);
  }

  // Initialize render context. An Arabic invoice is drawn through a mirror,
  // so everything below describes one layout and gets its reflection; either
  // way an Arabic line (a name, an address) is laid out right to left.
  const ctx: RenderContext = {
    pdf: isRtlLanguage(lang) ? mirroredPdf(pdf) : arabicAwarePdf(pdf),
    page: pdf,
    y: PAGE.MARGIN_TOP,
    lang,
  };

  // Set default font
  setPdfFont(pdf, "normal");

  // ========================================================================
  // HEADER SECTION
  // ========================================================================
  await renderHeader(ctx, normalized);

  // ========================================================================
  // PARTY SECTIONS (Invoice From / Invoice To)
  // ========================================================================
  renderPartySections(ctx, normalized);

  // ========================================================================
  // LINE ITEMS TABLE
  // ========================================================================
  renderLineItemsTable(ctx, normalized);

  // ========================================================================
  // TOTALS SECTION
  // ========================================================================
  renderTotals(ctx, normalized);

  // ========================================================================
  // NOTES & FOOTER
  // ========================================================================
  if (includeNotes) {
    renderNotes(ctx, normalized);
  }

  // Last, once every page exists: "page 2 of 3" needs the final count. Drawn
  // on the document itself, not the mirror — the footer mirrors itself.
  setPdfFont(pdf, "normal");
  drawPageFooters(
    pdf,
    {
      lang,
      rtl: isRtlLanguage(lang),
      printedOn: formatPrintDate(
        options.printedAt ?? new Date(),
        options.dateFormat ?? localizationService.getDateFormat(),
      ),
      // The office that issued the invoice, where "Issued with PropertyPro"
      // used to be: a tenant's invoice comes from their office.
      note: normalized.companyInfo.name,
    },
    {
      marginX: PAGE.MARGIN_LEFT,
      baseline: FOOTER.BASELINE,
      ruleY: FOOTER.RULE_Y,
      ruleWidth: 0.2,
      fontSize: FONTS.SIZES.TINY,
      textColor: COLORS.MUTED,
      ruleColor: COLORS.BORDER,
    },
  );

  return pdf;
}

// ============================================================================
// SECTION RENDERERS
// ============================================================================

/** Render the invoice header with logo and invoice meta */
async function renderHeader(
  ctx: RenderContext,
  normalized: NormalizedInvoice
): Promise<void> {
  const { pdf } = ctx;
  const company = normalized.companyInfo;
  const companyInitials = deriveCompanyInitials(company.name);
  const logoSize = LOGO_BOX.height;
  const logoX = PAGE.MARGIN_LEFT;
  const logoY = PAGE.MARGIN_TOP;

  // The office's logo, in proportion: a wide logo drawn into a square came
  // out squashed.
  let logoWidth = 0;
  const logo = await loadDocumentLogo(company.logo);
  if (logo) {
    try {
      const { width, height } = pdf.getImageProperties(logo.dataUrl);
      const size = fitLogo(width, height, LOGO_BOX);
      pdf.addImage(
        logo.dataUrl,
        logo.format,
        logoX,
        logoY,
        size.width,
        size.height,
        undefined,
        "FAST"
      );
      logoWidth = size.width;
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("Failed to render company logo in PDF:", error);
      }
    }
  }

  // Fallback: Render initials in colored circle
  if (!logoWidth) {
    setFillColor(pdf, COLORS.ACCENT);
    pdf.circle(logoX + logoSize / 2, logoY + logoSize / 2, logoSize / 2, "F");
    setTextColor(pdf, COLORS.WHITE);
    pdf.setFontSize(FONTS.SIZES.SUBHEADING);
    setPdfFont(pdf, "bold");
    pdf.text(companyInitials, logoX + logoSize / 2, logoY + logoSize / 2 + 2, {
      align: "center",
    });
    setPdfFont(pdf, "normal");
    logoWidth = logoSize;
  }

  // Company name next to logo
  const companyTextX = logoX + logoWidth + 8;
  setPdfFont(pdf, "bold");
  pdf.setFontSize(FONTS.SIZES.HEADING);
  setTextColor(pdf, COLORS.PRIMARY);
  pdf.text(company.name, companyTextX, logoY + 6);

  // Company contact info
  setPdfFont(pdf, "normal");
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.MUTED);
  // Only the details the office has filled in — no empty lines, and no
  // stray "•" between a missing phone and a missing email.
  let companyInfoY = logoY + 12;
  const contactLines = [
    company.address,
    [company.phone, company.email].filter(Boolean).join(" • "),
    company.website,
    company.vatNumber
      ? label(ctx, "leases.invoicePrint.vatNumber", "VAT No. {number}", {
          number: company.vatNumber,
        })
      : "",
  ].filter((line): line is string => Boolean(line));
  contactLines.forEach((line, index) => {
    if (index > 0) companyInfoY += 4;
    pdf.text(line, companyTextX, companyInfoY);
  });

  // ========================================================================
  // RIGHT SIDE: INVOICE title and meta
  // ========================================================================
  const rightX = PAGE.WIDTH - PAGE.MARGIN_RIGHT;

  // The title: tax invoice, simplified tax invoice, credit note or invoice
  // (invoiceTitle). In a language other than Arabic the Arabic title follows
  // it, as Saudi tax documents carry it.
  const title = invoiceTitle(normalized);
  const localTitle = label(ctx, title.key, title.english);
  setPdfFont(pdf, "bold");
  pdf.setFontSize(
    localTitle.length > 14 ? FONTS.SIZES.HEADING + 2 : FONTS.SIZES.TITLE,
  );
  setTextColor(pdf, COLORS.PRIMARY);
  pdf.text(
    ctx.lang === "ar" ? localTitle : localTitle.toUpperCase(),
    rightX,
    logoY + 8,
    { align: "right" },
  );
  if (ctx.lang !== "ar" && normalized.companyInfo.vatNumber) {
    setPdfFont(pdf, "normal");
    pdf.setFontSize(FONTS.SIZES.SMALL);
    setTextColor(pdf, COLORS.SECONDARY);
    pdf.text(title.arabic, rightX, logoY + 12.5, { align: "right" });
  }

  // Invoice number (prominent)
  setPdfFont(pdf, "bold");
  pdf.setFontSize(FONTS.SIZES.SUBHEADING);
  setTextColor(pdf, COLORS.ACCENT);
  const invoiceNumber = String(
    normalized.invoiceNumber || normalized._id || "INV-0001"
  );
  pdf.text(invoiceNumber, rightX, logoY + 17, { align: "right" });

  // Status badge
  const statusBadgeWidth = 28;
  const statusBadgeHeight = 7;
  const statusBadgeX = rightX - statusBadgeWidth;
  const statusBadgeY = logoY + 20;

  setFillColor(pdf, normalized.statusMeta.pdfFillColor);
  pdf.roundedRect(
    statusBadgeX,
    statusBadgeY,
    statusBadgeWidth,
    statusBadgeHeight,
    2,
    2,
    "F"
  );
  setTextColor(pdf, COLORS.WHITE);
  pdf.setFontSize(FONTS.SIZES.TINY);
  setPdfFont(pdf, "bold");
  pdf.text(
    label(ctx, `leases.invoices.status.${normalized.statusMeta.value}`, normalized.statusMeta.label).toUpperCase(),
    statusBadgeX + statusBadgeWidth / 2,
    statusBadgeY + 5,
    { align: "center" }
  );
  setPdfFont(pdf, "normal");

  // Dates
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.SECONDARY);
  const issueDate = formatPdfDate(normalized.issueDate, ctx.lang);
  const dueDate = formatPdfDate(normalized.dueDate, ctx.lang);

  let dateY = statusBadgeY + 14;
  pdf.text(
    label(ctx, "leases.invoicePrint.issueDate", "Issued: {date}", { date: issueDate }),
    rightX,
    dateY,
    { align: "right" },
  );
  dateY += 5;
  if (normalized.documentType === "credit_note") {
    // What a credit note corrects, in place of a due date it does not have.
    if (normalized.originalInvoiceNumber) {
      pdf.text(
        label(ctx, "leases.invoicePrint.creditNoteFor", "Credits invoice {number}", {
          number: normalized.originalInvoiceNumber,
        }),
        rightX,
        dateY,
        { align: "right" },
      );
    }
  } else {
    pdf.text(
      label(ctx, "leases.invoicePrint.dueDate", "Due: {date}", { date: dueDate }),
      rightX,
      dateY,
      { align: "right" },
    );
  }

  // Update context y position
  ctx.y = Math.max(logoY + logoSize + 15, dateY + 10);
}

/** Render Invoice From and Invoice To sections */
function renderPartySections(
  ctx: RenderContext,
  normalized: NormalizedInvoice
): void {
  const { pdf } = ctx;
  const company = normalized.companyInfo;

  // Use proper tenant/property from normalized object
  const tenant = normalized.tenant || normalized.tenantId || {};
  const property = normalized.property || normalized.propertyId || {};

  const sectionY = ctx.y + 5;
  const leftX = PAGE.MARGIN_LEFT;
  const rightX = PAGE.WIDTH / 2 + 10;

  // Build "Invoice From" lines
  const fromLines = [
    company.name,
    company.address,
    company.phone,
    company.email,
  ].filter(Boolean);

  // Build "Invoice To" lines: the buyer the invoice names — an owner, a
  // customer, or the tenant — with their address and VAT number when known.
  const toLines: string[] = [];
  const buyer = normalized.buyer ?? {};

  const tenantName =
    buyer.name ||
    [tenant.firstName, tenant.lastName].filter(Boolean).join(" ") ||
    tenant.name ||
    label(ctx, "leases.invoicePdf.tenant", "Tenant");
  toLines.push(tenantName);
  if (buyer.address) toLines.push(buyer.address);
  if (buyer.vatNumber) {
    toLines.push(
      label(ctx, "leases.invoicePrint.vatNumber", "VAT No. {number}", {
        number: buyer.vatNumber,
      }),
    );
  }

  // Tenant contact
  if (tenant.email) toLines.push(String(tenant.email));
  if (tenant.phone) toLines.push(String(tenant.phone));

  // Property info
  const propertyName = property.name || normalized.buildingName;
  if (propertyName) {
    toLines.push(""); // Spacer
    toLines.push(String(propertyName));
  }

  // Property address
  if (property.address) {
    if (typeof property.address === "string") {
      toLines.push(property.address);
    } else {
      const addr = property.address;
      if (addr.street) toLines.push(addr.street);
      const cityStateZip = [addr.city, addr.state, addr.zipCode]
        .filter(Boolean)
        .join(", ");
      if (cityStateZip) toLines.push(cityStateZip);
    }
  }

  // Render both sections
  const fromEndY = renderPartySection(
    pdf,
    leftX,
    sectionY,
    label(ctx, "leases.invoicePrint.from", "From"),
    fromLines,
    75
  );
  const toEndY = renderPartySection(
    pdf,
    rightX,
    sectionY,
    label(ctx, "leases.invoicePrint.to", "Bill to"),
    toLines,
    75
  );

  ctx.y = Math.max(fromEndY, toEndY) + 10;
}

/** Render the line items table */
function renderLineItemsTable(
  ctx: RenderContext,
  normalized: NormalizedInvoice
): void {
  const { pdf } = ctx;
  const items = Array.isArray(normalized.lineItems)
    ? (normalized.lineItems as InvoiceLineItemInfo[])
    : [];

  const tableX = PAGE.MARGIN_LEFT;
  const tableWidth = PAGE.CONTENT_WIDTH;
  const headerHeight = 10;
  const rowHeight = 9;

  // Column positions (relative to tableX). A VAT column when the lines say
  // how each is taxed (a custom invoice, a credit note).
  const showVat = items.some((item) => item.vatCategory);
  const cols = showVat
    ? {
        num: { x: 0, width: 10 },
        desc: { x: 10, width: 64 },
        qty: { x: 74, width: 16 },
        unit: { x: 90, width: 26 },
        vat: { x: 116, width: 26 },
        total: { x: 142, width: 28 },
      }
    : {
        num: { x: 0, width: 12 },
        desc: { x: 12, width: 80 },
        qty: { x: 92, width: 22 },
        unit: { x: 114, width: 28 },
        vat: { x: 0, width: 0 },
        total: { x: 142, width: 28 },
      };

  // ========================================================================
  // TABLE HEADER
  // ========================================================================
  ensureSpace(ctx, headerHeight + rowHeight * Math.min(items.length, 3) + 20);

  // Header background
  setFillColor(pdf, COLORS.HEADER_BG);
  pdf.rect(tableX, ctx.y, tableWidth, headerHeight, "F");

  // Header border
  setDrawColor(pdf, COLORS.BORDER);
  pdf.setLineWidth(0.3);
  pdf.rect(tableX, ctx.y, tableWidth, headerHeight);

  // Header text
  setPdfFont(pdf, "bold");
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.PRIMARY);

  const headerY = ctx.y + 7;
  pdf.text("#", tableX + cols.num.x + 4, headerY);
  pdf.text(
    label(ctx, "leases.invoicePrint.description", "Description"),
    tableX + cols.desc.x + 4,
    headerY,
  );
  pdf.text(
    label(ctx, "leases.invoicePrint.quantity", "Qty"),
    tableX + cols.qty.x + cols.qty.width / 2,
    headerY,
    { align: "center" },
  );
  pdf.text(
    label(ctx, "leases.invoicePrint.unitPrice", "Unit price"),
    tableX + cols.unit.x + cols.unit.width - 2,
    headerY,
    { align: "right" },
  );
  if (showVat) {
    pdf.text(
      label(ctx, "leases.invoicePrint.vatColumn", "VAT"),
      tableX + cols.vat.x + cols.vat.width - 2,
      headerY,
      { align: "right" },
    );
  }
  pdf.text(
    label(ctx, "leases.invoicePrint.total", "Total"),
    tableX + cols.total.x + cols.total.width - 2,
    headerY,
    { align: "right" },
  );

  ctx.y += headerHeight;

  // ========================================================================
  // TABLE ROWS
  // ========================================================================
  setPdfFont(pdf, "normal");
  pdf.setFontSize(FONTS.SIZES.SMALL);

  if (items.length === 0) {
    // Empty state
    setTextColor(pdf, COLORS.MUTED);
    pdf.text(
      label(ctx, "leases.invoicePrint.noItems", "No line items"),
      tableX + tableWidth / 2,
      ctx.y + 6,
      { align: "center" },
    );
    ctx.y += rowHeight + 4;
  } else {
    items.forEach((item, index) => {
      ensureSpace(ctx, rowHeight + 4);

      const qty = Number(item.quantity ?? 1) || 1;
      const unit = Number(item.unitPrice ?? 0);
      const total = Number(item.total ?? item.amount ?? qty * unit);

      const rowY = ctx.y + 6;
      setTextColor(pdf, COLORS.PRIMARY);

      // Row number
      pdf.text(String(index + 1), tableX + cols.num.x + 4, rowY);

      // Description (with truncation if needed)
      // A generated wording ("Monthly Rent") is said in the document's
      // language, from the line's type and billing period; typed text as typed.
      const description =
        describeCharge(
          {
            description: item.description,
            type: item.type,
            periodStart: item.metadata?.periodStart as string | undefined,
            periodEnd: item.metadata?.periodEnd as string | undefined,
          },
          ctx.lang,
        ) || label(ctx, "leases.invoicePdf.item", "Item");
      const maxDescWidth = cols.desc.width - 8;
      const truncatedDesc =
        pdf.getTextWidth(description) > maxDescWidth
          ? description.slice(0, showVat ? 32 : 40) + "..."
          : description;
      pdf.text(truncatedDesc, tableX + cols.desc.x + 4, rowY);

      // Quantity
      pdf.text(String(qty), tableX + cols.qty.x + cols.qty.width / 2, rowY, {
        align: "center",
      });

      // Unit price
      pdf.text(
        formatDisplayCurrency(unit, normalized.currencyCode),
        tableX + cols.unit.x + cols.unit.width - 2,
        rowY,
        { align: "right" }
      );

      // VAT: the rate (or exempt, zero-rated, out of scope) over its amount.
      if (showVat) {
        const vatX = tableX + cols.vat.x + cols.vat.width - 2;
        pdf.text(vatTreatmentLabel(ctx, item.vatCategory, item.vatRate), vatX, rowY - 1.5, {
          align: "right",
        });
        if (item.vatCategory === "S") {
          pdf.setFontSize(FONTS.SIZES.TINY);
          setTextColor(pdf, COLORS.MUTED);
          pdf.text(
            formatDisplayCurrency(item.vatAmount ?? 0, normalized.currencyCode),
            vatX,
            rowY + 2,
            { align: "right" },
          );
          pdf.setFontSize(FONTS.SIZES.SMALL);
          setTextColor(pdf, COLORS.PRIMARY);
        }
      }

      // Total
      setPdfFont(pdf, "bold");
      pdf.text(
        formatDisplayCurrency(total, normalized.currencyCode),
        tableX + cols.total.x + cols.total.width - 2,
        rowY,
        { align: "right" }
      );
      setPdfFont(pdf, "normal");

      // Row separator line
      ctx.y += rowHeight;
      setDrawColor(pdf, COLORS.BORDER);
      pdf.setLineWidth(0.2);
      pdf.line(tableX, ctx.y, tableX + tableWidth, ctx.y);
    });
  }

  ctx.y += 8;
}

/** Render the totals section */
function renderTotals(ctx: RenderContext, normalized: NormalizedInvoice): void {
  const { pdf } = ctx;
  const {
    totals: {
      subtotal,
      taxAmount,
      discountAmount,
      shippingAmount,
      adjustmentsAmount,
      total,
      amountPaid,
      balanceDue,
    },
  } = normalized;

  ensureSpace(ctx, 70);

  // Totals box dimensions
  const boxWidth = 75;
  const boxX = PAGE.WIDTH - PAGE.MARGIN_RIGHT - boxWidth;
  const labelX = boxX + 5;
  const valueX = boxX + boxWidth - 5;
  const lineHeight = 6;

  // Start totals
  let y = ctx.y;

  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.SECONDARY);

  // One charge per line, with a hairline between each and the next so an
  // amount cannot be read against the wrong label.
  let rowsDrawn = 0;
  const chargeRow = (text: string, amount: number) => {
    if (rowsDrawn > 0) drawSeparator(pdf, boxX, boxX + boxWidth, y - lineHeight + 2);
    pdf.text(text, labelX, y);
    pdf.text(formatDisplayCurrency(amount, normalized.currencyCode), valueX, y, {
      align: "right",
    });
    y += lineHeight;
    rowsDrawn += 1;
  };

  chargeRow(label(ctx, "leases.invoicePrint.subtotal", "Subtotal"), subtotal);

  // Only show non-zero additional charges
  if (!isApproximatelyZero(shippingAmount)) {
    chargeRow(label(ctx, "leases.invoicePrint.shipping", "Other charges"), shippingAmount);
  }

  if (!isApproximatelyZero(discountAmount)) {
    chargeRow(
      label(ctx, "leases.invoicePrint.discount", "Discount"),
      -Math.abs(discountAmount),
    );
  }

  if (!isApproximatelyZero(adjustmentsAmount)) {
    chargeRow(label(ctx, "leases.invoicePrint.adjustments", "Adjustments"), adjustmentsAmount);
  }

  // A tax invoice states what VAT is charged on and the VAT at each rate,
  // a zero included; any other invoice shows its VAT only when it has some.
  const taxInvoice = Boolean(normalized.companyInfo.vatNumber);
  if (taxInvoice) {
    chargeRow(
      label(ctx, "leases.invoicePrint.totalExclVat", "Total excluding VAT"),
      Math.round((subtotal - Math.abs(discountAmount)) * 100) / 100,
    );
    const standard = (normalized.vatBreakdown ?? []).filter(
      (row) => row.vatCategory === "S",
    );
    if (standard.length === 0) {
      chargeRow(label(ctx, "leases.invoicePrint.vat", "VAT"), taxAmount);
    } else {
      for (const row of standard) {
        chargeRow(
          `${label(ctx, "leases.invoicePrint.vat", "VAT")} (${row.vatRate}%)`,
          Math.abs(row.vatAmount),
        );
      }
    }
  } else if (!isApproximatelyZero(taxAmount)) {
    chargeRow(label(ctx, "leases.invoicePrint.vat", "VAT"), taxAmount);
  }

  // Separator line before total
  y += 2;
  setDrawColor(pdf, COLORS.BORDER);
  pdf.setLineWidth(0.5);
  pdf.line(boxX, y, boxX + boxWidth, y);
  y += 6;

  // Grand Total (highlighted). A tax invoice's longer label is set smaller,
  // so it never runs into the amount.
  setPdfFont(pdf, "bold");
  setTextColor(pdf, COLORS.PRIMARY);
  pdf.setFontSize(taxInvoice ? FONTS.SIZES.SMALL + 1 : FONTS.SIZES.HEADING);
  pdf.text(
    taxInvoice
      ? label(ctx, "leases.invoicePrint.totalInclVat", "Total including VAT")
      : label(ctx, "leases.invoicePrint.total", "Total"),
    labelX,
    y,
  );
  pdf.setFontSize(FONTS.SIZES.HEADING);
  pdf.text(formatDisplayCurrency(total, normalized.currencyCode), valueX, y, { align: "right" });
  y += lineHeight + 4;
  drawSeparator(pdf, boxX, boxX + boxWidth, y - 5);

  // The ZATCA QR code (phase 1) beside the totals, on the document itself so
  // an Arabic page does not reflect it.
  const company = normalized.companyInfo;
  if (canCarryZatcaQr(company.name, company.vatNumber)) {
    const qrX = PAGE.MARGIN_LEFT;
    const pageX = isRtlLanguage(ctx.lang) ? PAGE.WIDTH - qrX - QR_SIZE : qrX;
    drawQrCode(
      ctx.page,
      zatcaQrPayload({
        sellerName: company.name,
        vatNumber: String(company.vatNumber),
        timestamp: normalized.issuedAt ?? normalized.issueDate,
        total,
        vatTotal: taxAmount,
      }),
      pageX,
      ctx.y,
      QR_SIZE,
    );
  }

  // A credit note is owed nothing: no paid or balance lines.
  if (normalized.documentType === "credit_note") {
    ctx.y = Math.max(y + 4, ctx.y + QR_SIZE + 6);
    return;
  }

  // Amount Paid
  setPdfFont(pdf, "normal");
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.SECONDARY);
  pdf.text(label(ctx, "leases.invoicePrint.amountPaid", "Paid"), labelX, y);
  pdf.text(formatDisplayCurrency(amountPaid, normalized.currencyCode), valueX, y, { align: "right" });
  y += lineHeight + 2;

  // Balance Due (highlighted if non-zero)
  if (!isApproximatelyZero(balanceDue)) {
    // Background highlight for balance due
    setFillColor(pdf, COLORS.ACCENT);
    pdf.roundedRect(boxX, y - 4, boxWidth, 10, 2, 2, "F");

    setTextColor(pdf, COLORS.WHITE);
    setPdfFont(pdf, "bold");
    pdf.text(label(ctx, "leases.invoicePrint.balanceDue", "Balance due"), labelX, y + 2);
    pdf.text(formatDisplayCurrency(balanceDue, normalized.currencyCode), valueX, y + 2, {
      align: "right",
    });
    y += 14;
  } else {
    drawSeparator(pdf, boxX, boxX + boxWidth, y - 4);
    setTextColor(pdf, COLORS.ACCENT);
    setPdfFont(pdf, "bold");
    pdf.text(label(ctx, "leases.invoicePrint.balanceDue", "Balance due"), labelX, y);
    pdf.text(formatDisplayCurrency(0, normalized.currencyCode), valueX, y, { align: "right" });
    y += lineHeight;
  }

  ctx.y = Math.max(y + 10, canCarryZatcaQr(company.name, company.vatNumber) ? ctx.y + QR_SIZE + 6 : 0);
}

/** Render notes section */
function renderNotes(ctx: RenderContext, normalized: NormalizedInvoice): void {
  const { pdf } = ctx;
  const company = normalized.companyInfo;

  // Ensure we have space at the bottom
  const notesMinY = PAGE.HEIGHT - PAGE.MARGIN_BOTTOM - 50;
  if (ctx.y < notesMinY) {
    ctx.y = notesMinY;
  }
  // The heading, a first line and the contact block, together on one page.
  ensureSpace(ctx, 30);
  const sectionTop = ctx.y;

  // Separator line
  setDrawColor(pdf, COLORS.BORDER);
  pdf.setLineWidth(0.3);
  pdf.line(PAGE.MARGIN_LEFT, ctx.y, PAGE.WIDTH - PAGE.MARGIN_RIGHT, ctx.y);
  ctx.y += 8;

  // Notes section (left side)
  setPdfFont(pdf, "bold");
  pdf.setFontSize(FONTS.SIZES.BODY);
  setTextColor(pdf, COLORS.PRIMARY);
  pdf.text(
    label(ctx, "leases.invoicePrint.notes", "Notes").toUpperCase(),
    PAGE.MARGIN_LEFT,
    ctx.y,
  );

  ctx.y += 5;
  setPdfFont(pdf, "normal");
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.MUTED);

  // Wrap notes text
  const notesText =
    [normalized.creditReason, normalized.notes].filter(Boolean).join("\n") ||
    label(ctx, "leases.invoicePdf.thanks", "Thank you for your business.");
  const wrappedNotes = pdf.splitTextToSize(notesText, 100);
  // Beside the notes' first lines, on the page the section starts on.
  const contactPage = pdf.getCurrentPageInfo().pageNumber;
  wrappedNotes.forEach((line: string) => {
    // Long notes carry over to the next page instead of running under the
    // footer.
    ensureSpace(ctx, 4);
    pdf.text(line, PAGE.MARGIN_LEFT, ctx.y);
    ctx.y += 4;
  });

  // Contact section (right side) — only when there is a way to reach the office.
  if (!company.email && !company.phone) {
    return;
  }
  const lastPage = pdf.getCurrentPageInfo().pageNumber;
  if (lastPage !== contactPage) pdf.setPage(contactPage);
  const contactX = PAGE.WIDTH - PAGE.MARGIN_RIGHT - 60;
  const contactY = sectionTop + 8;

  setPdfFont(pdf, "bold");
  pdf.setFontSize(FONTS.SIZES.BODY);
  setTextColor(pdf, COLORS.PRIMARY);
  pdf.text(label(ctx, "leases.invoicePrint.questions", "Questions?"), contactX, contactY);

  setPdfFont(pdf, "normal");
  pdf.setFontSize(FONTS.SIZES.SMALL);
  setTextColor(pdf, COLORS.MUTED);
  [company.email, company.phone]
    .filter((line): line is string => Boolean(line))
    .forEach((line, index) => {
      pdf.text(line, contactX, contactY + 5 * (index + 1));
    });
}
