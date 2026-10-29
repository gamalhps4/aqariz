/**
 * PropertyPro - The periods a report page offers
 *
 * A report is read over a period, and the page that offers one needs three
 * things the controls cannot work out for themselves: the period it opens on,
 * the ready-made ranges ("this quarter") and whether the dates now in the
 * boxes are one of those ranges, so the selector can say so.
 *
 * Days here are the reader's own calendar days — what a person typing into a
 * date box means by "today" — written "YYYY-MM-DD" as `<input type="date">`
 * and the report routes read them. Both ends are inclusive.
 *
 * No database and no session: the pages import this.
 */

import { pickedDay } from "@/lib/dates/business-day";

export type PeriodPreset =
  | "this-month"
  | "last-month"
  | "this-quarter"
  | "this-year"
  | "last-year";

/** In the order the selector lists them. */
export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "this-month",
  "last-month",
  "this-quarter",
  "this-year",
  "last-year",
];

export function isPeriodPreset(value: unknown): value is PeriodPreset {
  return PERIOD_PRESETS.includes(value as PeriodPreset);
}

// A type rather than an interface, so a range can be used as filter values
// (a record of strings) without being copied.
export type PeriodRange = {
  startDate: string;
  endDate: string;
};

/** "2026-10-03" for the reader's calendar day — not the UTC one. */
export function localDay(date: Date): string {
  return pickedDay(date);
}

/**
 * The days a ready-made range covers. The running ranges close today; the two
 * "last" ranges close on the last day of the month or year they name.
 */
export function presetRange(
  preset: PeriodPreset,
  now: Date = new Date(),
): PeriodRange {
  const year = now.getFullYear();
  const month = now.getMonth();
  switch (preset) {
    case "last-month":
      return {
        startDate: localDay(new Date(year, month - 1, 1)),
        endDate: localDay(new Date(year, month, 0)),
      };
    case "this-quarter":
      return {
        startDate: localDay(new Date(year, Math.floor(month / 3) * 3, 1)),
        endDate: localDay(now),
      };
    case "this-year":
      return {
        startDate: localDay(new Date(year, 0, 1)),
        endDate: localDay(now),
      };
    case "last-year":
      return {
        startDate: localDay(new Date(year - 1, 0, 1)),
        endDate: localDay(new Date(year - 1, 11, 31)),
      };
    case "this-month":
      return {
        startDate: localDay(new Date(year, month, 1)),
        endDate: localDay(now),
      };
  }
}

/**
 * The period most reports open on: the year so far, which is how commission,
 * rent and expenses are reviewed.
 */
export function yearToDate(now: Date = new Date()): PeriodRange {
  return presetRange("this-year", now);
}

/**
 * Which ready-made range the dates in the boxes are, if any — so a selector
 * can show "This quarter" rather than "Custom" when someone has typed exactly
 * those days.
 */
export function presetOfRange(
  startDate: string,
  endDate: string,
  now: Date = new Date(),
): PeriodPreset | null {
  for (const preset of PERIOD_PRESETS) {
    const range = presetRange(preset, now);
    if (range.startDate === startDate && range.endDate === endDate) {
      return preset;
    }
  }
  return null;
}

/** Whether both ends are set and the start comes after the end. */
export function isReversedPeriod(startDate: string, endDate: string): boolean {
  return Boolean(startDate) && Boolean(endDate) && startDate > endDate;
}
