/**
 * PropertyPro - Reading the cells of an import row
 *
 * The contract and payment importers carry money and calendar days, and the
 * loose readers in csv.ts (`toNumber`, `toDate`) are too forgiving for them:
 * `toDate("04/10/2026")` is the 10th of April to `Date.parse` and the 4th of
 * October to anyone in Riyadh, and `toNumber("١٢٠٠")` is nothing at all. A
 * contract that starts six months late, or a payment that silently becomes
 * zero, is worse than a row refused with a reason.
 *
 * So these read strictly and say which of three things a cell was: empty,
 * read, or not readable — the last one becomes a row error naming the cell.
 *
 * No database, so it can be tested.
 */

import { isIsoDay } from "@/lib/dates/business-day";

/** A problem with one row, said on the import screen as `import.issue.<code>`. */
export interface RowProblem {
  /** English, for API clients and anything without a translation. */
  message: string;
  code: string;
  values?: Record<string, string | number>;
}

/** What a cell held: nothing (`value: null`), a value, or something unreadable. */
export type CellRead<T> = { ok: true; value: T | null } | { ok: false };

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/**
 * Arabic-Indic (٠١٢…) and Persian (۰۱۲…) digits as ASCII, and the Arabic
 * decimal and thousands separators as "." and nothing. A sheet typed with an
 * Arabic keyboard writes "١٢٬٥٠٠٫٥٠" for 12,500.50.
 */
export function westernDigits(value: string): string {
  return value
    .replace(EASTERN_DIGITS, (digit) => {
      const code = digit.charCodeAt(0);
      return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
    })
    .replace(/٫/g, ".")
    .replace(/٬/g, "");
}

/**
 * A calendar day, as "YYYY-MM-DD".
 *
 * Accepted: "2026-03-01" (with or without a time after it), "2026/03/01",
 * and the day-first "01/03/2026", "01-03-2026" or "01.03.2026" — the order a
 * Saudi office writes and the product prints. Month-first is not guessed at:
 * a file written that way fails on day 13 rather than importing the first
 * twelve days of every month in the wrong month.
 */
export function readDay(raw: string): CellRead<string> {
  const value = westernDigits(raw).trim();
  if (!value) return { ok: true, value: null };

  let year: string;
  let month: string;
  let day: string;
  const yearFirst = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(value);
  const dayFirst = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(value);
  if (yearFirst) {
    [, year, month, day] = yearFirst;
  } else if (dayFirst) {
    [, day, month, year] = dayFirst;
  } else {
    return { ok: false };
  }

  const iso = `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  return isIsoDay(iso) ? { ok: true, value: iso } : { ok: false };
}

/**
 * An amount of money, to the halala: "1,200.50", "SAR 1200", "١٢٠٠ ر.س".
 * Negative amounts and fractions of a halala are not amounts anyone means.
 */
export function readAmount(raw: string): CellRead<number> {
  const value = westernDigits(raw).trim();
  if (!value) return { ok: true, value: null };

  // Currency names go first, with the dots inside them — "ر.س" read
  // character by character would leave ".", and "ر.س 1200" become 0.12.
  // Then symbols, spaces and thousands separators; a minus sign stays so it
  // can be refused rather than quietly dropped.
  const cleaned = value
    .replace(/\p{L}+(?:\.\p{L}+)*\.?/gu, "")
    .replace(/[^0-9.\-]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned) && !/^-?\.\d+$/.test(cleaned)) {
    return { ok: false };
  }
  const amount = Number(cleaned);
  if (!Number.isFinite(amount) || amount < 0) return { ok: false };

  const halalas = Math.round(amount * 100);
  if (Math.abs(amount * 100 - halalas) > 1e-6) return { ok: false };
  return { ok: true, value: halalas / 100 };
}

/**
 * A key for comparing names typed by different people: case, spacing,
 * diacritics and tatweel set aside, and the Arabic letters most often
 * written either way (أ إ آ ٱ / ا, ى / ي, ة / ه) made one. "شقق الواحة" and
 * "شقق الواحه" are the same building; two buildings that only differ in
 * those ways come out as one key, which the matcher reports as ambiguous
 * rather than picking either.
 */
export function nameKey(value: string): string {
  return westernDigits(value)
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * A key for a unit number or a reference number: "a-101", "A 101" and
 * "A101" are the same unit on any sign.
 */
export function codeKey(value: string): string {
  return westernDigits(value)
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[\s_\-]+/g, "");
}
