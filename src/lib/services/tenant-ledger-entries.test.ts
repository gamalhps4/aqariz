/**
 * A tenant's ledger: charges with their VAT and discount, credit notes as
 * credits, receipts at what they brought in, and a running balance that
 * starts from what was owed before the period.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  buildLedgerEntries,
  invoiceBalanceEffect,
  invoiceEntries,
  receivedAmount,
  type LedgerInvoiceRow,
  type LedgerPaymentRow,
} from "@/lib/services/tenant-ledger-entries";

function invoice(overrides: Partial<LedgerInvoiceRow>): LedgerInvoiceRow {
  return {
    id: "inv",
    invoiceNumber: "RENT-000001",
    issueDate: new Date("2026-10-01T00:00:00Z"),
    category: "rent",
    status: "issued",
    documentType: "invoice",
    discountAmount: 0,
    taxAmount: 0,
    totalAmount: 0,
    lineItems: [],
    ...overrides,
  };
}

function payment(overrides: Partial<LedgerPaymentRow>): LedgerPaymentRow {
  return {
    id: "pay",
    paidDate: new Date("2026-10-05T00:00:00Z"),
    amount: 0,
    amountPaid: 0,
    status: "paid",
    paymentMethod: "cash",
    description: null,
    reference: "RCP-000001",
    ...overrides,
  };
}

describe("an invoice in the ledger", () => {
  test("charges its lines, takes off its discount and adds its VAT: its total", () => {
    const entries = invoiceEntries(
      invoice({
        totalAmount: 11085,
        taxAmount: 1485,
        discountAmount: 400,
        lineItems: [
          { description: "Rent", type: "rent", amount: 9000 },
          { description: "Electricity", type: "electricity", amount: 1000 },
        ],
      }),
    );
    assert.deepEqual(
      entries.map((entry) => [entry.category, entry.debitAmount, entry.creditAmount]),
      [
        ["rent", 9000, 0],
        ["utilities", 1000, 0],
        ["discount", 0, 400],
        ["vat", 1485, 0],
      ],
    );
    assert.equal(
      invoiceBalanceEffect(
        invoice({
          totalAmount: 11085,
          taxAmount: 1485,
          discountAmount: 400,
          lineItems: [
            { description: "Rent", type: "rent", amount: 9000 },
            { description: "Electricity", type: "electricity", amount: 1000 },
          ],
        }),
      ),
      11085,
    );
  });

  test("a credit note is one credit of its total", () => {
    const entries = invoiceEntries(
      invoice({ documentType: "credit_note", invoiceNumber: "CN-000001", totalAmount: -230 }),
    );
    assert.deepEqual(
      entries.map((entry) => [entry.type, entry.category, entry.creditAmount]),
      [["credit", "creditNote", 230]],
    );
  });
});

describe("the ledger", () => {
  test("runs from the opening balance, charges before receipts on the same day", () => {
    const entries = buildLedgerEntries(
      [invoice({ totalAmount: 3000, lineItems: [{ description: "Rent", type: "rent", amount: 3000 }], issueDate: new Date("2026-10-05T00:00:00Z") })],
      [payment({ amount: 3000, amountPaid: 2000 })],
      500,
    );
    assert.deepEqual(
      entries.map((entry) => [entry.category, entry.runningBalance]),
      [
        ["rent", 3500],
        ["payment", 1500],
      ],
    );
  });

  test("credits what a payment brought in, the amount on an older row", () => {
    assert.equal(receivedAmount({ amount: 3000, amountPaid: 1200 }), 1200);
    assert.equal(receivedAmount({ amount: 3000, amountPaid: 0 }), 3000);
  });
});
