/**
 * PropertyPro - Making a payment voucher's PDF
 *
 * Reads the voucher, the supplier it was made out to and the office's
 * letterhead, and draws it (voucher-renderer.ts) in the language asked for —
 * the office's own when nobody asked. Used by the voucher's print route.
 */

import "server-only";

import jsPDF from "jspdf";
import { db } from "@/lib/db/prisma";
import { mergeReceiptCompanyWithDefaults } from "@/lib/invoice/company-info-defaults";
import { isReportLanguage, type ReportLanguage } from "@/lib/reports/labels";
import { reportFontBase64 } from "@/lib/reports/pdf-font";
import { serverLogoDataUrl } from "@/lib/reports/logo-image";
import { getCompanyInfoServer, getOrgDocumentPreferences } from "@/lib/utils/company-info-server";
import { bankDisplayName } from "./types";
import { getVoucher } from "./vouchers.service";
import { renderVoucherPdf, type VoucherPdfData } from "./voucher-renderer";

export async function generateVoucherPdf(
  id: string,
  asked?: string | null,
): Promise<{ buffer: Buffer; fileName: string } | null> {
  const voucher = await getVoucher(id);
  if (!voucher) return null;

  const [preferences, companyInfo, supplier] = await Promise.all([
    getOrgDocumentPreferences(),
    getCompanyInfoServer(),
    voucher.supplier
      ? db.supplier.findFirst({
          where: { id: voucher.supplier.id, deletedAt: undefined },
          select: { name: true, vatNumber: true, address: true, city: true, bankName: true, iban: true },
        })
      : null,
  ]);
  const lang: ReportLanguage = isReportLanguage(asked) ? asked : preferences.language;

  const company = mergeReceiptCompanyWithDefaults(companyInfo || undefined);
  // The logo converted here, where the hosts it may come from are checked;
  // the renderer only draws what it is handed.
  const logo = await serverLogoDataUrl(company.logo);

  const data: VoucherPdfData = {
    number: voucher.displayNumber,
    date: new Date(`${voucher.voucherDate}T00:00:00.000Z`),
    status: voucher.status,
    amount: voucher.amount,
    currency: voucher.currency,
    method: voucher.method,
    reference: voucher.reference,
    notes: voucher.notes,
    supplier: {
      name: supplier?.name ?? voucher.supplier?.name ?? "",
      vatNumber: supplier?.vatNumber ?? voucher.supplier?.vatNumber ?? null,
      address: [supplier?.address, supplier?.city].filter(Boolean).join(", ") || null,
      bankName: supplier?.bankName ?? null,
      iban: supplier?.iban ?? null,
    },
    account: bankDisplayName(voucher.bankAccount, lang),
    allocations: (voucher.allocations ?? []).map((allocation) => ({
      billNumber: allocation.billDisplayNumber,
      supplierInvoiceNumber: allocation.supplierInvoiceNumber,
      amount: allocation.amount,
    })),
    // What the allocations leave over, whatever the voucher's state: a
    // cancelled voucher still prints what it covered, so its rows add up.
    onAccount: Math.max(
      0,
      Math.round(voucher.amount * 100) -
        (voucher.allocations ?? []).reduce((sum, allocation) => sum + Math.round(allocation.amount * 100), 0),
    ) / 100,
    company: { ...company, logo },
    preparedBy: voucher.createdByName,
    cancelReason: voucher.cancelReason,
  };

  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await renderVoucherPdf(pdf, data, {
    fontBase64: reportFontBase64(),
    lang,
    dateFormat: preferences.dateFormat,
  });
  return {
    buffer: Buffer.from(pdf.output("arraybuffer")),
    fileName: `${voucher.displayNumber}.pdf`,
  };
}
