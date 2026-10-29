/**
 * The accounts a purchase can and cannot be charged to.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { canChargePurchase, NOT_A_COST_KEYS, type CostAccountFacts } from "./cost-accounts";

const account = (overrides: Partial<CostAccountFacts> = {}): CostAccountFacts => ({
  type: "expense",
  postable: true,
  active: true,
  systemKey: null,
  bankLinked: false,
  ...overrides,
});

describe("what a purchase can be charged to", () => {
  test("an active, postable expense account", () => {
    assert.equal(canChargePurchase(account()), true);
    assert.equal(canChargePurchase(account({ systemKey: "expense_maintenance" })), true);
  });

  test("an asset account, for something the office capitalises", () => {
    assert.equal(canChargePurchase(account({ type: "asset", systemKey: "expense_capital_improvement" })), true);
    assert.equal(canChargePurchase(account({ type: "asset" })), true);
  });

  test("never money, a receivable or input VAT", () => {
    for (const key of NOT_A_COST_KEYS) {
      assert.equal(canChargePurchase(account({ type: "asset", systemKey: key })), false, key);
    }
    assert.equal(canChargePurchase(account({ type: "asset", bankLinked: true })), false);
  });

  test("never what the posting rules fill in themselves", () => {
    assert.equal(canChargePurchase(account({ systemKey: "investment_rent_expense" })), false);
    assert.equal(canChargePurchase(account({ systemKey: "input_vat", type: "asset" })), false);
  });

  test("never a contra-asset: a purchase adds to an asset, it does not write one off", () => {
    assert.equal(canChargePurchase(account({ type: "asset", normalSide: "credit" })), false);
    assert.equal(canChargePurchase(account({ type: "asset", normalSide: "debit" })), true);
    // An expense's own side is not asked.
    assert.equal(canChargePurchase(account({ type: "expense", normalSide: "debit" })), true);
  });

  test("never income, equity or a liability", () => {
    for (const type of ["income", "equity", "liability"]) {
      assert.equal(canChargePurchase(account({ type })), false, type);
    }
  });

  test("never a heading or an inactive account", () => {
    assert.equal(canChargePurchase(account({ postable: false })), false);
    assert.equal(canChargePurchase(account({ active: false })), false);
  });
});
