/**
 * The maintenance report words its categories, priorities and statuses.
 *
 * They were printed as stored — "in_progress", "emergency", "General Repair"
 * — on an Arabic screen. Every stored value the forms and the workflow write
 * must reach a catalogue entry, in English and in Arabic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { MaintenancePriority, MaintenanceStatus } from "@/types";
import { translations } from "@/locales";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import type { LineTranslate } from "@/lib/statements/line-text";
import {
  maintenanceCategoryText,
  maintenanceKey,
  maintenancePriorityText,
  maintenanceStatusText,
} from "@/lib/maintenance-labels";

const arabic: LineTranslate = (key, english, values) =>
  pdfLabel("ar", key, english, values);

/** What the request forms store (maintenance-request-form.tsx). */
const CATEGORIES = [
  "Plumbing",
  "Electrical",
  "HVAC",
  "Appliances",
  "Flooring",
  "Painting",
  "Roofing",
  "Windows",
  "Doors",
  "Landscaping",
  "Cleaning",
  "Pest Control",
  "Security",
  "General Repair",
  "Emergency",
  "Other",
];

describe("maintenanceKey", () => {
  test("turns stored values into the catalogue's keys", () => {
    assert.equal(maintenanceKey("in_progress"), "inProgress");
    assert.equal(maintenanceKey("General Repair"), "generalRepair");
    assert.equal(maintenanceKey("HVAC"), "hvac");
    assert.equal(maintenanceKey("Pest Control"), "pestControl");
    assert.equal(maintenanceKey("emergency"), "emergency");
  });
});

describe("every stored value has words", () => {
  const has = (key: string) =>
    Boolean(translations[key]?.en) && Boolean(translations[key]?.ar);

  test("statuses", () => {
    for (const status of Object.values(MaintenanceStatus)) {
      assert.ok(has(`maintenance.status.${maintenanceKey(status)}`), status);
    }
  });

  test("priorities", () => {
    for (const priority of Object.values(MaintenancePriority)) {
      assert.ok(has(`maintenance.priority.${maintenanceKey(priority)}`), priority);
    }
  });

  test("categories", () => {
    for (const category of CATEGORIES) {
      assert.ok(has(`maintenance.categories.${maintenanceKey(category)}`), category);
    }
  });
});

describe("in the reader's language", () => {
  test("Arabic reads Arabic", () => {
    assert.equal(maintenanceStatusText("in_progress", arabic), translations["maintenance.status.inProgress"].ar);
    assert.equal(maintenancePriorityText("emergency", arabic), "طوارئ");
    assert.notEqual(maintenanceCategoryText("General Repair", arabic), "General Repair");
  });

  test("an unknown code still reads as words", () => {
    const english: LineTranslate = (key, fallback) => pdfLabel("en", key, fallback);
    assert.equal(maintenanceStatusText("on_hold", english), "On hold");
    assert.equal(maintenanceCategoryText("", english), "");
  });
});
