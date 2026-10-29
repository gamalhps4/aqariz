/**
 * The commission is charged on rent, before VAT — not on everything received.
 *
 * Decided 2026-09-29: the VAT on the rent, the utilities billed with it,
 * deposits and one-off charges are all still collected and still settled, but
 * the office's percentage is taken of the rent alone. These pin how the rent
 * is found inside a payment.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  billedRentBase,
  invoiceRentShare,
  leaseRentShare,
  paymentCommissionBase,
  type BaseInvoice,
} from "@/lib/statements/commission-base";

/** A monthly installment: rent 1,000, electricity 100, VAT 15% on both. */
const installment: BaseInvoice = {
  category: "rent",
  taxAmount: 165,
  discountAmount: 0,
  totalAmount: 1_265,
  lineItems: [
    { description: "Monthly Rent", amount: 1_000, type: "rent" },
    { description: "Electricity", amount: 100, type: "electricity" },
  ],
};

/** A residential installment — no VAT, no utilities, as in the client's samples. */
const residential: BaseInvoice = {
  category: "rent",
  taxAmount: 0,
  totalAmount: 3_000,
  lineItems: [{ description: "Monthly Rent", amount: 3_000, type: "rent" }],
};

const deposit: BaseInvoice = {
  category: "security_deposit",
  taxAmount: 0,
  totalAmount: 5_000,
  lineItems: [{ description: "Security deposit", amount: 5_000, type: "security_deposit" }],
};

const invoices = new Map<string, BaseInvoice>([
  ["inv-rent", installment],
  ["inv-residential", residential],
  ["inv-deposit", deposit],
]);

describe("the rent inside an invoice", () => {
  test("VAT and utilities are taken out", () => {
    assert.equal(billedRentBase(installment), 1_000);
  });

  test("a residential installment is all rent", () => {
    assert.equal(invoiceRentShare(residential), 1);
    assert.equal(billedRentBase(residential), 3_000);
  });

  test("a deposit is not rent", () => {
    assert.equal(billedRentBase(deposit), 0);
  });

  test("an older rent invoice with an untyped line is rent", () => {
    assert.equal(
      billedRentBase({
        category: "rent",
        taxAmount: 0,
        totalAmount: 2_000,
        lineItems: [{ description: "Rent", amount: 2_000 }],
      }),
      2_000,
    );
  });

  test("a discount reduces the rent it is charged on", () => {
    assert.equal(
      billedRentBase({
        category: "rent",
        taxAmount: 0,
        discountAmount: 100,
        totalAmount: 900,
        lineItems: [{ amount: 1_000, type: "rent" }],
      }),
      900,
    );
  });
});

describe("the rent inside a payment", () => {
  test("a full payment of the installment is its rent before VAT", () => {
    assert.equal(
      paymentCommissionBase(
        { type: "rent", collected: 1_265, invoiceId: "inv-rent" },
        invoices,
      ),
      1_000,
    );
  });

  test("a part payment carries the installment's proportions", () => {
    assert.equal(
      paymentCommissionBase(
        { type: "rent", collected: 632.5, invoiceId: "inv-rent" },
        invoices,
      ),
      500,
    );
  });

  test("a deposit payment adds nothing", () => {
    assert.equal(
      paymentCommissionBase(
        { type: "security_deposit", collected: 5_000, invoiceId: "inv-deposit" },
        invoices,
      ),
      0,
    );
  });

  test("money applied across several invoices is split by where it went", () => {
    assert.equal(
      paymentCommissionBase(
        {
          type: "rent",
          collected: 4_265,
          invoiceId: "inv-rent",
          allocations: [
            { invoiceId: "inv-rent", amount: 1_265 },
            { invoiceId: "inv-residential", amount: 3_000 },
          ],
        },
        invoices,
      ),
      4_000,
    );
  });

  test("allocations larger than the payment never charge on more than was received", () => {
    assert.equal(
      paymentCommissionBase(
        {
          type: "rent",
          collected: 1_500,
          invoiceId: null,
          allocations: [{ invoiceId: "inv-residential", amount: 3_000 }],
        },
        invoices,
      ),
      1_500,
    );
  });

  test("a rent payment with no invoice is read against its contract", () => {
    const lease = {
      rentAmount: 1_000,
      electricityAmount: 100,
      waterAmount: 0,
      taxEnabled: true,
      taxRate: 15,
    };
    assert.equal(
      paymentCommissionBase({ type: "rent", collected: 1_265, invoiceId: null }, invoices, lease),
      1_000,
    );
    assert.equal(leaseRentShare(null), 1);
  });

  test("a fee with no invoice adds nothing", () => {
    assert.equal(
      paymentCommissionBase({ type: "other", collected: 200, invoiceId: null }, invoices),
      0,
    );
  });

  test("the client's sample: rent only, so the base is everything collected", () => {
    const payments = [3_000, 1_500, 4_000, 4_000].map((collected) =>
      paymentCommissionBase(
        {
          type: "rent",
          collected,
          invoiceId: null,
          allocations: [{ invoiceId: "inv-residential", amount: collected }],
        },
        invoices,
      ),
    );
    assert.deepEqual(payments, [3_000, 1_500, 4_000, 4_000]);
  });
});
