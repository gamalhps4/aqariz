/**
 * Every payment type reads in the reader's language.
 *
 * The payments list printed the stored value with one underscore replaced —
 * "security deposit" — in English on an Arabic screen.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PaymentType } from "@/types";
import {
  CHARGE_TYPES,
  paymentTypeLabel,
  paymentTypeLabelKey,
} from "@/lib/payments/type-labels";
import { translations } from "@/locales";

const LOCALES = ["en", "ar"] as const;

const tFor =
  (locale: (typeof LOCALES)[number]) =>
  (key: string, options?: { defaultValue?: string }) =>
    translations[key]?.[locale] ?? options?.defaultValue ?? key;

describe("a payment type", () => {
  test("has a label in every locale", () => {
    for (const type of Object.values(PaymentType)) {
      const label = paymentTypeLabelKey(type);
      assert.ok(label, `${type} has no label`);
      for (const locale of LOCALES) {
        assert.ok(
          translations[label.labelKey]?.[locale],
          `${label.labelKey} has no ${locale} text`,
        );
      }
    }
  });

  test("reads in Arabic on an Arabic screen", () => {
    assert.equal(paymentTypeLabel(PaymentType.SECURITY_DEPOSIT, tFor("ar")), "تأمين");
    assert.equal(paymentTypeLabel(PaymentType.RENT, tFor("en")), "Rent");
  });

  test("shows a value it does not know as it is", () => {
    assert.equal(paymentTypeLabel("parking", tFor("en")), "parking");
    assert.equal(paymentTypeLabel(undefined, tFor("en")), "");
  });

  test("is never offered as a late fee on a new charge", () => {
    assert.ok(!CHARGE_TYPES.includes(PaymentType.LATE_FEE));
  });
});
