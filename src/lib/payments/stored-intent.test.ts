/**
 * A payment is settled only by its own card charge.
 *
 * A tenant could write any Stripe payment-intent id onto their unpaid rent
 * (PATCH /api/payments/[id], "processPayment") and then call
 * POST /api/payments/create-intent, which asked the gateway one question —
 * has this intent succeeded? — and marked the rent paid. Last month's receipt
 * settled this month's rent, and a 50-riyal fee settled 5,000.
 *
 * The action is retired, and the intent now has to be this payment's: named
 * for it in the gateway's own metadata, for its amount, in its currency, and
 * found on a payment still waiting for its money.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  intentMismatch,
  isUnknownIntentError,
  storedIntentAction,
  type IntentPayment,
  type StoredIntent,
} from "@/lib/payments/stored-intent";
import { PaymentStatus } from "@/types";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";

const rent: IntentPayment = {
  id: "pay_rent",
  amount: 5000,
  amountPaid: 0,
  currency: "SAR",
  status: PaymentStatus.PENDING,
};

/** The intent create-intent raises for `rent`, as Stripe reports it. */
function intentFor(
  payment: IntentPayment,
  overrides: Partial<StoredIntent> = {},
): StoredIntent {
  return {
    status: "succeeded",
    amount: payment.amount,
    currency: "sar",
    metadata: { source: "PropertyPro", paymentId: payment.id },
    ...overrides,
  };
}

describe("a succeeded intent that is not this payment's", () => {
  test("raised for another payment is never recorded, whatever it charged", () => {
    const lastMonth = intentFor(rent, {
      metadata: { source: "PropertyPro", paymentId: "pay_last_month" },
    });
    assert.equal(intentMismatch(lastMonth, rent), "payment");
    assert.equal(storedIntentAction(lastMonth, rent), "review");
  });

  test("a small fee's receipt does not settle the rent", () => {
    const fee = intentFor(rent, {
      amount: 50,
      metadata: { paymentId: "pay_fee" },
    });
    assert.equal(storedIntentAction(fee, rent), "review");
  });

  test("with no payment named in its metadata is not recorded either", () => {
    const unnamed: StoredIntent["metadata"][] = [
      undefined,
      null,
      {},
      { invoiceId: "inv_1" },
    ];
    for (const metadata of unnamed) {
      const anonymous = intentFor(rent, { metadata });
      assert.equal(intentMismatch(anonymous, rent), "payment");
      assert.equal(storedIntentAction(anonymous, rent), "review");
    }
  });

  test("is left for a person rather than replaced — money moved on it", () => {
    const foreign = intentFor(rent, { metadata: { paymentId: "pay_other" } });
    assert.notEqual(storedIntentAction(foreign, rent), "replace");
    assert.notEqual(storedIntentAction(foreign, rent), "reuse");
  });
});

describe("this payment's own succeeded intent", () => {
  test("is recorded when it charged what the payment owes", () => {
    assert.equal(intentMismatch(intentFor(rent), rent), null);
    assert.equal(storedIntentAction(intentFor(rent), rent), "complete");
  });

  test("is recorded on an overdue or previously failed payment too", () => {
    for (const status of [PaymentStatus.OVERDUE, PaymentStatus.FAILED]) {
      const payment = { ...rent, status };
      assert.equal(storedIntentAction(intentFor(payment), payment), "complete");
    }
  });

  test("is not recorded when it charged a different amount", () => {
    for (const amount of [4999.99, 5000.01, 50, 500000]) {
      const intent = intentFor(rent, { amount });
      assert.equal(intentMismatch(intent, rent), "amount");
      assert.equal(storedIntentAction(intent, rent), "review");
    }
  });

  test("is not recorded when it charged another currency", () => {
    const dollars = intentFor(rent, { currency: "usd" });
    assert.equal(intentMismatch(dollars, rent), "currency");
    assert.equal(storedIntentAction(dollars, rent), "review");
    assert.equal(
      storedIntentAction(intentFor(rent, { currency: "" }), rent),
      "review",
    );
  });

  test("does not bring back a payment that is no longer waiting for money", () => {
    for (const status of [
      PaymentStatus.REFUNDED,
      PaymentStatus.CANCELLED,
      PaymentStatus.PARTIAL,
      PaymentStatus.PAID,
    ]) {
      const closed = { ...rent, status };
      assert.equal(
        storedIntentAction(intentFor(closed), closed),
        "review",
        status,
      );
    }
    const partPaid = { ...rent, amountPaid: 1000 };
    assert.equal(storedIntentAction(intentFor(partPaid), partPaid), "review");
  });
});

describe("matching the amount and currency", () => {
  test("compares in the smallest unit, not in floating point", () => {
    // Two sums that are the same money and different floats.
    const sums: Array<[number, number]> = [
      [0.1 + 0.2, 0.3],
      [1.1 + 2.2, 3.3],
    ];
    for (const [due, charged] of sums) {
      assert.notEqual(due, charged);
      const payment = { ...rent, amount: due };
      assert.equal(
        intentMismatch(intentFor(payment, { amount: charged }), payment),
        null,
      );
    }
  });

  test("one halala apart is a different amount", () => {
    const payment = { ...rent, amount: 1200.1 };
    assert.equal(
      intentMismatch(intentFor(payment, { amount: 1200.11 }), payment),
      "amount",
    );
  });

  test("reads a zero-decimal currency as whole units", () => {
    const yen = { ...rent, amount: 50000, currency: "JPY" };
    assert.equal(intentMismatch(intentFor(yen, { currency: "jpy" }), yen), null);
    assert.equal(
      intentMismatch(intentFor(yen, { currency: "jpy", amount: 500 }), yen),
      "amount",
    );
  });

  test("ignores the case the gateway writes the currency in", () => {
    assert.equal(intentMismatch(intentFor(rent, { currency: "SAR" }), rent), null);
    assert.equal(intentMismatch(intentFor(rent, { currency: "sar" }), rent), null);
  });

  test("a payment without a currency is in the market's", () => {
    const bare = { ...rent, currency: null };
    const intent = intentFor(bare, { currency: DEFAULT_CURRENCY.toLowerCase() });
    assert.equal(intentMismatch(intent, bare), null);
  });

  test("never matches a payment with no id", () => {
    const nameless = { ...rent, id: "" };
    const intent = intentFor(rent, { metadata: { paymentId: "" } });
    assert.equal(intentMismatch(intent, nameless), "payment");
  });
});

describe("an intent nothing was taken on", () => {
  test("this payment's own open intent is handed back to finish", () => {
    for (const status of [
      "requires_payment_method",
      "requires_confirmation",
      "requires_action",
      "processing",
    ]) {
      assert.equal(storedIntentAction(intentFor(rent, { status }), rent), "reuse");
    }
  });

  test("another payment's open intent is never handed back", () => {
    const foreign = intentFor(rent, {
      status: "requires_payment_method",
      metadata: { paymentId: "pay_other" },
    });
    assert.equal(storedIntentAction(foreign, rent), "replace");
  });

  test("an open intent that names no payment is kept, not dropped unpaid", () => {
    // The invoice route raises these before its payment row exists. Dropping
    // a live intent would leave a card form that can still be paid, with no
    // payment pointing at the charge.
    const unnamed: StoredIntent["metadata"][] = [
      undefined,
      null,
      {},
      { invoiceId: "inv_1" },
      { paymentId: "" },
    ];
    for (const metadata of unnamed) {
      const open = intentFor(rent, { status: "requires_payment_method", metadata });
      assert.equal(storedIntentAction(open, rent), "reuse");
      // ...and the same intent, once paid, still settles nothing by itself.
      assert.equal(storedIntentAction({ ...open, status: "succeeded" }, rent), "review");
    }
  });

  test("a cancelled intent is replaced", () => {
    assert.equal(
      storedIntentAction(intentFor(rent, { status: "canceled" }), rent),
      "replace",
    );
    assert.equal(
      storedIntentAction(
        intentFor(rent, { status: "canceled", metadata: { paymentId: "x" } }),
        rent,
      ),
      "replace",
    );
  });
});

describe("an intent the gateway could not be asked about", () => {
  test("is unknown only when the gateway says there is none", () => {
    // Stripe's answer to retrieving an id it has never issued.
    const missing = Object.assign(new Error("No such payment_intent: 'pi_x'"), {
      type: "StripeInvalidRequestError",
      code: "resource_missing",
      statusCode: 404,
    });
    assert.equal(isUnknownIntentError(missing), true);
    assert.equal(isUnknownIntentError({ code: "resource_missing" }), true);
    assert.equal(isUnknownIntentError({ statusCode: 404 }), true);
  });

  test("is not unknown when the gateway did not answer", () => {
    // Forgetting the intent on any of these would leave a charge that may
    // already have gone through with no payment to be recorded on.
    const unanswered: unknown[] = [
      Object.assign(new Error("connect ETIMEDOUT"), { type: "StripeConnectionError" }),
      Object.assign(new Error("Too many requests"), { statusCode: 429 }),
      Object.assign(new Error("Invalid API Key"), { statusCode: 401 }),
      Object.assign(new Error("Stripe is not configured"), { statusCode: 503 }),
      Object.assign(new Error("An error occurred"), { statusCode: 500 }),
      new Error("Failed to retrieve payment intent"),
      "resource_missing",
      null,
      undefined,
    ];
    for (const error of unanswered) {
      assert.equal(isUnknownIntentError(error), false, String(error));
    }
  });
});
