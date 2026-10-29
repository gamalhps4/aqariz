/**
 * PropertyPro - Downloading and printing a receipt from the payment screen
 *
 * The same receipt the tenant portal serves (receipt-renderer.ts, made from
 * the payment by receipt-data.ts), drawn in the browser in the reader's
 * language, with the office's logo and the printed-on date and page count at
 * its foot. The payment screen's Download button used to say "coming soon"
 * and download nothing, and Print printed the on-screen card, with no date
 * and no page number.
 */

import type jsPDF from "jspdf";
import { mergeReceiptCompanyWithDefaults } from "@/lib/invoice/company-info-defaults";
import { interfacePdfLanguage } from "@/lib/invoice/pdf-i18n";
import { loadBrowserPdfFont } from "@/lib/invoice/pdf-text";
import {
  normalizePaymentToReceipt,
  type ReceiptPaymentData,
} from "@/lib/invoice/receipt-data";
import { getCompanyInfo } from "@/lib/utils/company-info";
import { localizationService } from "@/lib/services/localization.service";
import { openPdfWindow } from "@/lib/pdf-window";

/** The payment's receipt drawn as a PDF, and the name to save it under. */
async function renderReceiptDocument(
  payment: ReceiptPaymentData,
): Promise<{ pdf: jsPDF; fileName: string }> {
  const lang = interfacePdfLanguage();
  const [{ default: JsPDF }, { renderReceiptPdf }, fontBase64, company] =
    await Promise.all([
      import("jspdf"),
      import("@/lib/invoice/receipt-renderer"),
      loadBrowserPdfFont(),
      getCompanyInfo(),
    ]);

  const receipt = normalizePaymentToReceipt(
    payment,
    mergeReceiptCompanyWithDefaults(company ?? undefined),
    lang,
  );
  const pdf = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  await renderReceiptPdf(pdf, receipt, { fontBase64, lang });

  return { pdf, fileName: `receipt-${receipt.receiptNumber}.pdf` };
}

/** Download the payment's receipt as a PDF. */
export async function downloadReceiptPdf(
  payment: ReceiptPaymentData,
): Promise<void> {
  const { pdf, fileName } = await renderReceiptDocument(payment);
  pdf.save(fileName);
}

/**
 * Print the payment's receipt: the PDF opens in a new window and asks to
 * print itself. Called from a click, so the window opens before any await.
 */
export function printReceiptPdf(payment: ReceiptPaymentData): void {
  openPdfWindow(async () => (await renderReceiptDocument(payment)).pdf, {
    print: true,
    waiting: localizationService.translate("payments.receipt.preparing", {
      defaultValue: "Preparing the receipt…",
    }),
  });
}
