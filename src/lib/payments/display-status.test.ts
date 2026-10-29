/**
 * The payments list's status filter lists exactly the rows whose badge reads
 * that status.
 *
 * The filter used to send stored statuses — Pending twice, the second copy
 * labelled "Processing" — while each badge is worked out from the stored
 * status, the money and the due date together. Picking "Overdue" listed
 * rows whose badge said Partly paid, and nothing could pick Due or Upcoming.
 * The query fragment is checked against the badge rule itself, so the two
 * cannot drift apart again.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PAYMENT_DISPLAY_STATUSES,
  daysOverdue,
  displayStatusWhere,
  isPaymentDisplayStatus,
  paymentDisplayStatus,
} from "@/lib/payments/display-status";
import { PaymentStatus } from "@/types";

/** Midday on the 1st in Riyadh (09:00 UTC) — "today" is unambiguous. */
const NOW = new Date("2026-10-01T09:00:00.000Z");

/** A due date as it is stored: the day, at midnight UTC. */
function daysFromToday(days: number): Date {
  return new Date(Date.UTC(2026, 9, 1 + days));
}

/**
 * Riyadh's midnight between the 3rd and the 4th, and the minutes either side.
 * The server's own clock is still on the 3rd for three more hours.
 */
const LAST_MINUTE_OF_THE_3RD = new Date("2026-10-03T20:59:59.999Z");
const FIRST_MINUTE_OF_THE_4TH = new Date("2026-10-03T21:00:00.000Z");
const FOUR_IN_THE_MORNING_ON_THE_4TH = new Date("2026-10-04T01:00:00.000Z");

interface Row {
  status: string;
  amount: number;
  amountPaid: number;
  dueDate: Date;
}

const asNumber = (value: unknown) =>
  value instanceof Date ? value.getTime() : Number(value);

/**
 * Evaluate a fragment against a row the way Postgres would, for the shapes
 * `displayStatusWhere` writes. An operator it does not model fails the test
 * rather than passing silently.
 */
function matches(where: Record<string, unknown>, row: Row): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[field];
    if (
      condition === null ||
      typeof condition !== "object" ||
      condition instanceof Date
    ) {
      return value === condition;
    }
    return Object.entries(condition).every(([operator, operand]) => {
      switch (operator) {
        case "in":
          return (operand as unknown[]).includes(value);
        case "lt":
          return asNumber(value) < asNumber(operand);
        case "lte":
          return asNumber(value) <= asNumber(operand);
        case "gt":
          return asNumber(value) > asNumber(operand);
        case "gte":
          return asNumber(value) >= asNumber(operand);
        default:
          throw new Error(`The test does not model the "${operator}" operator`);
      }
    });
  });
}

/**
 * Every row worth telling apart: each stored status, due long ago, yesterday,
 * today, tomorrow and later, with nothing, part or (once settled) all of the
 * money in. A still-open row never holds its whole amount — recording that
 * much settles it as PAID.
 */
function rows(): Row[] {
  const open = [PaymentStatus.PENDING, PaymentStatus.OVERDUE, PaymentStatus.PARTIAL];
  const out: Row[] = [];
  for (const status of Object.values(PaymentStatus)) {
    const paidAmounts = (open as string[]).includes(status)
      ? [0, 400]
      : [0, 400, 1000];
    for (const amountPaid of paidAmounts) {
      for (const days of [-30, -1, 0, 1, 30]) {
        out.push({ status, amount: 1000, amountPaid, dueDate: daysFromToday(days) });
      }
    }
  }
  return out;
}

describe("the status filter", () => {
  test("lists exactly the rows whose badge reads that status", () => {
    // At midday, and on both sides of Riyadh's midnight — where the server's
    // day and the office's differ.
    for (const now of [
      NOW,
      LAST_MINUTE_OF_THE_3RD,
      FIRST_MINUTE_OF_THE_4TH,
      FOUR_IN_THE_MORNING_ON_THE_4TH,
    ]) {
      for (const row of rows()) {
        const badge = paymentDisplayStatus(row, now);
        for (const state of PAYMENT_DISPLAY_STATUSES) {
          assert.equal(
            matches(displayStatusWhere(state, now), row),
            badge === state,
            `${state} filter vs a ${row.status} row, ${row.amountPaid} paid, due ${row.dueDate.toISOString().slice(0, 10)} at ${now.toISOString()} (badge: ${badge})`,
          );
        }
      }
    }
  });

  test("offers every state a badge can show, once", () => {
    const seen = new Set(rows().map((row) => paymentDisplayStatus(row, NOW)));
    for (const state of seen) {
      assert.ok(PAYMENT_DISPLAY_STATUSES.includes(state), state);
    }
    assert.equal(
      new Set(PAYMENT_DISPLAY_STATUSES).size,
      PAYMENT_DISPLAY_STATUSES.length,
    );
  });

  test("due means due today, and upcoming anything later", () => {
    const pending = (days: number): Row => ({
      status: PaymentStatus.PENDING,
      amount: 1000,
      amountPaid: 0,
      dueDate: daysFromToday(days),
    });
    assert.ok(matches(displayStatusWhere("due", NOW), pending(0)));
    assert.ok(matches(displayStatusWhere("upcoming", NOW), pending(1)));
    assert.ok(matches(displayStatusWhere("overdue", NOW), pending(-1)));
  });

  test("accepts only the states it knows", () => {
    assert.ok(isPaymentDisplayStatus("overdue"));
    assert.ok(!isPaymentDisplayStatus("pending"));
    assert.ok(!isPaymentDisplayStatus("processing"));
    assert.ok(!isPaymentDisplayStatus(undefined));
  });
});

describe("the day a payment falls due turns over at Riyadh's midnight", () => {
  const open = (due: string): Parameters<typeof paymentDisplayStatus>[0] => ({
    status: PaymentStatus.PENDING,
    amount: 1000,
    amountPaid: 0,
    dueDate: new Date(`${due}T00:00:00.000Z`),
  });

  test("rent due on the 3rd is still due in the 3rd's last minute", () => {
    assert.equal(
      paymentDisplayStatus(open("2026-10-03"), LAST_MINUTE_OF_THE_3RD),
      "due",
    );
  });

  test("and overdue from the first minute of the 4th, not three hours later", () => {
    // 21:00 UTC is already the 4th in Riyadh; the server's day was still the 3rd.
    assert.equal(
      paymentDisplayStatus(open("2026-10-03"), FIRST_MINUTE_OF_THE_4TH),
      "overdue",
    );
    assert.equal(
      paymentDisplayStatus(open("2026-10-03"), FOUR_IN_THE_MORNING_ON_THE_4TH),
      "overdue",
    );
  });

  test("rent due on the 4th is upcoming until the 4th begins, then due", () => {
    assert.equal(
      paymentDisplayStatus(open("2026-10-04"), LAST_MINUTE_OF_THE_3RD),
      "upcoming",
    );
    assert.equal(
      paymentDisplayStatus(open("2026-10-04"), FIRST_MINUTE_OF_THE_4TH),
      "due",
    );
  });

  test("days overdue are calendar days, whatever the hour", () => {
    const due = open("2026-10-03");
    assert.equal(daysOverdue(due, LAST_MINUTE_OF_THE_3RD), 0);
    assert.equal(daysOverdue(due, FIRST_MINUTE_OF_THE_4TH), 1);
    // Late in the 4th (Riyadh 23:00) it is still one day, not two.
    assert.equal(daysOverdue(due, new Date("2026-10-04T20:00:00.000Z")), 1);
    assert.equal(daysOverdue(due, new Date("2026-10-04T21:00:00.000Z")), 2);
  });
});
