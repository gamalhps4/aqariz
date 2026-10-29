/**
 * PropertyPro - Activity log time
 *
 * An activity entry is read for *when exactly*: the screens printed the date
 * alone, the console export wrote UTC without saying so, and the date filter
 * compared against `new Date("2026-10-31")` — midnight UTC at the START of the
 * last day, so everything done on the day the range ended was left out.
 *
 * Here every time is shown in Saudi time (Asia/Riyadh, owner's decision) with
 * seconds, and a day range means whole Riyadh days, the last one included.
 *
 * No React and no database: both screens, the exports and the tests use it.
 */

import { DEFAULT_TIMEZONE } from "@/lib/regional/region";

/** The zone every activity time is shown and filtered in. */
export const AUDIT_TIME_ZONE = DEFAULT_TIMEZONE;

const DAY_MS = 24 * 60 * 60 * 1000;

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const wallClockFormatters = new Map<string, Intl.DateTimeFormat>();

/** What a clock in `timeZone` reads at `instant`. */
function wallClock(instant: Date, timeZone: string): WallClock {
  let formatter = wallClockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    wallClockFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour") % 24,
    minute: read("minute"),
    second: read("second"),
  };
}

function toDate(value: Date | string | number): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (value: number, width = 2) => String(value).padStart(width, "0");

/**
 * "03/10/2026 15:42:07" — day first, as every Saudi document prints it, and a
 * 24-hour clock with seconds in Riyadh time. The same in every language: an
 * audit time is compared, not read aloud, and a fixed shape is what makes two
 * of them comparable at a glance. Latin digits throughout.
 */
export function formatAuditDateTime(
  value: Date | string | number | null | undefined,
  timeZone: string = AUDIT_TIME_ZONE,
): string {
  if (value === null || value === undefined || value === "") return "—";
  const date = toDate(value);
  if (!date) return "—";
  const clock = wallClock(date, timeZone);
  return (
    `${pad(clock.day)}/${pad(clock.month)}/${clock.year} ` +
    `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
  );
}

/** "2026-10-03 15:42:07" in Riyadh time — sortable, for spreadsheets. */
export function formatAuditExportTimestamp(
  value: Date | string | number | null | undefined,
  timeZone: string = AUDIT_TIME_ZONE,
): string {
  if (value === null || value === undefined || value === "") return "";
  const date = toDate(value);
  if (!date) return "";
  const clock = wallClock(date, timeZone);
  return (
    `${clock.year}-${pad(clock.month)}-${pad(clock.day)} ` +
    `${pad(clock.hour)}:${pad(clock.minute)}:${pad(clock.second)}`
  );
}

/** The calendar day ("YYYY-MM-DD") it is in `timeZone` at `instant`. */
export function isoDayInZone(
  instant: Date,
  timeZone: string = AUDIT_TIME_ZONE,
): string {
  const clock = wallClock(instant, timeZone);
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The UTC instant a day ("YYYY-MM-DD") begins in `timeZone`, or null. */
export function zonedDayStart(
  isoDay: string,
  timeZone: string = AUDIT_TIME_ZONE,
): Date | null {
  const match = ISO_DAY.exec(isoDay.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const naive = Date.UTC(year, month - 1, day);
  const offsetAt = (instant: number) => {
    const clock = wallClock(new Date(instant), timeZone);
    const asUtc = Date.UTC(
      clock.year,
      clock.month - 1,
      clock.day,
      clock.hour,
      clock.minute,
      clock.second,
    );
    return asUtc - Math.floor(instant / 1000) * 1000;
  };
  // Two passes: the offset at the guess can differ from the offset at the
  // answer when a clock change falls between them.
  let start = naive - offsetAt(naive);
  const second = offsetAt(start);
  if (naive - second !== start) start = naive - second;
  return new Date(start);
}

/**
 * A day range as a query bound: from the start of the first day to the start
 * of the day AFTER the last one, exclusive — so the last day counts in full.
 * Either end may be missing; an unreadable day is ignored rather than
 * guessed at.
 */
export function auditDateRange(
  startDay?: string | null,
  endDay?: string | null,
  timeZone: string = AUDIT_TIME_ZONE,
): { gte?: Date; lt?: Date } {
  const range: { gte?: Date; lt?: Date } = {};
  const start = startDay ? zonedDayStart(startDay, timeZone) : null;
  if (start) range.gte = start;
  const end = endDay ? zonedDayStart(endDay, timeZone) : null;
  if (end) {
    // The next day's start, found from the calendar rather than by adding
    // 24 hours, which a clock change would throw off.
    const nextDay = isoDayInZone(new Date(end.getTime() + DAY_MS + 3_600_000), timeZone);
    range.lt = zonedDayStart(nextDay, timeZone) ?? new Date(end.getTime() + DAY_MS);
  }
  return range;
}

/** The first day of the default window: the last `days` days, today included. */
export function defaultAuditStartDay(
  now: Date = new Date(),
  days = 30,
  timeZone: string = AUDIT_TIME_ZONE,
): string {
  return isoDayInZone(new Date(now.getTime() - (days - 1) * DAY_MS), timeZone);
}
