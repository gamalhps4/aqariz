/**
 * Purchase bills and payment vouchers on the books: an approved bill owes the
 * supplier (cost and input VAT / suppliers' payable), a voucher pays them
 * (suppliers' payable / the bank), and neither is posted until it is a real
 * document — a pending or cancelled bill, a cancelled voucher, post nothing.
 * A bill is the office's own purchase whatever building its lines are on: the
 * building is a cost centre, and what an owner bears is an Expense.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  planPaymentVoucher,
  planPurchaseBill,
  type PaymentVoucherDoc,
  type PurchaseBillDoc,
  type PurchaseBillLineDoc,
} from "./purchase";
import { totals, totalsByAccount } from "./common";
import { fingerprintPlan } from "./fingerprint";
import type { PostingPlan } from "../types";

const DAY = new Date("2026-10-04T00:00:00.000Z");

function line(overrides: Partial<PurchaseBillLineDoc> = {}): PurchaseBillLineDoc {
  return {
    accountId: "acct-supplies",
    net: 1_000,
    vat: 150,
    vatCategory: "S",
    ...overrides,
  };
}

function bill(overrides: Partial<PurchaseBillDoc> = {}): PurchaseBillDoc {
  return {
    id: "bill-1",
    number: "BILL-000001",
    date: DAY,
    status: "approved",
    supplierId: "sup-1",
    lines: [line()],
    vatRecoverable: true,
    ...overrides,
  };
}

function balanced(plan: PostingPlan | null) {
  assert.ok(plan, "expected a plan");
  const sums = totals(plan.lines);
  assert.equal(sums.debit, sums.credit, "the entry balances");
  return totalsByAccount(plan.lines);
}

const keyed = (plan: PostingPlan, key: string) =>
  plan.lines.filter((entry) => "key" in entry.account && entry.account.key === key);
const byId = (plan: PostingPlan, id: string) =>
  plan.lines.filter((entry) => "id" in entry.account && entry.account.id === id);

describe("an approved bill on the office's own account", () => {
  test("charges the cost and the input VAT, and owes the supplier the total", () => {
    const plan = planPurchaseBill(bill());
    const sums = balanced(plan);
    assert.deepEqual(sums.get("i:acct-supplies"), { debit: 100_000, credit: 0 });
    assert.deepEqual(sums.get("k:input_vat"), { debit: 15_000, credit: 0 });
    assert.deepEqual(sums.get("k:supplier_payables"), { debit: 0, credit: 115_000 });
    assert.equal(plan!.sourceType, "purchase_bill");
    assert.equal(plan!.sourceId, "bill-1");
    assert.equal(plan!.sourceRef, "BILL-000001");
    assert.equal(plan!.date.getTime(), DAY.getTime());
  });

  test("the supplier's line is kept in the supplier's sub-ledger", () => {
    const plan = planPurchaseBill(bill())!;
    const payable = keyed(plan, "supplier_payables")[0];
    assert.equal(payable.partyType, "supplier");
    assert.equal(payable.partyId, "sup-1");
  });

  test("the cost line carries its VAT category for the VAT return", () => {
    const plan = planPurchaseBill(
      bill({
        lines: [
          line({ accountId: "a-s", net: 1_000, vat: 150, vatCategory: "S" }),
          line({ accountId: "a-z", net: 500, vat: 0, vatCategory: "Z" }),
          line({ accountId: "a-e", net: 200, vat: 0, vatCategory: "E" }),
          line({ accountId: "a-o", net: 100, vat: 0, vatCategory: "O" }),
        ],
      }),
    )!;
    balanced(plan);
    assert.equal(byId(plan, "a-s")[0].vatCode, "S");
    assert.equal(byId(plan, "a-z")[0].vatCode, "Z");
    assert.equal(byId(plan, "a-e")[0].vatCode, "E");
    assert.equal(byId(plan, "a-o")[0].vatCode, "O");
    // Only the standard-rated line has input VAT.
    assert.equal(keyed(plan, "input_vat").length, 1);
    assert.equal(keyed(plan, "input_vat")[0].vatCode, "S");
    assert.equal(keyed(plan, "input_vat")[0].debit, 15_000);
    assert.equal(keyed(plan, "supplier_payables")[0].credit, 195_000);
  });

  test("an office that is not VAT-registered carries the VAT in the cost", () => {
    const plan = planPurchaseBill(bill({ vatRecoverable: false }))!;
    const sums = balanced(plan);
    assert.deepEqual(sums.get("i:acct-supplies"), { debit: 115_000, credit: 0 });
    assert.equal(sums.has("k:input_vat"), false);
    assert.equal(byId(plan, "acct-supplies")[0].vatCode ?? null, null);
  });

  test("the cost centre rides on the cost and the VAT lines", () => {
    const plan = planPurchaseBill(bill({ lines: [line({ propertyId: "prop-1", unitId: "unit-1" })] }))!;
    for (const entry of [byId(plan, "acct-supplies")[0], keyed(plan, "input_vat")[0]]) {
      assert.equal(entry.propertyId, "prop-1");
      assert.equal(entry.unitId, "unit-1");
    }
  });

  test("what each line was for is on its journal line", () => {
    const plan = planPurchaseBill(
      bill({ lines: [line({ description: "  Plumbing   repair — lobby " })] }),
    )!;
    assert.equal(byId(plan, "acct-supplies")[0].memo, "Plumbing repair — lobby");
  });

  test("lines for the same account, building and thing bought are one journal line", () => {
    const plan = planPurchaseBill(
      bill({
        lines: [
          line({ net: 100, vat: 15, description: "Paint", propertyId: "prop-1" }),
          line({ net: 300, vat: 45, description: "Paint", propertyId: "prop-1" }),
        ],
      }),
    )!;
    balanced(plan);
    assert.equal(byId(plan, "acct-supplies").length, 1);
    assert.equal(byId(plan, "acct-supplies")[0].debit, 40_000);
  });
});

describe("a line on a building", () => {
  test("is the office's cost, whoever owns the building", () => {
    // What an owner bears is an Expense (the statements read those); a bill
    // must not move an owner's balance in the books, or the statement and the
    // books would part.
    const plan = planPurchaseBill(bill({ lines: [line({ propertyId: "prop-1", unitId: "unit-1" })] }))!;
    const sums = balanced(plan);
    assert.deepEqual(sums.get("i:acct-supplies"), { debit: 100_000, credit: 0 });
    assert.deepEqual(sums.get("k:input_vat"), { debit: 15_000, credit: 0 });
    assert.equal(sums.has("k:owner_payable"), false);
    assert.equal(
      plan.lines.some((entry) => entry.partyType === "owner"),
      false,
    );
  });

  test("lines on different buildings keep their own cost centres", () => {
    const plan = planPurchaseBill(
      bill({
        lines: [
          line({ net: 100, vat: 15, description: "A", propertyId: "prop-1" }),
          line({ net: 200, vat: 30, description: "B", propertyId: "prop-2" }),
          line({ net: 300, vat: 45, description: "C", propertyId: null }),
        ],
      }),
    )!;
    balanced(plan);
    const costs = byId(plan, "acct-supplies");
    assert.deepEqual(
      costs.map((entry) => [entry.propertyId ?? null, entry.debit]),
      [
        ["prop-1", 10_000],
        ["prop-2", 20_000],
        [null, 30_000],
      ],
    );
    assert.equal(keyed(plan, "supplier_payables")[0].credit, 69_000);
  });

  test("an office that cannot reclaim VAT carries it in the cost on a building too", () => {
    const plan = planPurchaseBill(
      bill({ vatRecoverable: false, lines: [line({ propertyId: "prop-1" })] }),
    )!;
    const sums = balanced(plan);
    assert.deepEqual(sums.get("i:acct-supplies"), { debit: 115_000, credit: 0 });
    assert.equal(sums.has("k:input_vat"), false);
    assert.equal(byId(plan, "acct-supplies")[0].propertyId, "prop-1");
  });
});

describe("which bills post", () => {
  test("approved, partly paid and paid bills are owed", () => {
    for (const status of ["approved", "partially_paid", "paid"]) {
      assert.ok(planPurchaseBill(bill({ status })), status);
    }
  });

  test("a bill waiting for approval or cancelled posts nothing", () => {
    assert.equal(planPurchaseBill(bill({ status: "pending" })), null);
    assert.equal(planPurchaseBill(bill({ status: "cancelled" })), null);
  });

  test("being paid does not change what the bill posts", () => {
    const approved = planPurchaseBill(bill({ status: "approved" }))!;
    const paid = planPurchaseBill(bill({ status: "paid" }))!;
    assert.equal(fingerprintPlan(approved), fingerprintPlan(paid));
  });

  test("a bill that comes to nothing posts nothing", () => {
    assert.equal(planPurchaseBill(bill({ lines: [] })), null);
    assert.equal(planPurchaseBill(bill({ lines: [line({ net: 0, vat: 0 })] })), null);
  });

  test("editing a line changes what the bill posts", () => {
    const before = planPurchaseBill(bill())!;
    const after = planPurchaseBill(bill({ lines: [line({ net: 1_100, vat: 165 })] }))!;
    assert.notEqual(fingerprintPlan(before), fingerprintPlan(after));
  });
});

function voucher(overrides: Partial<PaymentVoucherDoc> = {}): PaymentVoucherDoc {
  return {
    id: "pv-1",
    number: "PV-000001",
    date: DAY,
    status: "posted",
    supplierId: "sup-1",
    amount: 1_150,
    bankLedgerAccountId: "ledger-bank",
    reference: "TRF-889",
    ...overrides,
  };
}

describe("a payment voucher", () => {
  test("pays the supplier out of the account it was drawn on", () => {
    const plan = planPaymentVoucher(voucher());
    const sums = balanced(plan);
    assert.deepEqual(sums.get("k:supplier_payables"), { debit: 115_000, credit: 0 });
    assert.deepEqual(sums.get("i:ledger-bank"), { debit: 0, credit: 115_000 });
    assert.equal(plan!.sourceType, "payment_voucher");
    assert.equal(plan!.sourceId, "pv-1");
    assert.equal(plan!.sourceRef, "PV-000001");
    assert.equal(plan!.memo, "TRF-889");
    const payable = keyed(plan!, "supplier_payables")[0];
    assert.equal(payable.partyType, "supplier");
    assert.equal(payable.partyId, "sup-1");
  });

  test("a cancelled voucher, or one for nothing, posts nothing", () => {
    assert.equal(planPaymentVoucher(voucher({ status: "cancelled" })), null);
    assert.equal(planPaymentVoucher(voucher({ amount: 0 })), null);
  });

  test("drawn on another account, it posts differently", () => {
    const first = planPaymentVoucher(voucher())!;
    const other = planPaymentVoucher(voucher({ bankLedgerAccountId: "ledger-cash" }))!;
    assert.notEqual(fingerprintPlan(first), fingerprintPlan(other));
  });

  test("a payment and the bill it settles leave the supplier owed nothing", () => {
    const owed = planPurchaseBill(bill())!;
    const paid = planPaymentVoucher(voucher())!;
    const net = [...owed.lines, ...paid.lines]
      .filter((entry) => "key" in entry.account && entry.account.key === "supplier_payables")
      .reduce((sum, entry) => sum + entry.credit - entry.debit, 0);
    assert.equal(net, 0);
  });
});
