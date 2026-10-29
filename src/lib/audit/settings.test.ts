/**
 * A settings save as an entry: only the fields that moved, and a secret is
 * stored as "set", never as typed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { SECRET_MASK, diffSettings } from "@/lib/audit/diff";
import { catalogTranslator } from "@/lib/audit/catalog";
import { auditRecordName, renderActivityMessage } from "@/lib/audit/render";

describe("diffSettings", () => {
  test("keeps only the fields that changed", () => {
    const diff = diffSettings(
      { language: "ar", currency: "SAR", timeFormat: "24h" },
      { language: "ar", currency: "USD", timeFormat: "24h" },
      ["language", "currency", "timeFormat"],
    );
    assert.deepEqual(diff.changed, ["currency"]);
    assert.deepEqual(diff.before, { currency: "SAR" });
    assert.deepEqual(diff.after, { currency: "USD" });
  });

  test("a save that moves nothing is an empty diff", () => {
    const diff = diffSettings(
      { rtl: true, smtpPort: "587" },
      { rtl: true, smtpPort: 587 },
      ["rtl", "smtpPort"],
    );
    assert.deepEqual(diff.changed, []);
  });

  test("a secret is compared as it is but stored masked", () => {
    const diff = diffSettings(
      { smtpHost: "mail.example.com", smtpPassword: "old-secret" },
      { smtpHost: "mail.example.com", smtpPassword: "new-secret" },
      ["smtpHost"],
      ["smtpPassword"],
    );
    assert.deepEqual(diff.changed, ["smtpPassword"]);
    assert.deepEqual(diff.secretsChanged, ["smtpPassword"]);
    assert.equal(diff.before.smtpPassword, SECRET_MASK);
    assert.equal(diff.after.smtpPassword, SECRET_MASK);
    const stored = JSON.stringify(diff);
    assert.ok(!stored.includes("old-secret") && !stored.includes("new-secret"));
  });

  test("a secret set for the first time, or cleared, shows as set or empty", () => {
    const set = diffSettings({}, { apiKey: "sk_live_123" }, [], ["apiKey"]);
    assert.equal(set.before.apiKey, null);
    assert.equal(set.after.apiKey, SECRET_MASK);
    const cleared = diffSettings({ apiKey: "sk_live_123" }, { apiKey: "" }, [], ["apiKey"]);
    assert.equal(cleared.before.apiKey, SECRET_MASK);
    assert.equal(cleared.after.apiKey, null);
  });

  test("a leading zero is part of a number such as a phone", () => {
    assert.deepEqual(
      diffSettings({ phone: "0555555555" }, { phone: "555555555" }, ["phone"]).changed,
      ["phone"],
    );
    assert.deepEqual(
      diffSettings({ amount: "1500.00" }, { amount: 1500 }, ["amount"]).changed,
      [],
    );
  });

  test("an unchanged secret is not an entry", () => {
    const diff = diffSettings({ apiKey: "k" }, { apiKey: "k" }, [], ["apiKey"]);
    assert.deepEqual(diff.changed, []);
    assert.deepEqual(diff.secretsChanged, []);
  });
});

describe("a settings entry in the reader's language", () => {
  const entry = {
    action: "settings_changed",
    messageKey: "admin.audit.msg.settings_area",
    messageParams: { area: "display" },
    resourceType: "settings",
    resourceName: "display",
  };

  test("names its area", () => {
    assert.equal(
      renderActivityMessage(entry, catalogTranslator("en")),
      "Changed settings: Display and language",
    );
    assert.equal(
      renderActivityMessage(entry, catalogTranslator("ar")),
      "تعديل الإعدادات: العرض واللغة",
    );
  });

  test("shows the area as the record", () => {
    assert.equal(auditRecordName(entry, catalogTranslator("ar")), "العرض واللغة");
    assert.equal(auditRecordName(entry, catalogTranslator("en")), "Display and language");
  });

  test("leaves another record's name alone", () => {
    assert.equal(
      auditRecordName({ resourceType: "lease", resourceName: "LC-2026-0001" }, catalogTranslator("ar")),
      "LC-2026-0001",
    );
  });
});
