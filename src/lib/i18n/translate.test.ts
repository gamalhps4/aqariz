/**
 * Catalogue text outside React — what emails, notifications and SMS are
 * written with. Same lookup order as the screens: the language, then
 * English, then the fallback, then the key; never blank.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  fillPlaceholders,
  formatDateFor,
  formatMonthFor,
  pluralKey,
  translateFor,
} from "@/lib/i18n/translate";

describe("translateFor", () => {
  test("reads the recipient's language, filling placeholders", () => {
    assert.equal(
      translateFor("ar", "notifications.message.leaseExpiryStaff.message.other", {
        property: "برج الياسمين",
        days: 30,
      }),
      "يقترب انتهاء عقد برج الياسمين. الأيام المتبقية: 30",
    );
    assert.equal(
      translateFor("en", "notifications.message.leaseExpiryStaff.message.other", {
        property: "Oak Towers",
        days: 30,
      }),
      "Lease for Oak Towers expires in 30 days",
    );
  });

  test("accepts a full locale or a recipient locale object", () => {
    assert.equal(
      translateFor("ar-SA", "notifications.message.paymentOverdue.title"),
      "إشعار بدفعة متأخرة",
    );
    assert.equal(
      translateFor({ language: "ar" }, "notifications.message.paymentOverdue.title"),
      "إشعار بدفعة متأخرة",
    );
  });

  test("an unknown language reads English; an unknown key its fallback, then itself", () => {
    assert.equal(
      translateFor("zh", "notifications.message.paymentOverdue.title"),
      "Overdue payment notice",
    );
    assert.equal(translateFor("ar", "no.such.key", undefined, "Fallback"), "Fallback");
    assert.equal(translateFor("ar", "no.such.key"), "no.such.key");
  });

  test("placeholders in both brace styles; values are not read as patterns", () => {
    assert.equal(
      fillPlaceholders("{{a}} and {a} and {b}", { a: "$1", b: null }),
      "$1 and $1 and ",
    );
  });

  test("English counts pick the singular; Arabic reads for any number", () => {
    assert.equal(pluralKey("x", 1), "x.one");
    assert.equal(pluralKey("x", 0), "x.other");
    assert.equal(pluralKey("x", 3), "x.other");
    assert.equal(
      translateFor("en", pluralKey("notifications.message.paymentReminder.message", 1), { days: 1 }),
      "Your rent payment is due in 1 day",
    );
    const arOne = translateFor("ar", pluralKey("notifications.message.paymentReminder.message", 1), { days: 1 });
    const arMany = translateFor("ar", pluralKey("notifications.message.paymentReminder.message", 3), { days: 3 });
    assert.equal(arOne, "موعد سداد إيجارك يقترب. الأيام المتبقية: 1");
    assert.equal(arMany, "موعد سداد إيجارك يقترب. الأيام المتبقية: 3");
  });
});

describe("dates for a recipient", () => {
  const date = new Date("2026-09-14T09:00:00Z");

  test("Arabic months with Western digits, in the office's zone", () => {
    const arabic = formatDateFor("ar", date, { timeZone: "Asia/Riyadh" });
    assert.match(arabic, /سبتمبر/);
    assert.match(arabic, /14/);
    assert.match(arabic, /2026/);
    assert.doesNotMatch(arabic, /[٠-٩]/, "no Arabic-Indic digits");
    assert.equal(formatMonthFor("en", date, { timeZone: "UTC" }), "September 2026");
  });

  test("an invalid date writes nothing rather than 'Invalid Date'", () => {
    assert.equal(formatDateFor("en", "not a date"), "");
  });
});
