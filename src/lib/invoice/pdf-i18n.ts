/**
 * PropertyPro - Invoice and receipt PDFs in the reader's language
 *
 * The PDFs drawn with jsPDF — an invoice downloaded, printed or emailed, the
 * receipt a tenant downloads — place every word at a coordinate, so they were
 * English with a left-to-right layout whatever language the office worked in.
 *
 * Labels come from the same catalogue as the screens (`leases.invoicePrint.*`
 * and friends), so a wording fixed once is fixed on paper too. For Arabic the
 * page is drawn through `mirroredPdf`, which reflects every coordinate and
 * alignment across the page: the renderers keep describing one layout, and
 * an Arabic reader gets its mirror image. Letter shaping is jsPDF's own once
 * the Arabic-capable face is embedded (see pdf-text.ts); the order of each
 * Arabic line is set by `drawText` below.
 */

import type jsPDF from "jspdf";
import type { TextOptionsLight } from "jspdf";
import { translations } from "@/locales";
import { isReportLanguage, type ReportLanguage } from "@/lib/reports/labels";
import {
  latinDigits,
  localizationService,
} from "@/lib/services/localization.service";
import { BUSINESS_TIME_ZONE, businessDay } from "@/lib/dates/business-day";

export type PdfLanguage = ReportLanguage;

const DATE_LOCALES: Record<PdfLanguage, string> = {
  en: "en-GB",
  ar: "ar-SA",
};

/**
 * The language the app is shown in, as a PDF language — what a document
 * drawn in the browser is written in. English for anything else.
 */
export function interfacePdfLanguage(): PdfLanguage {
  const code = localizationService.getCurrentLocale().split("-")[0];
  return isReportLanguage(code) ? code : "en";
}

/** Arabic is the one right-to-left language shipped. */
export function isRtlLanguage(lang: PdfLanguage): boolean {
  return lang === "ar";
}

/**
 * A label in the document's language — the catalogue entry when there is
 * one, the English wording otherwise. `{token}` and `{{token}}` are both
 * filled, as on screen.
 */
export function pdfLabel(
  lang: PdfLanguage,
  key: string,
  english: string,
  values?: Record<string, string | number>,
): string {
  const entry = translations[key];
  const text = entry?.[lang] ?? entry?.en ?? english;
  if (!values) return text;
  return Object.entries(values).reduce(
    (result, [token, value]) =>
      result
        .replace(new RegExp(`\\{\\{${token}\\}\\}`, "g"), String(value))
        .replace(new RegExp(`\\{${token}\\}`, "g"), String(value)),
    text,
  );
}

/**
 * "12 Sept 2026", in the document's language — with Western digits, as the
 * screens and every Saudi statement write them. Arabic used to come out in
 * Arabic-Indic digits ("١٢ سبتمبر ٢٠٢٦") beside a footer date in Western ones.
 */
export function formatPdfDate(date: Date, lang: PdfLanguage): string {
  try {
    return new Intl.DateTimeFormat(latinDigits(DATE_LOCALES[lang]), {
      year: "numeric",
      month: "short",
      day: "numeric",
      // The office's calendar, not the server's: a payment taken at 01:30 on
      // the 4th prints as the 4th. A day stored at midnight UTC is 03:00 here,
      // the same day.
      timeZone: BUSINESS_TIME_ZONE,
    }).format(date);
  } catch {
    return businessDay(date);
  }
}

/** A letter of the Arabic script, the presentation forms included. */
const ARABIC = /\p{Script=Arabic}/u;

/**
 * How jsPDF lays out a line that holds Arabic: as right-to-left text, put
 * into the order its glyphs are drawn in.
 *
 * jsPDF's default reads every line as left to right and flips the Arabic runs
 * inside it, leaving punctuation and brackets where a left-to-right reading
 * puts them: "شكراً لسدادك." printed its full stop against the first word,
 * and "(15%)" came out split and reversed around the text. Told the line is
 * right-to-left, its own bidi engine does what a browser does — the full stop
 * follows the last word, brackets are mirrored, numbers and Latin runs keep
 * their order. A line without Arabic keeps the default: read right to left,
 * "12,000.00 SAR" would print as "SAR 12,000.00".
 */
const RIGHT_TO_LEFT_LINE = {
  isInputVisual: false,
  isOutputVisual: true,
  isInputRtl: true,
  isOutputRtl: false,
  isSymmetricSwapping: true,
} as const;

/** The layout options a line needs: right to left when it holds Arabic. */
export function arabicLineLayout(
  text: string,
): typeof RIGHT_TO_LEFT_LINE | undefined {
  return ARABIC.test(text) ? RIGHT_TO_LEFT_LINE : undefined;
}

/**
 * Draw text with the layout each line needs (see `arabicLineLayout`).
 *
 * jsPDF applies one layout to a whole call, so lines of which only some hold
 * Arabic — an address with an email under it — are drawn one at a time, at
 * the spacing jsPDF would have used.
 */
export function drawText(
  pdf: jsPDF,
  text: string | string[],
  x: number,
  y: number,
  options: TextOptionsLight = {},
): void {
  const lines = Array.isArray(text) ? text : [text];
  if (!lines.some((line) => ARABIC.test(line))) {
    pdf.text(text, x, y, options);
    return;
  }
  if (!Array.isArray(text)) {
    pdf.text(text, x, y, { ...options, ...RIGHT_TO_LEFT_LINE });
    return;
  }
  const step =
    (pdf.getFontSize() * pdf.getLineHeightFactor()) / pdf.internal.scaleFactor;
  lines.forEach((line, index) => {
    pdf.text(line, x, y + index * step, {
      ...options,
      ...arabicLineLayout(line),
    });
  });
}

/** Everything but `text` passes straight through to the document. */
function passThrough(
  target: jsPDF,
  property: string | symbol,
  receiver: unknown,
): unknown {
  const value = Reflect.get(target, property, receiver);
  return typeof value === "function" ? value.bind(target) : value;
}

/**
 * The same document, with its Arabic lines laid out right to left — for a
 * left-to-right document that still prints an Arabic name or address.
 */
export function arabicAwarePdf(pdf: jsPDF): jsPDF {
  return new Proxy(pdf, {
    get(target, property, receiver) {
      if (property === "text") {
        return (
          text: string | string[],
          x: number,
          y: number,
          options?: TextOptionsLight,
        ) => {
          drawText(target, text, x, y, options);
          return target;
        };
      }
      return passThrough(target, property, receiver);
    },
  });
}

type Align = "left" | "right" | "center" | "justify";

function mirrorAlign(options?: TextOptionsLight): TextOptionsLight {
  const align = options?.align ?? "left";
  return {
    ...options,
    align: align === "left" ? "right" : align === "right" ? "left" : align,
  };
}

/**
 * The same document, drawn right to left.
 *
 * Every x-coordinate is reflected across the page, text alignment flips
 * (left ↔ right, centre stays), and boxes and images are reflected by their
 * far edge so they occupy the mirrored space. Arabic lines are laid out right
 * to left as in `arabicAwarePdf`. Anything that does not draw at a position —
 * fonts, colours, measuring text, adding pages — passes through.
 */
export function mirroredPdf(pdf: jsPDF): jsPDF {
  const width = (): number => pdf.internal.pageSize.getWidth();

  return new Proxy(pdf, {
    get(target, property, receiver) {
      switch (property) {
        case "text":
          return (
            text: string | string[],
            x: number,
            y: number,
            options?: TextOptionsLight & { align?: Align },
          ) => {
            drawText(target, text, width() - x, y, mirrorAlign(options));
            return target;
          };
        case "rect":
          return (x: number, y: number, w: number, h: number, style?: string) =>
            target.rect(width() - x - w, y, w, h, style);
        case "roundedRect":
          return (
            x: number,
            y: number,
            w: number,
            h: number,
            rx: number,
            ry: number,
            style?: string,
          ) => target.roundedRect(width() - x - w, y, w, h, rx, ry, style);
        case "line":
          return (x1: number, y1: number, x2: number, y2: number) =>
            target.line(width() - x1, y1, width() - x2, y2);
        case "circle":
          return (x: number, y: number, r: number, style?: string) =>
            target.circle(width() - x, y, r, style);
        case "addImage":
          return (
            // Every caller passes a data URL (see logo-utils).
            imageData: string,
            format: string,
            x: number,
            y: number,
            w: number,
            h: number,
            alias?: string,
            compression?: "NONE" | "FAST" | "MEDIUM" | "SLOW",
          ) =>
            target.addImage(
              imageData,
              format,
              width() - x - w,
              y,
              w,
              h,
              alias,
              compression,
            );
        default:
          return passThrough(target, property, receiver);
      }
    },
  });
}
