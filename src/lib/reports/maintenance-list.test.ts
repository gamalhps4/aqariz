/**
 * The maintenance screen and the file cut from it agree.
 *
 * Both filter, order and age the requests by the rules in one module. The
 * screen's "this week" and "this month" options once matched nothing, so they
 * showed every request; "overdue" was counted in 24-hour blocks from the
 * minute a request was raised on whatever clock the browser had.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAINTENANCE_SLA_DAYS,
  isUrgentRequest,
  maintenanceDaysOverdue,
  sortMaintenance,
} from "@/lib/reports/maintenance-list";

/** 4 October, 12:00 in Riyadh. */
const NOW = new Date("2026-10-04T09:00:00Z");

describe("how overdue a request is", () => {
  const raised = (iso: string, priority = "medium", status = "submitted") => ({
    createdAt: new Date(iso),
    priority,
    status,
  });

  test("is the days open beyond what the priority allows", () => {
    // Medium: 7 days. Raised on the 20th of September, it has been open 14.
    assert.equal(maintenanceDaysOverdue(raised("2026-09-20T09:00:00Z"), NOW), 7);
    // Emergency: 1 day. Raised on the 1st of October, open 3: 2 overdue.
    assert.equal(
      maintenanceDaysOverdue(raised("2026-10-01T09:00:00Z", "emergency"), NOW),
      2,
    );
    assert.equal(MAINTENANCE_SLA_DAYS.emergency, 1);
    assert.equal(MAINTENANCE_SLA_DAYS.low, 14);
  });

  test("is nothing while it is within its allowance, and for a finished request", () => {
    assert.equal(maintenanceDaysOverdue(raised("2026-09-27T09:00:00Z"), NOW), 0);
    assert.equal(
      maintenanceDaysOverdue(raised("2026-08-01T09:00:00Z", "low", "completed"), NOW),
      0,
    );
    assert.equal(
      maintenanceDaysOverdue(raised("2026-08-01T09:00:00Z", "low", "cancelled"), NOW),
      0,
    );
  });

  test("counts calendar days on the office's calendar", () => {
    // Raised at 23:30 Riyadh on the 27th (20:30 UTC), read at 00:30 on the 4th:
    // the 27th to the 4th is 7 days — within a medium request's allowance —
    // even though it is only 6 days and 1 hour of clock time.
    const lateRaised = raised("2026-09-27T20:30:00Z");
    assert.equal(
      maintenanceDaysOverdue(lateRaised, new Date("2026-10-03T21:30:00Z")),
      0,
    );
    // One day later it is 8 days open: a day over.
    assert.equal(
      maintenanceDaysOverdue(lateRaised, new Date("2026-10-04T21:30:00Z")),
      1,
    );
  });

  test("missing data is not overdue", () => {
    assert.equal(
      maintenanceDaysOverdue({ createdAt: null, priority: "high", status: "submitted" }),
      0,
    );
    assert.equal(
      maintenanceDaysOverdue({ createdAt: "garbage", priority: "high", status: "submitted" }),
      0,
    );
  });
});

describe("what urgent means", () => {
  test("a high or emergency request that is still open", () => {
    assert.equal(isUrgentRequest({ priority: "high", status: "submitted" }), true);
    assert.equal(isUrgentRequest({ priority: "emergency", status: "in_progress" }), true);
    assert.equal(isUrgentRequest({ priority: "emergency", status: "completed" }), false);
    assert.equal(isUrgentRequest({ priority: "medium", status: "submitted" }), false);
    assert.equal(isUrgentRequest({ priority: undefined, status: "submitted" }), false);
  });
});

describe("the order the screen sorts in", () => {
  const rows = [
    { id: "a", title: "Boiler", priority: "low", status: "assigned", createdAt: "2026-09-01T00:00:00Z", estimatedCost: 300, actualCost: null },
    { id: "b", title: "Aircon", priority: "emergency", status: "submitted", createdAt: "2026-09-03T00:00:00Z", estimatedCost: null, actualCost: 900 },
    { id: "c", title: "Door", priority: "high", status: "completed", createdAt: "2026-09-02T00:00:00Z", estimatedCost: 100, actualCost: 80 },
  ];
  const ids = (sorted: Array<{ id: string }>) => sorted.map((row) => row.id);

  test("by the day raised, newest first by default", () => {
    assert.deepEqual(ids(sortMaintenance(rows, "createdAt", "desc")), ["b", "c", "a"]);
    assert.deepEqual(ids(sortMaintenance(rows, undefined, undefined)), ["b", "c", "a"]);
    assert.deepEqual(ids(sortMaintenance(rows, "createdAt", "asc")), ["a", "c", "b"]);
  });

  test("by priority, emergency first when descending", () => {
    assert.deepEqual(ids(sortMaintenance(rows, "priority", "desc")), ["b", "c", "a"]);
    assert.deepEqual(ids(sortMaintenance(rows, "priority", "asc")), ["a", "c", "b"]);
  });

  test("by title, status and cost — the estimate, or the actual when there is none", () => {
    assert.deepEqual(ids(sortMaintenance(rows, "title", "asc")), ["b", "a", "c"]);
    assert.deepEqual(ids(sortMaintenance(rows, "status", "asc")), ["a", "c", "b"]);
    // Costs: a 300, b 900 (actual), c 100.
    assert.deepEqual(ids(sortMaintenance(rows, "cost", "desc")), ["b", "a", "c"]);
  });

  test("equal values keep the newest first", () => {
    const tied = [
      { id: "old", title: "Same", priority: "low", status: "submitted", createdAt: "2026-09-01T00:00:00Z" },
      { id: "new", title: "Same", priority: "low", status: "submitted", createdAt: "2026-09-05T00:00:00Z" },
    ];
    assert.deepEqual(ids(sortMaintenance(tied, "title", "asc")), ["new", "old"]);
  });

  test("leaves the rows it was given as they were", () => {
    const before = ids(rows);
    sortMaintenance(rows, "title", "asc");
    assert.deepEqual(ids(rows), before);
  });
});
