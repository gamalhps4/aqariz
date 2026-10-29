/**
 * An installment falling due: whose money it is decides where it goes.
 *
 * On an owner's building the whole installment, VAT included, is the
 * owner's and waits in "owners' uncollected rent"; on the office's own
 * building, or one it holds under investment, the rent is the office's
 * income and the VAT its output VAT. Every plan balances.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planInvoice, splitInvoice, ownerShareOf, type InvoiceDoc } from "./invoice";
import { totals, totalsByAccount } from "./common";

const DAY = new Date("2026-10-01T00:00:00.000Z");

function installment(overrides: Partial<InvoiceDoc> = {}): InvoiceDoc {
  return {
    id: "inv-1",
    number: "INV-1",
    date: DAY,
    category: "rent",
    total: 11_500,
    tax: 1_500,
    lines: [
      { type: "rent", amount: 9_000 },
      { type: "electricity", amount: 600 },
      { type: "water_sewer", amount: 400 },
    ],
    tenantId: "tenant-1",
    ownerId: "owner-1",
    propertyId: "prop-1",
    unitId: "unit-1",
    leaseId: "lease-1",
    ownership: "owner",
    depositHolder: "owner",
    ...overrides,
  };
}

function amounts(plan: ReturnType<typeof planInvoice>) {
  assert.ok(plan, "expected a plan");
  const sums = totals(plan.lines);
  assert.equal(sums.debit, sums.credit, "the entry balances");
  return totalsByAccount(plan.lines);
}

describe("an installment on an owner's building", () => {
  test("is owed by the tenant and waits for the owner, VAT included", () => {
    const byAccount = amounts(planInvoice(installment()));
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 1_150_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_uncollected_rent"), { debit: 0, credit: 1_150_000 });
    assert.equal(byAccount.has("k:output_vat"), false, "the owner's VAT is not the office's");
    assert.equal(byAccount.has("k:rent_income"), false);
  });

  test("keeps the tenant and the owner on their own lines", () => {
    const plan = planInvoice(installment())!;
    const receivable = plan.lines.find(
      (line) => "key" in line.account && line.account.key === "tenant_receivables",
    )!;
    const owner = plan.lines.find(
      (line) => "key" in line.account && line.account.key === "owner_uncollected_rent",
    )!;
    assert.equal(receivable.partyType, "tenant");
    assert.equal(receivable.partyId, "tenant-1");
    assert.equal(owner.partyType, "owner");
    assert.equal(owner.partyId, "owner-1");
    assert.equal(owner.leaseId, "lease-1");
    assert.equal(plan.sourceType, "invoice");
    assert.equal(plan.sourceRef, "INV-1");
  });

  test("a deposit the owner keeps is the owner's too", () => {
    const byAccount = amounts(
      planInvoice(
        installment({
          category: "security_deposit",
          total: 5_000,
          tax: 0,
          lines: [{ type: "security_deposit", amount: 5_000 }],
        }),
      ),
    );
    assert.deepEqual(byAccount.get("k:owner_uncollected_rent"), { debit: 0, credit: 500_000 });
    assert.equal(byAccount.has("k:security_deposits"), false);
  });

  test("a deposit the office keeps is held for the tenant", () => {
    const plan = planInvoice(
      installment({
        category: "security_deposit",
        total: 5_000,
        tax: 0,
        lines: [{ type: "security_deposit", amount: 5_000 }],
        depositHolder: "office",
      }),
    );
    const byAccount = amounts(plan);
    assert.deepEqual(byAccount.get("k:security_deposits"), { debit: 0, credit: 500_000 });
    const held = plan!.lines.find(
      (line) => "key" in line.account && line.account.key === "security_deposits",
    )!;
    assert.equal(held.partyType, "tenant");
  });
});

describe("an installment on the office's own building", () => {
  test("is the office's rent, other income and output VAT", () => {
    const byAccount = amounts(planInvoice(installment({ ownership: "office" })));
    assert.deepEqual(byAccount.get("k:tenant_receivables"), { debit: 1_150_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:rent_income"), { debit: 0, credit: 900_000 });
    assert.deepEqual(byAccount.get("k:other_income"), { debit: 0, credit: 100_000 });
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 150_000 });
    assert.equal(byAccount.has("k:owner_uncollected_rent"), false);
  });

  test("under an investment agreement, the rent is investment rent income", () => {
    const byAccount = amounts(planInvoice(installment({ ownership: "investment" })));
    assert.deepEqual(byAccount.get("k:investment_rent_income"), { debit: 0, credit: 900_000 });
    assert.equal(byAccount.has("k:rent_income"), false);
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 150_000 });
  });

  test("an exempt installment carries no VAT line and is marked exempt", () => {
    const plan = planInvoice(
      installment({ ownership: "office", total: 9_000, tax: 0, lines: [{ type: "rent", amount: 9_000 }] }),
    );
    const byAccount = amounts(plan);
    assert.equal(byAccount.has("k:output_vat"), false);
    const income = plan!.lines.find(
      (line) => "key" in line.account && line.account.key === "rent_income",
    )!;
    assert.equal(income.vatCode, "E");
  });

  test("a discount falls on every line alike and the parts add back up", () => {
    // 10,000 billed, 1,000 off, VAT 1,350 on the 9,000 left.
    const split = splitInvoice(
      installment({
        ownership: "office",
        total: 10_350,
        tax: 1_350,
        lines: [
          { type: "rent", amount: 9_000 },
          { type: "electricity", amount: 1_000 },
        ],
      }),
    );
    assert.equal(split.officeRent, 810_000);
    assert.equal(split.officeOther, 90_000);
    assert.equal(split.officeVat, 135_000);
    assert.equal(
      split.officeRent + split.officeOther + split.officeVat + split.owner + split.officeDeposit,
      split.total,
    );
  });
});

describe("edge cases", () => {
  test("an invoice for nothing posts nothing", () => {
    assert.equal(planInvoice(installment({ total: 0, tax: 0 })), null);
  });

  test("an invoice without lines is read by its category", () => {
    const byAccount = amounts(
      planInvoice(installment({ ownership: "office", lines: [], total: 1_000, tax: 0 })),
    );
    assert.deepEqual(byAccount.get("k:rent_income"), { debit: 0, credit: 100_000 });
  });

  test("an awkward split still balances to the halala", () => {
    const plan = planInvoice(
      installment({
        ownership: "office",
        total: 100,
        tax: 13.04,
        lines: [
          { type: "rent", amount: 1 },
          { type: "electricity", amount: 1 },
          { type: "water_sewer", amount: 1 },
        ],
      }),
    );
    amounts(plan);
  });

  test("a customer's invoice is kept in the customers' receivable", () => {
    const byAccount = amounts(planInvoice(installment({ ownership: "office", receivable: "customer" })));
    assert.equal(byAccount.has("k:tenant_receivables"), false);
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 1_150_000, credit: 0 });
  });

  test("the owner's share of a part payment is in proportion", () => {
    const split = splitInvoice(installment());
    assert.equal(ownerShareOf(split, 575_000), 575_000);
    const officeSplit = splitInvoice(installment({ ownership: "office" }));
    assert.equal(ownerShareOf(officeSplit, 575_000), 0);
  });
});
