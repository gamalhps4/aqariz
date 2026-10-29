/**
 * What is left to refund at a gateway after part of a payment was refunded in
 * the gateway's own dashboard.
 *
 * The bug this pins: PayPal reported a capture refunded in part as
 * "refunded", so "Refund" in the app sent nothing back and took the whole
 * payment off the books — 3,000 dropped, the tenant 2,500 short.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { planGatewayRefund } from "@/lib/payments/gateway-refund-plan";

describe("refunding what is left at the gateway", () => {
  test("3,000 taken, 500 refunded in the dashboard: 2,500 is refunded now", () => {
    assert.deepEqual(planGatewayRefund(3000, { status: "paid", refundedAmount: 500 }), {
      refundedEarlier: 500,
      toRefund: 2500,
    });
  });

  test("nothing refunded yet: all of it", () => {
    assert.deepEqual(planGatewayRefund(3000, { status: "paid", refundedAmount: 0 }), {
      refundedEarlier: 0,
      toRefund: 3000,
    });
    // A gateway that does not report refunds (PayTabs, Tap) and says paid.
    assert.deepEqual(planGatewayRefund(3000, { status: "paid" }), { refundedEarlier: 0, toRefund: 3000 });
  });

  test("refunded in full already: nothing more goes back, the books still record it", () => {
    assert.deepEqual(planGatewayRefund(3000, { status: "refunded", refundedAmount: 3000 }), {
      refundedEarlier: 3000,
      toRefund: 0,
    });
    // Refunded with no amount reported: taken as all of it.
    assert.deepEqual(planGatewayRefund(3000, { status: "refunded" }), { refundedEarlier: 3000, toRefund: 0 });
  });

  test("a reported amount wins over the status, and never goes past what was received", () => {
    assert.deepEqual(planGatewayRefund(3000, { status: "refunded", refundedAmount: 500 }), {
      refundedEarlier: 500,
      toRefund: 2500,
    });
    assert.deepEqual(planGatewayRefund(3000, { status: "refunded", refundedAmount: 3500 }), {
      refundedEarlier: 3000,
      toRefund: 0,
    });
  });

  test("halalas do not drift", () => {
    assert.deepEqual(planGatewayRefund(1234.56, { status: "paid", refundedAmount: 0.1 + 0.2 }), {
      refundedEarlier: 0.3,
      toRefund: 1234.26,
    });
  });

  test("the gateway has no record of it: the whole amount is asked for", () => {
    assert.deepEqual(planGatewayRefund(3000, null), { refundedEarlier: 0, toRefund: 3000 });
  });
});
