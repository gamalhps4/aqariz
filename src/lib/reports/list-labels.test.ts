/**
 * A list's file words its codes as its screen does.
 *
 * The rows hold "pending_signature", "in_progress", "move_in"; an export that
 * printed them as they are read "move_in" in the middle of an Arabic page.
 * Every code a list can hold has to reach a catalogue entry in every
 * language, or the file prints the code.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { translations } from "@/locales";
import {
  assignmentText,
  expiryUrgency,
  expiryUrgencyText,
  inspectionConditionText,
  inspectionStatusText,
  inspectionTypeText,
  leaseStatusText,
  propertyStatusText,
  responseTimeText,
  translatorFor,
  unitStatusText,
} from "@/lib/reports/list-labels";
import { REPORT_LANGUAGES } from "@/lib/reports/labels";
import { LeaseStatus } from "@/types";

const english = translatorFor("en");
const arabic = translatorFor("ar");

/** Whether a key has words in every language the product ships. */
const worded = (key: string) =>
  REPORT_LANGUAGES.every((language) => Boolean(translations[key]?.[language]));

describe("every stored code has words in every language", () => {
  test("a contract's status — pending_signature included", () => {
    for (const status of Object.values(LeaseStatus)) {
      assert.ok(worded(`leases.status.${status}`), status);
    }
  });

  test("a building's and a unit's status", () => {
    for (const status of ["available", "occupied", "maintenance", "unavailable"]) {
      assert.ok(worded(`properties.status.${status}`), `building ${status}`);
      assert.ok(worded(`units.status.${status}`), `unit ${status}`);
    }
  });

  test("an inspection's type, status and condition", () => {
    for (const key of [
      "types.moveIn",
      "types.moveOut",
      "types.routine",
      "types.maintenance",
      "status.scheduled",
      "status.inProgress",
      "status.completed",
      "status.cancelled",
      "conditions.excellent",
      "conditions.good",
      "conditions.fair",
      "conditions.poor",
    ]) {
      assert.ok(worded(`inspections.${key}`), key);
    }
  });

  test("how urgent an expiring contract is, how long an emergency has been open", () => {
    for (const level of ["critical", "warning", "upcoming"]) {
      assert.ok(worded(`leases.expiring.urgency.${level}`), level);
    }
    for (const level of ["normal", "overdue", "critical", "completed", "activeStatus"]) {
      assert.ok(worded(`maintenance.emergency.list.filters.${level}`), level);
    }
    assert.ok(worded("maintenance.labels.unassigned"));
    assert.ok(worded("maintenance.emergency.list.filters.assignedFilter"));
  });
});

describe("a code is worded as its screen words it", () => {
  test("in English", () => {
    assert.equal(leaseStatusText("pending_signature", english), "Awaiting signature");
    assert.equal(leaseStatusText("active", english), "Active");
    assert.equal(propertyStatusText("occupied", english), "Occupied");
    assert.equal(unitStatusText("unavailable", english), "Unavailable");
    assert.equal(inspectionTypeText("move_in", english), "Move-In");
    assert.equal(inspectionStatusText("in_progress", english), "In Progress");
    assert.equal(inspectionConditionText("excellent", english), "Excellent");
  });

  test("in Arabic — never as the code", () => {
    assert.equal(
      leaseStatusText("pending_signature", arabic),
      translations["leases.status.pending_signature"].ar,
    );
    assert.equal(leaseStatusText("active", arabic), translations["leases.status.active"].ar);
    const words = [
      leaseStatusText("renewed", arabic),
      propertyStatusText("maintenance", arabic),
      unitStatusText("occupied", arabic),
      inspectionTypeText("move_out", arabic),
      inspectionStatusText("in_progress", arabic),
      inspectionConditionText("poor", arabic),
      expiryUrgencyText("critical", arabic),
      responseTimeText("overdue", arabic),
      assignmentText(false, arabic),
    ];
    for (const word of words) {
      assert.match(word, /\p{Script=Arabic}/u, word);
      assert.ok(!word.includes("_"), word);
    }
  });

  test("a code nobody catalogued reads as English words, not as the code", () => {
    assert.equal(leaseStatusText("on_hold", english), "On hold");
    assert.equal(leaseStatusText("on_hold", arabic), "On hold");
  });

  test("nothing is nothing", () => {
    assert.equal(leaseStatusText("", english), "");
    assert.equal(leaseStatusText(null, english), "");
    assert.equal(inspectionConditionText(undefined, english), "");
  });
});

describe("how urgent an expiring contract is", () => {
  test("a week or less is critical, a month or less a warning", () => {
    assert.equal(expiryUrgency(0), "critical");
    assert.equal(expiryUrgency(7), "critical");
    assert.equal(expiryUrgency(8), "warning");
    assert.equal(expiryUrgency(30), "warning");
    assert.equal(expiryUrgency(31), "upcoming");
    assert.equal(expiryUrgency(90), "upcoming");
  });
});
