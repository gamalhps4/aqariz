/**
 * Money a gateway took that its payment could not take is held as the
 * tenant's credit, marked by the first entry of its history. The books read
 * the mark (lib/accounting/documents.service.ts) to post it against the
 * tenant's account instead of as income.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { isTenantCreditPayment, tenantCreditEntry } from "@/lib/payments/tenant-credit";

describe("a held credit", () => {
  const entry = tenantCreditEntry({
    amount: 3000,
    paymentMethod: "credit_card",
    at: new Date("2026-10-04T09:30:00.000Z"),
    creditOf: "pay_1",
    reason: "paid-at-desk",
    gateway: "moyasar",
    gatewayName: "Moyasar",
    transactionId: "pay-uuid-9",
  });

  test("says what it is, what it came in for and why", () => {
    assert.equal(entry.event, "credit");
    assert.equal(entry.amount, 3000);
    assert.equal(entry.creditOf, "pay_1");
    assert.equal(entry.transactionId, "pay-uuid-9");
    assert.match(entry.notes, /Moyasar/);
    assert.match(entry.notes, /recorded at the office/);
  });

  test("is told apart from every other payment by its history", () => {
    assert.equal(isTenantCreditPayment([entry]), true);
    // A refund later keeps it a credit.
    assert.equal(isTenantCreditPayment([entry, { event: "refunded", amount: 3000 }]), true);
    assert.equal(isTenantCreditPayment([{ event: "recorded", amount: 3000 }]), false);
    assert.equal(isTenantCreditPayment([]), false);
    assert.equal(isTenantCreditPayment(null), false);
    assert.equal(isTenantCreditPayment("credit"), false);
  });
});
