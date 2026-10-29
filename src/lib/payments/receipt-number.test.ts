/**
 * Two receipts raced for one payment, and the loser has to find the winner's.
 *
 * The receipt writer told its two collisions apart by `meta.target`, which
 * this stack never sets: under row-level security Postgres leaves the key out
 * of its error and only names the constraint in its own message. A second
 * receipt for the same payment was taken for a taken number, retried four
 * times under new numbers, and then failed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  formatPaymentNumber,
  parsePaymentNumber,
  receiptCollision,
  receiptNumberFor,
} from "@/lib/payments/receipt-number";

/** A unique violation as the database really reports it, under RLS. */
function underRls(constraint: string) {
  return {
    code: "P2002",
    message: "Unique constraint failed on the (not available)",
    meta: {
      modelName: "PaymentReceipt",
      driverAdapterError: {
        name: "DriverAdapterError",
        cause: {
          originalCode: "23505",
          originalMessage: `duplicate key value violates unique constraint "${constraint}"`,
          kind: "UniqueConstraintViolation",
        },
      },
    },
  };
}

describe("a failed receipt insert", () => {
  test("names a second receipt for the same payment", () => {
    assert.equal(
      receiptCollision(underRls("payment_receipts_paymentId_key")),
      "payment",
    );
    assert.equal(
      receiptCollision({ code: "P2002", meta: { target: ["paymentId"] } }),
      "payment",
    );
  });

  test("names a receipt number that is already taken", () => {
    assert.equal(
      receiptCollision(underRls("payment_receipts_organizationId_receiptNumber_key")),
      "number",
    );
  });

  test("is not a collision when nothing unique was hit", () => {
    assert.equal(receiptCollision(new Error("connection reset")), null);
    assert.equal(receiptCollision({ code: "P2003", meta: {} }), null);
  });
});

describe("a receipt number", () => {
  test("is the payment's own number, whatever receipt was stored before", () => {
    assert.equal(receiptNumberFor("cmabc12345678", "202609-0007", 42), "RCP-000042");
    assert.equal(receiptNumberFor("cmabc12345678", null, 7), "RCP-000007");
  });

  test("before the payment is numbered: the stored one, else one made from the id", () => {
    assert.equal(receiptNumberFor("cmabc12345678", " RCP-2026-0007 "), "RCP-2026-0007");
    assert.equal(receiptNumberFor("cmabc12345678", " RCP-2026-0007 ", null), "RCP-2026-0007");
    assert.equal(receiptNumberFor("cmabc12345678"), "RCP-12345678");
  });
});

describe("a payment number", () => {
  test("prints as RCP- and six digits, longer numbers in full", () => {
    assert.equal(formatPaymentNumber(123), "RCP-000123");
    assert.equal(formatPaymentNumber(1), "RCP-000001");
    assert.equal(formatPaymentNumber(999999), "RCP-999999");
    assert.equal(formatPaymentNumber(1234567), "RCP-1234567");
  });

  test("is absent on a payment nobody has paid — the screens show a dash", () => {
    assert.equal(formatPaymentNumber(null), null);
    assert.equal(formatPaymentNumber(undefined), null);
    assert.equal(formatPaymentNumber(0), null);
    assert.equal(formatPaymentNumber(-3), null);
    assert.equal(formatPaymentNumber(1.5), null);
  });

  test("is found by a search however it is typed", () => {
    for (const typed of ["RCP-000123", "rcp-123", "RCP 000123", "rcp123", "#123", "000123", "123", " 123 "]) {
      assert.equal(parsePaymentNumber(typed), 123, typed);
    }
  });

  test("is not read into a name, a phone number or a contract reference", () => {
    for (const typed of ["", "Ahmed", "+966 50 123 4567", "AGR-2023-002", "RCP-", "12a", "0", "000", null, undefined]) {
      assert.equal(parsePaymentNumber(typed), null, String(typed));
    }
  });

  test("printed and read back is the same number", () => {
    for (const number of [1, 42, 123456, 7654321]) {
      assert.equal(parsePaymentNumber(formatPaymentNumber(number)), number);
    }
  });
});
