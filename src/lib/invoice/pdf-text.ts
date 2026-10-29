/**
 * PropertyPro - Text an invoice or receipt PDF can actually draw
 *
 * The invoice and receipt PDFs were drawn in jsPDF's built-in Helvetica,
 * which only carries the Latin-1 set. Two things every Saudi document holds
 * are outside it:
 *
 * - The riyal sign. SAR is formatted as "﷼1,200.00", and one character
 *   outside the set makes jsPDF re-encode the whole string: every amount on
 *   the invoice came out as "1 , 2 0 0 . 0 0ýü".
 * - Arabic. A tenant, a building or an office named in Arabic printed as
 *   blanks and stray Latin letters.
 *
 * So money is written with the ISO code — which any font can draw, and which
 * is how a Saudi invoice writes it anyway — and, when the caller supplies it,
 * the text is set in Amiri, the same face the report PDFs embed. It covers
 * Arabic and Latin in one font, and jsPDF shapes and orders the Arabic
 * itself once a font with the glyphs is loaded.
 */

import type jsPDF from "jspdf";
import { formatCurrency } from "@/lib/utils/formatting";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";

/** "1,200.00 SAR" — money as any PDF font can draw it. */
export function formatPdfMoney(
  amount: number,
  currencyCode?: string | null,
): string {
  // Rounded first, so a float left over from arithmetic never prints "-0.00"
  // (-0 === 0, so the comparison also clears the sign).
  const rounded = Number.isFinite(amount) ? Number(amount.toFixed(2)) : 0;
  const safe = rounded === 0 ? 0 : rounded;
  const code = (currencyCode || DEFAULT_CURRENCY).toUpperCase();
  return `${formatCurrency(safe, code, { showSymbol: false })} ${code}`;
}

const PDF_FONT_NAME = "Amiri";
const PDF_FONT_FILE = "Amiri-Regular.ttf";

/**
 * Marks a document that has the embedded face registered.
 *
 * A property on the document rather than a WeakSet of documents: an Arabic
 * invoice is drawn through a mirroring proxy (see pdf-i18n.ts), which is a
 * different object from the document itself, and a set lookup on it missed —
 * the page silently fell back to Helvetica and printed its Arabic as noise.
 * A property read goes straight through the proxy.
 */
const EMBEDDED = Symbol("propertypro.pdfFont");

function hasEmbeddedFont(pdf: jsPDF): boolean {
  return Boolean((pdf as unknown as Record<symbol, unknown>)[EMBEDDED]);
}

/**
 * Register the embedded face on a document.
 *
 * Amiri ships one weight, so it is registered as both "normal" and "bold":
 * a heading loses its weight rather than falling back to Helvetica and
 * losing its letters.
 */
export function embedPdfFont(pdf: jsPDF, fontBase64: string): void {
  pdf.addFileToVFS(PDF_FONT_FILE, fontBase64);
  pdf.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "normal");
  pdf.addFont(PDF_FONT_FILE, PDF_FONT_NAME, "bold");
  (pdf as unknown as Record<symbol, unknown>)[EMBEDDED] = true;
  pdf.setFont(PDF_FONT_NAME, "normal");
}

/** Set the document's font, in the embedded face when it has one. */
export function setPdfFont(pdf: jsPDF, style: "normal" | "bold"): void {
  if (hasEmbeddedFont(pdf)) {
    pdf.setFont(PDF_FONT_NAME, style);
  } else {
    pdf.setFont("helvetica", style);
  }
}

let browserFont: Promise<string | null> | null = null;

/**
 * The embedded face, fetched once per page load, for PDFs drawn in the
 * browser. Server code reads the file from disk instead (see
 * `reportFontBase64`). Resolves to null when the font cannot be fetched, and
 * the document then falls back to Helvetica rather than failing.
 */
export function loadBrowserPdfFont(): Promise<string | null> {
  if (!browserFont) {
    browserFont = fetch("/api/fonts/amiri")
      .then(async (response) => {
        if (!response.ok) return null;
        const bytes = new Uint8Array(await response.arrayBuffer());
        let binary = "";
        const chunk = 0x8000;
        for (let index = 0; index < bytes.length; index += chunk) {
          binary += String.fromCharCode(
            ...bytes.subarray(index, index + chunk),
          );
        }
        return btoa(binary);
      })
      .catch(() => null)
      .then((font) => {
        // A failed fetch is not cached: the next document tries again.
        if (!font) browserFont = null;
        return font;
      });
  }
  return browserFont;
}
