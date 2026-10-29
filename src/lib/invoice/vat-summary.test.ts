/**
 * The VAT summary: the office's output VAT by category, net of credit notes;
 * owners' rent apart; input VAT the office may reclaim, and what it may not.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  expenseVatLine,
  summarizeVat,
  vatPeriodKey,
  type VatExpenseDoc,
  type VatInvoiceDoc,
} from "@/lib/invoice/vat-summary";

function invoice(overrides: Partial<VatInvoiceDoc>): VatInvoiceDoc {
  return {
    id: "i",
    day: "2026-10-03",
    documentType: "invoice",
    category: "management_fee",
    subtotal: 0,
    discountAmount: 0,
    taxAmount: 0,
    lines: [],
    onOwnersBuilding: false,
    ...overrides,
  };
}

function expense(overrides: Partial<VatExpenseDoc>): VatExpenseDoc {
  return {
    id: "e",
    day: "2026-10-05",
    amount: 0,
    vatAmount: 0,
    vatCategory: null,
    onOwnersBuilding: false,
    ...overrides,
  };
}

describe("the VAT summary", () => {
  test("adds output VAT by category and rate, a credit note taking its share off", () => {
    const summary = summarizeVat(
      [
        invoice({
          id: "a",
          lines: [
            { vatCategory: "S", vatRate: 15, netAmount: 900, vatAmount: 135 },
            { vatCategory: "E", vatRate: 0, netAmount: 2700, vatAmount: 0 },
          ],
        }),
        invoice({
          id: "b",
          documentType: "credit_note",
          day: "2026-11-02",
          lines: [{ vatCategory: "S", vatRate: 15, netAmount: -200, vatAmount: -30 }],
        }),
        // An installment, VAT-bearing (commercial), without lines.
        invoice({ id: "c", category: "rent", subtotal: 10000, taxAmount: 1500 }),
      ],
      [],
    );
    assert.deepEqual(summary.output.rows, [
      { vatCategory: "S", vatRate: 15, netAmount: 10700, vatAmount: 1605, count: 3 },
      { vatCategory: "E", vatRate: 0, netAmount: 2700, vatAmount: 0, count: 1 },
    ]);
    assert.equal(summary.output.vatAmount, 1605);
    assert.deepEqual(summary.creditNotes, { count: 1, netAmount: -200, vatAmount: -30 });
    assert.deepEqual(
      summary.periods.map((row) => [row.key, row.outputVat]),
      [
        ["2026-10", 1635],
        ["2026-11", -30],
      ],
    );
  });

  test("puts rent on owners' buildings apart, out of the office's total", () => {
    const summary = summarizeVat(
      [invoice({ category: "rent", subtotal: 5000, taxAmount: 750, onOwnersBuilding: true })],
      [],
    );
    assert.equal(summary.output.vatAmount, 0);
    assert.equal(summary.ownersOutput.vatAmount, 750);
    assert.equal(summary.netVatDue, 0);
  });

  test("reclaims input VAT on the office's own expenses, not on owners' buildings", () => {
    const summary = summarizeVat(
      [invoice({ lines: [{ vatCategory: "S", vatRate: 15, netAmount: 1000, vatAmount: 150 }] })],
      [
        expense({ id: "x", amount: 115, vatAmount: 15, vatCategory: "S" }),
        expense({ id: "y", amount: 230, vatAmount: 30, onOwnersBuilding: true }),
        // No VAT recorded: not in the summary.
        expense({ id: "z", amount: 500 }),
      ],
      "quarter",
    );
    assert.deepEqual(summary.input.rows, [
      { vatCategory: "S", vatRate: 15, netAmount: 100, vatAmount: 15, count: 1 },
    ]);
    assert.equal(summary.ownersInput.vatAmount, 30);
    assert.equal(summary.netVatDue, 135);
    assert.deepEqual(summary.periods, [{ key: "2026-Q4", outputVat: 150, inputVat: 15, netVat: 135 }]);
  });

  test("an expense's rate is worked back from its VAT; one without a category is standard", () => {
    assert.deepEqual(expenseVatLine(expense({ amount: 1150, vatAmount: 150 })), {
      vatCategory: "S",
      vatRate: 15,
      netAmount: 1000,
      vatAmount: 150,
    });
    assert.deepEqual(expenseVatLine(expense({ amount: 300, vatCategory: "E" })), {
      vatCategory: "E",
      vatRate: 0,
      netAmount: 300,
      vatAmount: 0,
    });
    assert.equal(expenseVatLine(expense({ amount: 300 })), null);
  });

  test("periods are months or quarters", () => {
    assert.equal(vatPeriodKey("2026-03-31", "month"), "2026-03");
    assert.equal(vatPeriodKey("2026-03-31", "quarter"), "2026-Q1");
    assert.equal(vatPeriodKey("2026-12-01", "quarter"), "2026-Q4");
  });
});
