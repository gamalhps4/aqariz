/**
 * Accounting phase 0's documents on the books: an invoice written line by
 * line posts each line by its own VAT treatment, a credit note turns it
 * around, what an owner or a customer paid on their invoice is a receipt,
 * and an expense records its VAT category and passes through its supplier.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planInvoiceSettlement, planLinedInvoice, type LinedInvoiceDoc } from "./invoice";
import { planExpense } from "./expense";
import { totals, totalsByAccount } from "./common";
import type { PostingPlan } from "../types";

const DAY = new Date("2026-10-04T00:00:00.000Z");

const customer = {
  account: "customer_receivables" as const,
  partyType: "customer" as const,
  partyId: "vat:300000000000003",
};

function lined(overrides: Partial<LinedInvoiceDoc> = {}): LinedInvoiceDoc {
  return {
    id: "inv-1",
    number: "INV-000001",
    date: DAY,
    lines: [
      { category: "management_fee", net: 1_000, vat: 150, vatCategory: "S" },
      { category: "other", net: 500, vat: 0, vatCategory: "Z" },
      { category: "rent", net: 2_000, vat: 0, vatCategory: "E" },
    ],
    receivable: customer,
    ownerId: null,
    ownership: "office",
    depositHolder: "owner",
    ...overrides,
  };
}

function balanced(plan: PostingPlan | null) {
  assert.ok(plan, "expected a plan");
  const sums = totals(plan.lines);
  assert.equal(sums.debit, sums.credit, "the entry balances");
  return totalsByAccount(plan.lines);
}

const lineOf = (plan: PostingPlan, key: string) =>
  plan.lines.filter((line) => "key" in line.account && line.account.key === key);

describe("an invoice written line by line", () => {
  test("each line by its own treatment: fees, zero-rated, exempt rent, VAT", () => {
    const plan = planLinedInvoice(lined());
    const byAccount = balanced(plan);
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 365_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:management_fee_income"), { debit: 0, credit: 100_000 });
    assert.deepEqual(byAccount.get("k:other_income"), { debit: 0, credit: 50_000 });
    assert.deepEqual(byAccount.get("k:rent_income"), { debit: 0, credit: 200_000 });
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 15_000 });
    assert.equal(lineOf(plan!, "management_fee_income")[0].vatCode, "S");
    assert.equal(lineOf(plan!, "other_income")[0].vatCode, "Z");
    assert.equal(lineOf(plan!, "rent_income")[0].vatCode, "E");
    const receivable = lineOf(plan!, "customer_receivables")[0];
    assert.equal(receivable.partyType, "customer");
    assert.equal(receivable.partyId, customer.partyId);
  });

  test("a credit note turns every side around", () => {
    const plan = planLinedInvoice(
      lined({
        id: "cn-1",
        lines: [{ category: "management_fee", net: -200, vat: -30, vatCategory: "S" }],
      }),
    );
    const byAccount = balanced(plan);
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 0, credit: 23_000 });
    assert.deepEqual(byAccount.get("k:management_fee_income"), { debit: 20_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 3_000, credit: 0 });
  });

  test("an owner billed is kept in the receivable under the owner", () => {
    const plan = planLinedInvoice(
      lined({ receivable: { account: "customer_receivables", partyType: "owner", partyId: "owner-1" } }),
    );
    const receivable = lineOf(plan!, "customer_receivables")[0];
    assert.equal(receivable.partyType, "owner");
    assert.equal(receivable.partyId, "owner-1");
  });

  test("a tenant's invoice on an owner's building is the owner's money", () => {
    const plan = planLinedInvoice(
      lined({
        receivable: { account: "tenant_receivables", partyType: "tenant", partyId: "tenant-1" },
        ownerId: "owner-1",
        propertyId: "prop-1",
        ownership: "owner",
        lines: [
          { category: "maintenance", net: 400, vat: 60, vatCategory: "S" },
          { category: "security_deposit", net: 1_000, vat: 0, vatCategory: "O" },
        ],
        depositHolder: "office",
      }),
    );
    const byAccount = balanced(plan);
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 146_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_uncollected_rent"), { debit: 0, credit: 46_000 });
    assert.deepEqual(byAccount.get("k:security_deposits"), { debit: 0, credit: 100_000 });
    assert.equal(byAccount.has("k:output_vat"), false, "the VAT is the owner's");
    assert.equal(lineOf(plan!, "owner_uncollected_rent")[0].vatCode, "O");
  });

  test("on a building held under investment, rent is investment income", () => {
    const plan = planLinedInvoice(
      lined({
        ownership: "investment",
        propertyId: "prop-2",
        lines: [{ category: "rent", net: 5_000, vat: 750, vatCategory: "S" }],
      }),
    );
    const byAccount = balanced(plan);
    assert.deepEqual(byAccount.get("k:investment_rent_income"), { debit: 0, credit: 500_000 });
  });

  test("nothing to post when the lines come to nothing", () => {
    assert.equal(planLinedInvoice(lined({ lines: [] })), null);
  });
});

describe("what an owner or a customer paid on their invoice", () => {
  test("lands in the money account by method and clears their receivable", () => {
    const plan = planInvoiceSettlement({
      id: "inv-1:1",
      number: "INV-000001",
      date: DAY,
      amount: 1_000,
      method: "cash",
      receivable: customer,
    });
    const byAccount = balanced(plan);
    assert.equal(plan!.sourceType, "invoice_settlement");
    assert.deepEqual(byAccount.get("k:cash_on_hand"), { debit: 100_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 0, credit: 100_000 });
  });

  test("a transfer goes to the bank; nothing for nothing", () => {
    const byAccount = balanced(
      planInvoiceSettlement({ id: "x:1", date: DAY, amount: 50, method: "bank_transfer", receivable: customer }),
    );
    assert.deepEqual(byAccount.get("k:bank"), { debit: 5_000, credit: 0 });
    assert.equal(
      planInvoiceSettlement({ id: "x:2", date: DAY, amount: 0, method: "cash", receivable: customer }),
      null,
    );
  });
});

describe("an expense's VAT and supplier", () => {
  const base = {
    id: "exp-1",
    date: DAY,
    amount: 1_150,
    vatAmount: 150,
    vatRecoverable: true,
    category: "maintenance",
    method: "bank_transfer",
    propertyId: null,
    ownerId: null,
    ownership: null,
  };

  test("paid to a named supplier, it passes through the supplier's account", () => {
    const plan = planExpense({ ...base, status: "paid", supplierId: "sup-1" });
    const byAccount = balanced(plan);
    assert.deepEqual(byAccount.get("k:supplier_payables"), { debit: 115_000, credit: 115_000 });
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 115_000 });
    for (const line of lineOf(plan!, "supplier_payables")) {
      assert.equal(line.partyType, "supplier");
      assert.equal(line.partyId, "sup-1");
    }
  });

  test("the cost line carries the expense's category for the VAT return", () => {
    const zero = planExpense({ ...base, status: "paid", vatAmount: 0, vatCategory: "Z" });
    assert.equal(lineOf(zero!, "expense_maintenance")[0].vatCode, "Z");
    const standard = planExpense({ ...base, status: "paid", vatCategory: "S" });
    assert.equal(lineOf(standard!, "expense_maintenance")[0].vatCode, "S");
  });

  test("an office that is not registered records no VAT treatment", () => {
    const plan = planExpense({ ...base, status: "paid", vatRecoverable: false, vatCategory: "S" });
    assert.equal(lineOf(plan!, "expense_maintenance")[0].vatCode ?? null, null);
    assert.equal(lineOf(plan!, "input_vat").length, 0);
  });
});
