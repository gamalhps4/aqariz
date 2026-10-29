/**
 * Expenses: an owner's cost comes off what the office holds for them; the
 * office's own cost is an expense by category, with reclaimable VAT apart.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planExpense, type ExpenseDoc } from "./expense";
import { totals, totalsByAccount } from "./common";

const DAY = new Date("2026-10-03T00:00:00.000Z");

function expense(overrides: Partial<ExpenseDoc> = {}): ExpenseDoc {
  return {
    id: "exp-1",
    number: "EXP-1",
    date: DAY,
    amount: 1_150,
    vatAmount: 150,
    vatRecoverable: true,
    category: "maintenance",
    status: "paid",
    method: "bank_transfer",
    propertyId: "prop-1",
    unitId: null,
    ownerId: "owner-1",
    ownership: "owner",
    ...overrides,
  };
}

function amounts(plan: ReturnType<typeof planExpense>) {
  assert.ok(plan, "expected a plan");
  const sums = totals(plan.lines);
  assert.equal(sums.debit, sums.credit, "the entry balances");
  return totalsByAccount(plan.lines);
}

describe("on an owner's building", () => {
  test("the whole cost, VAT included, comes off the owner's payable", () => {
    const plan = planExpense(expense());
    const byAccount = amounts(plan);
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 115_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 115_000 });
    assert.equal(byAccount.has("k:input_vat"), false);
    const owner = plan!.lines.find(
      (line) => "key" in line.account && line.account.key === "owner_payable",
    )!;
    assert.equal(owner.partyType, "owner");
    assert.equal(owner.partyId, "owner-1");
    assert.equal(owner.propertyId, "prop-1");
  });
});

describe("the office's own cost", () => {
  test("is an expense by category with input VAT apart", () => {
    const byAccount = amounts(planExpense(expense({ propertyId: null, ownerId: null, ownership: null })));
    assert.deepEqual(byAccount.get("k:expense_maintenance"), { debit: 100_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:input_vat"), { debit: 15_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 115_000 });
  });

  test("an office that cannot reclaim VAT carries it in the cost", () => {
    const byAccount = amounts(
      planExpense(expense({ propertyId: null, ownerId: null, ownership: null, vatRecoverable: false })),
    );
    assert.deepEqual(byAccount.get("k:expense_maintenance"), { debit: 115_000, credit: 0 });
    assert.equal(byAccount.has("k:input_vat"), false);
  });

  test("on its own building it is the office's cost too", () => {
    const byAccount = amounts(planExpense(expense({ ownership: "office", category: "utilities" })));
    assert.deepEqual(byAccount.get("k:expense_utilities"), { debit: 100_000, credit: 0 });
    assert.equal(byAccount.has("k:owner_payable"), false);
  });

  test("an unknown category is an other expense", () => {
    const byAccount = amounts(planExpense(expense({ ownership: null, category: "something-new" })));
    assert.deepEqual(byAccount.get("k:expense_other"), { debit: 100_000, credit: 0 });
  });

  test("paid in cash: from the cash box", () => {
    const byAccount = amounts(planExpense(expense({ ownership: null, method: "cash" })));
    assert.deepEqual(byAccount.get("k:cash_on_hand"), { debit: 0, credit: 115_000 });
  });
});

describe("by status", () => {
  test("approved but unpaid is owed as an accrued expense", () => {
    const byAccount = amounts(planExpense(expense({ status: "approved" })));
    assert.deepEqual(byAccount.get("k:accrued_expenses"), { debit: 0, credit: 115_000 });
    assert.equal(byAccount.has("k:bank"), false);
  });

  test("approved with a supplier is owed to the supplier", () => {
    const plan = planExpense(expense({ status: "approved", supplierId: "sup-1" }));
    const byAccount = amounts(plan);
    assert.deepEqual(byAccount.get("k:supplier_payables"), { debit: 0, credit: 115_000 });
    const supplier = plan!.lines.find(
      (line) => "key" in line.account && line.account.key === "supplier_payables",
    )!;
    assert.equal(supplier.partyType, "supplier");
  });

  test("pending and cancelled post nothing", () => {
    assert.equal(planExpense(expense({ status: "pending" })), null);
    assert.equal(planExpense(expense({ status: "cancelled" })), null);
  });
});
