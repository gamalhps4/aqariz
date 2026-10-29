/**
 * Which terms an edit changes, for refusing term edits on a contract whose
 * installments are billed (owner's decision, 2026-10-01).
 *
 * The edit form sends every field on every save, so the rule compares values:
 * saving a corrected contract number must not read as a change of rent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  changedTerms,
  lockedTermsMessage,
  type ContractTerms,
} from "@/lib/lease-term-edits";

const STORED: ContractTerms = {
  startDate: new Date("2026-01-01T00:00:00Z"),
  endDate: new Date("2026-12-31T00:00:00Z"),
  paymentFrequency: "quarterly",
  rentAmount: 3000,
  contractAmount: null,
  securityDepositAmount: 2000,
  electricityAmount: 0,
  waterAmount: 150,
  taxEnabled: true,
  taxRate: 15,
  terms: { rentAmount: 3000, paymentConfig: { rentDueDay: 1 } },
  propertyId: "p1",
  unitId: "u1",
  tenantId: "t1",
};

/** What the edit form sends for the stored contract, unchanged. */
const FORM = {
  propertyId: "p1",
  unitId: "u1",
  tenantId: "t1",
  startDate: new Date("2026-01-01"),
  endDate: new Date("2026-12-31"),
  paymentFrequency: "quarterly",
  electricityAmount: 0,
  waterAmount: 150,
  taxEnabled: true,
  taxRate: 15,
  contractAmount: null,
  terms: {
    rentAmount: 3000,
    securityDeposit: 2000,
    paymentConfig: { rentDueDay: 1 },
  },
};

describe("an unchanged form", () => {
  test("changes no term", () => {
    assert.deepEqual(changedTerms(STORED, FORM), []);
  });

  test("a date stored with a time of day is still the same day", () => {
    const stored = {
      ...STORED,
      startDate: new Date("2026-01-01T09:30:00Z"),
    };
    assert.deepEqual(changedTerms(stored, FORM), []);
  });

  test("a due day left unset reads as the 1st, which is what it bills as", () => {
    const stored = { ...STORED, terms: { rentAmount: 3000 } };
    assert.deepEqual(changedTerms(stored, FORM), []);
  });

  test("a tax rate means nothing while tax is off", () => {
    const stored = { ...STORED, taxEnabled: false, taxRate: 0 };
    assert.deepEqual(
      changedTerms(stored, { ...FORM, taxEnabled: false, taxRate: 0 }),
      [],
    );
  });

  test("rent or deposit matching either stored copy is no change", () => {
    // The form fills itself from the `terms` copy; an older row's column can
    // hold something else.
    const stored = {
      ...STORED,
      rentAmount: 3050,
      securityDepositAmount: 0,
      terms: { rentAmount: 3000, securityDeposit: 2000 },
    };
    assert.deepEqual(changedTerms(stored, FORM), []);
  });

  test("fields the edit does not send are not compared", () => {
    assert.deepEqual(changedTerms(STORED, {}), []);
  });
});

describe("a real change", () => {
  test("is named, each term once", () => {
    assert.deepEqual(
      changedTerms(STORED, {
        ...FORM,
        endDate: new Date("2027-06-30"),
        paymentFrequency: "monthly",
        terms: { ...FORM.terms, rentAmount: 3100 },
        unitId: "u2",
      }),
      ["endDate", "paymentFrequency", "rent", "unitId"],
    );
  });

  test("switching to a total for the term is a change of how rent is stated", () => {
    assert.deepEqual(changedTerms(STORED, { ...FORM, contractAmount: 12_000 }), [
      "contractAmount",
    ]);
  });

  test("a contract priced by its total compares the total, not the derived rent", () => {
    const total = { ...STORED, contractAmount: 12_000 };
    assert.deepEqual(
      changedTerms(total, {
        ...FORM,
        contractAmount: 12_000,
        // The form's rent for a total is the share; it may differ by halalas.
        terms: { ...FORM.terms, rentAmount: 2999.99 },
      }),
      [],
    );
    assert.deepEqual(changedTerms(total, { ...FORM, contractAmount: 12_500 }), [
      "contractAmount",
    ]);
  });

  test("tax, deposit, utilities and the due day are terms", () => {
    assert.deepEqual(
      changedTerms(STORED, {
        ...FORM,
        taxRate: 5,
        waterAmount: 200,
        terms: {
          ...FORM.terms,
          securityDeposit: 2500,
          paymentConfig: { rentDueDay: 5 },
        },
      }),
      ["securityDeposit", "waterAmount", "tax", "rentDueDay"],
    );
  });

  test("the refusal names what the edit tried to change", () => {
    const message = lockedTermsMessage(["rent", "endDate"]);
    assert.match(message, /billed installments/);
    assert.match(message, /rent, end date/);
  });
});
