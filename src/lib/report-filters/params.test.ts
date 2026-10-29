/**
 * The filters a report reads from its query string: which ones, what counts
 * as one, and what a day means.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  FILTER_ID_KEYS,
  isFilterId,
  isoDay,
  readDayParam,
  readFilterIds,
  readReportWindow,
} from "@/lib/report-filters/params";

const reader = (query: string) => new URLSearchParams(query);

describe("record filters", () => {
  test("only the ones named are read", () => {
    const result = readFilterIds(
      reader("ownerId=owner-abc123&propertyId=prop_xyz789&other=1"),
    );
    assert.deepEqual(result, {
      ok: true,
      ids: { ownerId: "owner-abc123", propertyId: "prop_xyz789" },
    });
  });

  test("absent and empty are not filters", () => {
    assert.deepEqual(readFilterIds(reader("")), { ok: true, ids: {} });
    assert.deepEqual(readFilterIds(reader("ownerId=&unitId=")), {
      ok: true,
      ids: {},
    });
  });

  test("a value that cannot be a record id is refused by name", () => {
    assert.deepEqual(readFilterIds(reader("tenantId=short")), {
      ok: false,
      key: "tenantId",
    });
    assert.deepEqual(readFilterIds(reader("leaseId=a'; DROP TABLE x;--")), {
      ok: false,
      key: "leaseId",
    });
    assert.deepEqual(readFilterIds(reader("unitId=" + "x".repeat(65))), {
      ok: false,
      key: "unitId",
    });
  });

  test("a page asks only for the ones it uses", () => {
    // `agreementId` is not read by a report that has no agreements, so a stray
    // one in a shared link cannot fail the request.
    const result = readFilterIds(reader("ownerId=owner-abc123&agreementId=!"), [
      "ownerId",
    ]);
    assert.deepEqual(result, { ok: true, ids: { ownerId: "owner-abc123" } });
  });

  test("cuids and 24-hex ids both pass", () => {
    assert.ok(isFilterId("cmg0abcd1234efgh5678ijkl"));
    assert.ok(isFilterId("507f1f77bcf86cd799439011"));
    assert.ok(!isFilterId(""));
    assert.ok(!isFilterId("has space in it"));
    assert.ok(!isFilterId(42));
  });

  test("every key a filter bar can set is one a route can read", () => {
    assert.deepEqual([...FILTER_ID_KEYS].sort(), [
      "agreementId",
      "compoundId",
      "leaseId",
      "ownerId",
      "propertyId",
      "tenantId",
      "unitId",
    ]);
  });
});

describe("a day from the query string", () => {
  test("opens a window at the start of the day and closes it at the end", () => {
    // Riyadh's midnight is 21:00 UTC the evening before.
    assert.equal(
      readDayParam("2026-10-03", "start")?.toISOString(),
      "2026-10-02T21:00:00.000Z",
    );
    assert.equal(
      readDayParam("2026-10-03", "end")?.toISOString(),
      "2026-10-03T20:59:59.999Z",
    );
  });

  test("a window ending on a day takes in the whole of it", () => {
    const start = readDayParam("2026-10-03", "start")!;
    const end = readDayParam("2026-10-03", "end")!;
    // A payment received at 01:30 on the 3rd in Riyadh is 22:30 UTC on the 2nd:
    // inside the 3rd's window, not the 2nd's.
    assert.ok(new Date("2026-10-02T22:30:00.000Z") >= start);
    assert.ok(new Date("2026-10-02T22:30:00.000Z") <= end);
    // So is one at 23:30 that night, which is still the 3rd in UTC as well.
    assert.ok(new Date("2026-10-03T20:30:00.000Z") <= end);
    // 00:30 on the 4th in Riyadh (21:30 UTC) is the next window's.
    assert.ok(new Date("2026-10-03T21:30:00.000Z") > end);
  });

  test("a date-only value (midnight UTC) falls in its own day's window", () => {
    const stored = new Date("2026-10-03T00:00:00.000Z");
    assert.ok(stored >= readDayParam("2026-10-03", "start")!);
    assert.ok(stored <= readDayParam("2026-10-03", "end")!);
    assert.ok(stored > readDayParam("2026-10-02", "end")!);
    assert.ok(stored < readDayParam("2026-10-04", "start")!);
  });

  test("absent is undefined, not a default", () => {
    assert.equal(readDayParam(null, "start"), undefined);
    assert.equal(readDayParam("", "end"), undefined);
  });

  test("something that is not a date is null", () => {
    assert.equal(readDayParam("soon", "start"), null);
    assert.equal(readDayParam("2026-13-01", "start"), null);
  });

  test("a day that does not exist is null rather than the next month", () => {
    assert.equal(readDayParam("2026-02-31", "end"), null);
    assert.equal(readDayParam("2026-04-31", "start"), null);
    assert.ok(readDayParam("2028-02-29", "start"));
  });

  test("a full timestamp is taken as written", () => {
    assert.equal(
      readDayParam("2026-10-03T08:15:00.000Z", "end")?.toISOString(),
      "2026-10-03T08:15:00.000Z",
    );
  });

  test("isoDay is the calendar day in Riyadh", () => {
    assert.equal(isoDay(new Date("2026-10-03T20:59:59.999Z")), "2026-10-03");
    // 21:00 UTC is already the 4th there, and the server's own day is the 3rd.
    assert.equal(isoDay(new Date("2026-10-03T21:00:00.000Z")), "2026-10-04");
    assert.equal(isoDay("2026-10-04T00:00:00.000Z"), "2026-10-04");
  });

  test("a window's own ends read back as the days they were made from", () => {
    for (const day of ["2026-01-01", "2026-10-03", "2026-12-31"]) {
      assert.equal(isoDay(readDayParam(day, "start")!), day);
      assert.equal(isoDay(readDayParam(day, "end")!), day);
    }
  });
});

describe("the period a statement is read over", () => {
  // 21:30 UTC on the 3rd of October is 00:30 on the 4th in Riyadh.
  const justAfterMidnight = new Date("2026-10-03T21:30:00.000Z");

  test("is the year so far unless the request names its own", () => {
    const window = readReportWindow(reader(""), justAfterMidnight);
    assert.ok(window.ok);
    assert.equal(window.startDay, "2026-01-01");
    assert.equal(window.endDay, "2026-10-04");
    assert.equal(window.startDate.toISOString(), "2025-12-31T21:00:00.000Z");
    assert.equal(window.endDate.toISOString(), "2026-10-04T20:59:59.999Z");
  });

  test("the first of the year is the new year's on the night it turns over", () => {
    const window = readReportWindow(reader(""), new Date("2025-12-31T21:10:00Z"));
    assert.ok(window.ok);
    assert.equal(window.startDay, "2026-01-01");
    assert.equal(window.endDay, "2026-01-01");
  });

  test("takes in the whole of both ends", () => {
    const window = readReportWindow(
      reader("startDate=2026-09-01&endDate=2026-09-30"),
      justAfterMidnight,
    );
    assert.ok(window.ok);
    assert.equal(window.startDate.toISOString(), "2026-08-31T21:00:00.000Z");
    assert.equal(window.endDate.toISOString(), "2026-09-30T20:59:59.999Z");
  });

  test("a timestamp is read as the Riyadh day it falls on", () => {
    const window = readReportWindow(
      reader("startDate=2026-09-01T21:30:00.000Z&endDate=2026-09-30"),
    );
    assert.ok(window.ok);
    assert.equal(window.startDay, "2026-09-02");
  });

  test("refuses what is not a day, and a window that ends before it starts", () => {
    const bad = readReportWindow(reader("startDate=last-week"));
    assert.ok(!bad.ok);
    assert.equal(bad.message, "Invalid date range provided");
    const backwards = readReportWindow(
      reader("startDate=2026-09-30&endDate=2026-09-01"),
    );
    assert.ok(!backwards.ok);
    assert.equal(backwards.message, "End date must be after the start date");
    assert.ok(!readReportWindow(reader("endDate=2026-02-30")).ok);
  });

  test("one day is a window of that day", () => {
    const window = readReportWindow(
      reader("startDate=2026-10-04&endDate=2026-10-04"),
    );
    assert.ok(window.ok);
    assert.equal(window.startDay, window.endDay);
  });
});
