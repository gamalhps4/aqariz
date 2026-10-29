/**
 * PropertyPro - A day as the office writes it
 *
 * The office's date-format setting ("DD/MM/YYYY" by default) applied to a
 * day. String work only — no clock, no zone, no database — so the PDF footer,
 * the export layer and the tests share one reading of the setting.
 */

import { DEFAULT_DATE_FORMAT } from "@/lib/regional/region";
import { businessMonth } from "@/lib/dates/business-day";
import type { ReportLanguage } from "./labels";

/** Day, month and year parts, in any order, with one separator between them. */
const DATE_FORMAT_SHAPE =
  /^(YYYY|YY|MM?|DD?)([/.\- ])(YYYY|YY|MM?|DD?)\2(YYYY|YY|MM?|DD?)$/;

const DATE_TOKEN = /YYYY|YY|MM|M|DD|D/g;

/**
 * Whether a stored date format is one this can write: "DD/MM/YYYY",
 * "YYYY-MM-DD" and the like — exactly one day, one month and one year.
 */
export function isUsableDateFormat(
  format: string | null | undefined,
): format is string {
  const match = DATE_FORMAT_SHAPE.exec((format ?? "").trim().toUpperCase());
  if (!match) return false;
  const units = [match[1], match[3], match[4]].map((part) => part[0]);
  return ["D", "M", "Y"].every(
    (unit) => units.filter((found) => found === unit).length === 1,
  );
}

/** A day's parts, zero-padded: "2026", "09", "29". */
export interface DayParts {
  year: string;
  month: string;
  day: string;
}

/**
 * The day written in `format`. Always Western digits, which is what Saudi
 * statements print. A format this cannot read falls back to the market's.
 */
export function writeDate(parts: DayParts, format?: string | null): string {
  return documentDateFormat(format).replace(DATE_TOKEN, (token) => {
    switch (token) {
      case "YYYY":
        return parts.year;
      case "YY":
        return parts.year.slice(-2);
      case "MM":
        return parts.month;
      case "M":
        return String(Number(parts.month));
      case "DD":
        return parts.day;
      default:
        return String(Number(parts.day));
    }
  });
}

/**
 * The format a document writes its dates in: the office's setting, or the
 * market's when the office has none (or one this cannot read). Never empty —
 * a printed document always writes a date the office's way; only a CSV, read
 * by machines, keeps ISO days, and it does so by passing no format at all.
 */
export function documentDateFormat(format?: string | null): string {
  return (isUsableDateFormat(format) ? format : DEFAULT_DATE_FORMAT)
    .trim()
    .toUpperCase();
}

/**
 * The office's format with slashes between the parts — what an Arabic PDF
 * writes. jsPDF lays a run of Arabic text out right to left, and a date with
 * hyphens in it comes out with its parts in reverse order; with slashes it
 * comes out as written. Day, month and year stay in the office's order.
 */
export function slashedDateFormat(format?: string | null): string {
  return documentDateFormat(format).replace(/[.\- ]/g, "/");
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * "2026-09-29" in the office's format. A calendar day, not a moment, so no
 * zone is applied; anything that is not an ISO day is returned as given.
 */
export function formatIsoDay(iso: string, format?: string | null): string {
  const match = ISO_DAY.exec(iso);
  if (!match) return iso;
  return writeDate({ year: match[1], month: match[2], day: match[3] }, format);
}

// ---------------------------------------------------------------------------
// Month names
// ---------------------------------------------------------------------------

/**
 * Each language's own calendar, with Western digits and the Gregorian months:
 * left to `ar-SA`, `Intl` writes the Islamic calendar and Arabic-Indic digits.
 */
const MONTH_LOCALES: Record<ReportLanguage, string> = {
  en: "en-GB",
  ar: "ar-SA-u-ca-gregory-nu-latn",
};

const MONTH_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function monthFormatter(
  language: ReportLanguage,
  style: "long" | "short",
): Intl.DateTimeFormat {
  const key = `${language}:${style}`;
  let found = MONTH_FORMATTERS.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(MONTH_LOCALES[language], {
      month: style,
      year: "numeric",
      timeZone: "UTC",
    });
    MONTH_FORMATTERS.set(key, found);
  }
  return found;
}

/**
 * A month as the reader's language writes it — "أكتوبر 2026", "October 2026",
 * "Oktober 2026".
 *
 * Takes a month ("2026-10"), a day ("2026-10-04") or a moment; a moment is
 * placed in the month it falls in on the office's calendar, not the server's.
 * Anything that is not a month comes back as it was given.
 */
export function monthLabel(
  value: Date | string | number,
  language: ReportLanguage,
  style: "long" | "short" = "long",
): string {
  const month = /^\d{4}-\d{2}$/.test(String(value))
    ? String(value)
    : businessMonth(value);
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return typeof value === "string" ? value : "";
  const monthNumber = Number(match[2]);
  if (monthNumber < 1 || monthNumber > 12) {
    return typeof value === "string" ? value : "";
  }
  return monthFormatter(language, style).format(
    new Date(Date.UTC(Number(match[1]), monthNumber - 1, 1)),
  );
}

const ENGLISH_MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/**
 * A report's "Month" cell in the reader's language.
 *
 * The routes write a month as "2026-09" or in English — "Sep 2026" — whatever
 * the language of the file; an Arabic reader got "Sep 2026" in an otherwise
 * Arabic report. Anything that is not one of those two shapes is left alone.
 */
export function translateMonthCell<T>(value: T, language: ReportLanguage): T {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (/^\d{4}-\d{2}$/.test(text)) {
    return monthLabel(text, language) as T;
  }
  const named = /^([A-Za-z]{3,9})\.? (\d{4})$/.exec(text);
  // English is already what an English reader needs.
  if (!named || language === "en") return value;
  const lower = named[1].toLowerCase();
  const index = ENGLISH_MONTHS.findIndex((month) => month.startsWith(lower));
  if (index < 0) return value;
  return monthLabel(`${named[2]}-${String(index + 1).padStart(2, "0")}`, language) as T;
}
