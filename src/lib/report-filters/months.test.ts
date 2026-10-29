/**
 * Month names come from the reader's language, in the Gregorian calendar and
 * Latin digits — on screen and in every download.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { monthLabel } from "@/lib/report-filters/months";

describe("month names", () => {
  test("English keeps the abbreviations the report always used", () => {
    assert.equal(monthLabel(1, 2026, "en"), "Jan");
    assert.equal(monthLabel(9, 2026, "en"), "Sep");
    assert.equal(monthLabel(1, 2026, "en", { withYear: true }), "Jan 2026");
  });

  test("the long style is what a printed month column uses", () => {
    assert.equal(
      monthLabel(1, 2026, "en", { withYear: true, style: "long" }),
      "January 2026",
    );
    assert.equal(
      monthLabel(10, 2026, "ar", { withYear: true, style: "long" }),
      "أكتوبر 2026",
    );
  });

  test("Arabic names the months in Arabic, with Latin digits", () => {
    assert.equal(monthLabel(1, 2026, "ar"), "يناير");
    assert.equal(monthLabel(10, 2026, "ar"), "أكتوبر");
    assert.equal(monthLabel(3, 2026, "ar", { withYear: true }), "مارس 2026");
  });

  test("Arabic is Gregorian, not Hijri", () => {
    // Left to the Saudi locale, some engines open on the Hijri calendar.
    for (let month = 1; month <= 12; month += 1) {
      const label = monthLabel(month, 2026, "ar", { withYear: true });
      assert.match(label, /2026$/, label);
    }
  });

  test("a language that no longer ships names its months in English", () => {
    // German, Spanish and French were removed on 2026-10-16; a stored code
    // must still print a month, not fail.
    assert.equal(monthLabel(3, 2026, "de", { withYear: true }), "Mar 2026");
  });

  test("every month of the year has its own name", () => {
    for (const language of ["en", "ar"]) {
      const names = new Set<string>();
      for (let month = 1; month <= 12; month += 1) {
        names.add(monthLabel(month, 2026, language));
      }
      assert.equal(names.size, 12, `${language} repeats a month name`);
    }
  });

  test("a language the product does not have falls back to English", () => {
    assert.equal(monthLabel(5, 2026, "xx"), "May");
  });

  test("the first of the month stays in its month in any time zone", () => {
    const zone = process.env.TZ;
    try {
      for (const tz of ["Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
        process.env.TZ = tz;
        assert.equal(monthLabel(12, 2026, "en", { withYear: true }), "Dec 2026");
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
