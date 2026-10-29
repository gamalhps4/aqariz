/**
 * VAT on an invoice written line by line.
 *
 * The manual invoice took its tax as one amount typed by hand and its
 * discount off the total after the tax. These pin the rules that replaced
 * that: a category and rate per line, the discount spread over the lines
 * before VAT, the residential/commercial default from the contract, and a
 * credit note as the same figures negative.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  allocateProportionally,
  computeVatInvoice,
  defaultVatTreatment,
  effectiveVatRate,
  isSaudiVatNumber,
  legacyInvoiceVat,
  negateVatInvoice,
  VatInputError,
} from "@/lib/invoice/vat";

describe("the treatment a line starts with", () => {
  test("residential rent is exempt, commercial rent follows the contract's rate", () => {
    assert.deepEqual(defaultVatTreatment("rent", null), { vatCategory: "E", vatRate: 0 });
    assert.deepEqual(defaultVatTreatment("rent", { taxEnabled: false, taxRate: 15 }), {
      vatCategory: "E",
      vatRate: 0,
    });
    assert.deepEqual(defaultVatTreatment("rent", { taxEnabled: true, taxRate: "15.000" }), {
      vatCategory: "S",
      vatRate: 15,
    });
    // Utilities billed with the rent go the same way as the rent.
    assert.deepEqual(defaultVatTreatment("electricity", { taxEnabled: true, taxRate: 15 }), {
      vatCategory: "S",
      vatRate: 15,
    });
  });

  test("a deposit is out of scope; the office's own services are standard-rated", () => {
    assert.deepEqual(defaultVatTreatment("security_deposit", { taxEnabled: true, taxRate: 15 }), {
      vatCategory: "O",
      vatRate: 0,
    });
    assert.deepEqual(defaultVatTreatment("management_fee"), { vatCategory: "S", vatRate: 15 });
    assert.deepEqual(defaultVatTreatment(undefined), { vatCategory: "S", vatRate: 15 });
  });

  test("only a standard-rated line carries a rate", () => {
    assert.equal(effectiveVatRate("Z", 15), 0);
    assert.equal(effectiveVatRate("E", 15), 0);
    assert.equal(effectiveVatRate("S", 5), 5);
    assert.equal(effectiveVatRate("S", 0), 15);
  });
});

describe("the arithmetic", () => {
  test("the discount comes off before VAT, spread over the lines", () => {
    const invoice = computeVatInvoice(
      [
        { description: "Management fee", unitPrice: 1000, vatCategory: "S", vatRate: 15 },
        { description: "Rent", unitPrice: 3000, vatCategory: "E" },
      ],
      400,
    );
    // 400 over 1000 : 3000 → 100 : 300.
    assert.deepEqual(
      invoice.lines.map((line) => [line.discountAmount, line.netAmount, line.vatAmount, line.totalAmount]),
      [
        [100, 900, 135, 1035],
        [300, 2700, 0, 2700],
      ],
    );
    assert.deepEqual(invoice.totals, {
      subtotal: 4000,
      discountAmount: 400,
      netAmount: 3600,
      taxAmount: 135,
      totalAmount: 3735,
    });
    assert.deepEqual(invoice.breakdown, [
      { vatCategory: "S", vatRate: 15, netAmount: 900, vatAmount: 135 },
      { vatCategory: "E", vatRate: 0, netAmount: 2700, vatAmount: 0 },
    ]);
  });

  test("quantities, and a discount that does not divide evenly, add up to the halala", () => {
    const invoice = computeVatInvoice(
      [
        { description: "Cleaning", quantity: 3, unitPrice: 33.33, vatCategory: "S", vatRate: 15 },
        { description: "Repair", unitPrice: 10, vatCategory: "S", vatRate: 15 },
        { description: "Parts", unitPrice: 10, vatCategory: "Z" },
      ],
      10,
    );
    const shares = invoice.lines.map((line) => line.discountAmount);
    assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100), 1000);
    assert.equal(invoice.lines[0].grossAmount, 99.99);
    const sum = (key: "netAmount" | "vatAmount" | "totalAmount") =>
      Math.round(invoice.lines.reduce((acc, line) => acc + line[key], 0) * 100) / 100;
    assert.equal(sum("netAmount"), invoice.totals.netAmount);
    assert.equal(sum("vatAmount"), invoice.totals.taxAmount);
    assert.equal(sum("totalAmount"), invoice.totals.totalAmount);
    assert.equal(invoice.totals.totalAmount, invoice.totals.netAmount + invoice.totals.taxAmount);
  });

  test("halalas split exactly, largest remainders first", () => {
    assert.deepEqual(allocateProportionally(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(allocateProportionally(0, [5, 5]), [0, 0]);
    assert.deepEqual(allocateProportionally(7, [0, 0]), [0, 0]);
  });

  test("a discount larger than the lines, or a bad line, is refused", () => {
    assert.throws(
      () => computeVatInvoice([{ description: "x", unitPrice: 10, vatCategory: "S" }], 11),
      VatInputError,
    );
    assert.throws(
      () => computeVatInvoice([{ description: "x", unitPrice: -1, vatCategory: "S" }]),
      VatInputError,
    );
    assert.throws(
      () => computeVatInvoice([{ description: "x", quantity: 0, unitPrice: 1, vatCategory: "S" }]),
      VatInputError,
    );
    assert.throws(
      () =>
        computeVatInvoice([
          { description: "x", unitPrice: 1, vatCategory: "X" as never },
        ]),
      VatInputError,
    );
  });

  test("a credit note is the same figures, negative", () => {
    const credit = negateVatInvoice(
      computeVatInvoice([{ description: "Fee", unitPrice: 200, vatCategory: "S", vatRate: 15 }]),
    );
    assert.deepEqual(credit.totals, {
      subtotal: -200,
      discountAmount: 0,
      netAmount: -200,
      taxAmount: -30,
      totalAmount: -230,
    });
    assert.equal(credit.lines[0].vatRate, 15);
    assert.equal(credit.breakdown[0].vatAmount, -30);
  });
});

describe("an invoice written before lines had categories", () => {
  test("is exempt without tax, standard-rated at its own rate with it, out of scope as a deposit", () => {
    assert.deepEqual(legacyInvoiceVat({ category: "rent", subtotal: 3000, taxAmount: 0 }), {
      vatCategory: "E",
      vatRate: 0,
      netAmount: 3000,
      vatAmount: 0,
    });
    // 15% worked back from rounded amounts is still 15%.
    assert.deepEqual(legacyInvoiceVat({ category: "rent", subtotal: 3333.33, taxAmount: 500 }), {
      vatCategory: "S",
      vatRate: 15,
      netAmount: 3333.33,
      vatAmount: 500,
    });
    assert.equal(
      legacyInvoiceVat({ category: "security_deposit", subtotal: 5000, taxAmount: 0 }).vatCategory,
      "O",
    );
  });
});

test("a Saudi VAT number is fifteen digits from 3 to 3", () => {
  assert.ok(isSaudiVatNumber("310122393500003"));
  assert.ok(isSaudiVatNumber("3101 2239 3500 003"));
  assert.ok(!isSaudiVatNumber("31012239350000"));
  assert.ok(!isSaudiVatNumber("210122393500003"));
  assert.ok(!isSaudiVatNumber(""));
  assert.ok(!isSaudiVatNumber(null));
});
