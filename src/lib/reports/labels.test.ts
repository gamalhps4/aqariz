/**
 * An Arabic reader's export has to come out in Arabic.
 *
 * Every report route writes its sheet in English; the sheet is translated on
 * its way out (lib/reports/labels.ts). These pin the shapes the routes
 * actually produce — a plain header, a title with a name after a dash, a
 * label with a rate in brackets, a stored status — and the one thing it must
 * never do: rewrite a tenant's name or a note because it happens to look
 * like a word it knows.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  labelSlug,
  reportLanguage,
  translateLabel,
  translateValue,
} from "@/lib/reports/labels";
import { localizeSheet } from "@/lib/reports/export";

describe("labels", () => {
  test("a plain header", () => {
    assert.equal(translateLabel("Contract number", "ar"), "رقم العقد");
    assert.equal(translateLabel("Due date", "en"), "Due date");
  });

  test("a title keeps the name after the dash", () => {
    assert.equal(
      translateLabel("Owner Statement of Account — ناصر الغامدي", "ar"),
      "كشف حساب المالك — ناصر الغامدي",
    );
  });

  test("a label keeps its bracketed figure", () => {
    assert.equal(
      translateLabel("VAT on commission (15%)", "ar"),
      "ضريبة القيمة المضافة على العمولة (15%)",
    );
  });

  test("English passes through, and so does anything unknown", () => {
    assert.equal(translateLabel("Contract number", "en"), "Contract number");
    assert.equal(
      translateLabel("A column nobody has translated", "ar"),
      "A column nobody has translated",
    );
  });

  test("slugs keep percent and plus apart from plain words", () => {
    assert.equal(labelSlug("Tax %"), "tax_pct");
    assert.equal(labelSlug("90+ days"), "90_plus_days");
    assert.notEqual(labelSlug("Occupancy %"), labelSlug("Occupancy"));
  });
});

describe("values", () => {
  test("stored statuses and methods are translated", () => {
    assert.equal(translateValue("overdue", "ar"), "متأخر");
    assert.equal(translateValue("bank_transfer", "ar"), "تحويل بنكي");
    assert.equal(translateValue("Monthly", "ar"), "شهري");
  });

  test("what a generator wrote as a charge or a note is said in the reader's language", () => {
    assert.equal(translateValue("Monthly Rent - September 2026", "ar"), "إيجار شهري — سبتمبر 2026");
    assert.equal(translateValue("Security deposit for lease", "ar"), "مبلغ التأمين");
    // An invoice type only the transaction list's table names.
    assert.equal(translateValue("parking_fee", "ar"), "رسوم المواقف");
    assert.equal(translateValue("Credit note CN-2026-0004", "ar"), "إشعار دائن CN-2026-0004");
    assert.equal(translateValue("Required before lease commencement", "ar"), "مطلوب قبل بدء العقد");
    // A building named after the dash can run past forty characters.
    assert.equal(
      translateValue("Monthly Rent - برج الياسمين السكني الفاخر - المرحلة الثانية", "ar"),
      "إيجار شهري — برج الياسمين السكني الفاخر - المرحلة الثانية",
    );
    // English readers get what was stored.
    assert.equal(translateValue("Monthly Rent - September 2026", "en"), "Monthly Rent - September 2026");
  });

  test("names, notes and numbers are left alone", () => {
    assert.equal(translateValue("طلال القحطاني", "ar"), "طلال القحطاني");
    assert.equal(translateValue(1200, "ar"), 1200);
    assert.equal(
      translateValue("paid via Ejari, balance on the 5th", "ar"),
      "paid via Ejari, balance on the 5th",
    );
    assert.equal(
      translateValue("Rent due after the handover", "ar"),
      "Rent due after the handover",
    );
  });
});

describe("the language a download asks for", () => {
  test("lang wins; an old rtl-only link still reads as Arabic", () => {
    assert.equal(reportLanguage(new URLSearchParams("lang=ar")), "ar");
    // French was removed on 2026-10-16: an old link asking for it reads English.
    assert.equal(reportLanguage(new URLSearchParams("lang=fr")), "en");
    assert.equal(reportLanguage(new URLSearchParams("rtl=1")), "ar");
    assert.equal(reportLanguage(new URLSearchParams("")), "en");
    assert.equal(reportLanguage(new URLSearchParams("lang=xx")), "en");
  });
});

describe("a whole sheet", () => {
  test("title, headers, summary and known values — not the rest", () => {
    const sheet = localizeSheet(
      {
        title: "Overdue Tenants",
        columns: [
          { header: "Tenant", value: (row: { name: string; state: string }) => row.name },
          { header: "Status", value: (row: { name: string; state: string }) => row.state },
        ],
        rows: [{ name: "Active Holdings", state: "overdue" }],
        summary: [["Total overdue", 9600]],
      },
      "ar",
    );
    assert.equal(sheet.title, "المستأجرون المتأخرون");
    assert.deepEqual(
      sheet.columns.map((column) => column.header),
      ["المستأجر", "الحالة"],
    );
    const [row] = sheet.rows;
    // "Active Holdings" is a name, not the status "active".
    assert.equal(sheet.columns[0].value(row), "Active Holdings");
    assert.equal(sheet.columns[1].value(row), "متأخر");
    assert.deepEqual(sheet.summary, [["إجمالي المتأخر", 9600]]);
  });
});
