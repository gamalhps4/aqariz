/**
 * An activity entry reads in the reader's language.
 *
 * Entries used to carry one English sentence written when the action
 * happened, so an Arabic office read its own log in English. They now store a
 * catalogue key and parameters; the sentence is put together when it is read
 * — statuses, record types and formats included — with the stored English as
 * the fallback for entries written before.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { catalogTranslator } from "@/lib/audit/catalog";
import {
  auditTypeLabel,
  changedFields,
  formatAuditValue,
  humanizeKey,
  renderActivityMessage,
} from "@/lib/audit/render";

const ar = catalogTranslator("ar");
const en = catalogTranslator("en");

describe("the sentence", () => {
  test("is rendered from its key, statuses in the reader's words", () => {
    const entry = {
      action: "status_changed",
      messageKey: "admin.audit.msg.status_changed",
      messageParams: { from: "active", to: "terminated" },
      description: "Changed the status from active to terminated",
      resourceType: "lease",
    };
    assert.equal(renderActivityMessage(entry, en), "Changed the status from Active to Terminated");
    assert.equal(renderActivityMessage(entry, ar), "تغيير الحالة من نشط إلى مُنهى");
  });

  test("names the record type in the reader's language", () => {
    const entry = { action: "create", messageKey: "admin.audit.msg.create", resourceType: "lease" };
    assert.equal(renderActivityMessage(entry, en), "Created: Contract");
    assert.equal(renderActivityMessage(entry, ar), "إنشاء عقد");
  });

  test("translates an export's report title and format", () => {
    const entry = {
      action: "bulk_export",
      messageKey: "admin.audit.msg.bulk_export",
      messageParams: { report: "Activity Log", format: "xlsx" },
      resourceType: "report",
    };
    assert.equal(renderActivityMessage(entry, en), "Exported Activity Log (Excel)");
    assert.equal(renderActivityMessage(entry, ar), "تصدير سجل النشاط (Excel)");
  });

  test("writes a date with slashes, which survive right-to-left text", () => {
    const entry = {
      action: "update",
      messageKey: "admin.audit.msg.period_closed",
      messageParams: { date: "2026-10-02" },
      resourceType: "accounting_period",
    };
    assert.equal(renderActivityMessage(entry, en), "Closed the books through 2026/10/02");
    assert.match(renderActivityMessage(entry, ar), /2026\/10\/02/);
  });

  test("formats an amount to two places", () => {
    const entry = {
      action: "payment_processed",
      messageKey: "admin.audit.msg.payment_processed",
      messageParams: { amount: 5000 },
      resourceType: "payment",
    };
    assert.equal(renderActivityMessage(entry, en), "Recorded a payment of 5,000.00");
  });

  test("falls back to the stored English for an entry written before keys", () => {
    const legacy = {
      action: "create",
      messageKey: null,
      description: "Created invoice INV-0003",
      resourceType: "invoice",
    };
    assert.equal(renderActivityMessage(legacy, ar), "Created invoice INV-0003");
  });

  test("falls back to the action's own sentence for an unknown key", () => {
    const entry = {
      action: "delete",
      messageKey: "admin.audit.msg.no_such_key",
      description: "",
      resourceType: "unit",
    };
    assert.equal(renderActivityMessage(entry, en), "Deleted: Unit");
  });

  test("never renders a bare key, even for an action nobody wrote a sentence for", () => {
    const entry = { action: "some_new_action", messageKey: null, description: "" };
    assert.equal(renderActivityMessage(entry, en), "Some new action");
  });

  test("drops the gap an empty parameter leaves", () => {
    const entry = {
      action: "bulk_export",
      messageKey: "admin.audit.msg.bulk_export",
      messageParams: { report: "Payments Report", format: null },
      resourceType: "report",
    };
    assert.equal(renderActivityMessage(entry, en), "Exported Payments Report");
  });
});

describe("before and after values", () => {
  test("a status in the reader's words; money to two places; yes or no", () => {
    assert.equal(formatAuditValue("status", "paid", { t: ar, recordType: "invoice" }), "مدفوعة");
    assert.equal(formatAuditValue("amountPaid", 1500, { t: en }), "1,500.00");
    assert.equal(formatAuditValue("rentAmount", "2500.5", { t: en }), "2,500.50");
    assert.equal(formatAuditValue("isActive", false, { t: ar }), "لا");
    assert.equal(formatAuditValue("notes", null, { t: en }), "—");
  });

  test("a date as the screen formats it, a list as a list", () => {
    assert.equal(
      formatAuditValue("dueDate", "2026-10-01T00:00:00.000Z", {
        t: en,
        formatDate: (iso) => `day ${iso.slice(0, 10)}`,
      }),
      "day 2026-10-01",
    );
    assert.equal(formatAuditValue("permissions", ["a", "b"], { t: en }), "a, b");
  });

  test("every field on either side is listed, set or cleared", () => {
    assert.deepEqual(changedFields({ a: 1, b: 2 }, { b: 3, c: 4 }), ["a", "b", "c"]);
    assert.deepEqual(changedFields(null, { c: 4 }), ["c"]);
  });

  test("labels fall back to readable words", () => {
    assert.equal(humanizeKey("balanceRemaining"), "Balance remaining");
    assert.equal(auditTypeLabel("lease", ar), "عقد");
    assert.equal(auditTypeLabel("brand_new_type", en), "Brand new type");
  });
});
