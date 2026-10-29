/**
 * PropertyPro - Catalogue text in a given language, without React
 *
 * The screens translate through the localization provider. Text written on
 * the server — an email, an in-app notification, an SMS, a PDF label — has no
 * provider and no "current language": it is written for a recipient, in the
 * recipient's language (see `recipient-locale.ts`). This is the one lookup all
 * of them use, against the same catalogue as the screens, so a wording fixed
 * in `src/locales/` is fixed on screen and in every message at once.
 *
 * Lookup order: the language's entry, then English, then the fallback text,
 * then the key itself — the same order the screens use, so a message can never
 * come out blank.
 */

import { translations } from "@/locales";
import { localeCodeFor, toAppLanguage, type AppLanguage } from "./languages";
import { businessDay, businessMonth } from "@/lib/dates/business-day";

export type TranslateValues = Record<
  string,
  string | number | null | undefined
>;

/** Fill `{{token}}` and `{token}` placeholders, as the screens do. */
export function fillPlaceholders(text: string, values?: TranslateValues): string {
  if (!values) return text;
  return Object.entries(values).reduce((result, [token, raw]) => {
    const value = raw === null || raw === undefined ? "" : String(raw);
    // Escaped so a token can never be read as a regular expression.
    const name = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return result
      .replace(new RegExp(`\\{\\{${name}\\}\\}`, "g"), () => value)
      .replace(new RegExp(`\\{${name}\\}`, "g"), () => value);
  }, text);
}

/**
 * The catalogue entry `key` in `language`, with its placeholders filled.
 *
 * `language` may be a short code ("ar"), a full locale ("ar-SA") or a
 * recipient locale object; anything not shipped reads as English.
 */
export function translateFor(
  language: string | { language: string } | null | undefined,
  key: string,
  values?: TranslateValues,
  fallback?: string,
): string {
  const code: AppLanguage = toAppLanguage(
    typeof language === "object" && language !== null
      ? language.language
      : language,
    "en",
  );
  const entry = translations[key];
  const text = entry?.[code] ?? entry?.en ?? fallback ?? key;
  return fillPlaceholders(text, values);
}

/**
 * `<base>.one` for exactly one, `<base>.other` otherwise.
 *
 * English needs the pair ("1 day" / "3 days"). Arabic plural forms change
 * with the number (يوم، يومان، أيام، يومًا), so the Arabic entries of such a
 * pair are written to read for any number ("الأيام المتبقية: {days}") and
 * carry the same text under both keys.
 */
export function pluralKey(base: string, count: number): string {
  return Number(count) === 1 ? `${base}.one` : `${base}.other`;
}

/** Whether the catalogue has an entry for `key` (in English, the reference). */
export function hasTranslation(key: string): boolean {
  return Boolean(translations[key]?.en);
}

/**
 * Arabic locales write Western digits, as the screens, PDFs and exports do —
 * Arabic-Indic digits beside an amount in Western ones read as two systems.
 */
function intlLocale(language: string): string {
  const locale = localeCodeFor(language);
  return locale.startsWith("ar") ? `${locale}-u-nu-latn` : locale;
}

/**
 * A calendar date in the recipient's language — "3 October 2026",
 * "3 أكتوبر 2026". `timeZone` defaults to the server's; pass the office's
 * zone when the hour matters near midnight.
 */
export function formatDateFor(
  language: string,
  date: Date | string | number,
  options: { style?: "medium" | "long" | "full"; timeZone?: string } = {},
): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  const style = options.style ?? "long";
  const formatOptions: Intl.DateTimeFormatOptions =
    style === "medium"
      ? { year: "numeric", month: "short", day: "numeric" }
      : style === "full"
        ? { weekday: "long", year: "numeric", month: "long", day: "numeric" }
        : { year: "numeric", month: "long", day: "numeric" };
  try {
    return new Intl.DateTimeFormat(intlLocale(language), {
      ...formatOptions,
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(value);
  } catch {
    // Reached when Intl could not format (an unknown zone, say), so the
    // office's zone — not the one that failed — names the day.
    return businessDay(value);
  }
}

/** A time of day in the recipient's language — "3:30 PM", "3:30 م". */
export function formatTimeFor(
  language: string,
  date: Date | string | number,
  options: { timeZone?: string } = {},
): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale(language), {
      hour: "numeric",
      minute: "2-digit",
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(value);
  } catch {
    return value.toISOString().slice(11, 16);
  }
}

/**
 * A short axis label for a chart point: "6 Sep" / "6 سبتمبر" for a day,
 * "Sep" / "سبتمبر" for a month. Formatted in the reader's own time zone
 * unless one is given.
 */
export function formatChartLabelFor(
  language: string,
  date: Date | string | number,
  granularity: "day" | "month",
  options: { timeZone?: string } = {},
): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale(language), {
      ...(granularity === "day"
        ? { day: "numeric", month: "short" }
        : { month: "short" }),
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(value);
  } catch {
    return value.toISOString().slice(0, granularity === "day" ? 10 : 7);
  }
}

/** A month and year — "September 2026", "سبتمبر 2026". */
export function formatMonthFor(
  language: string,
  date: Date | string | number,
  options: { timeZone?: string } = {},
): string {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  try {
    return new Intl.DateTimeFormat(intlLocale(language), {
      year: "numeric",
      month: "long",
      ...(options.timeZone ? { timeZone: options.timeZone } : {}),
    }).format(value);
  } catch {
    return businessMonth(value);
  }
}
