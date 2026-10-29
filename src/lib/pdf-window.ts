/**
 * PropertyPro - A PDF drawn in the browser, in a window of its own
 *
 * Invoices and receipts are drawn with jsPDF in the browser (invoice-print.ts,
 * receipt-print.ts). This opens one in a new window, to look at or to print.
 *
 * The window opens synchronously, inside the click, so a popup blocker lets
 * it through; it shows a short "preparing" line until the PDF is drawn, then
 * loads it. Printing uses the PDF's own open action: the browser's viewer
 * asks to print as soon as the document is on screen.
 */

import type jsPDF from "jspdf";
import { localizationService } from "@/lib/services/localization.service";

/** How long the PDF's address stays readable — the viewer's, not ours. */
const PDF_URL_LIFETIME_MS = 5 * 60 * 1000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Open the PDF `draw` produces in a new window — asking to print it when
 * `print` is set. A PDF that fails to draw closes the window again.
 */
export function openPdfWindow(
  draw: () => Promise<jsPDF>,
  options: { print: boolean; waiting: string },
): void {
  const w = window.open("", "_blank", "width=900,height=700");
  if (!w) return;

  const lang = escapeHtml(localizationService.getCurrentLocale());
  const dir = localizationService.isRTL() ? "rtl" : "ltr";
  const waiting = escapeHtml(options.waiting);
  w.document.open();
  w.document.write(
    `<!DOCTYPE html><html lang="${lang}" dir="${dir}"><head><meta charset="UTF-8" /><title>${waiting}</title></head><body style="font-family:Arial,Tahoma,sans-serif;color:#6b7280;padding:24px;">${waiting}</body></html>`,
  );
  w.document.close();

  void draw()
    .then((pdf) => {
      if (w.closed) return;
      if (options.print) pdf.autoPrint();
      const url = URL.createObjectURL(pdf.output("blob"));
      w.location.replace(url);
      setTimeout(() => URL.revokeObjectURL(url), PDF_URL_LIFETIME_MS);
    })
    .catch((error) => {
      console.error("Failed to draw the PDF:", error);
      if (!w.closed) w.close();
    });
}
