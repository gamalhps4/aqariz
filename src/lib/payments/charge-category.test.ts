/**
 * What an installment is for: the rent registers list rent — with the
 * electricity and water billed on it — and report deposits and other charges
 * beside it, not mixed in. A deposit used to read exactly like a month's rent.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  chargeCategoryWhere,
  chargeGroup,
  inChargeFilter,
  isChargeFilter,
  utilitiesOnInvoice,
} from "@/lib/payments/charge-category";
import { rowsMatching } from "@/lib/testing/where-matcher";

describe("the group an invoice belongs to", () => {
  test("a rent installment is rent", () => {
    assert.equal(chargeGroup("rent"), "rent");
  });

  test("a security or pet deposit is a deposit", () => {
    assert.equal(chargeGroup("security_deposit"), "deposit");
    assert.equal(chargeGroup("pet_deposit"), "deposit");
  });

  test("anything billed on its own is another charge", () => {
    for (const category of ["electricity", "maintenance", "late_fee", "other"]) {
      assert.equal(chargeGroup(category), "other", category);
    }
    assert.equal(chargeGroup(null), "other");
  });

  test("every charge is on the register read for all of them", () => {
    assert.ok(inChargeFilter("security_deposit", "all"));
    assert.ok(!inChargeFilter("security_deposit", "rent"));
    assert.ok(inChargeFilter("security_deposit", "deposit"));
  });

  test("only the four choices are accepted", () => {
    for (const value of ["rent", "deposit", "other", "all"]) {
      assert.ok(isChargeFilter(value), value);
    }
    assert.ok(!isChargeFilter("security_deposit"));
    assert.ok(!isChargeFilter(undefined));
  });
});

describe("the same choice in a query", () => {
  const invoices = [
    { id: "rent", category: "rent" },
    { id: "deposit", category: "security_deposit" },
    { id: "pet", category: "pet_deposit" },
    { id: "water", category: "water_sewer" },
    { id: "repair", category: "repair" },
  ];
  const picked = (filter: Parameters<typeof chargeCategoryWhere>[0]) =>
    rowsMatching(invoices, chargeCategoryWhere(filter)).map((row) => row.id);

  test("picks exactly what the register lists", () => {
    assert.deepEqual(picked("rent"), ["rent"]);
    assert.deepEqual(picked("deposit"), ["deposit", "pet"]);
    assert.deepEqual(picked("other"), ["water", "repair"]);
  });

  test("all charges put no condition on the category", () => {
    assert.deepEqual(chargeCategoryWhere("all"), {});
  });

  test("agrees with the grouping row by row", () => {
    for (const filter of ["rent", "deposit", "other", "all"] as const) {
      assert.deepEqual(
        picked(filter),
        invoices
          .filter((row) => inChargeFilter(row.category, filter))
          .map((row) => row.id),
        filter,
      );
    }
  });
});

describe("the utilities billed on an installment", () => {
  test("are its electricity and water lines, before tax", () => {
    assert.equal(
      utilitiesOnInvoice([
        { type: "rent", amount: 2500 },
        { type: "electricity", amount: 150.25 },
        { type: "water_sewer", amount: 49.75 },
      ]),
      200,
    );
  });

  test("are nothing on a rent-only installment, or an older untyped one", () => {
    assert.equal(utilitiesOnInvoice([{ type: "rent", amount: 2500 }]), 0);
    assert.equal(utilitiesOnInvoice([{ description: "Rent", amount: 2500 }]), 0);
    assert.equal(utilitiesOnInvoice(null), 0);
  });
});
