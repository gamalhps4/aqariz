/**
 * An owner's commission is booked once: by the office's tax invoice for it.
 *
 * The bug: an owner fee invoice posted management fee income and output VAT,
 * and closing the settlement posted the same commission and VAT again out of
 * the owner's payable — 1,725 of commission and VAT taken twice.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  feeInvoiceMatches,
  settlementFeeLines,
  settlementFeeTotal,
} from "./settlement-invoice";
import { planInvoiceSettlement, planLinedInvoice, OWNER_BALANCE_METHOD } from "./posting/invoice";
import { planSettlementClose } from "./posting/owner";
import { totalsByAccount } from "./posting/common";
import type { PostingPlan } from "./types";

const DAY = new Date("2026-09-30T00:00:00.000Z");
const figures = { commission: 1_000, managementFee: 500, commissionVat: 225 };
const owner = { account: "customer_receivables" as const, partyType: "owner" as const, partyId: "owner-1" };

/** Every plan's lines, summed per account. */
function books(plans: Array<PostingPlan | null>) {
  return totalsByAccount(plans.flatMap((plan) => plan?.lines ?? []));
}

describe("the settlement's tax invoice", () => {
  test("carries the statement's figures to the halala, the VAT shared over the lines", () => {
    const lines = settlementFeeLines(figures, 15);
    assert.deepEqual(lines, [
      { category: "commission", net: 1_000, vat: 150, vatCategory: "S", vatRate: 15 },
      { category: "management_fee", net: 500, vat: 75, vatCategory: "S", vatRate: 15 },
    ]);
    assert.equal(settlementFeeTotal(figures), 1_725);
    // VAT worked out on the total (333.33 × 15% = 50.00) stays 50.00 in all.
    const odd = settlementFeeLines({ commission: 222.22, managementFee: 111.11, commissionVat: 50 }, 15);
    assert.equal(Math.round(odd.reduce((sum, line) => sum + line.vat, 0) * 100), 5_000);
  });

  test("an office that is not VAT-registered invoices its commission out of scope", () => {
    assert.deepEqual(settlementFeeLines({ commission: 800, managementFee: 0, commissionVat: 0 }, 0), [
      { category: "commission", net: 800, vat: 0, vatCategory: "O", vatRate: 0 },
    ]);
    assert.deepEqual(settlementFeeLines({ commission: 0, managementFee: 0, commissionVat: 0 }, 15), []);
  });

  test("an invoice already issued stands only for the same amount", () => {
    assert.equal(feeInvoiceMatches(1_725, figures), true);
    assert.equal(feeInvoiceMatches(1_725.01, figures), true);
    assert.equal(feeInvoiceMatches(1_150, figures), false);
  });
});

describe("closing a settlement with its invoice", () => {
  const invoice = planLinedInvoice({
    id: "inv-1",
    date: DAY,
    lines: settlementFeeLines(figures, 15).map((line) => ({
      category: line.category,
      net: line.net,
      vat: line.vat,
      vatCategory: line.vatCategory,
    })),
    receivable: owner,
    ownerId: null,
    ownership: "office",
    depositHolder: "office",
  });
  const paidFromBalance = planInvoiceSettlement({
    id: "inv-1:1",
    date: DAY,
    amount: 1_725,
    method: OWNER_BALANCE_METHOD,
    receivable: owner,
  });
  const settlement = planSettlementClose({
    id: "set-1",
    date: DAY,
    ownerId: "owner-1",
    commission: 1_000,
    managementFee: 500,
    commissionVat: 225,
    investmentRent: 300,
    invoiced: true,
  });

  test("books the commission and its VAT once, from the owner's payable", () => {
    const byAccount = books([invoice, paidFromBalance, settlement]);
    assert.deepEqual(byAccount.get("k:commission_income"), { debit: 0, credit: 100_000 });
    assert.deepEqual(byAccount.get("k:management_fee_income"), { debit: 0, credit: 50_000 });
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 22_500 });
    // The owner's receivable is opened by the invoice and closed from their balance.
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 172_500, credit: 172_500 });
    // Owner's payable: 1,725 taken for the fee, 300 investment rent owed to them.
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 172_500, credit: 30_000 });
  });

  test("the settlement entry keeps only the investment rent", () => {
    const byAccount = books([settlement]);
    assert.equal(byAccount.get("k:commission_income"), undefined);
    assert.equal(byAccount.get("k:output_vat"), undefined);
    assert.deepEqual(byAccount.get("k:investment_rent_expense"), { debit: 30_000, credit: 0 });
    // Nothing else to post: no entry at all.
    assert.equal(
      planSettlementClose({ id: "s", date: DAY, ownerId: "o", commission: 1_000, managementFee: 0, commissionVat: 150, investmentRent: 0, invoiced: true }),
      null,
    );
  });

  test("before settlements issued invoices, the entry booked the commission itself", () => {
    const byAccount = books([
      planSettlementClose({ id: "s", date: DAY, ownerId: "owner-1", commission: 1_000, managementFee: 500, commissionVat: 225, investmentRent: 0 }),
    ]);
    assert.deepEqual(byAccount.get("k:output_vat"), { debit: 0, credit: 22_500 });
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 172_500, credit: 0 });
  });

  test("cancelling it puts the deduction back on the owner's balance", () => {
    const undo = planInvoiceSettlement({
      id: "inv-1:2",
      date: new Date("2026-10-04T00:00:00.000Z"),
      amount: -1_725,
      method: OWNER_BALANCE_METHOD,
      receivable: owner,
    });
    const byAccount = books([undo]);
    assert.deepEqual(byAccount.get("k:owner_payable"), { debit: 0, credit: 172_500 });
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 172_500, credit: 0 });
  });
});

describe("a refund paid back on an overpaid invoice", () => {
  test("leaves the bank and clears the customer's credit", () => {
    // 1,150 paid, a credit note for 230, 230 paid back by transfer.
    const refund = planInvoiceSettlement({
      id: "inv-2:2",
      date: DAY,
      amount: -230,
      method: "bank_transfer",
      receivable: { account: "customer_receivables", partyType: "customer", partyId: "vat:300000000000003" },
    });
    const byAccount = books([refund]);
    assert.deepEqual(byAccount.get("k:bank"), { debit: 0, credit: 23_000 });
    assert.deepEqual(byAccount.get("k:customer_receivables"), { debit: 23_000, credit: 0 });
  });

  test("nothing posts for nothing", () => {
    assert.equal(
      planInvoiceSettlement({ id: "x:1", date: DAY, amount: 0, method: "cash", receivable: owner }),
      null,
    );
  });
});
