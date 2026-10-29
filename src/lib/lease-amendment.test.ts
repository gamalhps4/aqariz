/**
 * Amending a contract after its installments are billed (the client's "admin
 * override"): what is kept, what is cancelled and billed again, and when the
 * amendment is refused.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planAmendment,
  type AmendableInstallment,
  type AmendedLease,
} from "@/lib/lease-amendment";
import { leaseInstallmentPlan, planInstallments } from "@/lib/lease-installments";
import type { LockedTerm } from "@/lib/lease-term-edits";

const MONTHLY: AmendedLease = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-12-31T00:00:00Z"),
  rentAmount: 1000,
  paymentFrequency: "monthly",
  terms: {},
};

const QUARTERLY_TOTAL: AmendedLease = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-12-31T00:00:00Z"),
  contractAmount: 12000,
  rentAmount: 3000,
  paymentFrequency: "quarterly",
  terms: {},
};

/** The installments a contract was billed with, the first `paid` of them paid in full. */
function billed(lease: AmendedLease, paid = 0): AmendableInstallment[] {
  return leaseInstallmentPlan(lease).map((period, position) => ({
    id: `inv-${period.index}`,
    invoiceNumber: `INV-${period.index}`,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    dueDate: period.dueDate,
    totalAmount: period.totalAmount,
    amountPaid: position < paid ? period.totalAmount : 0,
    rentAmount: period.rentAmount,
  }));
}

function plan(
  amended: AmendedLease,
  installments: AmendableInstallment[],
  changed: LockedTerm[],
  extra: { depositBilled?: boolean; moneyHeld?: boolean } = {},
) {
  return planAmendment({
    amended,
    installments,
    changed,
    depositBilled: extra.depositBilled ?? false,
    moneyHeld: extra.moneyHeld ?? installments.some((row) => row.amountPaid > 0),
  });
}

describe("a correction: nothing paid yet", () => {
  test("every installment is billed again from the corrected rent", () => {
    const result = plan({ ...MONTHLY, rentAmount: 1100 }, billed(MONTHLY), ["rent"]);
    assert.equal(result.level, "correction");
    assert.deepEqual(result.problems, []);
    assert.equal(result.keep.length, 0);
    assert.equal(result.cancel.length, 12);
    assert.equal(result.create.length, 12);
    assert.equal(result.totals.before, 12000);
    assert.equal(result.totals.after, 13200);
  });

  test("the tenant or unit can be corrected", () => {
    const result = plan(MONTHLY, billed(MONTHLY), ["tenantId", "unitId"]);
    assert.equal(result.level, "correction");
    assert.deepEqual(result.problems, []);
  });

  test("a new start date re-cuts the whole schedule", () => {
    const moved = {
      ...MONTHLY,
      startDate: new Date("2026-02-01T00:00:00Z"),
      endDate: new Date("2027-01-31T00:00:00Z"),
    };
    const result = plan(moved, billed(MONTHLY), ["startDate", "endDate"]);
    assert.deepEqual(result.problems, []);
    assert.equal(result.create[0].periodStart.toISOString(), "2026-02-01T00:00:00.000Z");
  });

  test("an edit that changes nothing is refused", () => {
    const result = plan(MONTHLY, billed(MONTHLY), []);
    assert.deepEqual(result.problems, [{ code: "nothing_changed" }]);
  });
});

describe("an amendment: some installments paid", () => {
  test("paid installments stay as billed; the rest take the new rent", () => {
    const result = plan({ ...MONTHLY, rentAmount: 1200 }, billed(MONTHLY, 3), ["rent"]);
    assert.equal(result.level, "amendment");
    assert.deepEqual(result.problems, []);
    assert.deepEqual(
      result.keep.map((row) => row.id),
      ["inv-1", "inv-2", "inv-3"],
    );
    assert.equal(result.cancel.length, 9);
    assert.equal(result.create.length, 9);
    assert.ok(result.create.every((period) => period.rentAmount === 1200));
    assert.equal(result.totals.paid, 3000);
    assert.equal(result.totals.after, 3000 + 9 * 1200);
    assert.equal(result.kept, null);
  });

  test("a contract written as a total spreads what is left over the unpaid installments", () => {
    const result = plan(
      { ...QUARTERLY_TOTAL, contractAmount: 13200 },
      billed(QUARTERLY_TOTAL, 1),
      ["contractAmount"],
    );
    assert.deepEqual(result.problems, []);
    assert.equal(result.create.length, 3);
    assert.deepEqual(
      result.create.map((period) => period.rentAmount),
      [3400, 3400, 3400],
    );
    assert.equal(result.totals.after, 13200);
    assert.deepEqual(result.kept, {
      periodStarts: ["2026-01-01T00:00:00.000Z"],
      rent: 3000,
    });
  });

  test("the contract keeps planning the same split once amended", () => {
    const schedule = planInstallments({
      startDate: QUARTERLY_TOTAL.startDate,
      endDate: QUARTERLY_TOTAL.endDate,
      rentAmount: 0,
      contractAmount: 10001,
      frequency: "quarterly",
      keptRent: { periodStarts: ["2026-01-01T00:00:00.000Z"], rent: 3000 },
    });
    assert.deepEqual(
      schedule.map((period) => period.rentAmount),
      [3000, 2333.66, 2333.66, 2333.68],
    );
  });

  test("the term can run longer: the new periods are billed", () => {
    const longer = { ...MONTHLY, endDate: new Date("2027-03-31T00:00:00Z") };
    const result = plan(longer, billed(MONTHLY, 2), ["endDate"]);
    assert.deepEqual(result.problems, []);
    assert.equal(result.create.length, 13);
  });

  test("the term cannot end inside a period already paid", () => {
    const shorter = { ...MONTHLY, endDate: new Date("2026-02-15T00:00:00Z") };
    const result = plan(shorter, billed(MONTHLY, 2), ["endDate"]);
    assert.deepEqual(result.problems.map((problem) => problem.code), ["paid_period_changed"]);
  });

  test("the start date or cycle cannot move a paid period", () => {
    const quarterly = { ...MONTHLY, paymentFrequency: "quarterly" };
    const result = plan(quarterly, billed(MONTHLY, 2), ["paymentFrequency"]);
    assert.ok(result.problems.some((problem) => problem.code === "paid_period_changed"));
  });

  test("the tenant and unit cannot change once money has come in", () => {
    const result = plan(MONTHLY, billed(MONTHLY, 1), ["tenantId"]);
    assert.deepEqual(result.problems, [{ code: "placement_after_payment" }]);
  });

  test("money held on the contract makes it an amendment even with no installment paid", () => {
    const result = plan(MONTHLY, billed(MONTHLY), ["unitId"], { moneyHeld: true });
    assert.equal(result.level, "amendment");
    assert.deepEqual(result.problems, [{ code: "placement_after_payment" }]);
  });

  test("a total below what is already paid is refused", () => {
    const result = plan(
      { ...QUARTERLY_TOTAL, contractAmount: 5000 },
      billed(QUARTERLY_TOTAL, 2),
      ["contractAmount"],
    );
    assert.deepEqual(result.problems, [{ code: "total_below_paid", paidRent: 6000 }]);
  });

  test("a billed deposit cannot change here", () => {
    const result = plan(MONTHLY, billed(MONTHLY), ["securityDeposit"], { depositBilled: true });
    assert.deepEqual(result.problems, [{ code: "deposit_billed" }]);
  });

  test("a payment arriving after the preview changes the fingerprint", () => {
    const before = plan({ ...MONTHLY, rentAmount: 1200 }, billed(MONTHLY, 1), ["rent"]);
    const after = plan({ ...MONTHLY, rentAmount: 1200 }, billed(MONTHLY, 2), ["rent"]);
    assert.notEqual(before.fingerprint, after.fingerprint);
  });
});
