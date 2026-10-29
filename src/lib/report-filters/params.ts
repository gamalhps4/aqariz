/**
 * PropertyPro - The filters a report takes from its query string
 *
 * Every report page narrows its figures by the same handful of things — an
 * owner, a compound, a building, a unit, a tenant, a contract, an agreement,
 * a status, a period — and every report endpoint reads them from the query
 * string. They are named, checked and read once, here, so the page that sends
 * them and the route that receives them cannot drift apart on a name.
 *
 * No database and no session: the page imports this too.
 */

import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessToday,
  isIsoDay,
  parseBusinessDay,
} from "@/lib/dates/business-day";

/** The record filters, by their query-string names. */
export const FILTER_ID_KEYS = [
  "ownerId",
  "compoundId",
  "propertyId",
  "unitId",
  "tenantId",
  "leaseId",
  "agreementId",
] as const;

export type FilterIdKey = (typeof FILTER_ID_KEYS)[number];

/** The record filters a request carried — only the ones it named. */
export type FilterIds = Partial<Record<FilterIdKey, string>>;

/**
 * What a record id looks like. The same shape `isValidObjectId` accepts for
 * a record named in the address (cuids, and 24-hex ids from older links):
 * enough to refuse junk before it reaches the database, without pretending to
 * know that the record exists. One that does not exist, or that the reader may
 * not see, narrows the report to nothing — it is never an error.
 */
const RECORD_ID = /^[A-Za-z0-9_-]{8,64}$/;

export function isFilterId(value: unknown): value is string {
  return typeof value === "string" && RECORD_ID.test(value);
}

/** Anything that reads like `URLSearchParams.get`. */
export interface ParamReader {
  get(name: string): string | null;
}

export type FilterIdsResult =
  | { ok: true; ids: FilterIds }
  | { ok: false; key: FilterIdKey };

/**
 * The record filters named in a query string.
 *
 * Absent and empty mean "not filtered". A value that is present but cannot be
 * a record id is refused with the name of the filter, so the route can say
 * which one — rather than quietly dropping it and returning every row.
 */
export function readFilterIds(
  params: ParamReader,
  keys: readonly FilterIdKey[] = FILTER_ID_KEYS,
): FilterIdsResult {
  const ids: FilterIds = {};
  for (const key of keys) {
    const raw = params.get(key);
    if (raw === null || raw === "") continue;
    if (!isFilterId(raw)) return { ok: false, key };
    ids[key] = raw;
  }
  return { ok: true, ids };
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * A day from the query string, as the instant a report window opens or closes
 * on it.
 *
 * "2026-10-03" is a calendar day, and a window that ends on it takes in the
 * whole of it: the last instant, not midnight at its start. Days are the
 * office's — Riyadh's — so a payment taken at 01:30 on the 3rd is in the 3rd's
 * report; a date-only value (stored at midnight UTC, 03:00 there) falls in the
 * same day's window. A full timestamp is taken as written.
 *
 * `undefined` when the request did not carry one, `null` when it carried
 * something that is not a date — a day that does not exist ("2026-02-31")
 * included, which `Date` would otherwise roll into March.
 */
export function readDayParam(
  raw: string | null,
  edge: "start" | "end",
): Date | null | undefined {
  if (raw === null || raw === "") return undefined;

  if (DAY.test(raw)) {
    // A day that does not exist ("2026-02-31") is refused, not rolled over.
    if (!isIsoDay(raw)) return null;
    return edge === "start" ? businessDayStart(raw) : businessDayEnd(raw);
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** "2026-10-03" — the calendar day an instant falls on, on the office's calendar. */
export function isoDay(value: Date | string): string {
  return businessDay(value);
}

export type ReportWindow =
  | {
      ok: true;
      startDate: Date;
      endDate: Date;
      /** The days the window names, "2026-01-01" — what a file says it covers. */
      startDay: string;
      endDay: string;
    }
  | { ok: false; message: string };

/**
 * The period a statement or report is read over, from `startDate` and
 * `endDate`: the year so far unless the request names its own, both ends
 * inclusive and cut on the office's calendar — the first instant of the first
 * day to the last instant of the last, so "to the 31st" takes in the whole of
 * the 31st and a payment taken at 01:30 on the 1st is in the 1st's report.
 *
 * A value that is not a day (or a timestamp, read as the day it falls on) is
 * refused, and so is a window that ends before it starts.
 */
export function readReportWindow(
  params: ParamReader,
  now: Date = new Date(),
): ReportWindow {
  const startParam = params.get("startDate");
  const endParam = params.get("endDate");
  const today = businessToday(now);
  const startDay = startParam
    ? parseBusinessDay(startParam)
    : `${today.slice(0, 4)}-01-01`;
  const endDay = endParam ? parseBusinessDay(endParam) : today;
  if (!startDay || !endDay) {
    return { ok: false, message: "Invalid date range provided" };
  }
  if (endDay < startDay) {
    return { ok: false, message: "End date must be after the start date" };
  }
  return {
    ok: true,
    startDate: businessDayStart(startDay),
    endDate: businessDayEnd(endDay),
    startDay,
    endDay,
  };
}
