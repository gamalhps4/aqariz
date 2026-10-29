/**
 * Security deposits: collected without a payment, and settled at the end.
 *
 * Who holds the deposit decides everything: the office (its own buildings,
 * or an office that keeps deposits) keeps it as a liability until it is
 * refunded or kept; an owner who keeps deposits has it, and only a refund the
 * office pays for them touches the office's books.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  depositHeldBy,
  planDepositReceipt,
  planDepositSettlement,
  type DepositSettlementDoc,
} from "./deposit";
import { totals, totalsByAccount } from "./common";

const DAY = new Date("2026-10-03T00:00:00.000Z");

const base = {
  id: "dep-1",
  date: DAY,
  tenantId: "tenant-1",
  ownerId: "owner-1",
  propertyId: "prop-1",
  unitId: "unit-1",
  leaseId: "lease-1",
};

function amounts(plan: ReturnType<typeof planDepositSettlement>) {
  assert.ok(plan, "expected a plan");
  const sums = totals(plan.lines);
  assert.equal(sums.debit, sums.credit, "the entry balances");
  return totalsByAccount(plan.lines);
}

function settlement(overrides: Partial<DepositSettlementDoc> = {}): DepositSettlementDoc {
  return {
    ...base,
    amount: 5_000,
    refundAmount: 3_000,
    refundMethod: "bank_transfer",
    ownership: "office",
    depositHolder: "owner",
    ...overrides,
  };
}

describe("who holds a deposit", () => {
  test("the office on its own and investment buildings, the setting elsewhere", () => {
    assert.equal(depositHeldBy("office", "owner"), "office");
    assert.equal(depositHeldBy("investment", "owner"), "office");
    assert.equal(depositHeldBy("owner", "owner"), "owner");
    assert.equal(depositHeldBy("owner", "office"), "office");
  });
});

describe("a deposit collected without a payment", () => {
  test("the office holds it as a liability to the tenant", () => {
    const byAccount = amounts(
      planDepositReceipt({ ...base, amount: 5_000, method: "cash", ownership: "office", depositHolder: "owner" }),
    );
    assert.deepEqual(byAccount.get("k:cash_on_hand"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:security_deposits"), { debit: 0, credit: 500_000 });
  });

  test("an owner who keeps deposits is owed it", () => {
    const byAccount = amounts(
      planDepositReceipt({ ...base, amount: 5_000, method: null, ownership: "owner", depositHolder: "owner" }),
    );
    assert.deepEqual(byAccount.get("k:bank"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 500_000 });
  });

  test("paid straight to an owner who keeps it: nothing", () => {
    assert.equal(
      planDepositReceipt({ ...base, amount: 5_000, method: "owner_cash", ownership: "owner", depositHolder: "owner" }),
      null,
    );
  });
});

describe("a deposit settled on the office's own building", () => {
  test("refunded in part: the refund leaves the bank, the rest is other income", () => {
    const byAccount = amounts(planDepositSettlement(settlement()));
    assert.deepEqual(byAccount.get("k:security_deposits"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 300_000 });
    assert.deepEqual(byAccount.get("k:other_income"), { debit: 0, credit: 200_000 });
  });

  test("forfeited: all of it is kept", () => {
    const byAccount = amounts(planDepositSettlement(settlement({ refundAmount: 0 })));
    assert.deepEqual(byAccount.get("k:other_income"), { debit: 0, credit: 500_000 });
    assert.equal(byAccount.has("k:bank"), false);
  });

  test("refunded in cash: from the cash box", () => {
    const byAccount = amounts(planDepositSettlement(settlement({ refundAmount: 5_000, refundMethod: "cash" })));
    assert.deepEqual(byAccount.get("k:cash_on_hand"), { debit: 0, credit: 500_000 });
  });
});

describe("a deposit settled on an owner's building", () => {
  test("held by the office: what is kept compensates the owner", () => {
    const byAccount = amounts(
      planDepositSettlement(settlement({ ownership: "owner", depositHolder: "office" })),
    );
    assert.deepEqual(byAccount.get("k:security_deposits"), { debit: 500_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 300_000 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 200_000 });
  });

  test("held by the owner: a refund the office paid comes off what it owes them", () => {
    const byAccount = amounts(
      planDepositSettlement(settlement({ ownership: "owner", depositHolder: "owner" })),
    );
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 300_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 300_000 });
    assert.equal(byAccount.has("k:security_deposits"), false);
  });

  test("held by the owner and refunded by them: nothing for the office", () => {
    assert.equal(
      planDepositSettlement(
        settlement({ ownership: "owner", depositHolder: "owner", refundMethod: "owner_account" }),
      ),
      null,
    );
  });

  test("held by the office but refunded by the owner: the office owes them", () => {
    const byAccount = amounts(
      planDepositSettlement(
        settlement({ ownership: "owner", depositHolder: "office", refundMethod: "owner_cash" }),
      ),
    );
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 500_000 });
    assert.equal(byAccount.has("k:bank"), false);
  });
});
