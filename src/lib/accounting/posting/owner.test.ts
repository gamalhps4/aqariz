/**
 * An owner's settlement and payout.
 *
 * The close takes the office's commission and the VAT on it out of the
 * owner's payable and credits the investment rent the office owes; a payout
 * pays the payable from a bank or cash account.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planOwnerPayout, planSettlementClose } from "./owner";
import { totals, totalsByAccount } from "./common";

const DAY = new Date("2026-09-30T00:00:00.000Z");

describe("closing an owner's period", () => {
  test("the commission and its VAT come out of the owner's payable", () => {
    const plan = planSettlementClose({
      id: "set-1",
      date: DAY,
      ownerId: "owner-1",
      agreementId: "agr-1",
      commission: 500,
      managementFee: 0,
      commissionVat: 75,
      investmentRent: 0,
    });
    assert.ok(plan);
    const sums = totals(plan.lines);
    assert.equal(sums.debit, sums.credit);
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 57_500, credit: 0 });
    assert.deepEqual(byAccount.get("k:commission_income"), { debit: 0, credit: 50_000 });
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 7_500 });
    const payable = plan.lines.find(
      (line) => "key" in line.account && line.account.key === "owner_payable",
    )!;
    assert.equal(payable.partyType, "owner");
    assert.equal(payable.partyId, "owner-1");
    assert.equal(payable.agreementId, "agr-1");
    assert.equal(plan.sourceType, "owner_settlement");
  });

  test("a fixed fee is management fee income", () => {
    const plan = planSettlementClose({
      id: "set-2",
      date: DAY,
      ownerId: "owner-1",
      commission: 0,
      managementFee: 550,
      commissionVat: 82.5,
      investmentRent: 0,
    })!;
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("k:management_fee_income"), { debit: 0, credit: 55_000 });
    assert.equal(byAccount.has("k:commission_income"), false);
  });

  test("investment rent the office owes is credited to the owner", () => {
    const plan = planSettlementClose({
      id: "set-3",
      date: DAY,
      ownerId: "owner-1",
      commission: 0,
      managementFee: 0,
      commissionVat: 0,
      investmentRent: 10_000,
    })!;
    const sums = totals(plan.lines);
    assert.equal(sums.debit, sums.credit);
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("k:investment_rent_expense"), { debit: 1_000_000, credit: 0 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 1_000_000 });
  });

  test("a period with nothing to charge posts nothing", () => {
    assert.equal(
      planSettlementClose({
        id: "set-4",
        date: DAY,
        ownerId: "owner-1",
        commission: 0,
        managementFee: 0,
        commissionVat: 0,
        investmentRent: 0,
      }),
      null,
    );
  });
});

describe("paying an owner out", () => {
  test("the payable is paid from the chosen account", () => {
    const plan = planOwnerPayout({
      id: "pay-out-1",
      date: DAY,
      ownerId: "owner-1",
      amount: 8_500,
      paidFromAccountId: "acc-bank-2",
    })!;
    const sums = totals(plan.lines);
    assert.equal(sums.debit, sums.credit);
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 850_000, credit: 0 });
    assert.deepEqual(byAccount.get("i:acc-bank-2"), { debit: 0, credit: 850_000 });
    assert.equal(plan.sourceType, "owner_payout");
  });

  test("nothing paid posts nothing", () => {
    assert.equal(
      planOwnerPayout({ id: "x", date: DAY, ownerId: "o", amount: 0, paidFromAccountId: "a" }),
      null,
    );
  });
});
