/**
 * The payment methods an office records with, and who received the money.
 *
 * The client's list is exactly six: Cash, POS, Bank Transfer, Cash to Owner,
 * Transfer to Owner, Ejar Platform. The last three reached the owner, not the
 * office, and every agreement and owner report must count them that way —
 * which decides whether a settlement says "the office owes the owner" or the
 * reverse. Before this, an unknown method was quietly recorded as cash, and
 * "cash to owner" did not exist at all, so it could only be entered as cash.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { PaymentMethod } from "@/types";
import {
  MANUAL_PAYMENT_METHODS,
  OWNER_RECEIVED_METHODS,
  isManualPaymentMethod,
  isReceivedByOwner,
  paymentMethodLabel,
} from "@/lib/payments/methods";
import {
  manualPaymentMethodSchema,
  paymentCreateSchema,
} from "@/lib/validations";
import { translations } from "@/locales";

const LOCALES = ["en", "ar"] as const;

/** Stands in for the provider's `t`: the catalogue's English, else the default. */
const englishT = (key: string, options?: { defaultValue?: string }) =>
  translations[key]?.en ?? options?.defaultValue ?? key;

describe("the methods staff can pick", () => {
  test("are the client's six, in the client's order", () => {
    assert.deepEqual(
      MANUAL_PAYMENT_METHODS.map((option) => option.value),
      ["cash", "pos", "bank_transfer", "owner_cash", "owner_account", "ejari"],
    );
  });

  test("keep the stored values of the two relabelled methods", () => {
    assert.equal(PaymentMethod.OWNER_ACCOUNT, "owner_account");
    assert.equal(PaymentMethod.EJARI, "ejari");
    assert.equal(paymentMethodLabel("owner_account", englishT), "Transfer to Owner");
    assert.equal(paymentMethodLabel("ejari", englishT), "Ejar Platform");
  });

  test("carry a label in every locale, on screen and in exports", () => {
    for (const option of MANUAL_PAYMENT_METHODS) {
      for (const locale of LOCALES) {
        assert.ok(
          translations[option.labelKey]?.[locale],
          `${option.labelKey} has no ${locale} text`,
        );
        assert.ok(
          translations[`exports.value.${option.value}`]?.[locale],
          `exports.value.${option.value} has no ${locale} text`,
        );
      }
    }
  });

  test("the Arabic names the client's Ejar, not Dubai's Ejari", () => {
    assert.equal(translations["payments.record.paymentMethods.ejari"].ar, "منصة إيجار");
    assert.equal(translations["exports.value.ejari"].ar, "منصة إيجار");
  });
});

describe("methods no longer offered", () => {
  const retired = [
    PaymentMethod.CREDIT_CARD,
    PaymentMethod.DEBIT_CARD,
    PaymentMethod.CHECK,
    PaymentMethod.ACH,
    PaymentMethod.MONEY_ORDER,
    PaymentMethod.OTHER,
    PaymentMethod.PAYPAL,
  ];

  test("cannot be picked", () => {
    for (const method of retired) {
      assert.equal(isManualPaymentMethod(method), false, method);
    }
  });

  test("still read as words on older payments", () => {
    for (const method of Object.values(PaymentMethod)) {
      assert.notEqual(paymentMethodLabel(method, englishT), method, method);
    }
    assert.equal(paymentMethodLabel("credit_card", englishT), "Credit Card");
    assert.equal(paymentMethodLabel("manual", englishT), "Manual");
  });

  test("free text from before the enum is shown as written", () => {
    assert.equal(paymentMethodLabel("wire via cousin", englishT), "wire via cousin");
    assert.equal(paymentMethodLabel("constructor", englishT), "constructor");
    assert.equal(paymentMethodLabel(null, englishT), "");
  });
});

describe("validating a recorded method", () => {
  test("accepts each of the six", () => {
    for (const option of MANUAL_PAYMENT_METHODS) {
      assert.equal(manualPaymentMethodSchema.safeParse(option.value).success, true, option.value);
    }
  });

  test("refuses anything else instead of recording it as cash", () => {
    for (const value of ["manual", "online", "credit_card", "check", "other", "CASH", "", " cash"]) {
      assert.equal(manualPaymentMethodSchema.safeParse(value).success, false, JSON.stringify(value));
    }
    assert.equal(manualPaymentMethodSchema.safeParse(undefined).success, false);
  });

  test("says which methods it takes", () => {
    const result = manualPaymentMethodSchema.safeParse("manual");
    assert.equal(result.success, false);
    const message = result.success ? "" : result.error.errors[0].message;
    for (const option of MANUAL_PAYMENT_METHODS) {
      assert.ok(message.includes(option.value), message);
    }
  });

  test("a new payment may leave the method out, but not give an old one", () => {
    const base = {
      tenantId: "tenant",
      propertyId: "building",
      amount: 5_000,
      type: "rent",
      dueDate: "2026-10-01",
    };
    assert.equal(paymentCreateSchema.safeParse(base).success, true);
    assert.equal(paymentCreateSchema.safeParse({ ...base, paymentMethod: "pos" }).success, true);
    assert.equal(
      paymentCreateSchema.safeParse({ ...base, paymentMethod: "credit_card" }).success,
      false,
    );
  });
});

describe("money received by the owner", () => {
  test("is cash to the owner, a transfer to the owner, and Ejar", () => {
    assert.deepEqual(
      [...OWNER_RECEIVED_METHODS].sort(),
      ["ejari", "owner_account", "owner_cash"],
    );
    for (const method of OWNER_RECEIVED_METHODS) {
      assert.equal(isReceivedByOwner(method), true, method);
      assert.equal(isManualPaymentMethod(method), true, method);
    }
  });

  test("everything else reached the office, online payments included", () => {
    for (const method of [
      PaymentMethod.CASH,
      PaymentMethod.POS,
      PaymentMethod.BANK_TRANSFER,
      // How Stripe stores a card payment.
      PaymentMethod.CREDIT_CARD,
      PaymentMethod.PAYPAL,
      PaymentMethod.CHECK,
      PaymentMethod.OTHER,
    ]) {
      assert.equal(isReceivedByOwner(method), false, method);
    }
    assert.equal(isReceivedByOwner(null), false);
    assert.equal(isReceivedByOwner(undefined), false);
  });
});
