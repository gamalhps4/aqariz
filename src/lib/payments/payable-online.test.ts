/**
 * A card charge is raised only for a payment the books can take the money on.
 *
 * create-intent raised one for anything that was not already paid. A
 * refunded or cancelled payment, a part-paid one (charged its full amount
 * again), a rent whose installment the office had since settled at the desk:
 * the tenant's card was charged, and the money then had nowhere to go.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  isAwaitingMoney,
  onlinePaymentRefusal,
} from "@/lib/payments/payable-online";
import { InvoiceStatus, PaymentStatus } from "@/types";

const rent = { status: PaymentStatus.PENDING, amount: 5000, amountPaid: 0 };
const installment = { status: InvoiceStatus.ISSUED, balanceRemaining: 5000 };

describe("a payment still waiting for its money", () => {
  test("pending, overdue or previously failed, with nothing recorded on it", () => {
    for (const status of [
      PaymentStatus.PENDING,
      PaymentStatus.OVERDUE,
      PaymentStatus.FAILED,
    ]) {
      assert.equal(isAwaitingMoney({ ...rent, status }), true, status);
      assert.equal(onlinePaymentRefusal({ ...rent, status }), null, status);
    }
    assert.equal(isAwaitingMoney({ ...rent, amountPaid: null }), true);
  });

  test("not one that is paid, part-paid, refunded or cancelled", () => {
    const closed: Array<[string, string]> = [
      [PaymentStatus.PAID, "it is paid"],
      [PaymentStatus.PARTIAL, "it is part-paid"],
      [PaymentStatus.REFUNDED, "it is refunded"],
      [PaymentStatus.CANCELLED, "it is cancelled"],
    ];
    for (const [status, reason] of closed) {
      assert.equal(isAwaitingMoney({ ...rent, status }), false, status);
      assert.equal(onlinePaymentRefusal({ ...rent, status }), reason);
      // The installment having room does not reopen the payment.
      assert.equal(onlinePaymentRefusal({ ...rent, status }, installment), reason);
    }
  });

  test("not one that reads pending but already has money on it", () => {
    const partPaid = { ...rent, amountPaid: 1000 };
    assert.equal(isAwaitingMoney(partPaid), false);
    assert.equal(
      onlinePaymentRefusal(partPaid),
      "money is already recorded against it",
    );
  });
});

describe("the installment the payment belongs to", () => {
  test("takes the payment when it still owes at least that much", () => {
    assert.equal(onlinePaymentRefusal(rent, installment), null);
    assert.equal(
      onlinePaymentRefusal(rent, { ...installment, balanceRemaining: 8000 }),
      null,
    );
    assert.equal(
      onlinePaymentRefusal(rent, { ...installment, status: InvoiceStatus.OVERDUE }),
      null,
    );
  });

  test("is not asked about when the payment has none", () => {
    assert.equal(onlinePaymentRefusal(rent), null);
    assert.equal(onlinePaymentRefusal(rent, undefined), null);
  });

  test("refuses when it is gone", () => {
    assert.equal(
      onlinePaymentRefusal(rent, null),
      "its installment no longer exists",
    );
  });

  test("refuses when it is cancelled", () => {
    assert.equal(
      onlinePaymentRefusal(rent, { ...installment, status: InvoiceStatus.CANCELLED }),
      "its installment is cancelled",
    );
  });

  test("refuses when the office has already settled it", () => {
    assert.equal(
      onlinePaymentRefusal(rent, { status: InvoiceStatus.PAID, balanceRemaining: 0 }),
      "its installment is already fully paid",
    );
  });

  test("refuses a charge for more than is left on it", () => {
    assert.equal(
      onlinePaymentRefusal(rent, { status: InvoiceStatus.PARTIAL, balanceRemaining: 2750 }),
      "only 2750.00 is left on its installment",
    );
  });

  test("allows the half-halala of rounding the recording path allows", () => {
    assert.equal(
      onlinePaymentRefusal(rent, { ...installment, balanceRemaining: 4999.996 }),
      null,
    );
    assert.notEqual(
      onlinePaymentRefusal(rent, { ...installment, balanceRemaining: 4999.99 }),
      null,
    );
  });
});
