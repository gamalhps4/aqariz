/**
 * The contract value a schedule adds up to must be the one the office wrote.
 *
 * The client review's "the installments and dates in the lease contract have
 * not been adjusted ... should show 12,000" was this: a 1 Jan - 31 Dec monthly
 * contract at 1,000 totalled 11,967.74, because the planner read the lease's
 * end date as exclusive and prorated a twelfth cycle that was in fact whole.
 *
 * These cases pin the arithmetic down from both ends — a term written
 * inclusively and the same term written exclusively must bill identically —
 * so the rounding can never drift back.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planInstallments,
  summarizeInstallments,
  splitContractAmount,
  contractInstallmentShare,
  leaseInstallmentPlan,
  leaseAnnualRent,
  taxFor,
  addMonthsUTC,
  installmentsPerYear,
  normalizeFrequency,
  type PaymentFrequencyKey,
} from "@/lib/lease-installments";

function total(
  startDate: string,
  endDate: string,
  frequency: PaymentFrequencyKey,
  rentAmount: number,
) {
  const plan = planInstallments({ startDate, endDate, rentAmount, frequency });
  return { plan, ...summarizeInstallments(plan) };
}

/** A schedule for a contract written as one figure for the whole term. */
function fromTotal(
  startDate: string,
  endDate: string,
  frequency: PaymentFrequencyKey,
  contractAmount: number,
  extra: { electricityAmount?: number; taxEnabled?: boolean; taxRate?: number } = {},
) {
  const plan = planInstallments({
    startDate,
    endDate,
    // Deliberately wrong: the total must win over whatever the column holds.
    rentAmount: 999,
    contractAmount,
    frequency,
    ...extra,
  });
  return {
    plan,
    rents: plan.map((installment) => installment.rentAmount),
    ...summarizeInstallments(plan),
  };
}

describe("contract value", () => {
  test("a calendar year at 1,000 a month bills 12,000 — the reported case", () => {
    const { count, totalAmount } = total(
      "2026-01-01",
      "2026-12-31",
      "monthly",
      1000,
    );
    assert.equal(count, 12);
    assert.equal(totalAmount, 12000);
  });

  test("the same term written exclusively bills identically", () => {
    // 1 Jan 2026 - 1 Jan 2027 means the same twelve months to an office that
    // writes end dates as "up to but not including".
    const inclusive = total("2026-01-01", "2026-12-31", "monthly", 1000);
    const exclusive = total("2026-01-01", "2027-01-01", "monthly", 1000);
    assert.equal(exclusive.count, inclusive.count);
    assert.equal(exclusive.totalAmount, inclusive.totalAmount);
  });

  test("no cycle of a whole-year term is prorated", () => {
    const { plan } = total("2026-01-01", "2026-12-31", "monthly", 1000);
    assert.equal(
      plan.filter((installment) => installment.prorated).length,
      0,
      "a full calendar year has no short period to prorate",
    );
  });

  test("the final period closes on the day after the term ends", () => {
    const { plan } = total("2026-01-01", "2026-12-31", "monthly", 1000);
    const last = plan[plan.length - 1];
    assert.equal(last.periodStart.toISOString().slice(0, 10), "2026-12-01");
    // Exclusive boundary: 31 December is covered, so the period closes on the 1st.
    assert.equal(last.periodEnd.toISOString().slice(0, 10), "2027-01-01");
    assert.equal(last.totalAmount, 1000);
  });

  for (const [frequency, rent, count] of [
    ["monthly", 1000, 12],
    ["quarterly", 3000, 4],
    ["four_monthly", 4000, 3],
    ["semi_annual", 6000, 2],
    ["annual", 12000, 1],
  ] as Array<[PaymentFrequencyKey, number, number]>) {
    test(`a ${frequency} calendar year bills 12,000 across ${count}`, () => {
      const { count: actual, totalAmount } = total(
        "2026-01-01",
        "2026-12-31",
        frequency,
        rent,
      );
      assert.equal(actual, count);
      assert.equal(totalAmount, 12000);
    });
  }

  test("a year from mid-month bills twelve whole cycles", () => {
    const { count, totalAmount } = total(
      "2026-03-15",
      "2027-03-14",
      "monthly",
      1000,
    );
    assert.equal(count, 12);
    assert.equal(totalAmount, 12000);
  });

  test("a leap year is still twelve whole months", () => {
    const { count, totalAmount } = total(
      "2028-01-01",
      "2028-12-31",
      "monthly",
      1000,
    );
    assert.equal(count, 12);
    assert.equal(totalAmount, 12000);
  });

  test("eighteen months bills eighteen", () => {
    const { count, totalAmount } = total(
      "2026-01-01",
      "2027-06-30",
      "monthly",
      1000,
    );
    assert.equal(count, 18);
    assert.equal(totalAmount, 18000);
  });
});

describe("a contract written as a total", () => {
  // The client's reference system: "Lease Amount 12000 [Total]" and a
  // payment cycle, which gives 12 × 1,000 monthly.
  for (const [frequency, count, each] of [
    ["monthly", 12, 1000],
    ["quarterly", 4, 3000],
    ["four_monthly", 3, 4000],
    ["semi_annual", 2, 6000],
    ["annual", 1, 12000],
  ] as Array<[PaymentFrequencyKey, number, number]>) {
    test(`12,000 ${frequency} is ${count} × ${each}`, () => {
      const { rents, subtotal } = fromTotal(
        "2026-01-01",
        "2026-12-31",
        frequency,
        12000,
      );
      assert.deepEqual(rents, Array<number>(count).fill(each));
      assert.equal(subtotal, 12000);
    });
  }

  test("10,000 monthly is 11 × 833.33 and a last installment of 833.37", () => {
    const { rents, subtotal } = fromTotal(
      "2026-01-01",
      "2026-12-31",
      "monthly",
      10000,
    );
    assert.deepEqual(rents, [...Array<number>(11).fill(833.33), 833.37]);
    // To the halala: the installments add back to the figure on the paper.
    assert.equal(subtotal, 10000);
  });

  test("a short final period is not prorated: the total already prices it", () => {
    // Two whole months and half of March. Per installment this prorates to
    // 2,483.87 (see below); written as a total it bills exactly the total.
    const even = fromTotal("2026-01-01", "2026-03-15", "monthly", 3000);
    assert.deepEqual(even.rents, [1000, 1000, 1000]);
    assert.equal(even.plan.some((installment) => installment.prorated), false);

    const uneven = fromTotal("2026-01-01", "2026-03-15", "monthly", 2500);
    assert.deepEqual(uneven.rents, [833.33, 833.33, 833.34]);
    assert.equal(uneven.subtotal, 2500);
  });

  test("tax is added on top of the total", () => {
    const { subtotal, taxAmount, totalAmount, plan } = fromTotal(
      "2026-01-01",
      "2026-12-31",
      "monthly",
      12000,
      { taxEnabled: true, taxRate: 15 },
    );
    assert.equal(subtotal, 12000);
    assert.equal(taxAmount, 1800);
    assert.equal(totalAmount, 13800);
    assert.equal(plan[0].totalAmount, 1150);
  });

  test("utilities stay per installment and are charged in full", () => {
    const { plan } = fromTotal("2026-01-01", "2026-03-15", "monthly", 3000, {
      electricityAmount: 200,
    });
    assert.deepEqual(
      plan.map((installment) => installment.electricityAmount),
      [200, 200, 200],
    );
    assert.equal(plan[2].subtotal, 1200);
  });

  test("no total, or a zero one, keeps the per-installment schedule", () => {
    for (const contractAmount of [null, undefined, 0]) {
      const plan = planInstallments({
        startDate: "2026-01-01",
        endDate: "2026-03-15",
        rentAmount: 1000,
        contractAmount,
        frequency: "monthly",
      });
      assert.equal(summarizeInstallments(plan).totalAmount, 2483.87);
      assert.equal(plan[2].prorated, true);
    }
  });

  test("a lease row's total drives the schedule built from it", () => {
    const plan = leaseInstallmentPlan({
      startDate: new Date("2026-01-01"),
      endDate: new Date("2026-12-31"),
      rentAmount: 833.33,
      contractAmount: 10000,
      paymentFrequency: "monthly",
    });
    assert.equal(plan.length, 12);
    assert.equal(summarizeInstallments(plan).subtotal, 10000);
    assert.equal(plan[11].rentAmount, 833.37);
  });

  test("the stored share is the regular installment", () => {
    assert.equal(
      contractInstallmentShare({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        frequency: "monthly",
        contractAmount: 10000,
      }),
      833.33,
    );
  });

  test("the remainder is never negative: the last installment is the larger", () => {
    // Rounding 666.666… to nearest would give 666.67 twice and a last
    // installment of 666.66 — a "remainder" of minus two halalas.
    const { rents, subtotal } = fromTotal(
      "2026-01-01",
      "2026-03-31",
      "monthly",
      2000,
    );
    assert.deepEqual(rents, [666.66, 666.66, 666.68]);
    assert.equal(subtotal, 2000);
  });

  test("the split works in whole halalas", () => {
    assert.deepEqual(splitContractAmount(0.1, 3), {
      count: 3,
      share: 0.03,
      last: 0.04,
    });
    assert.deepEqual(splitContractAmount(12000, 1), {
      count: 1,
      share: 12000,
      last: 12000,
    });
    assert.deepEqual(splitContractAmount(12000, 0), {
      count: 0,
      share: 0,
      last: 0,
    });
  });
});

describe("annual rent", () => {
  test("a total over a year is that total, not twelve rounded shares", () => {
    assert.equal(
      leaseAnnualRent({
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        rentAmount: 833.33,
        contractAmount: 10000,
        paymentFrequency: "monthly",
      }),
      10000,
    );
  });

  test("a two-year total is annualised over its two years", () => {
    assert.equal(
      leaseAnnualRent({
        startDate: "2026-01-01",
        endDate: "2027-12-31",
        rentAmount: 1000,
        contractAmount: 24000,
        paymentFrequency: "monthly",
      }),
      12000,
    );
  });

  test("per installment it is the rent times the cycles in a year", () => {
    for (const [paymentFrequency, rentAmount] of [
      ["quarterly", 3000],
      ["four_monthly", 4000],
    ] as const) {
      assert.equal(
        leaseAnnualRent({
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          rentAmount,
          paymentFrequency,
        }),
        12000,
      );
    }
  });
});

describe("proration", () => {
  test("a term that really does stop mid-cycle still prorates", () => {
    // Two whole months and half of March. The fix must not be "corrected"
    // into ignoring short periods altogether.
    const { count, totalAmount, plan } = total(
      "2026-01-01",
      "2026-03-15",
      "monthly",
      1000,
    );
    assert.equal(count, 3);
    assert.equal(totalAmount, 2483.87);
    assert.equal(plan[2].prorated, true);
    assert.equal(plan[0].prorated, false);
  });

  test("a one-day tail is absorbed, not billed as its own installment", () => {
    // An exclusive-style end date would otherwise gain a thirteenth
    // installment worth a single day once the date is read inclusively.
    const { count } = total("2026-01-01", "2027-01-01", "monthly", 1000);
    assert.equal(count, 12);
  });
});

describe("edges", () => {
  test("an end date before the start bills nothing", () => {
    assert.equal(total("2026-06-01", "2026-01-01", "monthly", 1000).count, 0);
  });

  test("a single-day term bills one prorated installment", () => {
    const { count } = total("2026-01-01", "2026-01-01", "monthly", 1000);
    assert.equal(count, 1);
  });

  test("an unparseable date bills nothing rather than throwing", () => {
    assert.equal(
      planInstallments({
        startDate: "not-a-date",
        endDate: "2026-12-31",
        rentAmount: 1000,
        frequency: "monthly",
      }).length,
      0,
    );
  });
});

describe("tax", () => {
  test("is only charged when enabled and rated", () => {
    assert.equal(taxFor(1000, true, 15), 150);
    assert.equal(taxFor(1000, false, 15), 0);
    assert.equal(taxFor(1000, true, 0), 0);
    assert.equal(taxFor(1000, true, undefined), 0);
  });

  test("rides on the contract total", () => {
    const plan = planInstallments({
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      rentAmount: 1000,
      frequency: "monthly",
      taxEnabled: true,
      taxRate: 15,
    });
    const { subtotal, taxAmount, totalAmount } = summarizeInstallments(plan);
    assert.equal(subtotal, 12000);
    assert.equal(taxAmount, 1800);
    assert.equal(totalAmount, 13800);
  });
});

describe("helpers", () => {
  test("month arithmetic clamps to the length of the target month", () => {
    // 31 January + 1 month has no 31st to land on.
    assert.equal(
      addMonthsUTC(new Date("2026-01-31"), 1).toISOString().slice(0, 10),
      "2026-02-28",
    );
  });

  test("installments per year matches the frequency", () => {
    assert.equal(installmentsPerYear("monthly"), 12);
    assert.equal(installmentsPerYear("quarterly"), 4);
    assert.equal(installmentsPerYear("four_monthly"), 3);
    assert.equal(installmentsPerYear("annual"), 1);
  });

  test("an unknown frequency falls back to monthly rather than throwing", () => {
    assert.equal(normalizeFrequency("fortnightly"), "monthly");
    assert.equal(normalizeFrequency(undefined), "monthly");
  });
});
