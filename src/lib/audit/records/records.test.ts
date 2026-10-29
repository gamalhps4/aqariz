/**
 * What the activity entries of expenses, agreements, deposits, maintenance
 * requests, documents and listings hold — and how each reads.
 *
 * No database: the builders take the rows as the routes read them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { catalogTranslator } from "@/lib/audit/catalog";
import { diffSnapshot } from "@/lib/audit/diff";
import { auditStatusLabel, formatAuditValue } from "@/lib/audit/render";
import { AuditAction, describeApiRequest } from "@/lib/audit/vocabulary";
import {
  AGREEMENT_CHANGE_KEYS,
  agreementName,
  agreementSnapshot,
} from "./agreement";
import {
  DEPOSIT_CHANGE_KEYS,
  deductionsTotal,
  depositEntry,
  depositSnapshot,
  depositTenantName,
  findDeduction,
} from "./deposit";
import {
  documentName,
  documentSnapshot,
  uploadedFileSnapshot,
} from "./document";
import {
  EXPENSE_CHANGE_KEYS,
  expenseName,
  expenseSnapshot,
} from "./expense";
import {
  INQUIRY_CHANGE_KEYS,
  LISTING_CHANGE_KEYS,
  LISTING_STATE_KEYS,
  inquirySnapshot,
  listingName,
  listingPlace,
  listingSnapshot,
  listingStateAction,
} from "./listing";
import {
  MAINTENANCE_CHANGE_KEYS,
  maintenanceEntry,
  maintenanceName,
  maintenanceSnapshot,
} from "./maintenance";
import {
  clip,
  compact,
  dayOf,
  firstOf,
  kilobytes,
  numberOf,
  personName,
  statusMove,
} from "./shared";

const en = catalogTranslator("en");
const ar = catalogTranslator("ar");

/** A Prisma Decimal, as far as the snapshot reader is concerned. */
const decimal = (value: number) => ({ toNumber: () => value });

describe("the pieces every snapshot is made of", () => {
  test("a person is named by their name, else the name column, else their address", () => {
    assert.equal(personName({ firstName: "Nora", lastName: "Saad" }), "Nora Saad");
    assert.equal(personName({ firstName: null, lastName: null, name: "Acme" }), "Acme");
    assert.equal(personName({ email: "a@b.sa" }), "a@b.sa");
    assert.equal(personName(null), null);
  });

  test("a long text is cut, an empty one is nothing", () => {
    assert.equal(clip("  short  ", 20), "short");
    assert.equal(clip("x".repeat(50), 10)?.length, 10);
    assert.equal(clip("   "), null);
    assert.equal(clip(5), null);
  });

  test("money and dates are plain values", () => {
    assert.equal(numberOf(decimal(12.5)), 12.5);
    assert.equal(numberOf("2500.00"), 2500);
    assert.equal(numberOf(null), null);
    assert.equal(numberOf("abc"), null);
    assert.equal(dayOf(new Date("2026-10-04T10:00:00Z")), "2026-10-04");
    assert.equal(dayOf("2026-10-04"), "2026-10-04");
  });

  test("a file's size is in kilobytes; zero means unknown", () => {
    assert.equal(kilobytes(1024), 1);
    assert.equal(kilobytes(1536), 1.5);
    assert.equal(kilobytes(0), null);
    assert.equal(kilobytes(undefined), null);
  });

  test("a created or removed record keeps only the fields that hold something", () => {
    assert.deepEqual(
      compact({ a: 1, b: null, c: "", d: [], e: false, f: 0, g: ["x"] }),
      { a: 1, e: false, f: 0, g: ["x"] },
    );
  });

  test("a status that moved says from and to; one that did not says nothing", () => {
    assert.deepEqual(statusMove({ status: "pending" }, { status: "paid" }), {
      from: "pending",
      to: "paid",
    });
    assert.equal(statusMove({ status: "paid" }, { status: "paid" }), null);
    assert.equal(statusMove({}, { status: "paid" }), null);
  });

  test("a bulk entry lists the first titles it touched", () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ title: `Leak ${index}` }));
    assert.equal(firstOf(rows, (row) => row.title).length, 20);
    assert.deepEqual(firstOf([{ title: " " }, { title: "A" }], (row) => row.title), ["A"]);
  });
});

describe("an expense", () => {
  // As the expense service answers: the building and supplier as objects.
  const row = {
    id: "e1",
    expenseNumber: "EXP-7",
    category: "maintenance",
    description: "Pump repair",
    amount: decimal(1150),
    date: new Date("2026-10-01T00:00:00Z"),
    paymentMethod: "bank_transfer",
    referenceNumber: null,
    notes: null,
    status: "pending",
    vatAmount: 150,
    taxDeductible: true,
    isRecurring: false,
    propertyId: { id: "p1", name: "Tower A" },
    supplier: { name: "Al Noor Plumbing" },
    supplierInvoiceNumber: "INV-9",
    receiptUrl: "https://files.example/receipt.pdf",
    createdBy: { id: "u1" },
  };

  test("is named by its number, else by what it was for", () => {
    assert.equal(expenseName(row), "EXP-7");
    assert.equal(expenseName({ ...row, expenseNumber: null }), "Pump repair");
    assert.equal(expenseName(null), null);
  });

  test("keeps the names, the money and the dates — not the ids or the receipt", () => {
    const snapshot = expenseSnapshot(row);
    assert.equal(snapshot.propertyName, "Tower A");
    assert.equal(snapshot.supplierName, "Al Noor Plumbing");
    assert.equal(snapshot.amount, 1150);
    assert.equal(snapshot.date, "2026-10-01T00:00:00.000Z");
    assert.equal("receiptUrl" in snapshot, false);
    assert.equal("propertyId" in snapshot, false);
    assert.deepEqual(Object.keys(snapshot).sort(), [...EXPENSE_CHANGE_KEYS].sort());
  });

  test("an edit records only what moved, an approval its status", () => {
    const approved = { ...row, status: "approved", amount: 1200 };
    const diff = diffSnapshot(expenseSnapshot(row), expenseSnapshot(approved), EXPENSE_CHANGE_KEYS);
    assert.deepEqual(diff.changed.sort(), ["amount", "status"]);
    assert.deepEqual(diff.before, { amount: 1150, status: "pending" });
    assert.deepEqual(diff.after, { amount: 1200, status: "approved" });
    assert.deepEqual(statusMove(expenseSnapshot(row), expenseSnapshot(approved)), {
      from: "pending",
      to: "approved",
    });
  });

  test("a deleted expense's row reads cancelled, which is not what it was", () => {
    assert.equal("status" in expenseSnapshot(row, { status: false }), false);
    assert.equal(compact(expenseSnapshot(row, { status: false })).referenceNumber, undefined);
  });
});

describe("a management agreement", () => {
  const row = {
    agreementNumber: "AGR-12",
    kind: "management",
    owner: { firstName: "Khalid", lastName: "Omar", email: "k@x.sa" },
    property: { id: "p1", name: "Tower A" },
    compound: null,
    feeType: "percentage",
    feePercentage: decimal(5),
    feeAmount: decimal(0),
    feeFrequency: "monthly",
    commissionBasis: "collected",
    currency: "SAR",
    startDate: new Date("2026-01-01T00:00:00Z"),
    endDate: null,
    status: "active",
    terminatedDate: null,
    documents: ["https://files.example/a.pdf"],
    notes: null,
  };

  test("is named by its number and keeps the owner, the cover and the terms", () => {
    assert.equal(agreementName(row), "AGR-12");
    const snapshot = agreementSnapshot(row);
    assert.equal(snapshot.ownerName, "Khalid Omar");
    assert.equal(snapshot.propertyName, "Tower A");
    assert.equal(snapshot.compoundName, null);
    assert.equal(snapshot.feePercentage, 5);
    assert.equal(snapshot.documentsCount, 1);
    assert.equal(JSON.stringify(snapshot).includes("files.example"), false);
  });

  test("changing the commission and closing the agreement are two moves in one entry", () => {
    const closed = {
      ...row,
      feePercentage: decimal(6),
      status: "terminated",
      terminatedDate: new Date("2026-09-30T00:00:00Z"),
    };
    const diff = diffSnapshot(agreementSnapshot(row), agreementSnapshot(closed), AGREEMENT_CHANGE_KEYS);
    assert.deepEqual(diff.changed.sort(), ["feePercentage", "status", "terminatedDate"]);
    assert.deepEqual(statusMove(agreementSnapshot(row), agreementSnapshot(closed)), {
      from: "active",
      to: "terminated",
    });
  });
});

describe("a security deposit", () => {
  const deposit = {
    amount: 5000,
    currency: "SAR",
    status: "collected",
    collectedDate: new Date("2026-02-01T00:00:00Z"),
    deductions: [
      { id: "d1", category: "damage", description: "Door", amount: 300 },
      { id: "d2", category: "cleaning", description: "Deep clean", amount: 150.5 },
    ],
    refundAmount: null,
    refundDate: null,
    refundMethod: null,
    refundNotes: null,
    notes: null,
    tenant: { firstName: "Sara", lastName: "Ali", email: "s@x.sa" },
  };

  test("adds up its deductions to the halala", () => {
    assert.equal(deductionsTotal(deposit.deductions), 450.5);
    assert.equal(deductionsTotal([]), 0);
    assert.equal(depositSnapshot(deposit).deductionsTotal, 450.5);
    assert.equal(depositSnapshot(deposit).deductionsCount, 2);
    assert.equal(depositTenantName(deposit), "Sara Ali");
  });

  test("collecting is a move of the status", () => {
    const pending = { ...deposit, status: "pending", collectedDate: null, deductions: [] };
    const entry = depositEntry({ requestAction: "collect", deposit: pending, updated: deposit });
    assert.equal(entry.action, AuditAction.STATUS_CHANGED);
    assert.deepEqual(entry.messageParams, { from: "pending", to: "collected" });
    const diff = diffSnapshot(entry.before, entry.after, entry.keys);
    assert.ok(diff.changed.includes("status"));
    assert.ok(diff.changed.includes("collectedDate"));
  });

  test("a deduction added names its category, description and amount", () => {
    const before = { ...deposit, deductions: [deposit.deductions[0]] };
    const entry = depositEntry({ requestAction: "add-deduction", deposit: before, updated: deposit });
    assert.equal(entry.action, AuditAction.UPDATE);
    assert.equal(entry.messageKey, "admin.audit.msg.deposit_deduction_added");
    const diff = diffSnapshot(entry.before, entry.after, entry.keys);
    assert.equal(diff.after.deductionCategory, "cleaning");
    assert.equal(diff.after.deductionAmount, 150.5);
    assert.deepEqual([diff.before.deductionsTotal, diff.after.deductionsTotal], [300, 450.5]);
  });

  test("a deduction taken off names what was removed", () => {
    const after = { ...deposit, deductions: [deposit.deductions[0]] };
    assert.equal(findDeduction(deposit, "d2")?.description, "Deep clean");
    const entry = depositEntry({
      requestAction: "remove-deduction",
      deposit,
      updated: after,
      deductionId: "d2",
    });
    const diff = diffSnapshot(entry.before, entry.after, entry.keys);
    assert.equal(entry.messageKey, "admin.audit.msg.deposit_deduction_removed");
    assert.equal(diff.before.deductionDescription, "Deep clean");
    assert.equal(diff.after.deductionDescription, null);
  });

  test("a refund reads as a refund with its amount; a deposit kept in full as a status move", () => {
    const refunded = {
      ...deposit,
      status: "partially_refunded",
      refundAmount: 4549.5,
      refundDate: new Date("2026-10-01T00:00:00Z"),
      refundMethod: "bank_transfer",
    };
    const entry = depositEntry({ requestAction: "refund", deposit, updated: refunded });
    assert.equal(entry.action, AuditAction.PAYMENT_REFUNDED);
    assert.deepEqual(entry.messageParams, { amount: 4549.5, currency: "SAR" });
    assert.ok(DEPOSIT_CHANGE_KEYS.includes("refundMethod"));

    const forfeited = { ...refunded, status: "forfeited", refundAmount: 0 };
    const kept = depositEntry({ requestAction: "refund", deposit, updated: forfeited });
    assert.equal(kept.action, AuditAction.STATUS_CHANGED);
    assert.deepEqual(kept.messageParams, { from: "collected", to: "forfeited" });
  });

  test("notes alone are an update", () => {
    const entry = depositEntry({
      requestAction: "update-notes",
      deposit,
      updated: { ...deposit, notes: "Held in the owner's account" },
    });
    assert.equal(entry.action, AuditAction.UPDATE);
    assert.equal(entry.messageKey, undefined);
    assert.deepEqual(diffSnapshot(entry.before, entry.after, entry.keys).changed, ["notes"]);
  });
});

describe("a maintenance request", () => {
  const row = {
    title: "Water leak in the kitchen",
    description: "Under the sink",
    priority: "high",
    category: "Plumbing",
    status: "submitted",
    estimatedCost: null,
    actualCost: null,
    scheduledDate: null,
    completedDate: null,
    contactPhone: "0555555555",
    images: ["https://files.example/leak.jpg"],
    assignedTo: null,
    property: { name: "Tower A" },
    tenant: { firstName: "Sara", lastName: "Ali" },
  };

  test("is named by its title and keeps the names, not the phone or the photos", () => {
    assert.equal(maintenanceName(row), "Water leak in the kitchen");
    const snapshot = maintenanceSnapshot(row);
    assert.equal(snapshot.propertyName, "Tower A");
    assert.equal(snapshot.tenantName, "Sara Ali");
    assert.equal("contactPhone" in snapshot, false);
    assert.equal("images" in snapshot, false);
  });

  test("an assignment names the person and the status it moved to", () => {
    const assigned = {
      ...row,
      status: "assigned",
      assignedTo: { firstName: "Faisal", lastName: "Nasser" },
    };
    const entry = maintenanceEntry({ before: row, after: assigned, assignment: true });
    assert.equal(entry.action, AuditAction.UPDATE);
    assert.equal(entry.messageKey, "admin.audit.msg.maintenance_assigned");
    assert.deepEqual(entry.messageParams, { assignee: "Faisal Nasser" });
    const diff = diffSnapshot(entry.before, entry.after, entry.keys);
    assert.deepEqual(diff.changed.sort(), ["assignedToName", "status"]);
  });

  test("a change of the person on an edit reads as an assignment on its own", () => {
    const entry = maintenanceEntry({
      before: row,
      after: { ...row, assignedTo: { firstName: "Faisal", lastName: "Nasser" } },
    });
    assert.equal(entry.messageKey, "admin.audit.msg.maintenance_assigned");
  });

  test("starting and completing are status moves with their cost and date", () => {
    const progress = { ...row, status: "in_progress" };
    const start = maintenanceEntry({ before: row, after: progress });
    assert.equal(start.action, AuditAction.STATUS_CHANGED);
    assert.deepEqual(start.messageParams, { from: "submitted", to: "in_progress" });

    const done = {
      ...progress,
      status: "completed",
      actualCost: decimal(420),
      completedDate: new Date("2026-10-03T00:00:00Z"),
    };
    const complete = maintenanceEntry({ before: progress, after: done });
    assert.deepEqual(
      diffSnapshot(complete.before, complete.after, complete.keys).changed.sort(),
      ["actualCost", "completedDate", "status"],
    );
  });

  test("an edit that moves nothing names no field", () => {
    const entry = maintenanceEntry({ before: row, after: { ...row } });
    assert.equal(entry.action, AuditAction.UPDATE);
    assert.deepEqual(diffSnapshot(entry.before, entry.after, entry.keys).changed, []);
    assert.ok(MAINTENANCE_CHANGE_KEYS.includes("assignedToName"));
  });
});

describe("a document", () => {
  const row = {
    name: "contract-scan.pdf",
    description: "Signed copy",
    type: "lease",
    category: "lease",
    fileSize: 2048,
    tags: ["signed", ""],
    fileUrl: "https://files.example/signed-url?sig=secret",
    r2ObjectKey: "PropertyPro/lease-documents/abc/contract-scan.pdf",
  };

  test("is named by its file name and says where it is filed — never where it is stored", () => {
    assert.equal(documentName(row), "contract-scan.pdf");
    const snapshot = documentSnapshot(row, { contractNumber: "C-2026-001" });
    assert.equal(snapshot.fileSizeKb, 2);
    assert.equal(snapshot.contractNumber, "C-2026-001");
    assert.deepEqual(snapshot.tags, ["signed"]);
    const text = JSON.stringify(snapshot);
    assert.equal(text.includes("files.example"), false);
    assert.equal(text.includes("PropertyPro/"), false);
    assert.equal(text.includes("secret"), false);
  });

  test("a file with no row keeps its name and size", () => {
    assert.deepEqual(compact(uploadedFileSnapshot({ name: "plan.pdf", size: 10240 })), {
      fileName: "plan.pdf",
      fileSizeKb: 10,
    });
  });
});

describe("a listing", () => {
  // As the "before" read gives it (columns), and as the service answers (DTO).
  const stored = {
    titleAr: "شقة فاخرة",
    titleEn: "Luxury flat",
    type: "rent",
    slug: "luxury-flat",
    price: decimal(42000),
    pricePeriod: "annual",
    city: "Riyadh",
    district: null,
    contactPhone: "0500000000",
    whatsappNumber: null,
    adLicenceNumber: "7100000001",
    adLicenceExpiry: new Date("2026-12-01T00:00:00Z"),
    status: "draft",
    publishedAt: null,
    photos: ["a.jpg", "b.jpg"],
    amenities: ["Balcony"],
  };
  const dto = {
    ...stored,
    price: 42000,
    adLicenceExpiry: "2026-12-01",
    unit: { unitNumber: "12B" },
    property: { name: "Tower A" },
  };

  test("is named by its title, Arabic first", () => {
    assert.equal(listingName(dto), "شقة فاخرة");
    assert.equal(listingName({ titleAr: "", titleEn: "Luxury flat", slug: "x" }), "Luxury flat");
    assert.equal(listingName({ titleAr: "", titleEn: "", slug: "x" }), "x");
  });

  test("a row and the DTO of the same listing compare equal, field for field", () => {
    const diff = diffSnapshot(listingSnapshot(stored), listingSnapshot(dto), LISTING_CHANGE_KEYS);
    assert.deepEqual(diff.changed, []);
    assert.equal(listingSnapshot(dto).photosCount, 2);
    assert.deepEqual(listingPlace(dto), { propertyName: "Tower A", unitNumber: "12B" });
  });

  test("a listing for a property not in the system is placed by its address and city", () => {
    const standalone = {
      ...stored,
      propertyType: "villa",
      addressLine: "شارع التخصصي، فيلا 12",
      areaSqm: 450,
      bedrooms: 5,
      bathrooms: 4,
      floor: null,
    };
    const asDto = { ...standalone, price: 42000, adLicenceExpiry: "2026-12-01", unit: null, property: null };
    assert.deepEqual(listingPlace(asDto), { address: "شارع التخصصي، فيلا 12", city: "Riyadh" });
    assert.deepEqual(
      diffSnapshot(listingSnapshot(standalone), listingSnapshot(asDto), LISTING_CHANGE_KEYS).changed,
      [],
    );
    const bigger = diffSnapshot(
      listingSnapshot(standalone),
      listingSnapshot({ ...asDto, areaSqm: 480, bedrooms: 6 }),
      LISTING_CHANGE_KEYS,
    );
    assert.deepEqual(bigger.changed.sort(), ["areaSqm", "bedrooms"]);
    assert.deepEqual(bigger.before, { areaSqm: 450, bedrooms: 5 });
  });

  test("an edit records the price and the licence that moved", () => {
    const edited = { ...dto, price: 45000, adLicenceNumber: "7100000002" };
    const diff = diffSnapshot(listingSnapshot(stored), listingSnapshot(edited), LISTING_CHANGE_KEYS);
    assert.deepEqual(diff.changed.sort(), ["adLicenceNumber", "price"]);
    assert.deepEqual(diff.before, { price: 42000, adLicenceNumber: "7100000001" });
  });

  test("publishing records the status and the day it went up", () => {
    const published = { ...dto, status: "published", publishedAt: "2026-10-04T08:00:00.000Z" };
    const diff = diffSnapshot(listingSnapshot(stored), listingSnapshot(published), LISTING_STATE_KEYS);
    assert.deepEqual(diff.changed.sort(), ["publishedAt", "status"]);
  });

  test("a state move reads as publishing, archiving or restoring — and a non-move as nothing", () => {
    assert.equal(listingStateAction("draft", "published"), "status_changed");
    assert.equal(listingStateAction("published", "draft"), "status_changed");
    assert.equal(listingStateAction("published", "archived"), "archive");
    assert.equal(listingStateAction("draft", "archived"), "archive");
    assert.equal(listingStateAction("archived", "draft"), "restore");
    assert.equal(listingStateAction("published", "published"), null);
    assert.equal(listingStateAction(undefined, "published"), null);
  });

  test("an inquiry records its status, who has it and the notes — not what the visitor wrote", () => {
    const before = inquirySnapshot({
      status: "new",
      notes: null,
      assignee: null,
      message: "Is it still available?",
      phone: "0555",
    });
    const after = inquirySnapshot({
      status: "contacted",
      notes: "Called back",
      assignee: { id: "u1", name: "Faisal Nasser" },
      message: "Is it still available?",
      phone: "0555",
    });
    assert.deepEqual(Object.keys(after).sort(), [...INQUIRY_CHANGE_KEYS].sort());
    const diff = diffSnapshot(before, after, INQUIRY_CHANGE_KEYS);
    assert.deepEqual(diff.changed.sort(), ["assigneeName", "notes", "status"]);
    assert.equal(JSON.stringify(after).includes("0555"), false);
  });
});

describe("the words an entry is read in", () => {
  test("a status the catalogue spells in camel case is found", () => {
    assert.equal(auditStatusLabel("in_progress", "maintenance", en), "In Progress");
    assert.equal(auditStatusLabel("partially_refunded", "deposit", en), "Partly refunded");
    assert.equal(auditStatusLabel("published", "listing", en), "Published");
    assert.equal(auditStatusLabel("contacted", "listing_inquiry", en), "Contacted");
    assert.notEqual(auditStatusLabel("in_progress", "maintenance", ar), "In Progress");
    assert.notEqual(auditStatusLabel("published", "listing", ar), "Published");
  });

  test("a status with no catalogue word falls back to the generic or a readable form", () => {
    assert.equal(auditStatusLabel("pending", "deposit", en), "Pending");
    assert.equal(auditStatusLabel("brand_new_state", "deposit", en), "Brand new state");
  });

  test("a coded value is worded by the catalogue of its record", () => {
    const value = (field: string, raw: string, recordType: string, t = en) =>
      formatAuditValue(field, raw, { t, recordType });
    assert.equal(value("priority", "high", "maintenance"), "High");
    assert.equal(value("category", "Pest Control", "maintenance"), "Pest Control");
    assert.equal(value("category", "management_fee", "expense"), "Management Fee");
    assert.equal(value("paymentMethod", "bank_transfer", "expense"), "Bank transfer");
    assert.equal(value("feeFrequency", "semi_annual", "agreement"), "Semi-Annual");
    assert.equal(value("documentType", "identification", "document"), "Identification");
    assert.notEqual(value("priority", "high", "maintenance", ar), "High");
    assert.notEqual(value("paymentMethod", "cash", "expense", ar), "Cash");
  });

  test("the same field name on another record is left as stored", () => {
    assert.equal(
      formatAuditValue("category", "management_fee", { t: en, recordType: "unit" }),
      "management_fee",
    );
  });

  test("the new money fields show two places; free text is left alone", () => {
    for (const field of ["feeAmount", "deductionsTotal", "deductionAmount", "estimatedCost", "actualCost", "price"]) {
      assert.equal(formatAuditValue(field, 1500, { t: en }), "1,500.00", field);
    }
    assert.equal(formatAuditValue("notes", "pending", { t: en, recordType: "deposit" }), "pending");
  });
});

describe("what a request to the new record types names", () => {
  test("a file taken down through the upload helper is a deletion, not an upload", () => {
    assert.equal(describeApiRequest("DELETE", "/api/upload")?.action, AuditAction.DELETE);
    assert.equal(describeApiRequest("POST", "/api/upload")?.action, AuditAction.DOCUMENT_UPLOAD);
    assert.equal(
      describeApiRequest("POST", "/api/leases/cmus8fbd500283o9ksjsargdg/documents/upload")?.action,
      AuditAction.DOCUMENT_UPLOAD,
    );
  });

  test("a listing and its inquiries are records of their own, in their own modules", () => {
    const listing = describeApiRequest("POST", "/api/marketing/listings");
    assert.equal(listing?.recordType, "listing");
    assert.equal(listing?.category, "property_management");
    const inquiry = describeApiRequest("PATCH", "/api/marketing/inquiries/cmus8fbd500283o9ksjsargdg");
    assert.equal(inquiry?.recordType, "listing_inquiry");
    assert.equal(inquiry?.category, "communication");
    const status = describeApiRequest("POST", "/api/marketing/listings/cmus8fbd500283o9ksjsargdg/status");
    assert.equal(status?.recordType, "listing");
    assert.equal(status?.action, AuditAction.STATUS_CHANGED);
  });

  test("the maintenance routes' words map to the actions they are", () => {
    const bulk = describeApiRequest("POST", "/api/maintenance/bulk-status");
    assert.equal(bulk?.action, AuditAction.BULK_UPDATE);
    assert.equal(bulk?.recordType, "maintenance");
  });
});
