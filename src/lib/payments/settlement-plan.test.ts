/**
 * A gateway capture settles only a payment that is still waiting for money.
 *
 * The guard used to stop at paid and part paid. A refunded payment — money
 * already handed back, and taken off its installment — went back to PAID when
 * a late or replayed Stripe event arrived, and its money was applied to the
 * installment again. A cancelled charge could be settled the same way.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  GATEWAY_FINAL_STATUSES,
  isGatewayFinal,
  planGatewaySettlement,
} from "@/lib/payments/settlement-plan";
import { PaymentStatus } from "@/types";

const rent = (status: string) => ({ status, amount: 5000, currency: "SAR" });

describe("a gateway capture", () => {
  test("never settles a refunded or cancelled payment", () => {
    for (const status of [PaymentStatus.REFUNDED, PaymentStatus.CANCELLED]) {
      assert.deepEqual(
        planGatewaySettlement(rent(status), { amount: 5000, currency: "sar" }),
        { settle: false },
        status,
      );
    }
  });

  test("does not settle one that is already settled", () => {
    for (const status of [PaymentStatus.PAID, PaymentStatus.PARTIAL]) {
      assert.deepEqual(
        planGatewaySettlement(rent(status), { amount: 5000 }),
        { settle: false },
        status,
      );
    }
  });

  test("settles what is still owed, as PAID when it covers the amount", () => {
    for (const status of [
      PaymentStatus.PENDING,
      PaymentStatus.OVERDUE,
      PaymentStatus.FAILED,
    ]) {
      assert.deepEqual(
        planGatewaySettlement(rent(status), { amount: 5000, currency: "sar" }),
        { settle: true, status: PaymentStatus.PAID, currencyMismatch: false },
        status,
      );
    }
  });

  test("records a short or foreign-currency capture as PARTIAL", () => {
    assert.deepEqual(
      planGatewaySettlement(rent(PaymentStatus.PENDING), { amount: 4999.99 }),
      { settle: true, status: PaymentStatus.PARTIAL, currencyMismatch: false },
    );
    assert.deepEqual(
      planGatewaySettlement(rent(PaymentStatus.PENDING), {
        amount: 5000,
        currency: "usd",
      }),
      { settle: true, status: PaymentStatus.PARTIAL, currencyMismatch: true },
    );
  });

  test("compares money in whole cents", () => {
    // 0.7 - 0.4 is 0.29999999999999993 in floating point.
    const plan = planGatewaySettlement(
      { status: PaymentStatus.PENDING, amount: 0.3, currency: "SAR" },
      { amount: 0.7 - 0.4 },
    );
    assert.ok(plan.settle && plan.status === PaymentStatus.PAID);
  });

  test("names every final status once", () => {
    assert.equal(new Set(GATEWAY_FINAL_STATUSES).size, 4);
    assert.ok(isGatewayFinal(PaymentStatus.REFUNDED));
    assert.ok(!isGatewayFinal(PaymentStatus.PENDING));
  });
});
