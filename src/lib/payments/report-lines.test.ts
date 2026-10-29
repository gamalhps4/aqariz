/**
 * A payment as the reports show it: under the installment it paid, with its
 * own date, the share it put on that installment, how it was paid and who
 * recorded it — and the installment's last payment date taken from the
 * payments, not from the moment someone typed the last one in.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  installmentAsAt,
  installmentPayments,
  lastPaymentDate,
  receivedAmount,
  paymentReceiver,
  paymentReference,
  receivableLines,
  type ReportPaymentSource,
} from "@/lib/payments/report-lines";
import type { ReceivableRow } from "@/types/payment-report";

function payment(
  overrides: Partial<ReportPaymentSource> & { id: string },
): ReportPaymentSource {
  return {
    status: "paid",
    paidDate: new Date("2026-08-05T00:00:00.000Z"),
    createdAt: new Date("2026-08-20T09:30:00.000Z"),
    amount: 1000,
    amountPaid: 1000,
    paymentMethod: "cash",
    allocations: [],
    paymentHistory: [],
    recordedBy: null,
    ...overrides,
  };
}

function byId(...rows: ReportPaymentSource[]) {
  return new Map(rows.map((row) => [row.id, row]));
}

describe("the reference", () => {
  test("is what the office typed, the latest entry that has one", () => {
    assert.equal(
      paymentReference({
        paymentHistory: [
          { event: "recorded", reference: "TRX-1" },
          { event: "deleted" },
          { event: "recorded", reference: "  TRX-2 " },
          { event: "restored" },
        ],
      }),
      "TRX-2",
    );
  });

  test("falls back to the gateway's own reference", () => {
    assert.equal(
      paymentReference({ paymentHistory: [], stripePaymentIntentId: "pi_1" }),
      "pi_1",
    );
    assert.equal(
      paymentReference({ paymentHistory: [{ reference: " " }], paypalCaptureId: "cap_1" }),
      "cap_1",
    );
  });

  test("the typed reference wins over the gateway's", () => {
    assert.equal(
      paymentReference({
        paymentHistory: [{ event: "recorded", reference: "CHQ-88" }],
        stripePaymentIntentId: "pi_1",
      }),
      "CHQ-88",
    );
  });

  test("then an older path's transaction id — never a refund's", () => {
    assert.equal(
      paymentReference({ paymentHistory: [{ amount: 1500, transactionId: "TXN-DEMO-7" }] }),
      "TXN-DEMO-7",
    );
    assert.equal(
      paymentReference({
        paymentHistory: [
          { amount: 1500, transactionId: "TXN-1" },
          { amount: -500, transactionId: "re_1" },
        ],
      }),
      "TXN-1",
    );
  });

  test("is empty when nothing proves it", () => {
    assert.equal(paymentReference({ paymentHistory: null }), null);
    assert.equal(paymentReference({ paymentHistory: [{ transactionId: "" }] }), null);
  });
});

describe("who received the money", () => {
  test("the owner, for the three methods that bypass the office", () => {
    for (const method of ["owner_cash", "owner_account", "ejari"]) {
      assert.equal(paymentReceiver(method), "owner", method);
    }
  });

  test("the office, for everything else", () => {
    for (const method of ["cash", "pos", "bank_transfer", "credit_card", null]) {
      assert.equal(paymentReceiver(method), "office", String(method));
    }
  });
});

describe("the payments on an installment", () => {
  test("one line each, oldest first, from the installment's own list", () => {
    const lines = installmentPayments(
      { id: "inv_1", paymentIds: ["p_late", "p_early", "p_gone", "p_early"] },
      byId(
        payment({ id: "p_late", paidDate: new Date("2026-08-20T00:00:00.000Z"), amountPaid: 3000 }),
        payment({ id: "p_early", paidDate: new Date("2026-08-05T00:00:00.000Z"), amountPaid: 4000 }),
        payment({ id: "p_other", amountPaid: 9999 }),
      ),
    );
    assert.deepEqual(
      lines.map((line) => [line.paymentId, line.paidDate.slice(0, 10), line.amount]),
      [
        ["p_early", "2026-08-05", 4000],
        ["p_late", "2026-08-20", 3000],
      ],
    );
  });

  test("a charge nobody has paid is not a payment", () => {
    const lines = installmentPayments(
      { id: "inv_1", paymentIds: ["p_pending", "p_overdue", "p_failed", "p_partial", "p_refunded"] },
      byId(
        payment({ id: "p_pending", status: "pending", amountPaid: 0 }),
        payment({ id: "p_overdue", status: "overdue", amountPaid: 0 }),
        payment({ id: "p_failed", status: "failed", amountPaid: 0 }),
        payment({ id: "p_partial", status: "partial", amount: 1000, amountPaid: 400 }),
        payment({ id: "p_refunded", status: "refunded" }),
      ),
    );
    assert.deepEqual(
      lines.map((line) => [line.paymentId, line.amount]),
      [["p_partial", 400]],
    );
  });

  test("each line carries its payment number, the receipt number it printed under", () => {
    const [numbered, unnumbered] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1", "p_2"] },
      byId(
        payment({ id: "p_1", number: 42, paidDate: new Date("2026-08-01T00:00:00.000Z") }),
        payment({ id: "p_2", paidDate: new Date("2026-08-02T00:00:00.000Z") }),
      ),
    );
    assert.equal(numbered.paymentNumber, "RCP-000042");
    // Not numbered yet (before the backfill), or the column not read.
    assert.equal(unnumbered.paymentNumber, null);
  });

  test("the date is when the money arrived, not when it was typed in", () => {
    const [line] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1"] },
      byId(payment({ id: "p_1" })),
    );
    assert.equal(line.paidDate, "2026-08-05T00:00:00.000Z");

    const [undated] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1"] },
      byId(payment({ id: "p_1", paidDate: null })),
    );
    assert.equal(undated.paidDate, "2026-08-20T09:30:00.000Z");
  });

  test("a payment split over several installments shows only this one's share", () => {
    const split = payment({
      id: "p_split",
      amount: 5000,
      amountPaid: 5000,
      allocations: [
        { invoiceId: "inv_1", amount: 2000 },
        { invoiceId: "inv_2", amount: 3000 },
      ],
    });
    const [first] = installmentPayments({ id: "inv_1", paymentIds: ["p_split"] }, byId(split));
    const [second] = installmentPayments({ id: "inv_2", paymentIds: ["p_split"] }, byId(split));
    assert.equal(first.amount, 2000);
    assert.equal(second.amount, 3000);
  });

  test("without an allocation, what was captured — else what was asked", () => {
    const [captured] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1"] },
      byId(payment({ id: "p_1", amount: 1000, amountPaid: 600 })),
    );
    assert.equal(captured.amount, 600);

    const [asked] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1"] },
      byId(payment({ id: "p_1", amount: 1000, amountPaid: 0 })),
    );
    assert.equal(asked.amount, 1000);
  });

  test("method, reference and who recorded it", () => {
    const [recorded, online, unknown] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_desk", "p_online", "p_old"] },
      byId(
        payment({
          id: "p_desk",
          paidDate: new Date("2026-08-01T00:00:00.000Z"),
          paymentMethod: "bank_transfer",
          paymentHistory: [{ event: "recorded", reference: "TRX-5521" }],
          recordedBy: { firstName: "سارة", lastName: "العتيبي" },
        }),
        payment({
          id: "p_online",
          paidDate: new Date("2026-08-02T00:00:00.000Z"),
          paymentMethod: "credit_card",
          stripePaymentIntentId: "pi_9",
        }),
        payment({
          id: "p_old",
          paidDate: new Date("2026-08-03T00:00:00.000Z"),
          paymentMethod: null,
        }),
      ),
    );
    assert.deepEqual(
      [recorded.method, recorded.reference, recorded.recordedBy, recorded.online],
      ["bank_transfer", "TRX-5521", "سارة العتيبي", false],
    );
    assert.deepEqual(
      [online.method, online.reference, online.recordedBy, online.online],
      ["credit_card", "pi_9", null, true],
    );
    assert.deepEqual(
      [unknown.method, unknown.reference, unknown.recordedBy, unknown.online],
      ["unspecified", null, null, false],
    );
  });
});

describe("the last payment date", () => {
  const stamped = new Date("2026-09-29T10:00:00.000Z");

  test("is the latest payment's own date, not the applied-at stamp", () => {
    const lines = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1", "p_2"] },
      byId(
        payment({ id: "p_1", paidDate: new Date("2026-08-20T00:00:00.000Z") }),
        payment({ id: "p_2", paidDate: new Date("2026-08-05T00:00:00.000Z") }),
      ),
    );
    assert.equal(
      lastPaymentDate(lines, { amountPaid: 2000, lastPaymentDate: stamped }),
      "2026-08-20T00:00:00.000Z",
    );
  });

  test("falls back to the stamp only while money is on the installment", () => {
    assert.equal(
      lastPaymentDate([], { amountPaid: 500, lastPaymentDate: stamped }),
      stamped.toISOString(),
    );
    // A payment taken back off leaves the stamp behind.
    assert.equal(lastPaymentDate([], { amountPaid: 0, lastPaymentDate: stamped }), null);
    assert.equal(lastPaymentDate([], { amountPaid: 0, lastPaymentDate: null }), null);
  });
});

describe("a register as spreadsheet rows", () => {
  test("each installment, then one row per payment beneath it", () => {
    const [first] = installmentPayments(
      { id: "inv_1", paymentIds: ["p_1"] },
      byId(payment({ id: "p_1" })),
    );
    const paid = { invoiceId: "inv_1", payments: [first] } as ReceivableRow;
    const unpaid = { invoiceId: "inv_2", payments: [] } as unknown as ReceivableRow;

    const lines = receivableLines([paid, unpaid]);
    assert.deepEqual(
      lines.map((line) => [line.installment.invoiceId, line.payment?.paymentId ?? null]),
      [
        ["inv_1", null],
        ["inv_1", "p_1"],
        ["inv_2", null],
      ],
    );
  });
});

describe("an installment as it stood at a moment", () => {
  // 3,000 due on 1 August: 1,000 paid on 5 August, the rest on 10 September.
  const lines = installmentPayments(
    { id: "inv_1", paymentIds: ["p_aug", "p_sep"] },
    byId(
      payment({
        id: "p_aug",
        amount: 1000,
        amountPaid: 1000,
        paidDate: new Date("2026-08-05T00:00:00.000Z"),
      }),
      payment({
        id: "p_sep",
        amount: 2000,
        amountPaid: 2000,
        paidDate: new Date("2026-09-10T00:00:00.000Z"),
      }),
    ),
  );
  const paidOff = {
    amountPaid: 3000,
    balanceRemaining: 0,
    lastPaymentDate: new Date("2026-09-10T08:00:00.000Z"),
  };
  const endOf = (iso: string) => new Date(`${iso}T23:59:59.999Z`);

  test("read now, it is what it holds", () => {
    const now = installmentAsAt(paidOff, lines, null);
    assert.equal(now.balance, 0);
    assert.equal(now.amountPaid, 3000);
    assert.equal(now.payments.length, 2);
  });

  test("as at a date before it was paid off, it still owed the rest", () => {
    const august = installmentAsAt(paidOff, lines, endOf("2026-08-31"));
    assert.equal(august.balance, 2000);
    assert.equal(august.amountPaid, 1000);
    assert.deepEqual(
      august.payments.map((line) => line.paymentId),
      ["p_aug"],
    );
    assert.equal(august.lastPaymentDate, "2026-08-05T00:00:00.000Z");
  });

  test("as at a date before any payment, it owed all of it", () => {
    const july = installmentAsAt(paidOff, lines, endOf("2026-07-31"));
    assert.equal(july.balance, 3000);
    assert.equal(july.amountPaid, 0);
    assert.deepEqual(july.payments, []);
    assert.equal(july.lastPaymentDate, null);
  });

  test("a payment made on the day itself counts as made by then", () => {
    const tenth = installmentAsAt(paidOff, lines, endOf("2026-09-10"));
    assert.equal(tenth.balance, 0);
  });

  test("money no listed payment accounts for goes by when it was applied", () => {
    const unlisted = {
      amountPaid: 3000,
      balanceRemaining: 0,
      lastPaymentDate: new Date("2026-09-10T08:00:00.000Z"),
    };
    assert.equal(installmentAsAt(unlisted, [], endOf("2026-08-31")).balance, 3000);
    assert.equal(installmentAsAt(unlisted, [], endOf("2026-09-30")).balance, 0);
  });

  test("never takes back more than the installment holds", () => {
    // A payment still listed after its money was taken off the installment.
    const reversed = { amountPaid: 0, balanceRemaining: 3000, lastPaymentDate: null };
    const august = installmentAsAt(reversed, lines, endOf("2026-08-31"));
    assert.equal(august.balance, 3000);
    assert.equal(august.amountPaid, 0);
  });
});

describe("what a payment brought in", () => {
  test("is what was captured, or the amount on an older row", () => {
    assert.equal(receivedAmount({ amount: 1000, amountPaid: 400 }), 400);
    assert.equal(receivedAmount({ amount: 1000, amountPaid: 0 }), 1000);
    assert.equal(receivedAmount({ amount: 1000, amountPaid: null }), 1000);
  });
});
