/**
 * When exactly, in Saudi time.
 *
 * The console printed the date alone, exported UTC without saying so, and its
 * date filter compared against `new Date("2026-10-31")` — midnight UTC at the
 * START of the last day — so everything done on the day a range ended was
 * left out. Times are Riyadh time with seconds; a day range is whole Riyadh
 * days, the last one included.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  auditDateRange,
  defaultAuditStartDay,
  formatAuditDateTime,
  formatAuditExportTimestamp,
  isoDayInZone,
  zonedDayStart,
} from "@/lib/audit/time";

describe("a time on screen", () => {
  test("is Riyadh time (UTC+3), day first, with seconds", () => {
    assert.equal(formatAuditDateTime("2026-10-03T12:42:07.000Z"), "03/10/2026 15:42:07");
  });

  test("an evening in UTC is already tomorrow in Riyadh", () => {
    assert.equal(formatAuditDateTime(new Date("2026-10-31T21:30:05Z")), "01/11/2026 00:30:05");
  });

  test("a missing or unreadable time shows a dash, not 'Invalid Date'", () => {
    assert.equal(formatAuditDateTime(null), "—");
    assert.equal(formatAuditDateTime("not a date"), "—");
  });
});

describe("a time in an export", () => {
  test("is sortable, Riyadh time with seconds", () => {
    assert.equal(formatAuditExportTimestamp("2026-10-03T12:42:07.000Z"), "2026-10-03 15:42:07");
    assert.equal(formatAuditExportTimestamp(undefined), "");
  });
});

describe("a day range", () => {
  test("starts at Riyadh midnight of the first day", () => {
    assert.equal(zonedDayStart("2026-10-01")?.toISOString(), "2026-09-30T21:00:00.000Z");
  });

  test("ends at Riyadh midnight AFTER the last day: the last day counts in full", () => {
    const range = auditDateRange("2026-10-01", "2026-10-31");
    assert.equal(range.gte?.toISOString(), "2026-09-30T21:00:00.000Z");
    assert.equal(range.lt?.toISOString(), "2026-10-31T21:00:00.000Z");
    // 23:59:59 on the 31st, Riyadh time, is inside it…
    const lastSecond = new Date("2026-10-31T20:59:59.000Z");
    assert.ok(lastSecond >= range.gte! && lastSecond < range.lt!);
    // …and so is the afternoon the old filter dropped.
    const afternoon = new Date("2026-10-31T11:00:00.000Z");
    assert.ok(afternoon < range.lt!);
    // Midnight that ends the 31st is not.
    assert.ok(!(new Date("2026-10-31T21:00:00.000Z") < range.lt!));
  });

  test("one day is that whole day", () => {
    const range = auditDateRange("2026-10-03", "2026-10-03");
    assert.equal(range.lt!.getTime() - range.gte!.getTime(), 24 * 60 * 60 * 1000);
  });

  test("either end may be missing, and an unreadable day is ignored", () => {
    assert.deepEqual(auditDateRange(null, null), {});
    assert.equal(auditDateRange("2026-10-01", null).lt, undefined);
    assert.equal(auditDateRange(null, "2026-13-45").lt, undefined);
    assert.equal(zonedDayStart("yesterday"), null);
  });

  test("the month's end and the year's end roll over", () => {
    assert.equal(auditDateRange(null, "2026-12-31").lt?.toISOString(), "2026-12-31T21:00:00.000Z");
    assert.equal(auditDateRange(null, "2028-02-28").lt?.toISOString(), "2028-02-28T21:00:00.000Z");
  });
});

describe("the default window", () => {
  test("is the last 30 days, today included, by the Riyadh calendar", () => {
    const now = new Date("2026-10-03T22:30:00Z"); // already 4 October in Riyadh
    assert.equal(isoDayInZone(now), "2026-10-04");
    assert.equal(defaultAuditStartDay(now), "2026-09-05");
  });
});
