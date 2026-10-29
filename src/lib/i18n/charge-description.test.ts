/**
 * Stored English charge descriptions, shown in the reader's language.
 *
 * The generators wrote "Monthly Rent", "Monthly rent - September 2026",
 * "Security Deposit" and the like into every installment and payment. Those
 * rows are not rewritten; `describeCharge` recognises the generators' own
 * wordings and says them in the reader's language from the row's structured
 * data. A description somebody typed is never touched.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  chargePeriodText,
  describeCharge,
  describeChargeNote,
} from "@/lib/i18n/charge-description";

describe("describeCharge", () => {
  test("an installment line names its frequency and billing month", () => {
    const line = {
      description: "Monthly Rent",
      type: "rent",
      periodStart: "2026-09-01T00:00:00.000Z",
      periodEnd: "2026-09-30T00:00:00.000Z",
    };
    assert.equal(describeCharge(line, "ar"), "إيجار شهري — سبتمبر 2026");
    assert.equal(describeCharge(line, "en"), "Monthly rent — September 2026");
  });

  test("a quarterly, prorated installment spans its months", () => {
    const line = {
      description: "Quarterly Rent (Prorated)",
      type: "rent",
      periodStart: "2026-09-15T00:00:00.000Z",
      periodEnd: "2026-11-30T00:00:00.000Z",
    };
    assert.equal(
      describeCharge(line, "ar"),
      "إيجار ربع سنوي (بالتناسب مع المدة) — سبتمبر 2026 – نوفمبر 2026",
    );
  });

  test("a planned row takes the frequency from the contract", () => {
    assert.equal(
      describeCharge(
        { description: "Rent (prorated)", frequency: "semi_annual", periodStart: "2026-01-01T00:00:00Z" },
        "ar",
      ),
      "إيجار نصف سنوي (بالتناسب مع المدة) — يناير 2026",
    );
    assert.equal(describeCharge({ description: "Rent" }, "ar"), "إيجار");
  });

  test("a scheduler's month written in English reads as the reader's month", () => {
    assert.equal(
      describeCharge({ description: "Monthly rent - September 2026", type: "rent" }, "ar"),
      "إيجار شهري — سبتمبر 2026",
    );
    assert.equal(
      describeCharge({ description: "Monthly Rent - برج الياسمين" }, "ar"),
      "إيجار شهري — برج الياسمين",
      "a building named after the dash is kept as typed",
    );
  });

  test("deposits, utilities and the other generated wordings", () => {
    assert.equal(describeCharge({ description: "Security Deposit" }, "ar"), "مبلغ التأمين");
    assert.equal(describeCharge({ description: "Security deposit for lease" }, "ar"), "مبلغ التأمين");
    assert.equal(describeCharge({ description: "Electricity", type: "electricity" }, "ar"), "الكهرباء");
    assert.equal(describeCharge({ description: "Water" }, "ar"), "المياه");
    assert.equal(describeCharge({ description: "Additional charge" }, "ar"), "رسوم إضافية");
    assert.equal(
      describeCharge({ description: "Advance Rent Payment - Month 2" }, "ar"),
      "إيجار مقدَّم — الشهر 2",
    );
    assert.equal(
      describeCharge({ description: "Monthly rent payment #3 (prorated)" }, "en"),
      "Rent payment no. 3 (prorated)",
    );
    assert.equal(
      describeCharge({ description: "Payment - bank_transfer" }, "ar"),
      "دفعة — تحويل بنكي",
    );
  });

  test("text somebody typed is shown exactly as typed", () => {
    assert.equal(
      describeCharge({ description: "Maintenance contribution", type: "rent" }, "ar"),
      "Maintenance contribution",
    );
    assert.equal(describeCharge({ description: "رسوم موقف" }, "en"), "رسوم موقف");
  });

  test("no description: the type names the charge", () => {
    assert.equal(
      describeCharge({ type: "rent", periodStart: "2026-03-01T00:00:00Z" }, "ar"),
      "إيجار — مارس 2026",
    );
    assert.equal(describeCharge({ type: "security_deposit" }, "ar"), "مبلغ التأمين");
    assert.equal(describeCharge({}, "ar"), "");
  });

  test("the transaction list's wordings: a payment by its type, an invoice by its number", () => {
    assert.equal(describeCharge({ description: "Rent Payment" }, "ar"), "دفعة إيجار");
    assert.equal(describeCharge({ description: "Rent Payment" }, "en"), "Rent payment");
    assert.equal(describeCharge({ description: "Late Fee" }, "ar"), "رسوم تأخير");
    assert.equal(describeCharge({ description: "Utility Payment" }, "ar"), "رسوم الخدمات");
    assert.equal(describeCharge({ description: "Maintenance Payment" }, "ar"), "رسوم الصيانة");
    assert.equal(describeCharge({ description: "Invoice Payment" }, "ar"), "سداد فاتورة");
    assert.equal(describeCharge({ description: "Other Payment" }, "ar"), "دفعة أخرى");
    assert.equal(describeCharge({ description: "Payment" }, "ar"), "دفعة");
    assert.equal(describeCharge({ description: "Invoice INV-2026-0001" }, "ar"), "فاتورة INV-2026-0001");
    assert.equal(describeCharge({ description: "Invoice INV-2026-0001" }, "en"), "Invoice INV-2026-0001");
  });

  test("a receipt's line for a payment without a description", () => {
    assert.equal(describeCharge({ description: "Payment for rent" }, "ar"), "دفعة عن الإيجار");
    assert.equal(describeCharge({ description: "Payment for security deposit" }, "ar"), "دفعة عن التأمين");
    assert.equal(describeCharge({ description: "Payment for INV-2026-0001" }, "ar"), "دفعة عن INV-2026-0001");
  });

  test("what late fees wrote before they were removed", () => {
    assert.equal(
      describeCharge({ description: "Late Fee - 5 days overdue" }, "ar"),
      "رسوم تأخير — عدد أيام التأخر: 5",
    );
    assert.equal(
      describeCharge({ description: "Late Fee - 5 days overdue" }, "en"),
      "Late fee — 5 days overdue",
    );
  });

  test("a journal's own memos: the opening entry and a reversal", () => {
    assert.equal(describeCharge({ description: "Opening balances" }, "ar"), "أرصدة افتتاحية");
    assert.equal(
      describeCharge({ description: "Reversal of entry 12" }, "ar"),
      "يعكس القيد رقم 12",
    );
    assert.equal(describeCharge({ description: "Reversal of entry 12" }, "en"), "Reverses #12");
  });

  test("the tenant ledger's own lines", () => {
    assert.equal(describeCharge({ description: "Credit note CN-2026-0004" }, "ar"), "إشعار دائن CN-2026-0004");
    assert.equal(describeCharge({ description: "Discount" }, "ar"), "خصم");
    assert.equal(describeCharge({ description: "VAT" }, "ar"), "ضريبة القيمة المضافة");
    assert.equal(describeCharge({ description: "Opening balance" }, "ar"), "رصيد افتتاحي");
    assert.equal(describeCharge({ description: "Payment -" }, "ar"), "دفعة");
    assert.equal(
      describeCharge({ description: "Payment - paypal" }, "ar"),
      "دفعة — PayPal",
      "a gateway method the export catalogue lacks still has its label",
    );
    // An invoice without lines is charged under its category.
    assert.equal(describeCharge({ description: "security_deposit" }, "ar"), "مبلغ التأمين");
    assert.equal(
      describeCharge({ description: "rent", periodStart: "2026-03-01T00:00:00Z" }, "ar"),
      "إيجار — مارس 2026",
    );
  });

  test("a payment type with no wording of its own: the scheduler's fallback and a bare type", () => {
    assert.equal(
      describeCharge({ description: "other payment - September 2026" }, "ar"),
      "دفعة أخرى — سبتمبر 2026",
    );
    assert.equal(describeCharge({ type: "late_fee" }, "ar"), "رسوم تأخير");
    // A type only the transaction catalogue names.
    assert.equal(
      describeCharge({ type: "parking_fee" }, "en"),
      "Parking fee",
    );
    assert.equal(describeCharge({ type: "no_such_type" }, "ar"), "");
  });

  test("words that only look like a wording stay as typed", () => {
    assert.equal(describeCharge({ description: "Invoice discussion" }, "ar"), "Invoice discussion");
    assert.equal(describeCharge({ description: "Credit note for the broken door" }, "ar"), "Credit note for the broken door");
    assert.equal(describeCharge({ description: "constructor" }, "ar"), "constructor");
    assert.equal(describeCharge({ description: "cleaning" }, "ar"), "cleaning");
  });

  test("periods read in UTC, the way the generators store them", () => {
    assert.equal(
      chargePeriodText({ periodStart: "2026-10-01T00:00:00.000Z" }, "en"),
      "October 2026",
    );
    assert.equal(chargePeriodText({}, "en"), null);
  });
});

describe("describeChargeNote", () => {
  test("notes the system wrote are said in the reader's language", () => {
    assert.equal(
      describeChargeNote("Required before lease commencement", "ar"),
      "مطلوب قبل بدء العقد",
    );
    assert.equal(describeChargeNote("Recorded in bulk", "ar"), "سُجِّلت ضمن عملية جماعية");
    assert.equal(
      describeChargeNote("Applied to 2 invoice(s)", "ar"),
      "طُبِّقت على الفواتير (العدد: 2)",
    );
    assert.equal(
      describeChargeNote("Cancelled due to lease terminated", "ar"),
      "أُلغيت بسبب حالة العقد: مُنهى",
    );
    assert.equal(
      describeChargeNote("Applied to 1 invoice(s) [REVERSED]", "ar"),
      "طُبِّقت على الفواتير (العدد: 1) [تم العكس]",
    );
    assert.equal(
      describeChargeNote("Payment failed at Moyasar: card declined", "ar"),
      "تعذّر الدفع لدى Moyasar: card declined",
    );
    assert.equal(
      describeChargeNote("Paid with mada through Moyasar", "ar"),
      "دُفعت عبر Moyasar باستخدام mada",
    );
    assert.equal(describeChargeNote("Paid through PayTabs", "ar"), "دُفعت عبر PayTabs");
    assert.equal(
      describeChargeNote("Payment failed at Tap", "en"),
      "Payment failed at Tap",
    );
  });

  test("a prorated range written with Date#toDateString reads as dates", () => {
    const text = describeChargeNote("Prorated for Tue Sep 15 2026 to Wed Sep 30 2026", "en");
    assert.match(text, /^Prorated for 15 September 2026 to 30 September 2026$|^Prorated for September 15, 2026 to September 30, 2026$/);
    assert.match(describeChargeNote("Prorated for Tue Sep 15 2026 to Wed Sep 30 2026", "ar"), /^بالتناسب من .*2026 إلى .*2026$/);
  });

  test("a note somebody typed is shown exactly as typed", () => {
    assert.equal(describeChargeNote("  Paid at the desk by his brother ", "ar"), "Paid at the desk by his brother");
    assert.equal(describeChargeNote("دفع نقدًا", "en"), "دفع نقدًا");
    assert.equal(describeChargeNote(null, "ar"), "");
  });
});
