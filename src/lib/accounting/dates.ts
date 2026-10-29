/**
 * PropertyPro - The ledger's calendar
 *
 * A journal entry is dated by a calendar day, not an instant. The day is the
 * one the office lives in — a payment taken at 01:30 on the 3rd in Riyadh is
 * the 3rd's, although it is still the 2nd in UTC — and it is stored as the
 * midnight UTC that begins it, the convention every date-only column in the
 * schema already follows (an `<input type="date">` value parses to exactly
 * that). Both kinds of stored value come out right: a date-only column is
 * midnight UTC and stays its own day; a timestamp is read in the office's
 * time zone first.
 *
 * Pure: the posting rules, the period lock and the screens share it.
 */

import { DEFAULT_TIMEZONE } from "@/lib/regional/region";
import { businessDay, dateOnly } from "@/lib/dates/business-day";

const DAY_MS = 86_400_000;

/**
 * The calendar day an instant falls on in the office's time zone, as the
 * midnight UTC that begins it.
 */
export function ledgerDay(
  value: Date | string | number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new RangeError(`Not a date: ${String(value)}`);
  }
  // A value that is already a midnight UTC is a stored calendar day: keep it,
  // rather than reading it in a zone west of UTC as the day before.
  if (instant.getTime() % DAY_MS === 0) return new Date(instant.getTime());
  return dateOnly(businessDay(instant, timeZone));
}

/** `YYYY-MM-DD` for a stored day. */
export function formatDay(day: Date): string {
  return businessDay(day);
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A `YYYY-MM-DD` string as a stored day, or null when it is not one. Anything
 * longer (a full ISO timestamp) is read as an instant and brought to its day.
 */
export function parseDay(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : ledgerDay(value);
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (DAY_PATTERN.test(trimmed)) {
    const day = new Date(`${trimmed}T00:00:00.000Z`);
    // Reject 2026-02-31, which Date would roll into March.
    return Number.isNaN(day.getTime()) || formatDay(day) !== trimmed
      ? null
      : day;
  }
  const instant = new Date(trimmed);
  return Number.isNaN(instant.getTime()) ? null : ledgerDay(instant);
}

export function addDays(day: Date, days: number): Date {
  return new Date(day.getTime() + days * DAY_MS);
}

/** Today, as the office's calendar day. */
export function today(timeZone: string = DEFAULT_TIMEZONE): Date {
  return ledgerDay(new Date(), timeZone);
}

/** The later of two days. */
export function laterDay(a: Date, b: Date): Date {
  return a.getTime() >= b.getTime() ? a : b;
}

/**
 * Whether a day sits inside the closed part of the books: on or before the
 * day they are closed through. Nothing is locked while no period is closed.
 */
export function isLockedDay(day: Date, closedThrough: Date | null | undefined): boolean {
  return Boolean(closedThrough) && day.getTime() <= closedThrough!.getTime();
}

/**
 * The first day an entry may still be dated: the day after the closed
 * period, or null when nothing is closed.
 */
export function firstOpenDay(closedThrough: Date | null | undefined): Date | null {
  return closedThrough ? addDays(closedThrough, 1) : null;
}

/**
 * The day an entry for `day` can actually carry: the day itself when it is
 * open, else the first open day — a document that changes after its period
 * was closed is corrected in the next open one, never inside the closed one.
 */
export function openDayFor(day: Date, closedThrough: Date | null | undefined): Date {
  const open = firstOpenDay(closedThrough);
  return open && day.getTime() < open.getTime() ? open : day;
}
