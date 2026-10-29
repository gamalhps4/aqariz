/**
 * The ledger's reports hold together: a month of the office's documents,
 * posted by the real posting rules onto the template chart, gives a trial
 * balance whose columns agree, a balance sheet where assets equal
 * liabilities plus equity, statements that close where the trial balance
 * does — and a VAT return whose boxes are the phase-0 VAT summary's figures
 * for the same documents.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { COA_TEMPLATE } from "../coa-template";
import { isSystemKey, type SystemKey } from "../system-keys";
import { toHalalas } from "../money";
import { credit, debit, finishPlan } from "../posting/common";
import { planInvoice, planInvoiceSettlement, planLinedInvoice } from "../posting/invoice";
import { planPaymentReceipt, planPaymentRefund } from "../posting/payment";
import { planExpense } from "../posting/expense";
import { planDepositReceipt } from "../posting/deposit";
import { planOwnerPayout, planSettlementClose } from "../posting/owner";
import type { PostingPlan, VatCode } from "../types";
import {
  accountTree,
  buildStatement,
  computeBalanceSheet,
  computeProfitAndLoss,
  computeTrialBalance,
  computeVatReturn,
  type ReportAccount,
  type StatementLineInput,
  type Sums,
  type VatLineSums,
} from "./compute";
import { computeVatInvoice, negateVatInvoice } from "@/lib/invoice/vat";
import { summarizeVat, type VatExpenseDoc, type VatInvoiceDoc } from "@/lib/invoice/vat-summary";

// ---------------------------------------------------------------------------
// The chart, from the template: an account's id is its code.
// ---------------------------------------------------------------------------

const CHART: ReportAccount[] = COA_TEMPLATE.map((row) => ({
  id: row.code,
  code: row.code,
  nameAr: row.nameAr,
  nameEn: row.nameEn,
  type: row.type,
  normalSide: row.normalSide,
  parentId: row.parentCode,
  postable: row.postable,
}));
const BY_KEY = new Map<SystemKey, string>(
  COA_TEMPLATE.filter((row) => isSystemKey(row.systemKey)).map((row) => [row.systemKey as SystemKey, row.code]),
);
const TYPE = new Map(CHART.map((account) => [account.id, account.type]));

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

interface Line extends StatementLineInput {
  vatCode: VatCode | null;
}

/** Write plans the way the posting service does: accounts resolved, one entry each. */
function post(plans: ReadonlyArray<PostingPlan | null>): Line[] {
  const lines: Line[] = [];
  plans.forEach((plan, index) => {
    assert.ok(plan, `plan ${index} posts something`);
    plan.lines.forEach((line, lineNo) => {
      const accountId = "key" in line.account ? BY_KEY.get(line.account.key) : line.account.id;
      assert.ok(accountId, `account for ${JSON.stringify(line.account)}`);
      lines.push({
        id: `${index}-${lineNo}`,
        date: plan.date,
        entryId: `e${index}`,
        entryNumber: index + 1,
        sourceType: plan.sourceType,
        sourceId: plan.sourceId,
        sourceRef: plan.sourceRef ?? null,
        memo: plan.memo ?? null,
        accountId,
        partyType: line.partyType ?? null,
        partyId: line.partyId ?? null,
        propertyId: line.propertyId ?? null,
        debit: line.debit,
        credit: line.credit,
        vatCode: line.vatCode ?? null,
      });
    });
  });
  return lines;
}

function sums(lines: readonly Line[], keep: (line: Line) => boolean = () => true): Map<string, Sums> {
  const out = new Map<string, Sums>();
  for (const line of lines) {
    if (!keep(line)) continue;
    const entry = out.get(line.accountId) ?? { debit: 0, credit: 0 };
    entry.debit += line.debit;
    entry.credit += line.credit;
    out.set(line.accountId, entry);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The office's documents, with the figures the phase-0 summary reads.
// ---------------------------------------------------------------------------

const customerInvoice = computeVatInvoice(
  [
    { description: "Management", category: "management_fee", quantity: 1, unitPrice: 1_000, vatCategory: "S" },
    { description: "Export service", category: "other", quantity: 2, unitPrice: 250, vatCategory: "Z" },
    { description: "Residential rent", category: "rent", quantity: 1, unitPrice: 2_000, vatCategory: "E" },
  ],
  100,
);
const creditNote = negateVatInvoice(
  computeVatInvoice([
    { description: "Management (credit)", category: "management_fee", quantity: 1, unitPrice: 200, vatCategory: "S" },
  ]),
);
const linesOf = (computed: typeof customerInvoice) =>
  computed.lines.map((line) => ({
    category: line.category,
    net: line.netAmount,
    vat: line.vatAmount,
    vatCategory: line.vatCategory,
  }));
const customer = { account: "customer_receivables" as const, partyType: "customer" as const, partyId: "vat:300000000000003" };

const installment = (overrides: Partial<Parameters<typeof planInvoice>[0]>) =>
  planInvoice({
    id: "inv",
    date: day("2026-10-01"),
    category: "rent",
    total: 11_500,
    tax: 1_500,
    lines: [{ type: "rent", amount: 10_000 }],
    tenantId: "tenant-1",
    ownerId: "owner-1",
    propertyId: "prop-1",
    ownership: "owner",
    depositHolder: "owner",
    ...overrides,
  });

const ownersRent = installment({ id: "inv-owner", tax: 0, total: 10_000 });
const investmentRent = installment({ id: "inv-invest", propertyId: "prop-2", ownership: "investment" });
const ownRentExempt = installment({ id: "inv-own", propertyId: "prop-3", ownership: "office", ownerId: null, tax: 0, total: 8_000, lines: [{ type: "rent", amount: 8_000 }] });

const receipt = planPaymentReceipt({
  id: "pay-1",
  date: day("2026-10-03"),
  amount: 10_000,
  method: "bank_transfer",
  tenantId: "tenant-1",
  ownerId: "owner-1",
  propertyId: "prop-1",
  ownership: "owner",
  ownerPortion: toHalalas(10_000),
});
const investReceipt = planPaymentReceipt({
  id: "pay-2",
  date: day("2026-10-04"),
  amount: 11_500,
  method: "cash",
  tenantId: "tenant-2",
  ownerId: "owner-2",
  propertyId: "prop-2",
  ownership: "investment",
  ownerPortion: 0,
});

const officeExpense = planExpense({
  id: "exp-1",
  date: day("2026-10-05"),
  amount: 1_150,
  vatAmount: 150,
  vatRecoverable: true,
  vatCategory: "S",
  category: "maintenance",
  status: "paid",
  method: "bank_transfer",
  supplierId: "sup-1",
  propertyId: null,
  ownerId: null,
  ownership: null,
});
const zeroRatedExpense = planExpense({
  id: "exp-2",
  date: day("2026-10-06"),
  amount: 300,
  vatAmount: 0,
  vatRecoverable: true,
  vatCategory: "Z",
  category: "supplies",
  status: "approved",
  method: null,
  propertyId: null,
  ownerId: null,
  ownership: null,
});
const ownersExpense = planExpense({
  id: "exp-3",
  date: day("2026-10-06"),
  amount: 575,
  vatAmount: 75,
  vatRecoverable: true,
  vatCategory: "S",
  category: "repair",
  status: "paid",
  method: "cash",
  propertyId: "prop-1",
  ownerId: "owner-1",
  ownership: "owner",
});

const plans: Array<PostingPlan | null> = [
  // Opening balances on the cut-over day, the month before.
  finishPlan({
    sourceType: "opening_balance",
    sourceId: null,
    date: day("2026-09-01"),
    lines: [
      debit("bank", toHalalas(50_000)),
      credit("owner_payable", toHalalas(20_000), { partyType: "owner", partyId: "owner-1" }),
      credit("opening_balance_equity", toHalalas(30_000)),
    ],
  }),
  planDepositReceipt({
    id: "dep-1",
    date: day("2026-09-15"),
    tenantId: "tenant-1",
    ownerId: "owner-1",
    propertyId: "prop-1",
    unitId: "unit-1",
    leaseId: "lease-1",
    ownership: "owner",
    depositHolder: "office",
    amount: 5_000,
    method: null,
  }),
  ownersRent,
  investmentRent,
  ownRentExempt,
  receipt,
  investReceipt,
  planPaymentRefund(investReceipt!, { date: day("2026-10-20") }),
  officeExpense,
  zeroRatedExpense,
  ownersExpense,
  planLinedInvoice({
    id: "cust-1",
    number: "INV-000001",
    date: day("2026-10-08"),
    lines: linesOf(customerInvoice),
    receivable: customer,
    ownerId: null,
    ownership: "office",
    depositHolder: "owner",
  }),
  planLinedInvoice({
    id: "cn-1",
    number: "CN-000001",
    date: day("2026-10-10"),
    lines: linesOf(creditNote),
    receivable: customer,
    ownerId: null,
    ownership: "office",
    depositHolder: "owner",
  }),
  planInvoiceSettlement({
    id: "cust-1:1",
    number: "INV-000001",
    date: day("2026-10-12"),
    amount: 1_000,
    method: "bank_transfer",
    receivable: customer,
  }),
  planSettlementClose({
    id: "set-1",
    date: day("2026-10-31"),
    ownerId: "owner-1",
    commission: 500,
    managementFee: 0,
    commissionVat: 75,
    investmentRent: 9_000,
  }),
  planOwnerPayout({
    id: "out-1",
    date: day("2026-10-31"),
    ownerId: "owner-1",
    amount: 5_000,
    paidFromAccountId: BY_KEY.get("bank")!,
  }),
];

const LINES = post(plans);
const OCTOBER = { from: day("2026-10-01"), to: day("2026-10-31") };
const before = (line: Line) => line.date.getTime() < OCTOBER.from.getTime();
const within = (line: Line) => !before(line) && line.date.getTime() <= OCTOBER.to.getTime();

// ---------------------------------------------------------------------------

describe("trial balance", () => {
  test("every pair of columns adds up, opening, movement and closing", () => {
    const result = computeTrialBalance(CHART, sums(LINES, before), sums(LINES, within));
    assert.equal(result.balanced, true);
    assert.equal(result.totals.opening.debit, result.totals.opening.credit);
    assert.equal(result.totals.period.debit, result.totals.period.credit);
    assert.equal(result.totals.closing.debit, result.totals.closing.credit);
    assert.ok(result.totals.period.debit > 0);
    // Opening is September's: the opening balances and the deposit.
    assert.equal(result.totals.opening.debit, toHalalas(55_000));
  });

  test("an account's closing is its opening and the movement, on the side it falls", () => {
    const result = computeTrialBalance(CHART, sums(LINES, before), sums(LINES, within));
    const bank = result.rows.find((row) => row.account.id === BY_KEY.get("bank"))!;
    const net =
      bank.opening.debit - bank.opening.credit + bank.period.debit - bank.period.credit;
    assert.equal(bank.closing.debit - bank.closing.credit, net);
  });

  test("lines that do not balance show", () => {
    const broken = [...LINES, { ...LINES[0], id: "x", debit: 100, credit: 0 }];
    assert.equal(computeTrialBalance(CHART, new Map(), sums(broken)).balanced, false);
  });

  test("accounts with nothing are left out unless asked for", () => {
    const quiet = computeTrialBalance(CHART, new Map(), sums(LINES));
    const all = computeTrialBalance(CHART, new Map(), sums(LINES), { includeZero: true });
    assert.ok(all.rows.length > quiet.rows.length);
    assert.equal(all.rows.length, CHART.filter((account) => account.postable).length);
    assert.equal(all.balanced, true);
  });
});

describe("balance sheet", () => {
  test("assets equal liabilities plus equity, with the profit to date", () => {
    const sheet = computeBalanceSheet(CHART, sums(LINES));
    assert.equal(sheet.balanced, true);
    assert.equal(sheet.totalAssets, sheet.totalLiabilities + sheet.totalEquity + sheet.profitToDate);
    assert.ok(sheet.totalAssets > 0);
  });

  test("holds at every day, and its profit is the profit and loss to that day", () => {
    for (const iso of ["2026-09-01", "2026-09-30", "2026-10-05", "2026-10-15", "2026-10-31"]) {
      const asOf = day(iso).getTime();
      const upTo = sums(LINES, (line) => line.date.getTime() <= asOf);
      const sheet = computeBalanceSheet(CHART, upTo);
      assert.equal(sheet.balanced, true, iso);
      assert.equal(sheet.profitToDate, computeProfitAndLoss(CHART, upTo).netProfit, iso);
    }
  });

  test("owners' money is a liability, not the office's", () => {
    const sheet = computeBalanceSheet(CHART, sums(LINES));
    const payable = sheet.liabilities.find((row) => row.account.id === BY_KEY.get("owner_payable"))!;
    assert.ok(payable.amount > 0);
    const headings = sheet.liabilities.filter((row) => row.depth === 0);
    assert.equal(headings.length, 1);
    assert.equal(headings[0].amount, sheet.totalLiabilities);
  });
});

describe("profit and loss", () => {
  test("income less expenses; an owner's rent is not the office's income", () => {
    const result = computeProfitAndLoss(CHART, sums(LINES, within));
    assert.equal(result.netProfit, result.totalIncome - result.totalExpenses);
    const rentIncome = result.income.find((row) => row.account.id === BY_KEY.get("rent_income"));
    // Only the office's own building's rent (8,000) and the exempt rent line
    // of the customer's invoice — never the owner's 10,000.
    assert.equal(rentIncome?.amount, toHalalas(8_000) + toHalalas(customerInvoice.lines[2].netAmount));
    const commission = result.income.find((row) => row.account.id === BY_KEY.get("commission_income"));
    assert.equal(commission?.amount, toHalalas(500));
  });

  test("headings carry the totals of what is under them", () => {
    const tree = accountTree(
      CHART,
      new Map([
        [BY_KEY.get("rent_income")!, 300],
        [BY_KEY.get("other_income")!, 200],
      ]),
      ["income"],
    );
    assert.equal(tree[0].depth, 0);
    assert.equal(tree[0].amount, 500);
    assert.ok(tree.every((row) => row.amount !== 0));
  });
});

describe("statements", () => {
  test("an account's statement closes where the trial balance does", () => {
    const bankId = BY_KEY.get("bank")!;
    const bankLines = LINES.filter((line) => line.accountId === bankId);
    const opening = bankLines.filter(before).reduce((net, line) => net + line.debit - line.credit, 0);
    const statement = buildStatement(opening, bankLines.filter(within), "debit");
    const tb = computeTrialBalance(CHART, sums(LINES, before), sums(LINES, within));
    const row = tb.rows.find((candidate) => candidate.account.id === bankId)!;
    assert.equal(statement.closing, row.closing.debit - row.closing.credit);
    assert.equal(statement.rows.at(-1)?.balance, statement.closing);
  });

  test("a payable reads on its credit side", () => {
    const payable = LINES.filter(
      (line) => line.accountId === BY_KEY.get("owner_payable") && line.partyId === "owner-1",
    );
    const statement = buildStatement(0, payable, "credit");
    const net = payable.reduce((sum, line) => sum + line.credit - line.debit, 0);
    assert.equal(statement.closing, net);
    assert.ok(statement.closing > 0, "the office owes the owner");
  });

  test("a customer's receivable: invoiced, credited, paid", () => {
    const receivable = LINES.filter((line) => line.partyType === "customer");
    const statement = buildStatement(0, receivable, "debit");
    const expected =
      toHalalas(customerInvoice.totals.totalAmount) +
      toHalalas(creditNote.totals.totalAmount) -
      toHalalas(1_000);
    assert.equal(statement.closing, expected);
    assert.deepEqual(
      statement.rows.map((row) => row.sourceType),
      ["invoice", "invoice", "invoice_settlement"],
    );
  });
});

// ---------------------------------------------------------------------------
// VAT return against the phase-0 VAT summary
// ---------------------------------------------------------------------------

function vatLines(lines: readonly Line[]): VatLineSums[] {
  return lines
    .filter((line): line is Line & { vatCode: VatCode } => line.vatCode !== null)
    .map((line) => ({
      accountType: TYPE.get(line.accountId)!,
      role:
        line.accountId === BY_KEY.get("output_vat")
          ? ("output_vat" as const)
          : line.accountId === BY_KEY.get("input_vat")
            ? ("input_vat" as const)
            : null,
      vatCode: line.vatCode,
      debit: line.debit,
      credit: line.credit,
    }));
}

describe("VAT return", () => {
  // The same documents as the phase-0 summary reads them. The owner
  // settlement's commission is a ledger posting with no document of its own
  // there, so the comparison leaves it out.
  const docs: VatInvoiceDoc[] = [
    {
      id: "cust-1",
      day: "2026-10-08",
      documentType: "invoice",
      category: "management_fee",
      subtotal: customerInvoice.totals.subtotal,
      discountAmount: customerInvoice.totals.discountAmount,
      taxAmount: customerInvoice.totals.taxAmount,
      lines: customerInvoice.lines,
      onOwnersBuilding: false,
    },
    {
      id: "cn-1",
      day: "2026-10-10",
      documentType: "credit_note",
      category: "management_fee",
      subtotal: creditNote.totals.subtotal,
      discountAmount: creditNote.totals.discountAmount,
      taxAmount: creditNote.totals.taxAmount,
      lines: creditNote.lines,
      onOwnersBuilding: false,
    },
    { id: "inv-owner", day: "2026-10-01", documentType: "invoice", category: "rent", subtotal: 10_000, discountAmount: 0, taxAmount: 0, lines: [], onOwnersBuilding: true },
    { id: "inv-invest", day: "2026-10-01", documentType: "invoice", category: "rent", subtotal: 10_000, discountAmount: 0, taxAmount: 1_500, lines: [], onOwnersBuilding: false },
    { id: "inv-own", day: "2026-10-01", documentType: "invoice", category: "rent", subtotal: 8_000, discountAmount: 0, taxAmount: 0, lines: [], onOwnersBuilding: false },
  ];
  const expenses: VatExpenseDoc[] = [
    { id: "exp-1", day: "2026-10-05", amount: 1_150, vatAmount: 150, vatCategory: "S", onOwnersBuilding: false },
    { id: "exp-2", day: "2026-10-06", amount: 300, vatAmount: 0, vatCategory: "Z", onOwnersBuilding: false },
    { id: "exp-3", day: "2026-10-06", amount: 575, vatAmount: 75, vatCategory: "S", onOwnersBuilding: true },
  ];
  const summary = summarizeVat(docs, expenses);
  const documentLines = LINES.filter((line) => line.sourceType !== "owner_settlement");
  const vat = computeVatReturn(vatLines(documentLines));
  const halalasOf = (rows: typeof summary.output.rows, code: string, field: "netAmount" | "vatAmount") =>
    rows.filter((row) => row.vatCategory === code).reduce((sum, row) => sum + toHalalas(row[field]), 0);
  const box = (rows: typeof vat.sales, number: number) => rows.find((row) => row.box === number)!;

  test("sales boxes are the summary's output by category", () => {
    assert.equal(box(vat.sales, 1).amount, halalasOf(summary.output.rows, "S", "netAmount"));
    assert.equal(box(vat.sales, 1).vat, halalasOf(summary.output.rows, "S", "vatAmount"));
    assert.equal(box(vat.sales, 3).amount, halalasOf(summary.output.rows, "Z", "netAmount"));
    assert.equal(box(vat.sales, 5).amount, halalasOf(summary.output.rows, "E", "netAmount"));
    assert.equal(
      box(vat.sales, 6).amount,
      box(vat.sales, 1).amount + box(vat.sales, 3).amount + box(vat.sales, 5).amount,
    );
  });

  test("purchase boxes are the summary's reclaimable input", () => {
    assert.equal(box(vat.purchases, 7).amount, halalasOf(summary.input.rows, "S", "netAmount"));
    assert.equal(box(vat.purchases, 7).vat, toHalalas(summary.input.vatAmount));
    assert.equal(box(vat.purchases, 10).amount, halalasOf(summary.input.rows, "Z", "netAmount"));
    assert.equal(box(vat.purchases, 11).amount, 0);
  });

  test("net VAT due (box 13) is the summary's", () => {
    assert.equal(vat.netVatDue, toHalalas(summary.netVatDue));
    assert.equal(vat.totalOutputVat - vat.totalInputVat, vat.netVatDue);
  });

  test("the commission an owner settlement takes is a standard-rated sale too", () => {
    const withSettlement = computeVatReturn(vatLines(LINES));
    assert.equal(box(withSettlement.sales, 1).amount - box(vat.sales, 1).amount, toHalalas(500));
    assert.equal(withSettlement.totalOutputVat - vat.totalOutputVat, toHalalas(75));
  });

  test("an owner's rent, deposits and VAT paid over are not in the return", () => {
    const paidOver = finishPlan({
      sourceType: "manual",
      sourceId: null,
      date: day("2026-10-28"),
      lines: [debit("output_vat", toHalalas(1_000)), credit("bank", toHalalas(1_000))],
    });
    const withPayment = computeVatReturn(vatLines([...documentLines, ...post([paidOver])]));
    assert.equal(withPayment.netVatDue, vat.netVatDue);
  });
});
