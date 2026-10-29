/**
 * PropertyPro - Days, the way a listing counts them
 *
 * A licence is valid "until" a day, not until an instant, and the day is the
 * one on a Riyadh calendar: a licence that runs out on the 3rd is still good
 * at 11pm on the 3rd in Riyadh even though that is already the 4th in UTC
 * five minutes later. So every comparison here is between plain
 * `YYYY-MM-DD` days, the first of them read off the Asia/Riyadh clock.
 *
 * The licence expiry is a Postgres DATE (no time of day); Prisma hands it
 * back as midnight UTC of that day, which `dayOf` reads back with the UTC
 * parts so the day never shifts with the server's time zone.
 */

import { businessDay, businessToday } from "@/lib/dates/business-day";

export const LISTING_TIME_ZONE = "Asia/Riyadh";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Today's date on the Riyadh calendar, as `YYYY-MM-DD`. */
export function riyadhDay(now: Date = new Date()): string {
  return businessToday(now, LISTING_TIME_ZONE);
}

/**
 * A real calendar day, or null. "2026-02-30" is not one, whatever the shape
 * of the string says.
 */
export function parseDay(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = DAY_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  const same =
    date.getUTCFullYear() === Number(year) &&
    date.getUTCMonth() === Number(month) - 1 &&
    date.getUTCDate() === Number(day);
  return same ? `${year}-${month}-${day}` : null;
}

/** A day as the midnight-UTC Date a DATE column is written and compared with. */
export function dayToDate(day: string): Date {
  const parsed = parseDay(day);
  if (!parsed) throw new Error(`Not a calendar day: ${day}`);
  return new Date(`${parsed}T00:00:00.000Z`);
}

/** The day a DATE column's value names, or null for no value. */
export function dayOf(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    return parseDay(value.slice(0, 10));
  }
  if (Number.isNaN(value.getTime())) return null;
  return businessDay(value);
}

/** Whole days from one day to another (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const start = dayToDate(from).getTime();
  const end = dayToDate(to).getTime();
  return Math.round((end - start) / 86_400_000);
}
