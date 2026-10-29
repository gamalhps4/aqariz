/**
 * A security deposit paid through its installment is in the books once.
 *
 * The tenant paid the deposit installment (the installment and its payment
 * posted it), then staff pressed "Confirm collection" on the deposit card,
 * which sent `{}`: no payment was linked, so the deposit record posted a
 * receipt of its own as well — bank and deposits held twice. Collecting now
 * links the payment, and a deposit whose installment took money never posts
 * its own receipt.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  depositInstallmentPayments,
  depositPostsOwnReceipt,
  planDepositCollection,
  type DepositPaymentFacts,
} from "./deposit-installment";

const NOW = new Date("2026-10-04T09:00:00.000Z");

function payment(overrides: Partial<DepositPaymentFacts> = {}): DepositPaymentFacts {
  return {
    id: "pay-1",
    type: "invoice",
    status: "paid",
    invoiceId: "inv-deposit",
    allocations: [],
    paymentHistory: [],
    amount: 5000,
    amountPaid: 5000,
    paidDate: new Date("2026-10-01T08:00:00.000Z"),
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

describe("depositPostsOwnReceipt", () => {
  test("the deposit card's collect with its installment paid posts nothing more", () => {
    assert.equal(
      depositPostsOwnReceipt({ collectedPaymentId: null, installmentPaid: true }),
      false,
    );
  });

  test("collected with a payment linked: the payment posted it", () => {
    assert.equal(depositPostsOwnReceipt({ collectedPaymentId: "pay-1" }), false);
  });

  test("collected on the record with no payment anywhere: the record posts it", () => {
    assert.equal(depositPostsOwnReceipt({ collectedPaymentId: null, installmentPaid: false }), true);
    assert.equal(depositPostsOwnReceipt({ collectedPaymentId: null }), true);
  });
});

describe("depositInstallmentPayments", () => {
  const installments = ["inv-deposit"];

  test("a payment of the deposit installment, by its invoice or its allocations", () => {
    assert.deepEqual(
      depositInstallmentPayments([payment()], installments).map((p) => p.id),
      ["pay-1"],
    );
    const allocated = payment({
      id: "pay-2",
      invoiceId: null,
      allocations: [
        { invoiceId: "inv-rent", amount: 3000 },
        { invoiceId: "inv-deposit", amount: 5000 },
      ],
    });
    assert.deepEqual(
      depositInstallmentPayments([allocated], installments).map((p) => p.id),
      ["pay-2"],
    );
  });

  test("an older deposit payment row with no invoice", () => {
    const row = payment({ id: "pay-3", type: "security_deposit", invoiceId: null });
    assert.deepEqual(depositInstallmentPayments([row], []).map((p) => p.id), ["pay-3"]);
  });

  test("not rent, not money not taken or given back, not deleted", () => {
    for (const other of [
      payment({ invoiceId: "inv-rent" }),
      payment({ status: "pending", amountPaid: 0 }),
      payment({ status: "refunded" }),
      payment({ status: "cancelled" }),
      payment({ deletedAt: NOW }),
      payment({ amount: 0, amountPaid: 0 }),
    ]) {
      assert.deepEqual(depositInstallmentPayments([other], installments), []);
    }
  });

  test("latest first", () => {
    const early = payment({ id: "early", status: "partial", amountPaid: 2000 });
    const late = payment({ id: "late", paidDate: new Date("2026-10-03T08:00:00.000Z") });
    assert.deepEqual(
      depositInstallmentPayments([early, late], installments).map((p) => p.id),
      ["late", "early"],
    );
  });
});

describe("planDepositCollection", () => {
  test("Confirm collection with `{}` links the payment that paid the installment", () => {
    const paid = payment();
    assert.deepEqual(planDepositCollection({ paid: [paid], openInstallment: false, now: NOW }), {
      action: "link",
      paymentId: "pay-1",
      collectedDate: paid.paidDate,
    });
  });

  test("a payment the caller names must be one that paid it", () => {
    const paid = [payment(), payment({ id: "pay-9" })];
    assert.deepEqual(
      planDepositCollection({ paid, openInstallment: false, requestedPaymentId: "pay-9", now: NOW }),
      { action: "link", paymentId: "pay-9", collectedDate: paid[1].paidDate },
    );
    assert.deepEqual(
      planDepositCollection({ paid, openInstallment: false, requestedPaymentId: "rent-pay", now: NOW }),
      { action: "refuse", code: "DEPOSIT_PAYMENT_MISMATCH" },
    );
    assert.deepEqual(
      planDepositCollection({ paid: [], openInstallment: false, requestedPaymentId: "pay-1", now: NOW }),
      { action: "refuse", code: "DEPOSIT_PAYMENT_MISMATCH" },
    );
  });

  test("billed and not paid yet: the installment's payment comes first", () => {
    assert.deepEqual(planDepositCollection({ paid: [], openInstallment: true, now: NOW }), {
      action: "refuse",
      code: "DEPOSIT_INSTALLMENT_UNPAID",
    });
  });

  test("no installment at all: collected on the record, as before", () => {
    assert.deepEqual(planDepositCollection({ paid: [], openInstallment: false, now: NOW }), {
      action: "record",
    });
  });
});
