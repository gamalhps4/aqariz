/**
 * The payment report: every payment received in the period on the day its
 * money arrived, every refund made in the period as its own negative line,
 * and totals and breakdowns over all of them — not over the page on screen.
 *
 * Refunds used to vanish: the register read paid and partly paid payments
 * only, so a payment refunded later dropped out of the month it was received
 * in, and the refund itself appeared nowhere.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  monthKey,
  refundDate,
  registerLines,
  registerPage,
  summarizeRegister,
  type RegisterSource,
} from "@/lib/payments/payment-register";

const at = (iso: string) => new Date(`${iso}T09:00:00.000Z`);

function payment(overrides: Partial<RegisterSource> & { id: string }): RegisterSource {
  return {
    status: "paid",
    paidDate: at("2026-09-05"),
    createdAt: at("2026-09-06"),
    updatedAt: at("2026-09-06"),
    amount: 1000,
    amountPaid: 1000,
    paymentMethod: "bank_transfer",
    type: "rent",
    propertyId: "b1",
    tenantId: "t1",
    propertyName: "برج الياسمين",
    tenantName: "سارة العتيبي",
    paymentHistory: [],
    ...overrides,
  };
}

const september = {
  start: new Date("2026-09-01T00:00:00.000Z"),
  end: new Date("2026-09-30T23:59:59.999Z"),
};

const byId = (...rows: RegisterSource[]) => new Map(rows.map((row) => [row.id, row]));

describe("the lines of the payment report", () => {
  test("a payment received in the period is a line on the day its money arrived", () => {
    const lines = registerLines([payment({ id: "p1" })], [], september);
    assert.deepEqual(
      lines.map((line) => [line.type, line.paymentId, line.date.toISOString(), line.amount]),
      [["receipt", "p1", "2026-09-05T09:00:00.000Z", 1000]],
    );
  });

  test("a part payment counts for the money received, not the amount billed", () => {
    const [line] = registerLines(
      [payment({ id: "p1", status: "partial", amount: 3000, amountPaid: 1200 })],
      [],
      september,
    );
    assert.equal(line.amount, 1200);
  });

  test("money received outside the period, or a charge nobody paid, is not a line", () => {
    const lines = registerLines(
      [
        payment({ id: "august", paidDate: at("2026-08-31") }),
        payment({ id: "october", paidDate: at("2026-10-01") }),
        payment({ id: "pending", status: "pending", amountPaid: 0, paidDate: null }),
        payment({ id: "failed", status: "failed", amountPaid: 0 }),
      ],
      [],
      september,
    );
    assert.deepEqual(lines, []);
  });

  test("a refund is its own line, negative, on the day the money went back", () => {
    const refunded = payment({
      id: "p1",
      status: "refunded",
      paidDate: at("2026-08-20"),
      paymentHistory: [
        { event: "recorded", at: "2026-08-20T09:00:00.000Z", amount: 1000 },
        { event: "refunded", at: "2026-09-12T15:30:00.000Z", amount: 1000 },
      ],
    });
    // Received in August, refunded in September: September holds the refund.
    const lines = registerLines([refunded], [refunded], september);
    assert.deepEqual(
      lines.map((line) => [line.type, line.date.toISOString(), line.amount]),
      [["refund", "2026-09-12T15:30:00.000Z", -1000]],
    );
  });

  test("received and refunded in the same period, the two lines net to nothing", () => {
    const refunded = payment({
      id: "p1",
      status: "refunded",
      paymentHistory: [{ event: "refunded", at: "2026-09-20T10:00:00.000Z" }],
    });
    const lines = registerLines([refunded], [refunded], september);
    assert.deepEqual(
      lines.map((line) => [line.type, line.amount]),
      [
        ["refund", -1000],
        ["receipt", 1000],
      ],
    );
    const summary = summarizeRegister(lines, byId(refunded));
    assert.equal(summary.totalReceived, 1000);
    assert.equal(summary.totalRefunded, 1000);
    assert.equal(summary.totalCollected, 0);
    assert.equal(summary.paymentCount, 1);
    assert.equal(summary.refundCount, 1);
  });

  test("a refund keeps the amount that came in even where the status change zeroed it", () => {
    const refunded = payment({
      id: "p1",
      status: "refunded",
      amount: 2500,
      amountPaid: 0,
      paymentHistory: [{ event: "refunded", at: "2026-09-15T10:00:00.000Z" }],
    });
    const lines = registerLines([], [refunded], september);
    assert.equal(lines[0].amount, -2500);
  });

  test("newest first, and a page boundary always falls in the same place", () => {
    const rows = [
      payment({ id: "a", paidDate: at("2026-09-03") }),
      payment({ id: "c", paidDate: at("2026-09-10") }),
      payment({ id: "b", paidDate: at("2026-09-10") }),
    ];
    const lines = registerLines(rows, [], september);
    assert.deepEqual(
      lines.map((line) => line.paymentId),
      ["c", "b", "a"],
    );
    assert.deepEqual(
      registerLines([...rows].reverse(), [], september).map((line) => line.paymentId),
      ["c", "b", "a"],
    );
  });
});

describe("when a refund was made", () => {
  test("the refunded entry's own date", () => {
    assert.equal(
      refundDate(
        payment({
          id: "p1",
          paymentHistory: [
            { event: "recorded", at: "2026-08-01T00:00:00.000Z" },
            { event: "refunded", at: "2026-09-02T00:00:00.000Z" },
          ],
        }),
      ).toISOString(),
      "2026-09-02T00:00:00.000Z",
    );
  });

  test("an older path's entry with a negative amount", () => {
    assert.equal(
      refundDate(
        payment({
          id: "p1",
          paymentHistory: [{ amount: -1000, date: "2026-09-07T00:00:00.000Z" }],
        }),
      ).toISOString(),
      "2026-09-07T00:00:00.000Z",
    );
  });

  test("with no entry to say, the last time the payment changed", () => {
    assert.equal(
      refundDate(payment({ id: "p1", updatedAt: at("2026-09-09") })).toISOString(),
      "2026-09-09T09:00:00.000Z",
    );
  });
});

describe("the totals and breakdowns", () => {
  const office = payment({ id: "office", amountPaid: 1000, paymentMethod: "bank_transfer" });
  const ownerCash = payment({
    id: "owner-cash",
    amount: 2000,
    amountPaid: 2000,
    paymentMethod: "owner_cash",
    paidDate: at("2026-09-08"),
    propertyId: "b2",
    propertyName: "عمارة النخيل",
    tenantId: "t2",
    tenantName: "خالد",
  });
  const ejar = payment({
    id: "ejar",
    amount: 500,
    amountPaid: 500,
    paymentMethod: "ejari",
    type: "security_deposit",
    paidDate: at("2026-09-09"),
  });
  const noMethod = payment({ id: "old", amountPaid: 300, amount: 300, paymentMethod: null });
  const refunded = payment({
    id: "refunded",
    status: "refunded",
    amountPaid: 400,
    amount: 400,
    paymentMethod: "cash",
    paidDate: at("2026-08-28"),
    paymentHistory: [{ event: "refunded", at: "2026-09-04T00:00:00.000Z" }],
  });
  const sources = byId(office, ownerCash, ejar, noMethod, refunded);
  const lines = registerLines(
    [office, ownerCash, ejar, noMethod, refunded],
    [refunded],
    september,
  );
  const summary = summarizeRegister(lines, sources);

  test("received, refunded and what is left", () => {
    assert.equal(summary.paymentCount, 4);
    assert.equal(summary.refundCount, 1);
    assert.equal(summary.totalReceived, 3800);
    assert.equal(summary.totalRefunded, 400);
    assert.equal(summary.totalCollected, 3400);
  });

  test("by method, a payment with none recorded under 'unspecified'", () => {
    const methods = Object.fromEntries(summary.byMethod.map((group) => [group.key, group.net]));
    assert.deepEqual(methods, {
      owner_cash: 2000,
      bank_transfer: 1000,
      ejari: 500,
      unspecified: 300,
      cash: -400,
    });
  });

  test("by who received it: cash or a transfer to the owner, and Ejar, are the owner's", () => {
    const receivers = Object.fromEntries(
      summary.byReceiver.map((group) => [group.key, [group.count, group.received, group.refunded, group.net]]),
    );
    assert.deepEqual(receivers, {
      owner: [2, 2500, 0, 2500],
      office: [2, 1300, 400, 900],
    });
  });

  test("by month, oldest first, each line in the month it happened", () => {
    assert.deepEqual(
      summary.byMonth.map((group) => [group.key, group.net]),
      [["2026-09", 3400]],
    );
  });

  test("by building, by tenant and by kind of payment, named", () => {
    assert.deepEqual(
      summary.byBuilding.map((group) => [group.label, group.net]),
      [
        ["عمارة النخيل", 2000],
        ["برج الياسمين", 1400],
      ],
    );
    assert.deepEqual(
      summary.byTenant.map((group) => [group.label, group.count]),
      [
        ["خالد", 1],
        ["سارة العتيبي", 3],
      ],
    );
    assert.deepEqual(
      summary.byType.map((group) => [group.key, group.net]),
      [
        ["rent", 2900],
        ["security_deposit", 500],
      ],
    );
  });

  test("every breakdown adds up to the total", () => {
    for (const groups of [
      summary.byMethod,
      summary.byReceiver,
      summary.byMonth,
      summary.byBuilding,
      summary.byTenant,
      summary.byType,
    ]) {
      const net = Math.round(groups.reduce((sum, group) => sum + group.net, 0) * 100) / 100;
      assert.equal(net, summary.totalCollected);
    }
  });

  test("the months are the office's calendar months, in Riyadh", () => {
    // 23:00 Riyadh on 30 September is still September.
    assert.equal(monthKey(new Date("2026-09-30T20:00:00.000Z")), "2026-09");
    // 00:30 Riyadh on 1 October is 21:30 UTC on 30 September: October.
    assert.equal(monthKey(new Date("2026-09-30T21:30:00.000Z")), "2026-10");
  });
});

describe("a page of the report", () => {
  const lines = Array.from({ length: 23 }, (_, index) => index + 1);

  test("pages hold `limit` lines, the last what is left", () => {
    assert.deepEqual(registerPage(lines, 1, 10).lines, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    assert.deepEqual(registerPage(lines, 3, 10).lines, [21, 22, 23]);
    const page = registerPage(lines, 3, 10);
    assert.deepEqual([page.total, page.totalPages, page.page], [23, 3, 3]);
  });

  test("a page past the end shows the last one; nothing at all is one empty page", () => {
    assert.equal(registerPage(lines, 9, 10).page, 3);
    assert.deepEqual(registerPage([], 1, 10), {
      lines: [],
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 1,
    });
  });
});
