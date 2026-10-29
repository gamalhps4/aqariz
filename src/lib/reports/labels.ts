/**
 * PropertyPro - Exports in the reader's language
 *
 * Every export route writes its sheet in English: column headers, the title,
 * the summary labels, and enum values like "overdue" or "bank_transfer". An
 * office working in Arabic got a right-to-left PDF with English headings —
 * the review asks for "Arabic text, RTL layout, dates, currency, totals, and
 * page headers" to come out right in exports.
 *
 * Rather than thread a translator through twenty-odd routes, the sheet is
 * translated once, on its way out, from catalogue entries keyed by the
 * English text itself: `exports.label.<slug>` for headers, titles and
 * summary labels, `exports.value.<slug>` for the handful of stored values
 * worth translating. Anything without an entry is left in English, so a new
 * column can never break an export — it can only arrive untranslated.
 */

import { translations } from "@/locales";
import { describeCharge, describeChargeNote } from "@/lib/i18n/charge-description";
import { formatIsoDay } from "./date-format";

export const REPORT_LANGUAGES = ["en", "ar"] as const;
export type ReportLanguage = (typeof REPORT_LANGUAGES)[number];

export function isReportLanguage(value: unknown): value is ReportLanguage {
  return REPORT_LANGUAGES.includes(value as ReportLanguage);
}

/**
 * The language a download was asked for.
 *
 * The export control sends the interface's language as `lang`. Older links
 * carry only `rtl=1`, which only an Arabic reader ever set, so that still
 * reads as Arabic.
 */
export function reportLanguage(searchParams: URLSearchParams): ReportLanguage {
  const asked = searchParams.get("lang");
  if (isReportLanguage(asked)) return asked;
  const rtl = searchParams.get("rtl");
  return rtl === "1" || rtl === "true" ? "ar" : "en";
}

/** "Contract no." → "contract_no" — the key an English label is filed under. */
export function labelSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/%/g, " pct ")
    .replace(/\+/g, " plus ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Only whole, plain-ASCII text is looked up. The slug drops every character
 * outside a-z and 0-9, so "Owner Statement of Account — ناصر" would otherwise
 * slug to the bare title and come back without the owner's name — and an
 * Arabic tenant name would slug to nothing at all.
 */
const PLAIN = /^[\x20-\x7E]+$/;

function lookup(
  prefix: "label" | "value",
  text: string,
  language: ReportLanguage,
): string | undefined {
  if (!PLAIN.test(text)) return undefined;
  const slug = labelSlug(text);
  if (!slug) return undefined;
  return translations[`exports.${prefix}.${slug}`]?.[language];
}

/**
 * Translate a header, title or summary label.
 *
 * Handles the two dynamic shapes the routes produce: a title with a name
 * after a dash ("Owner Statement of Account — Ahmed"), and a label with a
 * figure in brackets ("VAT on commission (15%)"). The fixed part is
 * translated and the rest kept as written.
 *
 * Labels are written in English, so an English reader needs none of that —
 * only the indented breakdown rows, which are stored values ("  cash").
 */
export function translateLabel(text: string, language: ReportLanguage): string {
  if (!text) return text;

  if (language !== "en") {
    // The dynamic part first: a name after a dash is kept as written.
    const dash = text.indexOf(" — ");
    if (dash > 0) {
      const head = lookup("label", text.slice(0, dash), language);
      if (head) return `${head} — ${text.slice(dash + 3)}`;
    }

    const whole = lookup("label", text, language);
    if (whole) return whole;

    const bracketed = /^(.*?)\s*(\([^)]*\))$/.exec(text);
    if (bracketed) {
      const head = lookup("label", bracketed[1], language);
      if (head) return `${head} ${bracketed[2]}`;
    }
  }

  // Summary rows indent a breakdown ("  cash") under its total.
  const indented = /^(\s+)(.+)$/.exec(text);
  if (indented) {
    const inner =
      language === "en"
        ? translateValue(indented[2], language)
        : (lookup("value", indented[2], language) ??
          lookup("label", indented[2], language));
    if (inner && inner !== indented[2]) return `${indented[1]}${inner}`;
  }

  return text;
}

/**
 * A charge's category the shared value table has no entry for ("parking_fee",
 * "application_fee"): the transaction list's table names every invoice type.
 */
function chargeCategory(value: string, language: ReportLanguage): string | undefined {
  if (!/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value)) return undefined;
  return translations[`transactions.categories.${value}`]?.[language];
}

/** A stored code: lower-case words joined by underscores ("owner_account"). */
const STORED_CODE = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/;

export interface ValueOptions {
  /**
   * The office's date format. Given, every day the sheet carries — a cell, a
   * summary value, a report period — is written in it, as the rest of a
   * printed document writes dates; left out — a CSV, read by machines — days
   * stay ISO.
   */
  dateFormat?: string | null;
}

/**
 * How the routes write a report's period: "2026-08-31 to 2026-09-29", with
 * "…" for an open end.
 */
const PERIOD = /^(\d{4}-\d{2}-\d{2}|…) to (\d{4}-\d{2}-\d{2}|…)$/;

/** How the routes write a day in a cell: "2026-09-29", the office's day. */
const ISO_DAY_CELL = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A period in the reader's language — "من 31/08/2026 إلى 29/09/2026" — where
 * every Arabic statement used to say "2026-08-31 to 2026-09-29". Written in
 * the office's date format, whose slashes also keep jsPDF from reversing the
 * parts of a hyphenated date set inside Arabic text.
 */
function translatePeriod(
  value: string,
  language: ReportLanguage,
  options: ValueOptions,
): string | undefined {
  const match = PERIOD.exec(value);
  if (!match) return undefined;
  const day = (iso: string) =>
    iso === "…" || !options.dateFormat
      ? iso
      : formatIsoDay(iso, options.dateFormat);
  const entry = translations["exports.document.period"];
  const template = entry?.[language] ?? entry?.en ?? "{from} to {to}";
  return template.replace("{from}", day(match[1])).replace("{to}", day(match[2]));
}

/**
 * Translate a cell or summary value — only when it is one of the stored
 * values the catalogue knows (a status, a payment method, a frequency), or a
 * report period. Names, notes and numbers pass through untouched.
 *
 * English is looked up too: the catalogue's English entry is the readable
 * form of the code ("credit_card" → "Credit card"). A code the catalogue does
 * not know yet is still written as words in English rather than printed as
 * "in_review"; only something shaped exactly like a code is touched, so a
 * name or a note never is.
 */
export function translateValue<T>(
  value: T,
  language: ReportLanguage,
  options: ValueOptions = {},
): T {
  if (typeof value !== "string" || !value) return value;
  const period = translatePeriod(value, language, options);
  if (period) return period as T;
  // A day, in the office's format — "29/09/2026" rather than "2026-09-29".
  // Without one — a CSV — it stays ISO for whoever reads it by machine.
  if (options.dateFormat && ISO_DAY_CELL.test(value)) {
    return formatIsoDay(value, options.dateFormat) as T;
  }
  // A value longer than any enum is free text; do not guess at it.
  const known =
    value.length > 40
      ? undefined
      : (lookup("value", value, language) ?? chargeCategory(value, language));
  if (known) return known as T;
  // What a generator wrote as a charge or a note ("Monthly Rent - September
  // 2026", "Required before lease commencement"), said in the reader's
  // language. Both recognisers match only the generators' own wordings, from
  // the first character to the last: anything typed comes back as typed.
  if (language !== "en" && /[A-Za-z]/.test(value)) {
    const charge = describeCharge({ description: value }, language);
    if (charge !== value) return charge as T;
    const note = describeChargeNote(value, language);
    if (note !== value) return note as T;
  }
  if (value.length > 40) return value;
  if (language === "en" && STORED_CODE.test(value)) {
    const words = value.replace(/_/g, " ");
    return `${words.charAt(0).toUpperCase()}${words.slice(1)}` as T;
  }
  return value;
}
