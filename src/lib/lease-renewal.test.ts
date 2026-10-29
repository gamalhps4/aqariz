/**
 * A renewal is the same contract for a new term, not a fresh one on defaults.
 *
 * The renew route copied only the `terms` JSON, so a 3,000 quarterly contract
 * came back as 3,000 monthly — four times the rent — and lost its VAT and
 * utilities on the way.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { renewalContract } from "@/lib/lease-renewal";

const year = { startDate: "2027-01-01", endDate: "2027-12-31" };

const quarterly = {
  paymentFrequency: "quarterly",
  rentAmount: 3000,
  contractAmount: null,
  securityDepositAmount: 1500,
  electricityAmount: 200,
  waterAmount: 50,
  taxEnabled: true,
  taxRate: 15,
  currency: "SAR",
  terms: { rentAmount: 3000, securityDeposit: 1500 },
};

describe("renewal", () => {
  test("keeps the frequency", () => {
    assert.equal(renewalContract(quarterly, year).paymentFrequency, "quarterly");
    assert.equal(
      renewalContract({ ...quarterly, paymentFrequency: "four_monthly" }, year)
        .paymentFrequency,
      "four_monthly",
    );
  });

  test("keeps the rent, tax, utilities, deposit and currency", () => {
    assert.deepEqual(renewalContract(quarterly, year), {
      paymentFrequency: "quarterly",
      rentAmount: 3000,
      contractAmount: null,
      securityDepositAmount: 1500,
      electricityAmount: 200,
      waterAmount: 50,
      taxEnabled: true,
      taxRate: 15,
      currency: "SAR",
    });
  });

  test("reads a contract that predates the columns from its terms", () => {
    // Renewed and imported rows used to hold only `{ rentAmount }`.
    const legacy = { terms: { rentAmount: 2500, securityDeposit: 500 } };
    const renewed = renewalContract(legacy, year);
    assert.equal(renewed.rentAmount, 2500);
    assert.equal(renewed.securityDepositAmount, 500);
    assert.equal(renewed.paymentFrequency, "monthly");
  });

  test("keeps a total, divided over the new term", () => {
    const monthlyTotal = {
      ...quarterly,
      paymentFrequency: "monthly",
      rentAmount: 1000,
      contractAmount: 12000,
    };
    const sameLength = renewalContract(monthlyTotal, year);
    assert.equal(sameLength.contractAmount, 12000);
    assert.equal(sameLength.rentAmount, 1000);

    const halfYear = renewalContract(monthlyTotal, {
      startDate: "2027-01-01",
      endDate: "2027-06-30",
    });
    assert.equal(halfYear.contractAmount, 12000);
    assert.equal(halfYear.rentAmount, 2000);
  });

  test("takes the dialog's total over the old figure", () => {
    const renewed = renewalContract(quarterly, year, { contractAmount: 13200 });
    assert.equal(renewed.contractAmount, 13200);
    assert.equal(renewed.rentAmount, 3300);
    assert.equal(renewed.paymentFrequency, "quarterly");
  });

  test("a new rent per installment replaces an old total", () => {
    const renewed = renewalContract(
      { ...quarterly, contractAmount: 12000 },
      year,
      { rentAmount: 3300 },
    );
    assert.equal(renewed.contractAmount, null);
    assert.equal(renewed.rentAmount, 3300);
  });

  test("a contract without tax renews without a stray rate", () => {
    const renewed = renewalContract(
      { ...quarterly, taxEnabled: false, taxRate: 15 },
      year,
    );
    assert.equal(renewed.taxEnabled, false);
    assert.equal(renewed.taxRate, 0);
  });
});
