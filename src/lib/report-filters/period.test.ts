/**
 * The ready-made periods a report offers, and the period it opens on.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PERIOD_PRESETS,
  isReversedPeriod,
  isPeriodPreset,
  localDay,
  presetOfRange,
  presetRange,
  yearToDate,
} from "@/lib/report-filters/period";

// A Saturday in the middle of Q4, so no range sits on a boundary.
const now = new Date(2026, 9, 3, 14, 30);

describe("the ready-made ranges", () => {
  test("this month runs from the 1st to today", () => {
    assert.deepEqual(presetRange("this-month", now), {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
  });

  test("last month is the whole of the month before", () => {
    assert.deepEqual(presetRange("last-month", now), {
      startDate: "2026-09-01",
      endDate: "2026-09-30",
    });
  });

  test("last month reaches back over a new year", () => {
    assert.deepEqual(presetRange("last-month", new Date(2027, 0, 15)), {
      startDate: "2026-12-01",
      endDate: "2026-12-31",
    });
  });

  test("this quarter runs from its first day to today", () => {
    assert.deepEqual(presetRange("this-quarter", now), {
      startDate: "2026-10-01",
      endDate: "2026-10-03",
    });
    assert.deepEqual(presetRange("this-quarter", new Date(2026, 4, 20)), {
      startDate: "2026-04-01",
      endDate: "2026-05-20",
    });
  });

  test("this year is the year so far, last year the whole of it", () => {
    assert.deepEqual(presetRange("this-year", now), {
      startDate: "2026-01-01",
      endDate: "2026-10-03",
    });
    assert.deepEqual(presetRange("last-year", now), {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
    });
  });

  test("the period most reports open on is the year so far", () => {
    assert.deepEqual(yearToDate(now), presetRange("this-year", now));
  });

  test("a day is the reader's own calendar day", () => {
    assert.equal(localDay(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
    assert.equal(localDay(new Date(2026, 11, 31, 0, 0)), "2026-12-31");
  });
});

describe("which range the dates in the boxes are", () => {
  test("every ready-made range recognises itself", () => {
    // The middle month of a quarter, where no two ranges are the same days.
    const midQuarter = new Date(2026, 10, 14);
    for (const preset of PERIOD_PRESETS) {
      const { startDate, endDate } = presetRange(preset, midQuarter);
      assert.equal(presetOfRange(startDate, endDate, midQuarter), preset);
    }
  });

  test("in a quarter's first month, this month and this quarter are the same days", () => {
    // Read as the first of the two the selector lists.
    const { startDate, endDate } = presetRange("this-quarter", now);
    assert.equal(presetOfRange(startDate, endDate, now), "this-month");
  });

  test("dates that are none of them are a custom range", () => {
    assert.equal(presetOfRange("2026-02-01", "2026-02-20", now), null);
    assert.equal(presetOfRange("", "", now), null);
  });

  test("only the names the selector offers are presets", () => {
    assert.ok(isPeriodPreset("this-quarter"));
    assert.ok(!isPeriodPreset("custom"));
    assert.ok(!isPeriodPreset(undefined));
  });
});

describe("a period that runs backwards", () => {
  test("is one whose start is after its end", () => {
    assert.ok(isReversedPeriod("2026-10-05", "2026-10-01"));
    assert.ok(!isReversedPeriod("2026-10-01", "2026-10-05"));
    assert.ok(!isReversedPeriod("2026-10-01", "2026-10-01"));
  });

  test("is not one that is still being filled in", () => {
    assert.ok(!isReversedPeriod("", "2026-10-01"));
    assert.ok(!isReversedPeriod("2026-10-05", ""));
  });
});
