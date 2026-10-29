/**
 * PropertyPro - Month names in the reader's language
 *
 * The financial report's month-by-month table and chart named their months
 * from a list of English abbreviations, on screen and in every download. They
 * are named here by the platform's own calendar data instead, in whichever of
 * the five interface languages the reader is using.
 *
 * Gregorian whatever the language — the books are kept in it, and an Arabic
 * locale left to itself may open on the Hijri calendar — and with Latin
 * digits, as every figure and date in the product is written.
 *
 * Pure: the page and the report route both import it.
 */

/** The interface languages, and the locale each one's months are named in. */
const MONTH_LOCALES: Record<string, string> = {
  en: "en",
  ar: "ar",
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(
  language: string,
  withYear: boolean,
  style: "short" | "long",
): Intl.DateTimeFormat {
  const base = MONTH_LOCALES[language] ?? "en";
  const key = `${base}|${withYear}|${style}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(`${base}-u-ca-gregory-nu-latn`, {
      month: style,
      ...(withYear ? { year: "numeric" } : {}),
      // A month is a place on the calendar, not an instant: read it in UTC so
      // the reader's time zone cannot move it to the month before.
      timeZone: "UTC",
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * "Jan", or "Jan 2026" with the year; "January 2026" in the long style, which
 * is what a printed month column wants — short names run into one another in
 * some languages and are not the same length in any. `month` is 1–12, as the
 * report's SQL extracts it.
 */
export function monthLabel(
  month: number,
  year: number,
  language: string,
  options: { withYear?: boolean; style?: "short" | "long" } = {},
): string {
  const instant = new Date(Date.UTC(year, month - 1, 1));
  return formatterFor(
    language,
    Boolean(options.withYear),
    options.style ?? "short",
  ).format(instant);
}
