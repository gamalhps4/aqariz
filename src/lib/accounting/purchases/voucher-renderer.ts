/**
 * PropertyPro - The payment voucher (سند صرف) as a PDF
 *
 * The printed counterpart of a receipt voucher: who the money went to, from
 * which account, how, what it paid, the total, and three lines to sign —
 * prepared by, approved by, received by. Drawn with jsPDF in the same layout
 * family as the receipt (lib/invoice/receipt-renderer.ts): the office's
 * letterhead, the number, date and method at the top right, a title, the
 * parties, a table, a total bar. Arabic is the same layout drawn through a
 * mirror, with the Arabic-capable face embedded.
 *
 * Pure drawing: no database and nothing server-only, so a test can render one
 * and the route can hand it data it read.
 */

import type jsPDF from "jspdf";
import { deriveCompanyInitials, fitLogo, loadDocumentLogo } from "@/lib/invoice/logo-utils";
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
import type { ReceiptCompanyInfo } from "@/lib/invoice/receipt-renderer";

/** A4 portrait, in millimetres. */
const PAGE_HEIGHT = 297;
const MARGIN_X = 15;
const MARGIN_TOP = 20;
/** The lowest line content may reach; the footer sits below it. */
const CONTENT_BOTTOM = 277;

export interface VoucherPdfData {
  /** PV-000045 */
  number: string;
  date: Date;
  status: "posted" | "cancelled";
  amount: number;
  currency?: string | null;
  /** The stored method: bank_transfer | cheque | cash | card | other. */
  method: string;
  /** The cheque or transfer number. */
  reference: string | null;
  notes: string | null;
  supplier: {
    name: string;
    vatNumber: string | null;
    address: string | null;
    bankName: string | null;
    iban: string | null;
  };
  /** The bank or cash account the money left, as the reader names it. */
  account: string;
  /** What the voucher paid, bill by bill. */
  allocations: Array<{ billNumber: string; supplierInvoiceNumber: string | null; amount: number }>;
  /** What it left on account with the supplier. */
  onAccount: number;
  company: ReceiptCompanyInfo;
  /** Whoever wrote it, printed under "prepared by". */
  preparedBy: string | null;
  cancelReason?: string | null;
}

export interface VoucherPdfOptions {
  /** The Arabic-capable face, base64; without it Arabic names do not print. */
  fontBase64?: string | null;
  lang?: PdfLanguage;
  /** The office's date-format setting, for the printed-on date in the footer. */
  dateFormat?: string | null;
  /** When the voucher counts as printed. Now, unless a test pins it. */
  printedAt?: Date;
}

export async function renderVoucherPdf(
  target: jsPDF,
  voucher: VoucherPdfData,
  options: VoucherPdfOptions = {},
): Promise<jsPDF> {
  const lang = options.lang ?? "en";
  if (options.fontBase64) embedPdfFont(target, options.fontBase64);
  const pdf = isRtlLanguage(lang) ? mirroredPdf(target) : arabicAwarePdf(target);
  const label = (key: string, english: string, values?: Record<string, string | number>) =>
    pdfLabel(lang, key, english, values);
  const money = (amount: number) => formatPdfMoney(amount, voucher.currency);

  const primary = [37, 99, 235] as [number, number, number]; // blue: money going out
  const text = [17, 24, 39] as [number, number, number];
  const gray = [107, 114, 128] as [number, number, number];
  const border = [229, 231, 235] as [number, number, number];
  const danger = [220, 38, 38] as [number, number, number];

  const separator = (x1: number, x2: number, y: number) => {
    pdf.setDrawColor(...border);
    pdf.setLineWidth(0.2);
    pdf.line(x1, y, x2, y);
  };
  const bold = () => pdf.setFont(pdf.getFont().fontName, "bold");
  const normal = () => pdf.setFont(pdf.getFont().fontName, "normal");

  // ==========================================================================
  // Letterhead
  // ==========================================================================
  let logoWidth = 0;
  const logo = await loadDocumentLogo(voucher.company.logo);
  if (logo) {
    try {
      const { width, height } = pdf.getImageProperties(logo.dataUrl);
      const size = fitLogo(width, height, { width: 30, height: 20 });
      pdf.addImage(logo.dataUrl, logo.format, 15, 15, size.width, size.height, undefined, "FAST");
      logoWidth = size.width;
    } catch {
      // The voucher prints without its logo rather than not at all.
    }
  }
  if (!logoWidth) {
    pdf.setFillColor(...primary);
    pdf.rect(15, 15, 20, 20, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(12);
    bold();
    pdf.text(deriveCompanyInitials(voucher.company.name), 25, 26, { align: "center" });
    normal();
    logoWidth = 20;
  }
  const companyX = 15 + logoWidth + 3;
  pdf.setTextColor(...text);
  pdf.setFontSize(14);
  bold();
  pdf.text(voucher.company.name, companyX, 20);
  normal();
  pdf.setFontSize(9);
  pdf.setTextColor(...gray);
  [
    voucher.company.address,
    voucher.company.phone,
    voucher.company.email,
    voucher.company.website,
    voucher.company.vatNumber
      ? label("leases.invoicePrint.vatNumber", "VAT No. {number}", { number: voucher.company.vatNumber })
      : "",
  ]
    .filter((line): line is string => Boolean(line))
    .forEach((line, index) => pdf.text(line, companyX, 26 + index * 5));

  // The number, the date and how it was paid, top right.
  const labelX = 130;
  const valueX = 195;
  pdf.setFontSize(9);
  pdf.setTextColor(...gray);
  pdf.text(label("purchases.voucherPdf.number", "Voucher no."), labelX, 20);
  pdf.text(label("purchases.voucherPdf.date", "Date"), labelX, 26);
  pdf.text(label("purchases.voucherPdf.method", "Paid by"), labelX, 32);
  separator(labelX, valueX, 22);
  separator(labelX, valueX, 28);
  pdf.setTextColor(...text);
  bold();
  pdf.text(voucher.number, valueX, 20, { align: "right" });
  pdf.text(formatPdfDate(voucher.date, lang), valueX, 26, { align: "right" });
  pdf.text(label(`exports.value.${voucher.method}`, voucher.method.replace(/_/g, " ")), valueX, 32, {
    align: "right",
  });
  normal();

  // ==========================================================================
  // Title
  // ==========================================================================
  let y = 55;
  const ensureSpace = (height: number) => {
    if (y + height > CONTENT_BOTTOM) {
      pdf.addPage();
      y = MARGIN_TOP;
    }
  };
  pdf.setTextColor(...text);
  pdf.setFontSize(22);
  bold();
  pdf.text(label("purchases.voucherPdf.title", "Payment voucher").toUpperCase(), 105, y, { align: "center" });
  normal();
  y += 5;
  pdf.setDrawColor(...primary);
  pdf.setLineWidth(1);
  pdf.line(70, y, 140, y);

  if (voucher.status === "cancelled") {
    y += 9;
    pdf.setTextColor(...danger);
    pdf.setFontSize(12);
    bold();
    pdf.text(label("purchases.voucherPdf.cancelled", "Cancelled").toUpperCase(), 105, y, { align: "center" });
    normal();
    if (voucher.cancelReason) {
      y += 5;
      pdf.setFontSize(9);
      pdf.text(voucher.cancelReason, 105, y, { align: "center" });
    }
  }

  // ==========================================================================
  // Paid to / paid from
  // ==========================================================================
  y += 12;
  const section = (heading: string, lines: Array<string | null>, emphasis: string) => {
    pdf.setFontSize(10);
    pdf.setTextColor(...gray);
    bold();
    pdf.text(heading.toUpperCase(), 15, y);
    normal();
    y += 6;
    pdf.setTextColor(...text);
    pdf.setFontSize(10);
    bold();
    pdf.text(emphasis, 15, y);
    normal();
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    for (const line of lines.filter((value): value is string => Boolean(value))) {
      y += 5;
      const wrapped = pdf.splitTextToSize(line, 120) as string[];
      pdf.text(wrapped, 15, y);
      y += (wrapped.length - 1) * 5;
    }
  };

  section(
    label("purchases.voucherPdf.paidTo", "Paid to"),
    [
      voucher.supplier.vatNumber
        ? label("leases.invoicePrint.vatNumber", "VAT No. {number}", { number: voucher.supplier.vatNumber })
        : null,
      voucher.supplier.address,
      voucher.supplier.bankName,
      voucher.supplier.iban ? `${label("purchases.voucherPdf.iban", "IBAN")}: ${voucher.supplier.iban}` : null,
    ],
    voucher.supplier.name,
  );
  y += 10;
  section(
    label("purchases.voucherPdf.paidFrom", "Paid from"),
    [
      voucher.reference
        ? `${label("purchases.voucherPdf.reference", "Reference")}: ${voucher.reference}`
        : null,
    ],
    voucher.account,
  );

  // ==========================================================================
  // What it paid
  // ==========================================================================
  y += 14;
  pdf.setFontSize(12);
  pdf.setTextColor(...text);
  bold();
  pdf.text(label("purchases.voucherPdf.details", "Payment details").toUpperCase(), 15, y);
  normal();
  y += 8;
  pdf.setFillColor(243, 244, 246);
  pdf.rect(15, y, 180, 10, "F");
  pdf.setDrawColor(...border);
  pdf.setLineWidth(0.5);
  pdf.rect(15, y, 180, 10);
  pdf.setFontSize(9);
  pdf.setTextColor(...gray);
  bold();
  pdf.text(label("leases.invoicePrint.description", "Description"), 20, y + 6.5);
  pdf.text(label("purchases.voucherPdf.amount", "Amount"), 188, y + 6.5, { align: "right" });
  normal();
  y += 12;
  pdf.setTextColor(...text);
  pdf.setFontSize(9);

  const rows: Array<{ description: string; amount: number }> = voucher.allocations.map((allocation) => ({
    description: allocation.supplierInvoiceNumber
      ? label("purchases.voucherPdf.forBillWithInvoice", "Payment of bill {number} (supplier invoice {invoice})", {
          number: allocation.billNumber,
          invoice: allocation.supplierInvoiceNumber,
        })
      : label("purchases.voucherPdf.forBill", "Payment of bill {number}", { number: allocation.billNumber }),
    amount: allocation.amount,
  }));
  if (voucher.onAccount > 0.004 || rows.length === 0) {
    rows.push({
      description: label("purchases.voucherPdf.onAccount", "Payment on account"),
      amount: voucher.onAccount > 0.004 ? voucher.onAccount : voucher.amount,
    });
  }
  rows.forEach((row, index) => {
    ensureSpace(10);
    const lines = pdf.splitTextToSize(row.description, 140) as string[];
    pdf.text(lines, 20, y + 3);
    bold();
    pdf.text(money(row.amount), 188, y + 3, { align: "right" });
    normal();
    const height = Math.max(10, lines.length * 4 + 6);
    if (index < rows.length - 1) separator(15, 195, y + height - 3);
    y += height;
  });

  ensureSpace(30);
  y += 5;
  pdf.setDrawColor(...text);
  pdf.setLineWidth(0.8);
  pdf.line(15, y, 195, y);
  y += 10;
  pdf.setFillColor(...primary);
  pdf.rect(15, y - 5, 180, 14, "F");
  pdf.setFontSize(12);
  bold();
  pdf.setTextColor(255, 255, 255);
  pdf.text(label("purchases.voucherPdf.total", "Total paid").toUpperCase(), 20, y + 3);
  pdf.setFontSize(14);
  pdf.text(money(voucher.amount), 188, y + 3, { align: "right" });
  normal();

  if (voucher.notes) {
    y += 16;
    ensureSpace(20);
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    bold();
    pdf.text(label("purchases.voucherPdf.notes", "Notes").toUpperCase(), 15, y);
    normal();
    y += 5;
    pdf.setTextColor(...text);
    const wrapped = pdf.splitTextToSize(voucher.notes, 180) as string[];
    pdf.text(wrapped, 15, y);
    y += wrapped.length * 4;
  }

  // ==========================================================================
  // Signatures
  // ==========================================================================
  // Room to sign above each line, then the line and its title below it.
  y += 24;
  ensureSpace(12);
  const columns = [
    { title: label("purchases.voucherPdf.preparedBy", "Prepared by"), name: voucher.preparedBy },
    { title: label("purchases.voucherPdf.approvedBy", "Approved by"), name: null },
    { title: label("purchases.voucherPdf.receivedBy", "Received by"), name: null },
  ];
  const width = 54;
  const gap = (180 - width * 3) / 2;
  columns.forEach((column, index) => {
    const x = 15 + index * (width + gap);
    pdf.setDrawColor(...gray);
    pdf.setLineWidth(0.3);
    pdf.line(x, y, x + width, y);
    pdf.setFontSize(9);
    pdf.setTextColor(...gray);
    pdf.text(column.title, x + width / 2, y + 5, { align: "center" });
    if (column.name) {
      pdf.setTextColor(...text);
      pdf.text(column.name, x + width / 2, y - 3, { align: "center" });
    }
  });

  // The printed-on date and "page 1 of 2", on every page. Drawn on the
  // document itself, not the mirror: the footer mirrors itself.
  target.setFont(target.getFont().fontName, "normal");
  drawPageFooters(
    target,
    {
      lang,
      rtl: isRtlLanguage(lang),
      printedOn: formatPrintDate(options.printedAt ?? new Date(), options.dateFormat ?? null),
      note: voucher.company.name,
    },
    {
      marginX: MARGIN_X,
      baseline: PAGE_HEIGHT - 11,
      ruleY: PAGE_HEIGHT - 16,
      ruleWidth: 0.2,
      fontSize: 8,
      textColor: gray,
      ruleColor: border,
    },
  );
  return target;
}
