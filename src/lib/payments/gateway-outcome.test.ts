/**
 * What a gateway's report does to a payment — the same for every gateway.
 *
 * The settlement itself (lib/payments/settlement.ts) claims the row by
 * version, so of two concurrent deliveries only one records the money. These
 * pin the decision in front of it: a payment settled once is never settled
 * again by a replayed webhook, a second return, or an old attempt.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import type { GatewayPaymentState } from "@/lib/payments/gateway-adapter";
import { planGatewayOutcome } from "@/lib/payments/gateway-outcome";
import { gatewayReferenceOf, legacyGatewayReference } from "@/lib/payments/gateway-reference";
import { PaymentStatus } from "@/types";

const paid = (overrides: Partial<GatewayPaymentState> = {}): GatewayPaymentState => ({
  reference: "pay-uuid-1",
  sessionReference: "inv-uuid-1",
  status: "paid",
  amount: 5000,
  currency: "SAR",
  paymentId: "pay_1",
  method: "mada",
  ...overrides,
});

const row = (status: string, gatewayPaymentId: string | null = "inv-uuid-1") => ({
  id: "pay_1",
  status,
  gatewayPaymentId,
});

describe("a paid report", () => {
  test("settles a payment still waiting for its money", () => {
    for (const status of [PaymentStatus.PENDING, PaymentStatus.OVERDUE, PaymentStatus.FAILED]) {
      assert.deepEqual(planGatewayOutcome(row(status), paid()), { action: "settle" }, status);
    }
  });

  test("delivered twice settles once: the second finds the payment paid", () => {
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PENDING), paid()), { action: "settle" });
    // After the first settlement the row is PAID and carries the payment's reference.
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PAID, "pay-uuid-1"), paid()), {
      action: "none",
      reason: "settled-already",
    });
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PAID, "inv-uuid-1"), paid()), {
      action: "none",
      reason: "settled-already",
    });
  });

  test("a second attempt's money on a paid payment goes to a person", () => {
    assert.deepEqual(
      planGatewayOutcome(row(PaymentStatus.PAID, "chg_other"), paid()),
      { action: "review", reason: "closed-payment" },
    );
  });

  test("money arriving on a payment paid at the desk is the tenant paying twice", () => {
    // Checkout opened (inv-uuid-1 stored), 3,000 recorded at the desk, then
    // the tenant finishes the gateway's page: 3,000 more.
    const deskPaid = { ...row(PaymentStatus.PAID, "inv-uuid-1"), recordedById: "staff-1" };
    assert.deepEqual(planGatewayOutcome(deskPaid, paid({ amount: 3000 })), {
      action: "review",
      reason: "paid-at-desk",
    });
    // The desk cleared the checkout off the row: still the tenant paying twice.
    const cleared = { ...row(PaymentStatus.PAID, null), recordedById: "staff-1" };
    assert.deepEqual(planGatewayOutcome(cleared, paid({ amount: 3000 })), {
      action: "review",
      reason: "paid-at-desk",
    });
    // Settled by the gateway itself, a replay is still only a replay.
    assert.deepEqual(planGatewayOutcome({ ...row(PaymentStatus.PAID, "pay-uuid-1"), recordedById: null }, paid()), {
      action: "none",
      reason: "settled-already",
    });
  });

  test("never revives a refunded or cancelled payment", () => {
    for (const status of [PaymentStatus.REFUNDED, PaymentStatus.CANCELLED]) {
      assert.deepEqual(planGatewayOutcome(row(status), paid()), {
        action: "review",
        reason: "closed-payment",
      });
    }
  });

  test("another payment's charge never settles this one", () => {
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PENDING), paid({ paymentId: "pay_2" })), {
      action: "review",
      reason: "other-payment",
    });
  });

  test("a report that names no payment is matched by the caller and settles", () => {
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PENDING), paid({ paymentId: null })), {
      action: "settle",
    });
  });
});

describe("a failed report", () => {
  test("fails the pending payment whose attempt it is", () => {
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PENDING), paid({ status: "failed" })), {
      action: "fail",
    });
  });

  test("an old attempt failing leaves a newer one alone", () => {
    assert.deepEqual(
      planGatewayOutcome(row(PaymentStatus.PENDING, "chg_newer"), paid({ status: "failed" })),
      { action: "none", reason: "stale-attempt" },
    );
  });

  test("never touches a settled payment, nor an overdue one's status", () => {
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PAID), paid({ status: "failed" })), {
      action: "none",
      reason: "settled-already",
    });
    assert.deepEqual(planGatewayOutcome(row(PaymentStatus.OVERDUE), paid({ status: "failed" })), {
      action: "none",
      reason: "still-owed",
    });
  });
});

test("pending and refunded reports change nothing", () => {
  assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PENDING), paid({ status: "pending" })), {
    action: "none",
    reason: "pending",
  });
  assert.deepEqual(planGatewayOutcome(row(PaymentStatus.PAID), paid({ status: "refunded" })), {
    action: "none",
    reason: "refunded-at-gateway",
  });
});

describe("the reference on a payment", () => {
  test("the generic columns win; the old columns stand in before the migration", () => {
    assert.deepEqual(
      gatewayReferenceOf({ gatewayProvider: "moyasar", gatewayPaymentId: "pay-uuid", stripePaymentIntentId: "pi_1" }),
      { provider: "moyasar", id: "pay-uuid" },
    );
    assert.deepEqual(gatewayReferenceOf({ stripeCheckoutSessionId: "cs_1" }), { provider: "stripe", id: "cs_1" });
    assert.deepEqual(gatewayReferenceOf({ paypalCaptureId: "CAP-1" }), { provider: "paypal", id: "CAP-1" });
    assert.equal(gatewayReferenceOf({}), null);
  });

  test("the backfill copies what a refund names: the intent over the session, the capture over the order", () => {
    assert.deepEqual(
      legacyGatewayReference({ stripePaymentIntentId: "pi_1", stripeCheckoutSessionId: "cs_1" }),
      { provider: "stripe", id: "pi_1" },
    );
    assert.deepEqual(
      legacyGatewayReference({ paypalOrderId: "ORDER-1", paypalCaptureId: "CAP-1" }),
      { provider: "paypal", id: "CAP-1" },
    );
    assert.deepEqual(legacyGatewayReference({ paypalOrderId: "ORDER-1" }), { provider: "paypal", id: "ORDER-1" });
    assert.equal(legacyGatewayReference({}), null);
  });
});
