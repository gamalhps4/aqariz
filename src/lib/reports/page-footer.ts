/**
 * PropertyPro - The foot of every printed page
 *
 * The client asked for two things at the bottom of every printout: the date it
 * was printed, and "page 2 of 5". A report sent to an owner runs to several
 * pages, and a loose page with no date and no count cannot be put back in
 * order or told apart from last month's copy.
 *
 * Report PDFs, invoices and receipts all draw that footer here, so the three
 * cannot drift into three different wordings. It is drawn once every page
 * exists — "of 5" is only known at the end — and mirrored for a right-to-left
 * reader: the date on the right, the page count on the left.
 *
 * The date is written in the office's own date-format setting and read on a
 * Riyadh clock. A server in another zone would otherwise print yesterday's
 * date on anything produced after 9pm there.
 */

import type jsPDF from "jspdf";
import { DEFAULT_TIMEZONE } from "@/lib/regional/region";
import {
  drawText,
  pdfLabel,
  type PdfLanguage,
} from "@/lib/invoice/pdf-i18n";
import { businessDay } from "@/lib/dates/business-day";
import { formatIsoDay } from "./date-format";

type Rgb = readonly [number, number, number];

/**
 * A moment as the office writes its date — "29/09/2026" under the default
 * setting — on the market's clock (Riyadh). A format this cannot read falls
 * back to the market's.
 */
export function formatPrintDate(
  date: Date,
  format?: string | null,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  let day: string;
  try {
    day = businessDay(date, timeZone);
  } catch {
    // An unknown zone name throws; the market's zone never does.
    day = businessDay(date, DEFAULT_TIMEZONE);
  }
  return formatIsoDay(day, format);
}

/** "Printed on 29/09/2026", in the document's language. */
export function printedOnLabel(lang: PdfLanguage, date: string): string {
  return pdfLabel(lang, "exports.document.printedOn", "Printed on {date}", {
    date,
  });
}

/** "Page 2 of 5", in the document's language. */
export function pageOfLabel(
  lang: PdfLanguage,
  page: number,
  pages: number,
): string {
  return pdfLabel(lang, "exports.document.pageOf", "Page {page} of {pages}", {
    page,
    pages,
  });
}

export interface PageFooterContent {
  lang: PdfLanguage;
  /** Right to left: the date on the right edge, the page count on the left. */
  rtl: boolean;
  /** When the document was printed, already written by `formatPrintDate`. */
  printedOn: string;
  /** Centred between the two — who issued the document. */
  note?: string | null;
}

export interface PageFooterStyle {
  /** Distance from each side of the page, in the document's own unit. */
  marginX: number;
  /** Baseline of the footer text, from the top of the page. */
  baseline: number;
  /** A hairline across the page above the footer; left out when omitted. */
  ruleY?: number;
  ruleWidth: number;
  /** Points, whatever unit the document measures in. */
  fontSize: number;
  textColor: Rgb;
  ruleColor: Rgb;
}

/** Shorten text to a width, marking the cut. */
function clipToWidth(doc: jsPDF, text: string, width: number): string {
  if (width <= 0) return "";
  if (doc.getTextWidth(text) <= width) return text;
  let clipped = text;
  while (clipped.length > 1 && doc.getTextWidth(`${clipped}…`) > width) {
    clipped = clipped.slice(0, -1);
  }
  return `${clipped}…`;
}

/**
 * Stamp the footer on every page of a finished document.
 *
 * Call it last: it walks the pages that exist, so a page added afterwards
 * would have none, and every earlier page would still say "of" the old count.
 * The document's current font is used — the caller has already chosen the
 * face that can draw the document's language.
 */
export function drawPageFooters(
  doc: jsPDF,
  content: PageFooterContent,
  style: PageFooterStyle,
): void {
  const pages = doc.getNumberOfPages();
  const width = doc.internal.pageSize.getWidth();
  const startX = content.rtl ? width - style.marginX : style.marginX;
  const endX = content.rtl ? style.marginX : width - style.marginX;
  const startAlign = content.rtl ? "right" : "left";
  const endAlign = content.rtl ? "left" : "right";
  const printed = printedOnLabel(content.lang, content.printedOn);

  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);

    // Colours and line widths are written into the page that is current when
    // they are set, so they are set again on every page rather than once.
    if (style.ruleY !== undefined) {
      doc.setDrawColor(style.ruleColor[0], style.ruleColor[1], style.ruleColor[2]);
      doc.setLineWidth(style.ruleWidth);
      doc.line(style.marginX, style.ruleY, width - style.marginX, style.ruleY);
    }

    doc.setFontSize(style.fontSize);
    doc.setTextColor(style.textColor[0], style.textColor[1], style.textColor[2]);

    const count = pageOfLabel(content.lang, page, pages);
    drawText(doc, printed, startX, style.baseline, { align: startAlign });
    drawText(doc, count, endX, style.baseline, { align: endAlign });

    if (content.note) {
      // The note is centred, so it may use what the wider of the two side
      // texts leaves on both sides of the middle.
      const gap = doc.getTextWidth("    ");
      const side = Math.max(doc.getTextWidth(printed), doc.getTextWidth(count));
      const room = width - 2 * style.marginX - 2 * (side + gap);
      const note = clipToWidth(doc, content.note, room);
      if (note) {
        drawText(doc, note, width / 2, style.baseline, { align: "center" });
      }
    }
  }
}
