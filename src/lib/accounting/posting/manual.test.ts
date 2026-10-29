/**
 * Entries written through the ledger's own screens: a manual journal, the
 * opening balances, a transfer between the office's accounts, a reversal.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { planManualJournal, planOpeningBalances, planReversal } from "./manual";
import { planBankTransfer } from "./bank";
import { LedgerRuleError, totals, totalsByAccount } from "./common";

const DAY = new Date("2026-10-03T00:00:00.000Z");

describe("a manual journal", () => {
  test("balanced lines post as typed", () => {
    const plan = planManualJournal({
      date: DAY,
      memo: "Office rent for October",
      lines: [
        { accountId: "acc-rent", debit: "2,500.00" },
        { accountId: "acc-bank", credit: 2500 },
      ],
    });
    assert.equal(plan.sourceType, "manual");
    assert.equal(plan.sourceId, null);
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("i:acc-rent"), { debit: 250_000, credit: 0 });
    assert.deepEqual(byAccount.get("i:acc-bank"), { debit: 0, credit: 250_000 });
  });

  test("Arabic digits are read", () => {
    const plan = planManualJournal({
      date: DAY,
      lines: [
        { accountId: "a", debit: "١٢٥٠٫٥" },
        { accountId: "b", credit: "1250.50" },
      ],
    });
    assert.equal(totals(plan.lines).debit, 125_050);
  });

  test("unbalanced lines are refused", () => {
    assert.throws(
      () =>
        planManualJournal({
          date: DAY,
          lines: [
            { accountId: "a", debit: 100 },
            { accountId: "b", credit: 90 },
          ],
        }),
      (error: unknown) =>
        error instanceof LedgerRuleError && error.code === "LEDGER_UNBALANCED",
    );
  });

  test("a line with both sides, or none, is refused", () => {
    assert.throws(
      () =>
        planManualJournal({
          date: DAY,
          lines: [
            { accountId: "a", debit: 100, credit: 100 },
            { accountId: "b", credit: 0 },
          ],
        }),
      LedgerRuleError,
    );
  });

  test("a single line is refused", () => {
    assert.throws(
      () => planManualJournal({ date: DAY, lines: [{ accountId: "a", debit: 100 }] }),
      (error: unknown) =>
        error instanceof LedgerRuleError && error.code === "LEDGER_TOO_FEW_LINES",
    );
  });

  test("three decimals are a typing mistake", () => {
    assert.throws(
      () =>
        planManualJournal({
          date: DAY,
          lines: [
            { accountId: "a", debit: "10.005" },
            { accountId: "b", credit: "10.005" },
          ],
        }),
      (error: unknown) =>
        error instanceof LedgerRuleError && error.code === "LEDGER_LINE_BAD_AMOUNT",
    );
  });
});

describe("opening balances", () => {
  test("the difference goes to opening-balance equity", () => {
    const plan = planOpeningBalances({
      date: DAY,
      lines: [
        { accountId: "acc-bank", debit: 50_000 },
        { accountId: "acc-owner-payable", credit: 30_000, partyType: "owner", partyId: "owner-1" },
      ],
    });
    assert.equal(plan.sourceType, "opening_balance");
    const sums = totals(plan.lines);
    assert.equal(sums.debit, sums.credit);
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("k:opening_balance_equity"), { debit: 0, credit: 2_000_000 });
    const owner = plan.lines.find(
      (line) => "id" in line.account && line.account.id === "acc-owner-payable",
    )!;
    assert.equal(owner.partyType, "owner");
    assert.equal(owner.partyId, "owner-1");
  });

  test("balanced balances need no equity line", () => {
    const plan = planOpeningBalances({
      date: DAY,
      lines: [
        { accountId: "a", debit: 100 },
        { accountId: "b", credit: 100 },
      ],
    });
    assert.equal(totalsByAccount(plan.lines).has("k:opening_balance_equity"), false);
  });

  test("a credit-heavy opening debits equity", () => {
    const plan = planOpeningBalances({
      date: DAY,
      lines: [{ accountId: "acc-payable", credit: 700 }],
    });
    assert.deepEqual(
      totalsByAccount(plan.lines).get("k:opening_balance_equity"),
      { debit: 70_000, credit: 0 },
    );
  });
});

describe("a transfer between the office's accounts", () => {
  test("debits the account it went to and credits the one it came from", () => {
    const plan = planBankTransfer({
      id: "tr-1",
      date: DAY,
      amount: 12_000,
      fromAccountId: "acc-cash",
      toAccountId: "acc-bank",
      reference: "DEP-55",
    });
    const byAccount = totalsByAccount(plan.lines);
    assert.deepEqual(byAccount.get("i:acc-bank"), { debit: 1_200_000, credit: 0 });
    assert.deepEqual(byAccount.get("i:acc-cash"), { debit: 0, credit: 1_200_000 });
    assert.equal(plan.sourceType, "bank_transfer");
    assert.equal(plan.sourceRef, "DEP-55");
  });

  test("to the same account, or for nothing, is refused", () => {
    assert.throws(() =>
      planBankTransfer({ id: "t", date: DAY, amount: 10, fromAccountId: "a", toAccountId: "a" }),
    );
    assert.throws(() =>
      planBankTransfer({ id: "t", date: DAY, amount: 0, fromAccountId: "a", toAccountId: "b" }),
    );
  });
});

describe("a reversal", () => {
  test("turns every line around and keeps the source", () => {
    const reversal = planReversal(
      {
        sourceType: "manual",
        sourceId: null,
        number: 7,
        lines: [
          { accountId: "a", debit: 10_000, credit: 0, partyType: "owner", partyId: "o-1" },
          { accountId: "b", debit: 0, credit: 10_000 },
        ],
      },
      DAY,
    );
    const byAccount = totalsByAccount(reversal.lines);
    assert.deepEqual(byAccount.get("i:a"), { debit: 0, credit: 10_000 });
    assert.deepEqual(byAccount.get("i:b"), { debit: 10_000, credit: 0 });
    assert.equal(reversal.lines[0].partyId, "o-1");
    assert.equal(reversal.sourceType, "manual");
  });
});
