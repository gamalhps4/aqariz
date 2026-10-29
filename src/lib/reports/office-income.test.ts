/**
 * The office's income, out of the money received: not the deposits it
 * holds, not VAT, not the rent it collects for owners.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { officeIncome, paymentVat, type IncomePaymentRow } from "@/lib/reports/office-income";

function payment(overrides: Partial<IncomePaymentRow>): IncomePaymentRow {
  return {
    type: "rent",
    propertyId: "p1",
    propertyName: "Tower",
    paidDate: new Date("2026-10-03T00:00:00Z"),
    received: 0,
    invoiceTax: null,
    invoiceTotal: null,
    leaseTaxEnabled: null,
    leaseTaxRate: null,
    onOwnersBuilding: false,
    ...overrides,
  };
}

describe("the office's income", () => {
  test("leaves out deposits, VAT and owners' rent, and shows each apart", () => {
    const income = officeIncome(
      [
        payment({ type: "security_deposit", received: 5000 }),
        // Rent on the office's own building, VAT-bearing through its invoice.
        payment({ received: 1150, invoiceTax: 150, invoiceTotal: 1150 }),
        // Rent on an owner's building: collected for the owner.
        payment({ received: 3000, onOwnersBuilding: true, propertyId: "p2" }),
        // A late fee on the office's building, no VAT.
        payment({ type: "late_fee", received: 100 }),
      ],
      [{ category: "management_fee", paidDate: new Date("2026-10-04T00:00:00Z"), amount: 575, invoiceTax: 75, invoiceTotal: 575 }],
    );
    assert.equal(income.grossReceived, 9825);
    assert.equal(income.depositsHeld, 5000);
    assert.equal(income.vatCollected, 225);
    assert.equal(income.rentCollectedForOwners, 3000);
    assert.equal(income.officeIncome, 1000 + 100 + 500);
    assert.deepEqual(
      income.byCategory.map((group) => [group._id, group.amount]),
      [
        ["rent", 1000],
        ["management_fee", 500],
        ["late_fee", 100],
      ],
    );
    assert.equal(income.byMonth.get("2026-10"), 1600);
  });

  test("rent paid without an invoice carries the VAT its contract charges", () => {
    assert.equal(
      paymentVat(payment({ received: 1150, leaseTaxEnabled: true, leaseTaxRate: 15 })),
      15000,
    );
    assert.equal(paymentVat(payment({ received: 1000, leaseTaxEnabled: false, leaseTaxRate: 15 })), 0);
    assert.equal(
      paymentVat(payment({ type: "maintenance", received: 1150, leaseTaxEnabled: true, leaseTaxRate: 15 })),
      0,
    );
  });
});
