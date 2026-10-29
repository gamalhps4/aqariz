/**
 * The five statuses the review asks for: "Upcoming, Due, Overdue, Paid, or
 * Partially Paid".
 *
 * "Partially Paid" was unreachable in practice. Overdue was tested first, and
 * money almost always arrives against an installment *after* its due date, so
 * a row with 400 of 1,000 collected read "Overdue" — indistinguishable from
 * one with nothing paid at all.
 *
 * The pair of tests that matter most are the two at the bottom: partial has
 * to win the badge, and the overdue *totals* have to keep counting that row's
 * unpaid remainder anyway. Fixing one by breaking the other is the obvious
 * wrong turn.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  classifyInstallment,
  isOverdue,
  type InstallmentState,
} from "@/lib/lease-installment-state";
import { InvoiceStatus } from "@/types";

const NOW = new Date("2026-09-23T12:00:00.000Z");

function invoice(over: Partial<Parameters<typeof classifyInstallment>[0]> = {}) {
  return {
    status: InvoiceStatus.ISSUED as string,
    dueDate: new Date("2026-12-01"),
    amountPaid: 0,
    balanceRemaining: 1000,
    ...over,
  };
}

describe("classification", () => {
  test("cancelled wins over everything", () => {
    assert.equal(
      classifyInstallment(
        invoice({ status: InvoiceStatus.CANCELLED, amountPaid: 500 }),
        NOW,
      ),
      "cancelled",
    );
  });

  test("nothing left to pay is paid", () => {
    assert.equal(
      classifyInstallment(
        invoice({ balanceRemaining: 0, amountPaid: 1000 }),
        NOW,
      ),
      "paid",
    );
  });

  test("falling due within the week is due", () => {
    assert.equal(
      classifyInstallment(invoice({ dueDate: new Date("2026-09-28") }), NOW),
      "due",
    );
  });

  test("further out is upcoming, however it was issued", () => {
    // The contract form issues every installment on signing. Read off the
    // stored status, eleven months of future rent all showed as "Due".
    assert.equal(classifyInstallment(invoice(), NOW), "upcoming");
    assert.equal(
      classifyInstallment(invoice({ status: InvoiceStatus.SCHEDULED }), NOW),
      "upcoming",
    );
  });

  test("the week boundary is inclusive of its last day", () => {
    // 23 Sep + 7 days = 30 Sep: still due; 1 Oct: upcoming.
    assert.equal(
      classifyInstallment(invoice({ dueDate: new Date("2026-09-30") }), NOW),
      "due",
    );
    assert.equal(
      classifyInstallment(invoice({ dueDate: new Date("2026-10-01T12:00:00Z") }), NOW),
      "upcoming",
    );
  });

  test("past its due date with nothing paid is overdue", () => {
    assert.equal(
      classifyInstallment(invoice({ dueDate: new Date("2026-01-01") }), NOW),
      "overdue",
    );
  });

  test("rent is not late until the due date has fully elapsed", () => {
    // Due today: still "due", not yet overdue.
    assert.equal(
      classifyInstallment(invoice({ dueDate: new Date("2026-09-23") }), NOW),
      "due",
    );
  });
});

describe("partly paid", () => {
  test("is reported even when the due date has passed", () => {
    // The whole point of the status. 400 of 1,000, three months late.
    const state = classifyInstallment(
      invoice({
        dueDate: new Date("2026-06-01"),
        amountPaid: 400,
        balanceRemaining: 600,
      }),
      NOW,
    );
    assert.equal(state, "partial");
  });

  test("still counts as overdue money", () => {
    // Fixing the badge must not quietly remove the balance from collections.
    const row = {
      dueDate: "2026-06-01",
      balanceRemaining: 600,
      state: "partial" as InstallmentState,
    };
    assert.equal(isOverdue(row, NOW), true);
  });
});

describe("overdue totals", () => {
  test("a settled row is never overdue", () => {
    assert.equal(
      isOverdue(
        { dueDate: "2026-01-01", balanceRemaining: 0, state: "paid" },
        NOW,
      ),
      false,
    );
  });

  test("a cancelled row is never overdue", () => {
    assert.equal(
      isOverdue(
        { dueDate: "2026-01-01", balanceRemaining: 500, state: "cancelled" },
        NOW,
      ),
      false,
    );
  });

  test("a future balance is not overdue", () => {
    assert.equal(
      isOverdue(
        { dueDate: "2026-12-01", balanceRemaining: 1000, state: "upcoming" },
        NOW,
      ),
      false,
    );
  });

  test("the totals are driven by the date, not the badge", () => {
    // Same row, two labels; the money answer must not change.
    const base = { dueDate: "2026-06-01", balanceRemaining: 600 };
    assert.equal(
      isOverdue({ ...base, state: "partial" }, NOW),
      isOverdue({ ...base, state: "overdue" }, NOW),
    );
  });

  test("an installment that was never billed is not overdue, however old", () => {
    // The Due and Overdue registers read invoices, so an unbilled row is on
    // neither. The contract's own overdue count used to include it, and the
    // two disagreed about the same contract.
    assert.equal(
      isOverdue(
        { dueDate: "2026-01-01", balanceRemaining: 1000, state: "planned" },
        NOW,
      ),
      false,
    );
  });

  test("the same installment, once billed, is overdue by the same date", () => {
    const row = { dueDate: "2026-01-01", balanceRemaining: 1000 };
    assert.equal(isOverdue({ ...row, state: "planned" }, NOW), false);
    assert.equal(isOverdue({ ...row, state: "overdue" }, NOW), true);
  });
});
