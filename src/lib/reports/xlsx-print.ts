/**
 * PropertyPro - A spreadsheet that prints like the PDF
 *
 * The PDF has always carried the date it was printed and "page 2 of 5" at the
 * foot of every page, because a loose page with neither cannot be put back in
 * order. The Excel export had no print setup at all: printed, it came out
 * with no date, no page count, the header row on the first sheet only, and a
 * wide table cut across two sheets of paper.
 *
 * Excel writes those into the header and footer of the sheet, in a small
 * language of its own: `&L`, `&C` and `&R` open the left, centre and right
 * sections, `&P` is the page number and `&N` the page count, and a literal
 * ampersand is written `&&`. The page numbers are Excel's to fill in when it
 * prints; the date is the one this file was made on, in the office's format
 * and on a Riyadh clock, like the PDF's.
 *
 * Pure strings, so the codes can be tested without opening Excel.
 */

import { pdfLabel, type PdfLanguage } from "@/lib/invoice/pdf-i18n";
import { printedOnLabel } from "./page-footer";

/** Text for a header or footer section: an ampersand there is a code. */
function escapeSection(text: string): string {
  return text.replace(/&/g, "&&");
}

export interface PrintHeaderFooter {
  oddHeader: string;
  oddFooter: string;
}

/**
 * The header and footer of every printed sheet.
 *
 * The footer mirrors the PDF's: the date on the side the language starts
 * from, the page count on the other, and the issuing office in the middle.
 * The header repeats the office's name, so every sheet of a printout says who
 * it came from.
 */
export function printHeaderFooter(content: {
  lang: PdfLanguage;
  rtl: boolean;
  /** The day the file was made, already written in the office's format. */
  printedOn: string;
  /** The issuing office, when the office has one. */
  office?: string | null;
}): PrintHeaderFooter {
  const printed = escapeSection(printedOnLabel(content.lang, content.printedOn));
  const pages = pageCountCodes(content.lang);
  const startSection = content.rtl ? "&R" : "&L";
  const endSection = content.rtl ? "&L" : "&R";

  const office = content.office?.trim() ?? "";
  return {
    oddHeader: office ? `&C${escapeSection(office)}` : "",
    oddFooter: `${startSection}${printed}${endSection}${pages}`,
  };
}

/**
 * "Page 2 of 5", with Excel's own codes where the numbers go: it fills in the
 * page it is printing, and the pages there are.
 */
function pageCountCodes(lang: PdfLanguage): string {
  return pdfLabel(lang, "exports.document.pageOf", "Page {page} of {pages}", {
    page: "&P",
    pages: "&N",
  });
}
