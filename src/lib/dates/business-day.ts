/**
 * PropertyPro - The business day
 *
 * Every date this product shows or compares is a day on the office's wall
 * calendar — Riyadh's. The server runs on UTC, and the code kept asking the
 * server's clock which day it is: `toISOString().slice(0, 10)` for a column of
 * a spreadsheet, `setHours(0, 0, 0, 0)` for "today", `new Date()` for a due
 * date. Between midnight and 03:00 in Riyadh the server is still on the
 * previous day, so a payment recorded at 01:30 on the 4th was exported as the
 * 3rd, a rent due on the 3rd was not yet overdue on the morning of the 4th,
 * and a period "up to today" stopped a day short.
 *
 * This is the one place that knows the zone. Everything here is a pure
 * function of the instant it is given and the zone — no database, no
 * browser, no server clock unless the caller leaves `now` out — so the same
 * file serves the API routes, the report layer and the pages, and the tests
 * can put a clock at 21:30 UTC and say what day it is in Riyadh.
 *
 * Two kinds of stored date go through it, and both come out right:
 *
 *   - an instant (a payment's `paidDate`, a request's `createdAt`) belongs to
 *     the Riyadh day it happened on;
 *   - a date-only value (a contract's start and end, an installment's due
 *     date) is stored at midnight UTC, which is 03:00 in Riyadh — the same
 *     calendar day — so it reads as the day it was meant as.
 *
 * Days travel as ISO strings ("2026-10-04"): a calendar day has no clock and
 * no zone, and strings of that shape sort and compare as days do.
 */

import { DEFAULT_TIMEZONE } from "@/lib/regional/region";

/** The zone the office's calendar is kept in. */
export const BUSINESS_TIME_ZONE = DEFAULT_TIMEZONE;

/**
 * The first day of the business week, as `Date#getUTCDay` numbers it: 0 is
 * Sunday. The Saudi working week is Sunday to Thursday, so a week on a
 * calendar there starts on a Sunday.
 */
export const BUSINESS_WEEK_STARTS_ON = 0;

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Zones that never change their offset, so it is a constant and needs no
 * `Intl` at all. Saudi Arabia has kept UTC+3 since 1947.
 */
const FIXED_OFFSET_MINUTES: Readonly<Record<string, number>> = {
  "Asia/Riyadh": 180,
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** How far `timeZone`'s wall clock is ahead of UTC at an instant, in minutes. */
function offsetMinutes(instant: number, timeZone: string): number {
  const fixed = FIXED_OFFSET_MINUTES[timeZone];
  if (fixed !== undefined) return fixed;

  const parts = formatterFor(timeZone).formatToParts(new Date(instant));
  const field = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  // `h23` never prints 24, but an engine that ignores the hint does.
  const hour = field("hour") % 24;
  const wallAsUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    hour,
    field("minute"),
    field("second"),
  );
  // The formatter drops the milliseconds; so must the instant it is read against.
  const wholeSeconds = Math.floor(instant / 1000) * 1000;
  return Math.round((wallAsUtc - wholeSeconds) / MINUTE_MS);
}

/** Year, month (1-12) and day of an ISO day, or null when it is not a real one. */
function parseDay(day: string): [number, number, number] | null {
  const match = ISO_DAY.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const check = new Date(Date.UTC(year, month - 1, date));
  // `Date.UTC` rolls 2026-02-30 over into March; a real day does not roll.
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== date
  ) {
    return null;
  }
  return [year, month, date];
}

function requireDay(day: string): [number, number, number] {
  const parsed = parseDay(day);
  if (!parsed) throw new RangeError(`"${day}" is not an ISO day (YYYY-MM-DD)`);
  return parsed;
}

function isoOf(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Whether a value is a real calendar day written "YYYY-MM-DD". */
export function isIsoDay(value: unknown): value is string {
  return typeof value === "string" && parseDay(value) !== null;
}

/**
 * The calendar day an instant falls on, in the office's zone: "2026-10-04".
 *
 * A string that is already a day is returned as it is — it has no instant to
 * convert. Anything missing or unreadable comes back as "", which is what a
 * spreadsheet cell wants for a date that is not there, rather than a throw
 * halfway through a file.
 */
export function businessDay(
  value: Date | string | number | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "string" && ISO_DAY.test(value)) {
    return isIsoDay(value) ? value : "";
  }
  const instant =
    value instanceof Date
      ? value.getTime()
      : typeof value === "number"
        ? value
        : Date.parse(value);
  if (!Number.isFinite(instant)) return "";
  return isoOf(instant + offsetMinutes(instant, timeZone) * MINUTE_MS);
}

/** Today's date in the office's zone. */
export function businessToday(
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return businessDay(now, timeZone);
}

/**
 * The day a date picker's Date shows. A calendar control hands its day back as
 * LOCAL midnight — 21:00 UTC the evening before, in a browser on Riyadh time —
 * so `toISOString().split("T")[0]` read the day the person clicked as the day
 * before. The Date's own local fields are the day it was built from, in
 * whatever zone the browser is in. For a value the control was given (a day
 * stored at midnight UTC, shown on the Riyadh calendar) or any instant, use
 * `businessDay`; this is only for what the control returns.
 */
export function pickedDay(date: Date | null | undefined): string {
  if (!date || Number.isNaN(date.getTime())) return "";
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The instant a day begins: 00:00:00.000 on the office's wall clock. */
export function businessDayStart(
  day: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  const [year, month, date] = requireDay(day);
  const wallMidnight = Date.UTC(year, month - 1, date);
  const first = offsetMinutes(wallMidnight, timeZone);
  let instant = wallMidnight - first * MINUTE_MS;
  // A zone that changes its clock overnight needs the offset at the answer,
  // not at the guess. Riyadh never does; the second look costs nothing.
  const second = offsetMinutes(instant, timeZone);
  if (second !== first) instant = wallMidnight - second * MINUTE_MS;
  return new Date(instant);
}

/** The last millisecond of a day: 23:59:59.999 on the office's wall clock. */
export function businessDayEnd(
  day: string,
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  return new Date(
    businessDayStart(addBusinessDays(day, 1), timeZone).getTime() - 1,
  );
}

/** The first instant of the day `now` falls on. */
export function startOfBusinessDay(
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  return businessDayStart(businessToday(now, timeZone), timeZone);
}

/** The last instant of the day `now` falls on — what a register is read at. */
export function endOfBusinessDay(
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): Date {
  return businessDayEnd(businessToday(now, timeZone), timeZone);
}

/**
 * A day, `days` days later (or earlier, when negative). Calendar arithmetic
 * on the day itself — no clock, no zone — so month ends and leap days are the
 * calendar's.
 */
export function addBusinessDays(day: string, days: number): string {
  const [year, month, date] = requireDay(day);
  return isoOf(Date.UTC(year, month - 1, date + days));
}

/**
 * A day, `months` months later (or earlier, when negative). A day that the
 * target month does not have — the 31st, into a month of 30 — is the month's
 * last day, as a calendar clamps it.
 */
export function addBusinessMonths(day: string, months: number): string {
  const [year, month, date] = requireDay(day);
  const target = month - 1 + months;
  const lastDay = new Date(Date.UTC(year, target + 1, 0)).getUTCDate();
  return isoOf(Date.UTC(year, target, Math.min(date, lastDay)));
}

/** Whole days from one day to another: positive when `to` is later. */
export function businessDaysBetween(fromDay: string, toDay: string): number {
  const [fy, fm, fd] = requireDay(fromDay);
  const [ty, tm, td] = requireDay(toDay);
  return Math.round(
    (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS,
  );
}

export interface DayRange {
  from: string;
  to: string;
}

/** The first and last day of the month a day is in. */
export function businessMonthRange(day: string): DayRange {
  const [year, month] = requireDay(day);
  const pad = String(month).padStart(2, "0");
  return {
    from: `${String(year).padStart(4, "0")}-${pad}-01`,
    to: isoOf(Date.UTC(year, month, 0)),
  };
}

/** The first and last day of the week a day is in. */
export function businessWeekRange(
  day: string,
  weekStartsOn: number = BUSINESS_WEEK_STARTS_ON,
): DayRange {
  const [year, month, date] = requireDay(day);
  const weekday = new Date(Date.UTC(year, month - 1, date)).getUTCDay();
  const back = (weekday - weekStartsOn + 7) % 7;
  const from = addBusinessDays(day, -back);
  return { from, to: addBusinessDays(from, 6) };
}

/** The windows a "today / this week / this month" filter names. */
export type DayPreset = "today" | "week" | "month";

export function isDayPreset(value: unknown): value is DayPreset {
  return value === "today" || value === "week" || value === "month";
}

/**
 * The days a preset names, on the office's calendar: today; this week, from
 * its Sunday; this month. A screen and the file cut from it both read the
 * window here, so "this week" is the same seven days in each.
 */
export function businessPresetRange(
  preset: DayPreset,
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): DayRange {
  const today = businessToday(now, timeZone);
  switch (preset) {
    case "today":
      return { from: today, to: today };
    case "week":
      return businessWeekRange(today);
    case "month":
      return businessMonthRange(today);
  }
}

/** The `days` days that end on `endDay`, today included: a trailing window. */
export function trailingDays(days: number, endDay: string): DayRange {
  return { from: addBusinessDays(endDay, -(Math.max(1, days) - 1)), to: endDay };
}

/** "2026-10" — the month a day or an instant falls in, on the office's calendar. */
export function businessMonth(
  value: Date | string | number | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string {
  return businessDay(value, timeZone).slice(0, 7);
}

/**
 * The instants a range of days covers, both ends inclusive: from the first
 * moment of `from` to the last of `to`. Either may be left open. This is what
 * a "from – to" date filter means when the user types two days.
 */
export function businessRange(
  from?: string | null,
  to?: string | null,
  timeZone: string = BUSINESS_TIME_ZONE,
): { gte?: Date; lte?: Date } | undefined {
  const start = from && isIsoDay(from) ? businessDayStart(from, timeZone) : undefined;
  const end = to && isIsoDay(to) ? businessDayEnd(to, timeZone) : undefined;
  if (!start && !end) return undefined;
  return {
    ...(start ? { gte: start } : {}),
    ...(end ? { lte: end } : {}),
  };
}

/**
 * A day read from a query string, or null when it is not one. Either a day
 * ("2026-10-04") or an ISO timestamp, which is read as the day it falls on.
 * Anything else — "04/10/2026" is the 4th of October to a Saudi reader and the
 * 10th of April to `Date.parse` — is not guessed at.
 */
export function parseBusinessDay(
  value: string | null | undefined,
  timeZone: string = BUSINESS_TIME_ZONE,
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (isIsoDay(trimmed)) return trimmed;
  if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
  const day = businessDay(trimmed, timeZone);
  return day || null;
}

/**
 * Days from today until a date, on the calendar: 0 for today, 3 for three
 * days away, negative once it has passed. Not `Math.ceil` of a millisecond
 * difference, which turns on whatever hour the server happens to ask.
 */
export function businessDaysUntil(
  date: Date | string | number | null | undefined,
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): number {
  const day = businessDay(date, timeZone);
  if (!day) return Number.NaN;
  return businessDaysBetween(businessToday(now, timeZone), day);
}

/**
 * Whether a due date has passed. A date is due for its whole day: it is late
 * only once that day is over, which on the office's clock is at midnight in
 * Riyadh — not at 03:00 the next morning when the server's day turns over.
 */
export function isPastDue(
  due: Date | string | number | null | undefined,
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): boolean {
  const day = businessDay(due, timeZone);
  if (!day) return false;
  return day < businessToday(now, timeZone);
}

/** How many days late a due date is: 0 until it has passed. */
export function businessDaysOverdue(
  due: Date | string | number | null | undefined,
  now: Date | number = new Date(),
  timeZone: string = BUSINESS_TIME_ZONE,
): number {
  const day = businessDay(due, timeZone);
  if (!day) return 0;
  return Math.max(0, businessDaysBetween(day, businessToday(now, timeZone)));
}

/**
 * A day as the date-only value the database stores for it: midnight UTC.
 * What a contract's start, end and due date are written as, and so what a
 * query on those columns compares against.
 */
export function dateOnly(day: string): Date {
  const [year, month, date] = requireDay(day);
  return new Date(Date.UTC(year, month - 1, date));
}
