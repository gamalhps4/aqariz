/**
 * The office's calendar is Riyadh's, whatever clock the server keeps.
 *
 * Riyadh is UTC+3 all year, so the first three hours of every Riyadh day fall
 * on the PREVIOUS day in UTC. Everything that asked the server which day it is
 * — a spreadsheet's date column, "today", "overdue" — was a day behind for
 * exactly those hours. These tests put the clock on either side of Riyadh's
 * midnight and say which day it is.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  addBusinessDays,
  addBusinessMonths,
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessDaysBetween,
  businessDaysOverdue,
  businessDaysUntil,
  businessMonth,
  businessMonthRange,
  businessPresetRange,
  businessRange,
  businessToday,
  businessWeekRange,
  dateOnly,
  endOfBusinessDay,
  isDayPreset,
  isIsoDay,
  isPastDue,
  parseBusinessDay,
  pickedDay,
  startOfBusinessDay,
  trailingDays,
} from "@/lib/dates/business-day";

/** The 3rd's last Riyadh minute, and the 4th's first. */
const BEFORE_MIDNIGHT = new Date("2026-10-03T20:59:59.999Z");
const AT_MIDNIGHT = new Date("2026-10-03T21:00:00.000Z");

describe("the day an instant falls on", () => {
  test("2026-10-03T21:30Z is already the 4th in Riyadh", () => {
    assert.equal(businessDay(new Date("2026-10-03T21:30:00Z")), "2026-10-04");
    // What the server's own clock said, and the bug.
    assert.equal(
      new Date("2026-10-03T21:30:00Z").toISOString().slice(0, 10),
      "2026-10-03",
    );
  });

  test("turns over at Riyadh's midnight, to the millisecond", () => {
    assert.equal(businessDay(BEFORE_MIDNIGHT), "2026-10-03");
    assert.equal(businessDay(AT_MIDNIGHT), "2026-10-04");
  });

  test("a payment recorded between 00:00 and 02:59 exports with its own day", () => {
    for (const hour of ["00:00", "01:30", "02:59"]) {
      const recorded = new Date(`2026-10-04T${hour}:00+03:00`);
      assert.equal(businessDay(recorded), "2026-10-04", hour);
    }
    assert.equal(businessDay(new Date("2026-10-04T03:00:00+03:00")), "2026-10-04");
  });

  test("a date stored at midnight UTC is the day it was meant as", () => {
    // Contract dates and due dates are date-only values stored at 00:00Z,
    // which is 03:00 the same morning in Riyadh.
    assert.equal(businessDay(new Date("2026-10-04T00:00:00.000Z")), "2026-10-04");
    assert.equal(businessDay("2026-10-04T00:00:00.000Z"), "2026-10-04");
  });

  test("a string that is already a day is not converted", () => {
    assert.equal(businessDay("2026-10-04"), "2026-10-04");
    assert.equal(businessDay("2026-02-30"), "");
  });

  test("a missing or unreadable date is blank, not a throw", () => {
    assert.equal(businessDay(null), "");
    assert.equal(businessDay(undefined), "");
    assert.equal(businessDay(""), "");
    assert.equal(businessDay("not a date"), "");
    assert.equal(businessDay(new Date("nope")), "");
  });

  test("an instant given as a number, or with its own offset, reads the same", () => {
    assert.equal(businessDay(Date.parse("2026-10-03T21:30:00Z")), "2026-10-04");
    assert.equal(businessDay("2026-10-04T00:30:00+03:00"), "2026-10-04");
    assert.equal(businessDay("2026-10-03T23:30:00-05:00"), "2026-10-04");
  });

  test("does not depend on the zone the process runs in", () => {
    const before = process.env.TZ;
    try {
      for (const zone of ["America/Los_Angeles", "Asia/Dhaka", "UTC"]) {
        process.env.TZ = zone;
        assert.equal(
          businessDay(new Date("2026-10-03T21:30:00Z")),
          "2026-10-04",
          zone,
        );
        assert.equal(
          businessDayStart("2026-10-04").toISOString(),
          "2026-10-03T21:00:00.000Z",
          zone,
        );
        assert.equal(businessToday(AT_MIDNIGHT), "2026-10-04", zone);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});

describe("today and the edges of a day", () => {
  test("today follows the clock it is given", () => {
    assert.equal(businessToday(BEFORE_MIDNIGHT), "2026-10-03");
    assert.equal(businessToday(AT_MIDNIGHT), "2026-10-04");
  });

  test("a day runs from midnight to the last millisecond, Riyadh time", () => {
    assert.equal(
      businessDayStart("2026-10-04").toISOString(),
      "2026-10-03T21:00:00.000Z",
    );
    assert.equal(
      businessDayEnd("2026-10-04").toISOString(),
      "2026-10-04T20:59:59.999Z",
    );
  });

  test("the day an instant is in, as a pair of instants", () => {
    assert.equal(
      startOfBusinessDay(new Date("2026-10-03T21:30:00Z")).toISOString(),
      "2026-10-03T21:00:00.000Z",
    );
    assert.equal(
      endOfBusinessDay(new Date("2026-10-03T21:30:00Z")).toISOString(),
      "2026-10-04T20:59:59.999Z",
    );
    // The same instants bracket the moment itself.
    const now = new Date("2026-10-03T21:30:00Z");
    assert.ok(startOfBusinessDay(now) <= now && now <= endOfBusinessDay(now));
  });

  test("consecutive days leave no gap and no overlap", () => {
    const end = businessDayEnd("2026-10-03").getTime();
    const next = businessDayStart("2026-10-04").getTime();
    assert.equal(next - end, 1);
  });

  test("a day that is not one is refused, not guessed at", () => {
    assert.throws(() => businessDayStart("2026-13-01"), RangeError);
    assert.throws(() => businessDayEnd("tomorrow"), RangeError);
    assert.throws(() => addBusinessDays("2026-02-30", 1), RangeError);
  });

  test("a zone that changes its clock still gets the right midnight", () => {
    // New York springs forward on 8 March 2026: that day is 23 hours long.
    const zone = "America/New_York";
    assert.equal(
      businessDayStart("2026-03-08", zone).toISOString(),
      "2026-03-08T05:00:00.000Z",
    );
    assert.equal(
      businessDayStart("2026-03-09", zone).toISOString(),
      "2026-03-09T04:00:00.000Z",
    );
    assert.equal(
      businessDayEnd("2026-03-08", zone).toISOString(),
      "2026-03-09T03:59:59.999Z",
    );
    assert.equal(businessDay(new Date("2026-03-09T03:59:59.999Z"), zone), "2026-03-08");
    assert.equal(businessDay(new Date("2026-03-09T04:00:00.000Z"), zone), "2026-03-09");
  });
});

describe("calendar arithmetic", () => {
  test("adds and subtracts days across month ends and leap days", () => {
    assert.equal(addBusinessDays("2026-10-31", 1), "2026-11-01");
    assert.equal(addBusinessDays("2026-12-31", 1), "2027-01-01");
    assert.equal(addBusinessDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addBusinessDays("2027-02-28", 1), "2027-03-01");
    assert.equal(addBusinessDays("2026-03-01", -1), "2026-02-28");
    assert.equal(addBusinessDays("2026-10-04", 0), "2026-10-04");
  });

  test("counts whole days between two days", () => {
    assert.equal(businessDaysBetween("2026-10-04", "2026-10-04"), 0);
    assert.equal(businessDaysBetween("2026-10-04", "2026-11-03"), 30);
    assert.equal(businessDaysBetween("2026-10-04", "2026-10-01"), -3);
    assert.equal(businessDaysBetween("2027-12-31", "2028-03-01"), 61);
  });

  test("a month runs from its first day to its last", () => {
    assert.deepEqual(businessMonthRange("2026-10-04"), {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    assert.deepEqual(businessMonthRange("2026-02-10"), {
      from: "2026-02-01",
      to: "2026-02-28",
    });
    assert.deepEqual(businessMonthRange("2028-02-10"), {
      from: "2028-02-01",
      to: "2028-02-29",
    });
    assert.deepEqual(businessMonthRange("2026-12-31"), {
      from: "2026-12-01",
      to: "2026-12-31",
    });
  });

  test("a week starts on Sunday, as a Saudi calendar does", () => {
    // 4 October 2026 is a Sunday.
    assert.deepEqual(businessWeekRange("2026-10-04"), {
      from: "2026-10-04",
      to: "2026-10-10",
    });
    // 3 October is the Saturday that closes the week before.
    assert.deepEqual(businessWeekRange("2026-10-03"), {
      from: "2026-09-27",
      to: "2026-10-03",
    });
    assert.deepEqual(businessWeekRange("2026-10-08"), {
      from: "2026-10-04",
      to: "2026-10-10",
    });
    // Monday-first, for a caller that asks.
    assert.deepEqual(businessWeekRange("2026-10-04", 1), {
      from: "2026-09-28",
      to: "2026-10-04",
    });
  });

  test("a trailing window ends on, and includes, the day it is given", () => {
    assert.deepEqual(trailingDays(30, "2026-10-04"), {
      from: "2026-09-05",
      to: "2026-10-04",
    });
    assert.deepEqual(trailingDays(1, "2026-10-04"), {
      from: "2026-10-04",
      to: "2026-10-04",
    });
  });

  test("the month of an instant is the office's month, not the server's", () => {
    // 31 October, 22:00 UTC is already 1 November in Riyadh.
    assert.equal(businessMonth(new Date("2026-10-31T22:00:00Z")), "2026-11");
    assert.equal(businessMonth("2026-10-31"), "2026-10");
  });

  test("a stored date-only value round-trips through the day it names", () => {
    const stored = dateOnly("2026-10-04");
    assert.equal(stored.toISOString(), "2026-10-04T00:00:00.000Z");
    assert.equal(businessDay(stored), "2026-10-04");
  });
});

describe("today, this week, this month", () => {
  test("are read on the office's calendar", () => {
    // 21:30 UTC on Saturday 3 October is already Sunday the 4th in Riyadh.
    const now = new Date("2026-10-03T21:30:00Z");
    assert.deepEqual(businessPresetRange("today", now), {
      from: "2026-10-04",
      to: "2026-10-04",
    });
    assert.deepEqual(businessPresetRange("week", now), {
      from: "2026-10-04",
      to: "2026-10-10",
    });
    assert.deepEqual(businessPresetRange("month", now), {
      from: "2026-10-01",
      to: "2026-10-31",
    });
    // A minute earlier it is still the Saturday that closes the previous week
    // and the same month.
    const before = new Date("2026-10-03T20:59:00Z");
    assert.deepEqual(businessPresetRange("week", before), {
      from: "2026-09-27",
      to: "2026-10-03",
    });
  });

  test("only the three names are presets", () => {
    assert.equal(isDayPreset("today"), true);
    assert.equal(isDayPreset("week"), true);
    assert.equal(isDayPreset("month"), true);
    assert.equal(isDayPreset("THIS_WEEK"), false);
    assert.equal(isDayPreset(null), false);
  });
});

describe("a from-to filter", () => {
  test("covers both whole days, on the office's clock", () => {
    const range = businessRange("2026-10-01", "2026-10-03");
    assert.equal(range?.gte?.toISOString(), "2026-09-30T21:00:00.000Z");
    assert.equal(range?.lte?.toISOString(), "2026-10-03T20:59:59.999Z");
  });

  test("a payment at 01:30 on the last day is still inside it", () => {
    const range = businessRange("2026-10-01", "2026-10-03")!;
    // 01:30 on the 3rd in Riyadh is 22:30 on the 2nd UTC — inside either way —
    // but 23:30 on the 3rd Riyadh is 20:30 UTC on the 3rd.
    assert.ok(new Date("2026-10-03T23:30:00+03:00") <= range.lte!);
    // The first minute of the 4th is outside.
    assert.ok(new Date("2026-10-04T00:00:00+03:00") > range.lte!);
  });

  test("either end may be left open, or both", () => {
    assert.deepEqual(Object.keys(businessRange("2026-10-01", null) ?? {}), ["gte"]);
    assert.deepEqual(Object.keys(businessRange(undefined, "2026-10-03") ?? {}), ["lte"]);
    assert.equal(businessRange(), undefined);
    assert.equal(businessRange("", "garbage"), undefined);
  });

  test("a day typed into a filter is read as a day", () => {
    assert.equal(parseBusinessDay("2026-10-04"), "2026-10-04");
    assert.equal(parseBusinessDay(" 2026-10-04 "), "2026-10-04");
    assert.equal(parseBusinessDay("2026-10-03T21:30:00Z"), "2026-10-04");
    assert.equal(parseBusinessDay("04/10/2026"), null);
    assert.equal(parseBusinessDay(""), null);
    assert.equal(parseBusinessDay(null), null);
    assert.equal(isIsoDay("2026-10-04"), true);
    assert.equal(isIsoDay("2026-10-4"), false);
    assert.equal(isIsoDay(20261004), false);
  });
});

describe("due and overdue", () => {
  /** Rent due on the 3rd, stored as a date-only value. */
  const due = new Date("2026-10-03T00:00:00.000Z");

  test("is not late during its own day", () => {
    assert.equal(isPastDue(due, new Date("2026-10-03T08:00:00Z")), false);
    // 23:59 in Riyadh, the last minute of the due day.
    assert.equal(isPastDue(due, BEFORE_MIDNIGHT), false);
    assert.equal(businessDaysOverdue(due, BEFORE_MIDNIGHT), 0);
  });

  test("is late from Riyadh's midnight, not from 03:00 the next morning", () => {
    assert.equal(isPastDue(due, AT_MIDNIGHT), true);
    assert.equal(isPastDue(due, new Date("2026-10-03T21:30:00Z")), true);
    assert.equal(businessDaysOverdue(due, new Date("2026-10-03T21:30:00Z")), 1);
    // The server's own day would still have called it on time until 00:00Z.
    assert.equal(
      new Date("2026-10-03T21:30:00Z").toISOString().slice(0, 10) > "2026-10-03",
      false,
    );
  });

  test("counts the days it is late by on the calendar", () => {
    const now = new Date("2026-10-13T10:00:00Z");
    assert.equal(businessDaysOverdue(due, now), 10);
    assert.equal(businessDaysOverdue(due, new Date("2026-10-13T21:30:00Z")), 11);
  });

  test("a date in the future is never overdue", () => {
    assert.equal(isPastDue("2026-12-01", AT_MIDNIGHT), false);
    assert.equal(businessDaysOverdue("2026-12-01", AT_MIDNIGHT), 0);
  });

  test("no due date, or an unreadable one, is not overdue", () => {
    assert.equal(isPastDue(null), false);
    assert.equal(isPastDue("garbage"), false);
    assert.equal(businessDaysOverdue(undefined), 0);
  });

  test("days until are calendar days, whatever hour it is asked", () => {
    const end = new Date("2026-10-11T00:00:00.000Z");
    assert.equal(businessDaysUntil(end, new Date("2026-10-03T00:30:00Z")), 8);
    assert.equal(businessDaysUntil(end, new Date("2026-10-03T20:59:00Z")), 8);
    // From 00:00 on the 4th in Riyadh it is 7 days to go.
    assert.equal(businessDaysUntil(end, AT_MIDNIGHT), 7);
    assert.equal(businessDaysUntil(end, new Date("2026-10-11T10:00:00Z")), 0);
    assert.equal(businessDaysUntil(end, new Date("2026-10-12T10:00:00Z")), -1);
    assert.ok(Number.isNaN(businessDaysUntil(null)));
  });
});

describe("the day a date picker returns", () => {
  test("is the day built from, whatever the zone: local fields, not UTC", () => {
    // A calendar control returns LOCAL midnight. In a browser on Riyadh time
    // that is 21:00 UTC the evening before, which `toISOString().split("T")[0]`
    // read as the day BEFORE the one clicked.
    assert.equal(pickedDay(new Date(2026, 9, 4)), "2026-10-04");
    assert.equal(pickedDay(new Date(2026, 9, 4, 23, 59)), "2026-10-04");
    assert.equal(pickedDay(new Date(2026, 0, 1)), "2026-01-01");
    assert.equal(pickedDay(new Date(2026, 11, 31)), "2026-12-31");
  });

  test("a Riyadh-midnight instant read on a Riyadh clock is the day it starts", () => {
    // The instant a Riyadh browser builds for "4 October": the Riyadh day of
    // that instant is the same day the picker showed.
    assert.equal(businessDay(new Date("2026-10-03T21:00:00.000Z")), "2026-10-04");
  });

  test("nothing or an invalid date is no day", () => {
    assert.equal(pickedDay(null), "");
    assert.equal(pickedDay(undefined), "");
    assert.equal(pickedDay(new Date("garbage")), "");
  });
});

describe("months on the calendar", () => {
  test("add and subtract whole months", () => {
    assert.equal(addBusinessMonths("2026-10-01", 1), "2026-11-01");
    assert.equal(addBusinessMonths("2026-10-01", -11), "2025-11-01");
    assert.equal(addBusinessMonths("2026-10-01", 3), "2027-01-01");
    assert.equal(addBusinessMonths("2026-01-15", 0), "2026-01-15");
  });

  test("a day the month does not have is its last day", () => {
    assert.equal(addBusinessMonths("2026-01-31", 1), "2026-02-28");
    assert.equal(addBusinessMonths("2028-01-31", 1), "2028-02-29");
    assert.equal(addBusinessMonths("2026-03-31", -1), "2026-02-28");
    assert.equal(addBusinessMonths("2026-08-31", 1), "2026-09-30");
  });

  test("a trailing year of months starts where the dashboard expects", () => {
    const first = businessMonthRange("2026-10-04").from;
    assert.equal(addBusinessMonths(first, -11), "2025-11-01");
    assert.equal(addBusinessMonths(first, -12), "2025-10-01");
  });
});
