/**
 * The amounts an office in Saudi Arabia actually enters.
 *
 * Rent on a lease is per installment, so an annual contract carries the whole
 * year in one figure. The validators capped it at 100,000 — a villa or a shop
 * let for 150,000 SAR a year could not be saved, nor could a payment of it —
 * and the unit area kept its square-foot floor of 50 after the field became
 * square metres, which refused a 30 m² studio.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_MONEY,
  leaseTermsSchema,
  paymentCreateSchema,
  unitSchema,
} from "@/lib/validations";

describe("money limits", () => {
  test("an annual rent above 100,000 is a valid lease term", () => {
    const result = leaseTermsSchema.safeParse({
      rentAmount: 150_000,
      securityDeposit: 60_000,
    });
    assert.equal(result.success, true);
  });

  test("the whole year's rent can be recorded as one payment", () => {
    const result = paymentCreateSchema.safeParse({
      tenantId: "tenant",
      propertyId: "building",
      amount: 150_000,
      type: "rent",
      dueDate: "2026-09-01",
    });
    assert.equal(result.success, true);
  });

  test("a typo still gets caught", () => {
    const result = leaseTermsSchema.safeParse({
      rentAmount: MAX_MONEY * 10,
      securityDeposit: 0,
    });
    assert.equal(result.success, false);
  });

  test("no message quotes dollars", () => {
    const result = paymentCreateSchema.safeParse({
      tenantId: "tenant",
      propertyId: "building",
      amount: 0,
      type: "rent",
      dueDate: "2026-09-01",
    });
    assert.equal(result.success, false);
    const messages = result.success ? [] : result.error.errors.map((e) => e.message);
    assert.ok(messages.every((message) => !message.includes("$")), messages.join("; "));
  });
});

describe("late fees", () => {
  // The client had the late-payment amount deleted, so the contract form no
  // longer sends one. Requiring it again would refuse every new lease.
  test("a lease needs no late fee", () => {
    const result = leaseTermsSchema.safeParse({
      rentAmount: 12_000,
      securityDeposit: 0,
      paymentConfig: { rentDueDay: 1 },
    });
    assert.equal(result.success, true);
  });
});

describe("unit area in square metres", () => {
  test("a 30 m² studio is accepted", () => {
    const area = unitSchema.shape.squareFootage.safeParse(30);
    assert.equal(area.success, true);
  });
});

// Units added in bulk or by import have no floor, no area and a name the
// bulk dialog allowed; refusing any of them made the building unsaveable
// ("units.0.floor: Expected number, received null").
describe("a building with units added in bulk saves", () => {
  test("no floor (null) and no area (0) are accepted", () => {
    assert.equal(unitSchema.shape.floor.safeParse(null).success, true);
    assert.equal(unitSchema.shape.squareFootage.safeParse(0).success, true);
  });

  test("a unit number as long as the bulk dialog allows is accepted", () => {
    const name = "غرفة سائق - المبنى الشمالي 12";
    assert.ok(name.length > 20);
    assert.equal(unitSchema.shape.unitNumber.safeParse(name).success, true);
  });
});
