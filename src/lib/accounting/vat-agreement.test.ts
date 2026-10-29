/**
 * The VAT summary (document by document, lib/invoice/vat-summary.ts) and the
 * ledger's VAT return (lib/accounting/reports/compute.ts) must say the same
 * for the same period — one office files one return.
 *
 * They did not: the summary missed purchase-bill input VAT and the VAT owner
 * settlements booked on their commission, and dated an installment by its
 * issue day while the ledger posts it on its due day — an installment issued
 * on 25 September and due on 1 October was September's in one and October's
 * in the other.
 *
 * Here one office's October is posted through the real posting rules, summed
 * as the return sums the books, and summarised as the route summarises the
 * documents (same date rule, same mapping helpers).
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { planInvoice, planLinedInvoice, type InvoiceReceivable } from "./posting/invoice";
import { planExpense, type ExpenseDoc } from "./posting/expense";
import { planPurchaseBill, type PurchaseBillDoc } from "./posting/purchase";
import { planSettlementClose } from "./posting/owner";
import { mirrorLines } from "./posting/common";
import { computeVatReturn, type VatLineSums } from "./reports/compute";
import { SYSTEM_KEY_TYPES, isSystemKey } from "./system-keys";
import { settlementFeeLines } from "./settlement-invoice";
import type { PlannedLine, PostingPlan } from "./types";
import {
  expenseVatLine,
  invoiceVatDay,
  settlementVatDocs,
  summarizeVat,
  type VatBillDoc,
  type VatExpenseDoc,
  type VatInvoiceDoc,
} from "@/lib/invoice/vat-summary";
import type { VatCategory } from "@/lib/invoice/vat";

const day = (text: string) => new Date(`${text}T00:00:00.000Z`);
const FROM = "2026-10-01";
const TO = "2026-10-31";
const inOctober = (text: string) => text >= FROM && text <= TO;
const dayText = (date: Date) => date.toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// The office's documents
// ---------------------------------------------------------------------------

/** Installments: rent with 15% VAT on the office's own building. */
const installments = [
  // Issued in September, due 1 October: October's.
  { id: "inst-oct", issueDate: day("2026-09-25"), dueDate: day("2026-10-01"), total: 11_500, tax: 1_500, net: 10_000 },
  // Issued in October, due 1 November: not October's.
  { id: "inst-nov", issueDate: day("2026-10-25"), dueDate: day("2026-11-01"), total: 5_750, tax: 750, net: 5_000 },
];

interface LinedDoc {
  id: string;
  issueDate: Date;
  dueDate: Date;
  documentType: "invoice" | "credit_note";
  receivable: InvoiceReceivable;
  lines: Array<{ category: string; net: number; vat: number; vatCategory: VatCategory; vatRate: number }>;
}

const customer: InvoiceReceivable = { account: "customer_receivables", partyType: "customer", partyId: "vat:300000000000003" };
const owner: InvoiceReceivable = { account: "customer_receivables", partyType: "owner", partyId: "owner-1" };

const fee = settlementFeeLines({ commission: 1_000, managementFee: 500, commissionVat: 225 }, 15);

const lined: LinedDoc[] = [
  // A custom invoice: 1,000 standard-rated + 150 VAT, 500 exempt.
  {
    id: "inv-custom",
    issueDate: day("2026-10-05"),
    dueDate: day("2026-10-20"),
    documentType: "invoice",
    receivable: customer,
    lines: [
      { category: "other", net: 1_000, vat: 150, vatCategory: "S", vatRate: 15 },
      { category: "other", net: 500, vat: 0, vatCategory: "E", vatRate: 0 },
    ],
  },
  // Its credit note: 200 + 30 VAT off the standard-rated line.
  {
    id: "cn-custom",
    issueDate: day("2026-10-10"),
    dueDate: day("2026-10-10"),
    documentType: "credit_note",
    receivable: customer,
    lines: [{ category: "other", net: -200, vat: -30, vatCategory: "S", vatRate: 15 }],
  },
  // An owner settlement's tax invoice: commission 1,000 + fixed fee 500, VAT 225.
  {
    id: "inv-settlement",
    issueDate: day("2026-10-31"),
    dueDate: day("2026-10-31"),
    documentType: "invoice",
    receivable: owner,
    lines: fee.map((line) => ({
      category: line.category,
      net: line.net,
      vat: line.vat,
      vatCategory: line.vatCategory,
      vatRate: line.vatRate,
    })),
  },
];

const expenses: Array<ExpenseDoc & { onOwnersBuilding: boolean }> = [
  // The office's own maintenance: 1,150 with 150 VAT.
  {
    id: "exp-office",
    date: day("2026-10-07"),
    amount: 1_150,
    vatAmount: 150,
    vatRecoverable: true,
    vatCategory: "S",
    category: "maintenance",
    status: "paid",
    method: "bank_transfer",
    propertyId: null,
    ownerId: null,
    ownership: null,
    onOwnersBuilding: false,
  },
  // On an owner's building: the owner's VAT, not the office's to reclaim.
  {
    id: "exp-owner",
    date: day("2026-10-08"),
    amount: 575,
    vatAmount: 75,
    vatRecoverable: true,
    vatCategory: "S",
    category: "repair",
    status: "paid",
    method: "bank_transfer",
    propertyId: "prop-owner",
    ownerId: "owner-1",
    ownership: "owner",
    onOwnersBuilding: true,
  },
];

const bills: PurchaseBillDoc[] = [
  {
    id: "bill-1",
    date: day("2026-10-12"),
    status: "approved",
    supplierId: "sup-1",
    vatRecoverable: true,
    lines: [
      { accountId: "acc-supplies", net: 2_000, vat: 300, vatCategory: "S" },
      { accountId: "acc-supplies", net: 400, vat: 0, vatCategory: "Z" },
    ],
  },
];

/** A settlement closed before settlements issued invoices: it booked its commission itself. */
const legacySettlement = planSettlementClose({
  id: "set-legacy",
  date: day("2026-10-31"),
  ownerId: "owner-2",
  commission: 800,
  managementFee: 0,
  commissionVat: 120,
  investmentRent: 0,
})!;
/** One closed in September and cancelled in October: its reversal is October's. */
const septemberSettlement = planSettlementClose({
  id: "set-cancelled",
  date: day("2026-09-30"),
  ownerId: "owner-3",
  commission: 400,
  managementFee: 0,
  commissionVat: 60,
  investmentRent: 0,
})!;
const cancellation: PostingPlan = {
  ...septemberSettlement,
  date: day("2026-10-15"),
  lines: mirrorLines(septemberSettlement.lines),
};
/** The invoiced settlement: the invoice above books its commission, the entry none. */
const invoicedSettlement = planSettlementClose({
  id: "set-invoiced",
  date: day("2026-10-31"),
  ownerId: "owner-1",
  commission: 1_000,
  managementFee: 500,
  commissionVat: 225,
  investmentRent: 0,
  invoiced: true,
});

// ---------------------------------------------------------------------------
// The ledger's side: post, then sum as the return does
// ---------------------------------------------------------------------------

function ledgerPlans(): PostingPlan[] {
  const plans: Array<PostingPlan | null> = [
    ...installments.map((doc) =>
      planInvoice({
        id: doc.id,
        date: doc.dueDate,
        category: "rent",
        total: doc.total,
        tax: doc.tax,
        lines: [{ type: "rent", amount: doc.net }],
        tenantId: "tenant-1",
        ownerId: null,
        ownership: "office",
        depositHolder: "office",
      }),
    ),
    ...lined.map((doc) =>
      planLinedInvoice({
        id: doc.id,
        date: doc.issueDate,
        lines: doc.lines.map((line) => ({
          category: line.category,
          net: line.net,
          vat: line.vat,
          vatCategory: line.vatCategory,
        })),
        receivable: doc.receivable,
        ownerId: null,
        ownership: "office",
        depositHolder: "office",
      }),
    ),
    ...expenses.map((doc) => planExpense(doc)),
    ...bills.map((doc) => planPurchaseBill(doc)),
    legacySettlement,
    septemberSettlement,
    cancellation,
    invoicedSettlement,
  ];
  return plans.filter((plan): plan is PostingPlan => Boolean(plan));
}

function accountTypeOf(line: PlannedLine): VatLineSums["accountType"] {
  if ("key" in line.account && isSystemKey(line.account.key)) {
    return SYSTEM_KEY_TYPES[line.account.key][0];
  }
  return "expense";
}

function ledgerReturn() {
  const lines: VatLineSums[] = [];
  for (const plan of ledgerPlans()) {
    if (!inOctober(dayText(plan.date))) continue;
    for (const line of plan.lines) {
      if (!line.vatCode) continue;
      const key = "key" in line.account ? line.account.key : null;
      lines.push({
        accountType: accountTypeOf(line),
        role: key === "output_vat" ? "output_vat" : key === "input_vat" ? "input_vat" : null,
        vatCode: line.vatCode,
        debit: line.debit,
        credit: line.credit,
      });
    }
  }
  return computeVatReturn(lines);
}

// ---------------------------------------------------------------------------
// The summary's side: the documents, as the route reads them
// ---------------------------------------------------------------------------

function summary() {
  const invoiceDocs: VatInvoiceDoc[] = [
    ...installments.map((doc) => ({
      id: doc.id,
      day: invoiceVatDay(doc, false),
      documentType: "invoice" as const,
      category: "rent",
      subtotal: doc.net,
      discountAmount: 0,
      taxAmount: doc.tax,
      lines: [],
      onOwnersBuilding: false,
    })),
    ...lined.map((doc) => ({
      id: doc.id,
      day: invoiceVatDay(doc, true),
      documentType: doc.documentType,
      category: "other",
      subtotal: doc.lines.reduce((sum, line) => sum + line.net, 0),
      discountAmount: 0,
      taxAmount: doc.lines.reduce((sum, line) => sum + line.vat, 0),
      lines: doc.lines.map((line) => ({
        vatCategory: line.vatCategory,
        vatRate: line.vatRate,
        netAmount: line.net,
        vatAmount: line.vat,
      })),
      onOwnersBuilding: false,
    })),
  ].filter((doc) => inOctober(doc.day));

  const expenseDocs: VatExpenseDoc[] = expenses.map((doc) => ({
    id: doc.id,
    day: dayText(doc.date),
    amount: doc.amount,
    vatAmount: doc.vatAmount ?? 0,
    vatCategory: (doc.vatCategory as VatCategory) ?? null,
    onOwnersBuilding: doc.onOwnersBuilding,
  }));

  const billDocs: VatBillDoc[] = bills.map((bill) => ({
    id: bill.id,
    day: dayText(bill.date),
    lines: bill.lines.map((line) => ({
      vatCategory: line.vatCategory as VatCategory,
      vatRate: line.vatCategory === "S" ? 15 : 0,
      netAmount: line.net,
      vatAmount: line.vat,
    })),
  }));

  // Settlements as the route reads them: their entries' standard-rated lines.
  const settlementLines = [legacySettlement, septemberSettlement, cancellation, invoicedSettlement]
    .filter((plan): plan is PostingPlan => Boolean(plan))
    .map((plan, index) => ({ plan, entryId: `${plan.sourceId}:${index}` }))
    .filter(({ plan }) => inOctober(dayText(plan.date)))
    .flatMap(({ plan, entryId }) =>
      plan.lines
        .filter((line) => line.vatCode === "S")
        .map((line) => ({
          entryId,
          day: dayText(plan.date),
          debit: line.debit / 100,
          credit: line.credit / 100,
          income: accountTypeOf(line) === "income",
        })),
    );

  return summarizeVat(invoiceDocs, expenseDocs, "month", {
    bills: billDocs,
    settlements: settlementVatDocs(settlementLines, 15),
  });
}

describe("the VAT summary and the ledger's VAT return", () => {
  test("agree for the same period, to the halala", () => {
    const books = ledgerReturn();
    const documents = summary();
    // Output: 1,500 (installment due 1 Oct) + 150 (custom invoice) − 30
    // (credit note) + 225 (settlement's tax invoice) + 120 (a settlement that
    // booked its own commission) − 60 (one cancelled in October) = 1,905.
    assert.equal(books.totalOutputVat, 190_500);
    assert.equal(documents.output.vatAmount, 1_905);
    // Input: 150 (the office's expense) + 300 (the purchase bill) = 450;
    // the 75 on the owner's building is the owner's.
    assert.equal(books.totalInputVat, 45_000);
    assert.equal(documents.input.vatAmount, 450);
    assert.equal(books.netVatDue, 145_500);
    assert.equal(documents.netVatDue, 1_455);
    assert.deepEqual(documents.periods, [{ key: "2026-10", outputVat: 1_905, inputVat: 450, netVat: 1_455 }]);
  });

  test("an installment is the period of its due day in both", () => {
    assert.equal(invoiceVatDay(installments[0], false), "2026-10-01");
    assert.equal(invoiceVatDay(installments[1], false), "2026-11-01");
    // A custom invoice is its issue day's, as its tax point.
    assert.equal(invoiceVatDay(lined[0], true), "2026-10-05");
  });

  test("a settlement with a tax invoice books its commission once", () => {
    assert.equal(invoicedSettlement, null);
    const outputOnInvoice = ledgerPlans()
      .filter((plan) => plan.sourceId === "inv-settlement")
      .flatMap((plan) => plan.lines)
      .filter((line) => "key" in line.account && line.account.key === "output_vat")
      .reduce((sum, line) => sum + line.credit - line.debit, 0);
    assert.equal(outputOnInvoice, 22_500);
  });

  test("the input VAT of an expense reads the same on both sides", () => {
    const line = expenseVatLine({
      id: "exp-office",
      day: "2026-10-07",
      amount: 1_150,
      vatAmount: 150,
      vatCategory: "S",
      onOwnersBuilding: false,
    });
    assert.deepEqual(line, { vatCategory: "S", vatRate: 15, netAmount: 1_000, vatAmount: 150 });
  });
});
