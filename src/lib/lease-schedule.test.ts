/**
 * A contract's installment table, as the client asked for it: the opened
 * contract lists its own installments, each with due date, amount, paid,
 * remaining and status.
 *
 * "Installment N" was the row's position among everything billed on the
 * contract, sorted by date. A one-off charge added in March renumbered every
 * installment after it, and so did removing one: the receipt said
 * "Installment 5", the screen now called it 6. An installment is numbered by
 * its period now, and charges are listed apart.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  assembleInstallmentSchedule,
  type ScheduleInvoice,
} from "@/lib/lease-schedule";
import { planInstallments } from "@/lib/lease-installments";

const LEASE = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-12-31T00:00:00Z"),
  rentAmount: 1000,
  paymentFrequency: "monthly",
  currency: "SAR",
};

const PLAN = planInstallments({
  startDate: LEASE.startDate,
  endDate: LEASE.endDate,
  rentAmount: 1000,
  frequency: "monthly",
});

/** An invoice for the schedule's period number `n` (1-based). */
function billed(n: number, overrides: Partial<ScheduleInvoice> = {}): ScheduleInvoice {
  const period = PLAN[n - 1];
  return {
    id: `inv-${n}`,
    invoiceNumber: `RENT-${String(n).padStart(6, "0")}`,
    periodStart: period.periodStart,
    dueDate: period.dueDate,
    subtotal: 1000,
    taxAmount: 0,
    totalAmount: 1000,
    amountPaid: 0,
    balanceRemaining: 1000,
    status: "issued",
    lineItems: [{ description: "Monthly rent" }],
    ...overrides,
  };
}

function charge(id: string, dueDate: string, amount = 250): ScheduleInvoice {
  return {
    id,
    invoiceNumber: `RENT-${id}`,
    periodStart: null,
    dueDate: new Date(`${dueDate}T00:00:00Z`),
    subtotal: amount,
    taxAmount: 0,
    totalAmount: amount,
    amountPaid: 0,
    balanceRemaining: amount,
    status: "issued",
    lineItems: [{ description: "Maintenance contribution" }],
  };
}

const NOW = new Date("2026-04-10T12:00:00Z");

function numbers(invoices: ScheduleInvoice[]) {
  return assembleInstallmentSchedule(LEASE, invoices, NOW).installments.map(
    (row) => [row.index, row.invoiceId],
  );
}

describe("numbering", () => {
  const year = PLAN.map((_, i) => billed(i + 1));

  test("installments are numbered 1 to N by period", () => {
    const { installments } = assembleInstallmentSchedule(LEASE, year, NOW);
    assert.deepEqual(
      installments.map((row) => row.index),
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
    );
    assert.equal(installments[2].invoiceId, "inv-3");
  });

  test("adding a charge renumbers nothing, and the charge is listed apart", () => {
    const before = numbers(year);
    const withCharge = [...year, charge("extra", "2026-03-15")];
    assert.deepEqual(numbers(withCharge), before);

    const { charges } = assembleInstallmentSchedule(LEASE, withCharge, NOW);
    assert.equal(charges.length, 1);
    assert.equal(charges[0].invoiceId, "extra");
    assert.equal(charges[0].source, "manual");
  });

  test("a cancelled installment keeps its number, and so do the ones after it", () => {
    const cancelled = year.map((invoice) =>
      invoice.id === "inv-4"
        ? { ...invoice, status: "cancelled", balanceRemaining: 0 }
        : invoice,
    );
    const { installments, summary } = assembleInstallmentSchedule(
      LEASE,
      cancelled,
      NOW,
    );
    assert.equal(installments[3].state, "cancelled");
    assert.equal(installments[3].index, 4);
    assert.equal(installments[4].index, 5);
    assert.equal(summary.totalInstallments, 11);
  });

  test("a period the terms no longer have is kept with the charges", () => {
    const stray = billed(1, {
      id: "old",
      periodStart: new Date("2025-12-01T00:00:00Z"),
      dueDate: new Date("2025-12-01T00:00:00Z"),
    });
    const { installments, charges } = assembleInstallmentSchedule(
      LEASE,
      [stray],
      NOW,
    );
    assert.equal(installments.length, 12);
    assert.ok(installments.every((row) => row.invoiceId === null));
    assert.equal(charges[0].invoiceId, "old");
    assert.equal(charges[0].source, "orphaned");
  });
});

describe("rows not billed yet", () => {
  test("say whether their due date has passed", () => {
    const { installments } = assembleInstallmentSchedule(LEASE, [], NOW);
    // 1 Jan to 1 Apr are behind 10 Apr; 1 May is not.
    assert.deepEqual(
      installments.slice(0, 5).map((row) => [row.state, row.dueDatePassed]),
      [
        ["planned", true],
        ["planned", true],
        ["planned", true],
        ["planned", true],
        ["planned", false],
      ],
    );
  });

  test("are never counted overdue — nothing has been billed", () => {
    const { summary } = assembleInstallmentSchedule(LEASE, [], NOW);
    assert.equal(summary.overdueCount, 0);
    assert.equal(summary.overdueTotal, 0);
    assert.equal(summary.contractValue, 12_000);
  });
});

describe("the summary", () => {
  test("the contract value is the schedule's; money figures include charges", () => {
    const invoices = [
      billed(1, { amountPaid: 1000, balanceRemaining: 0, status: "paid" }),
      billed(2, { amountPaid: 400, balanceRemaining: 600, status: "partial" }),
      billed(3),
      charge("extra", "2026-02-15"),
    ];
    const { summary } = assembleInstallmentSchedule(LEASE, invoices, NOW);
    assert.equal(summary.contractValue, 12_000);
    assert.equal(summary.chargesCount, 1);
    assert.equal(summary.chargesTotal, 250);
    assert.equal(summary.billedTotal, 3_250);
    assert.equal(summary.collectedTotal, 1_400);
    assert.equal(summary.outstandingTotal, 1_850);
    // Installment 2 (600 left), installment 3 (1,000) and the charge (250)
    // are all past due on 10 April.
    assert.equal(summary.overdueCount, 3);
    assert.equal(summary.overdueTotal, 1_850);
    assert.equal(summary.paidCount, 1);
  });
});
