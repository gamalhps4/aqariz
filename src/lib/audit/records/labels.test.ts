/**
 * The words the activity entries of expenses, agreements, deposits,
 * maintenance requests, documents and listings are read in: every field they
 * carry, the record types, the sentences and the coded values have a text in
 * all five languages. The fields are collected from the builders themselves,
 * so a field added to one without a label fails here.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { translations } from "@/locales";
import { AUDIT_RECORD_TYPES } from "@/lib/audit/vocabulary";
import { agreementSnapshot } from "./agreement";
import { DEDUCTION_KEYS, deductionFields, depositSnapshot } from "./deposit";
import { documentSnapshot, uploadedFileSnapshot } from "./document";
import { expenseSnapshot } from "./expense";
import {
  OFFICE_SETTINGS_KEYS,
  inquirySnapshot,
  listingSnapshot,
} from "./listing";
import { maintenanceSnapshot } from "./maintenance";

const LOCALES = ["en", "ar"] as const;

function missing(key: string): string[] {
  const entry = translations[key] as Record<string, string> | undefined;
  return LOCALES.filter((locale) => !entry?.[locale]?.trim()).map(
    (locale) => `${locale}:${key}`,
  );
}

/** Every field the builders can put in an entry, from a row that has all of them. */
function fieldsOfTheBuilders(): Set<string> {
  const seen = new Set<string>();
  const collect = (values: Record<string, unknown>) => {
    for (const key of Object.keys(values)) seen.add(key);
  };
  const named = { firstName: "A", lastName: "B" };

  collect(
    expenseSnapshot({
      expenseNumber: "E1",
      category: "other",
      description: "d",
      amount: 1,
      date: new Date(),
      propertyId: { name: "b" },
      supplier: { name: "s" },
      supplierInvoiceNumber: "i",
      paymentMethod: "cash",
      referenceNumber: "r",
      status: "paid",
      vatAmount: 0,
      taxDeductible: true,
      isRecurring: false,
      notes: "n",
    }),
  );
  collect(
    agreementSnapshot({
      agreementNumber: "A1",
      kind: "management",
      owner: named,
      property: { name: "p" },
      compound: { name: "c" },
      feeType: "fixed",
      feePercentage: 0,
      feeAmount: 1,
      feeFrequency: "monthly",
      commissionBasis: "collected",
      currency: "SAR",
      startDate: new Date(),
      endDate: new Date(),
      status: "active",
      terminatedDate: new Date(),
      documents: [],
      notes: "n",
    }),
  );
  collect(
    depositSnapshot(
      {
        amount: 1,
        status: "collected",
        collectedDate: new Date(),
        deductions: [],
        refundAmount: 1,
        refundDate: new Date(),
        refundMethod: "check",
        refundNotes: "n",
        notes: "n",
      },
      { tenantName: "t", propertyName: "p", contractNumber: "c" },
    ),
  );
  collect(deductionFields({ category: "damage", description: "d", amount: 1 }));
  collect(
    maintenanceSnapshot({
      title: "t",
      description: "d",
      priority: "high",
      category: "Other",
      status: "assigned",
      assignedTo: named,
      property: { name: "p" },
      tenant: named,
      scheduledDate: new Date(),
      completedDate: new Date(),
      estimatedCost: 1,
      actualCost: 1,
    }),
  );
  // What the routes put beside the snapshots.
  collect({
    note: 1,
    contactMethod: 1,
    contactSuccessful: 1,
    contactedAt: 1,
    urgencyLevel: 1,
    reason: 1,
    requests: 1,
    count: 1,
    assignedToId: 1,
    adLicenceNumber: 1,
    adLicenceExpiry: 1,
  });
  collect(
    documentSnapshot(
      {
        name: "f.pdf",
        description: "d",
        type: "lease",
        category: "lease",
        fileSize: 1024,
        tags: ["t"],
      },
      { contractNumber: "C1" },
    ),
  );
  collect(uploadedFileSnapshot({ name: "f.pdf", size: 1024 }));
  collect(
    listingSnapshot({
      titleAr: "ا",
      titleEn: "a",
      type: "rent",
      price: 1,
      pricePeriod: "monthly",
      city: "c",
      district: "d",
      contactPhone: "1",
      whatsappNumber: "1",
      adLicenceNumber: "1",
      adLicenceExpiry: "2026-01-01",
      slug: "s",
      amenities: ["a"],
      photos: ["p"],
      status: "draft",
      publishedAt: new Date(),
      unit: { unitNumber: "1" },
      property: { name: "p" },
    }),
  );
  collect(
    inquirySnapshot({ status: "new", assignee: named, notes: "n" }),
  );
  collect(Object.fromEntries(OFFICE_SETTINGS_KEYS.map((key) => [key, 1])));
  collect(Object.fromEntries(DEDUCTION_KEYS.map((key) => [key, 1])));
  return seen;
}

describe("the labels of these records' entries", () => {
  test("every field an entry can carry has a label in all five languages", () => {
    const gaps = [...fieldsOfTheBuilders()].flatMap((field) =>
      missing(`admin.audit.fields.${field}`),
    );
    assert.deepEqual(gaps, []);
  });

  test("the new record types are in the vocabulary and worded", () => {
    for (const type of ["listing", "listing_inquiry"]) {
      assert.ok((AUDIT_RECORD_TYPES as readonly string[]).includes(type), type);
      assert.deepEqual(missing(`admin.audit.types.${type}`), []);
    }
  });

  test("the sentences these routes use exist in all five languages", () => {
    const keys = [
      "maintenance_assigned",
      "maintenance_note_added",
      "maintenance_contact_logged",
      "maintenance_escalated",
      "maintenance_bulk_status",
      "maintenance_bulk_assign",
      "maintenance_bulk_update",
      "maintenance_bulk_delete",
      "deposit_refunded",
      "deposit_deduction_added",
      "deposit_deduction_removed",
    ];
    assert.deepEqual(
      keys.flatMap((key) => missing(`admin.audit.msg.${key}`)),
      [],
    );
  });

  test("the coded values no catalogue words exist in all five languages", () => {
    const values = ["fully_refunded", "phone", "email", "sms", "in_person", "critical"];
    assert.deepEqual(
      values.flatMap((value) => missing(`admin.audit.values.${value}`)),
      [],
    );
  });

  test("the sentences carry the parameters the routes pass", () => {
    const text = (key: string) =>
      (translations[key] as Record<string, string> | undefined)?.en ?? "";
    assert.match(text("admin.audit.msg.maintenance_assigned"), /\{assignee\}/);
    assert.match(text("admin.audit.msg.maintenance_bulk_status"), /\{to\}.*\{count\}/);
    assert.match(text("admin.audit.msg.maintenance_bulk_assign"), /\{assignee\}.*\{count\}/);
    assert.match(text("admin.audit.msg.deposit_refunded"), /\{amount\}/);
  });
});
