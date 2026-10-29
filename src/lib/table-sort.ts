/**
 * PropertyPro - Sorting a table by a column
 *
 * The client asked for sort arrows (⇅) on every table header: click once for
 * ascending, again for descending. Most tables are built from columns whose
 * cells are rendered JSX, so a column sorts by `sortValue` when its page
 * gives one, and otherwise by the text its cell shows — the words the reader
 * sees are what they expect the order to follow. Dates and amounts written
 * out in Arabic do not sort as text, which is why the pages that show them
 * name a `sortValue`.
 *
 * Pure: the shared DataTable, the raw-table helper and the tests import it.
 */

import { isValidElement, type ReactNode } from "react";

export type SortDirection = "asc" | "desc";

export type SortValue = string | number | Date | boolean | null | undefined;

/** The text a rendered cell shows: its strings and numbers, in order. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join(" ");
  if (isValidElement(node)) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

// Western and Arabic-Indic digits, a sign, separators and a decimal point,
// with at most a currency around them: a symbol ("$29", "4,750 ﷼"), a percent
// sign, or a currency word set off by a space ("SAR 29", "29 ر.س"). A letter
// touching the digits is a unit number ("A101", "101B"), and any other word
// makes it text ("2026 Plan").
const CURRENCY_WORD = "(?:SAR|SR|USD|EUR|GBP|AED|ريال|ر\\.س\\.?)";
const AMOUNT = new RegExp(
  `^(?:[$€£¥﷼₹+]\\s?|${CURRENCY_WORD}\\s+)?` +
    "(-?[\\d٠-٩][\\d٠-٩,٬ ]*(?:[.٫][\\d٠-٩]+)?)" +
    `(?:\\s?[%$€£¥﷼₹]|\\s+${CURRENCY_WORD})?$`,
  "i",
);

// An amount at the start of a longer cell ("﷼500.00 Rent", the badge beside
// a payment's amount): only one that is plainly money — a currency sign, or
// a thousands or decimal separator — so "12 Main Street" stays text.
const LEADING_AMOUNT =
  /^(?:[$€£¥﷼₹]\s?)?(-?[\d٠-٩]{1,3}(?:[,٬][\d٠-٩]{3})*(?:[.٫][\d٠-٩]+)?)(?=\s|$)/;

function toNumber(digits: string): number {
  return Number(
    digits
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[,٬ ]/g, "")
      .replace("٫", "."),
  );
}

const MONTHS: Record<string, number> = {};
[
  ["january", "jan", "يناير", "كانون الثاني"],
  ["february", "feb", "فبراير", "شباط"],
  ["march", "mar", "مارس", "آذار"],
  ["april", "apr", "أبريل", "ابريل", "نيسان"],
  ["may", "مايو", "أيار"],
  ["june", "jun", "يونيو", "حزيران"],
  ["july", "jul", "يوليو", "تموز"],
  ["august", "aug", "أغسطس", "اغسطس", "آب"],
  ["september", "sep", "sept", "سبتمبر", "أيلول"],
  ["october", "oct", "أكتوبر", "اكتوبر", "تشرين الأول"],
  ["november", "nov", "نوفمبر", "تشرين الثاني"],
  ["december", "dec", "ديسمبر", "كانون الأول"],
].forEach((names, month) => names.forEach((name) => (MONTHS[name] = month)));

const MONTH_NAME = Object.keys(MONTHS)
  .sort((a, b) => b.length - a.length)
  .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

// The ways the app writes a day, at the start of a cell (a badge or a count
// may follow): "1 نوفمبر 2026", "Nov 1, 2026", "2026-11-01", "01/11/2026".
// Slashed dates are read day first — this market's format (DD/MM/YYYY); a
// page whose office writes month first gives its date column a sortValue.
const DAY_MONTH_YEAR = new RegExp(`^(\\d{1,2})\\s+(${MONTH_NAME})\\.?,?\\s+(\\d{4})`, "i");
const MONTH_DAY_YEAR = new RegExp(`^(${MONTH_NAME})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, "i");
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})(?=$|[\sT])/;
const SLASHED_DAY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?=$|\s)/;

function westernDigits(text: string): string {
  return text.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

/** A day the cell's text starts with, as a Date, or null. */
export function textDate(text: string): Date | null {
  const value = westernDigits(text.trim());
  const at = (year: number, month: number, day: number) => {
    const date = new Date(Date.UTC(year, month, day));
    return date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
  };
  let match = DAY_MONTH_YEAR.exec(value);
  if (match) return at(Number(match[3]), MONTHS[match[2].toLowerCase()], Number(match[1]));
  match = MONTH_DAY_YEAR.exec(value);
  if (match) return at(Number(match[3]), MONTHS[match[1].toLowerCase()], Number(match[2]));
  match = ISO_DAY.exec(value);
  if (match) return at(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  match = SLASHED_DAY.exec(value);
  if (match) return at(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
  return null;
}

/**
 * A cell's text as a value: a day when it starts with a date (see
 * `textDate`), a number when the text is an amount ("4,750.00",
 * "﷼ 4,750", "SAR 29", "21.7%", "١٢") or starts with one that is plainly
 * money ("﷼500.00 Rent"), otherwise the trimmed text. Unit numbers like
 * "A101" stay text; the collator orders their digits as numbers. Collation
 * alone would put "1,000" before "500": it stops at the comma.
 */
export function textSortValue(text: string): SortValue {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const day = textDate(trimmed);
  if (day) return day;
  const whole = AMOUNT.exec(trimmed);
  if (whole) {
    const value = toNumber(whole[1]);
    if (Number.isFinite(value)) return value;
  }
  const leading = LEADING_AMOUNT.exec(trimmed);
  if (leading && /^[$€£¥﷼₹]|[,٬.٫]/.test(leading[0])) {
    const value = toNumber(leading[1]);
    if (Number.isFinite(value)) return value;
  }
  return trimmed;
}

function rank(value: SortValue): number | string | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

const collators = new Map<string, Intl.Collator>();

function collatorFor(language: string): Intl.Collator {
  let collator = collators.get(language);
  if (!collator) {
    collator = new Intl.Collator(language, { numeric: true, sensitivity: "base" });
    collators.set(language, collator);
  }
  return collator;
}

/**
 * Ascending order of two values. Empty values go last whichever way the
 * column is sorted, so a click never fills the top of the table with blanks;
 * numbers come before text when a column mixes them.
 */
export function compareSortValues(
  a: SortValue,
  b: SortValue,
  language = "en",
): number {
  const left = rank(a);
  const right = rank(b);
  if (left === null || right === null) {
    return left === right ? 0 : left === null ? 1 : -1;
  }
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (typeof left === "number") return -1;
  if (typeof right === "number") return 1;
  return collatorFor(language).compare(left, right);
}

/** The rows in the column's order; stable, and empties last either way. */
export function sortRows<T>(
  rows: readonly T[],
  valueOf: (row: T, index: number) => SortValue,
  direction: SortDirection,
  language = "en",
): T[] {
  const keyed = rows.map((row, index) => ({ row, index, value: valueOf(row, index) }));
  keyed.sort((x, y) => {
    const xEmpty = rank(x.value) === null;
    const yEmpty = rank(y.value) === null;
    if (xEmpty !== yEmpty) return xEmpty ? 1 : -1;
    const order = compareSortValues(x.value, y.value, language);
    return (direction === "asc" ? order : -order) || x.index - y.index;
  });
  return keyed.map((entry) => entry.row);
}

/** The next state of a header click: ascending, descending, then off. */
export function nextSort(
  current: { key: string | null; direction: SortDirection },
  key: string,
  allowOff = true,
): { key: string | null; direction: SortDirection } {
  if (current.key !== key) return { key, direction: "asc" };
  if (current.direction === "asc") return { key, direction: "desc" };
  return allowOff ? { key: null, direction: "asc" } : { key, direction: "asc" };
}
