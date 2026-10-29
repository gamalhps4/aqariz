/**
 * Form validation messages in the reader's language.
 *
 * Schemas across the app were written with English messages, and the shared
 * form field printed them as they were. `validationText` reads them for an
 * Arabic (or German…) reader by kind — required, too short, not an email —
 * while English readers, and messages already translated, are left alone.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { validationText } from "@/lib/i18n/validation-text";

describe("validationText", () => {
  test("required, in all its spellings", () => {
    for (const message of ["Required", "First name is required", "Dates are required.", "Notes cannot be empty", "Please enter your name"]) {
      assert.equal(validationText(message, "ar"), "هذا الحقل مطلوب", message);
    }
  });

  test("zod's defaults and the app's own wording, by kind", () => {
    assert.equal(validationText("Invalid email", "ar"), "أدخل بريدًا إلكترونيًا صحيحًا");
    assert.equal(validationText("Please enter a valid email address", "ar"), "أدخل بريدًا إلكترونيًا صحيحًا");
    assert.equal(validationText("String must contain at least 8 character(s)", "ar"), "الحد الأدنى لعدد الأحرف: 8");
    assert.equal(validationText("Password must be at least 12 characters long", "ar"), "الحد الأدنى لعدد الأحرف: 12");
    assert.equal(validationText("Number must be greater than or equal to 0", "ar"), "يجب ألا تقل القيمة عن 0");
    assert.equal(validationText("Expected number, received nan", "ar"), "أدخل رقمًا");
    assert.equal(validationText("Invalid file URL", "ar"), "أدخل رابطًا صحيحًا");
    assert.equal(validationText("Application fee cannot be negative", "ar"), "لا يمكن أن تكون القيمة سالبة");
    assert.equal(validationText("Application fee too high", "ar"), "القيمة أعلى من المسموح");
    assert.equal(validationText("Please select a property", "ar"), "اختر أحد الخيارات");
    assert.equal(validationText("Invalid enum value. Expected 'a' | 'b', received 'c'", "ar"), "اختر أحد الخيارات");
    assert.equal(validationText("Passwords don't match", "ar"), "كلمتا المرور غير متطابقتين");
  });

  test("an exact catalogue entry wins over the generic wording", () => {
    assert.equal(
      validationText("End date must be after start date", "ar"),
      "يجب أن يكون تاريخ النهاية بعد تاريخ البداية",
    );
  });

  test("English readers and already-translated messages are left alone", () => {
    assert.equal(validationText("First name is required", "en"), "First name is required");
    assert.equal(validationText("الاسم الأول مطلوب", "ar"), "الاسم الأول مطلوب");
    assert.equal(validationText("Something odd happened", "ar"), "Something odd happened");
    assert.equal(validationText("", "ar"), "");
  });

  test("a language that no longer ships reads the English catalogue", () => {
    assert.equal(validationText("Required", "de"), "This field is required");
  });
});
