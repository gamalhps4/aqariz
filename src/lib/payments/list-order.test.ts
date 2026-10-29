import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  PAYMENT_SORT_FIELDS,
  chosenPaymentOrder,
  isPaymentSortField,
} from "./list-order";

const withNumber = { withNumber: true };

describe("chosenPaymentOrder", () => {
  test("no sortBy is no chosen order: the route keeps its own", () => {
    assert.equal(chosenPaymentOrder(null, null, withNumber), null);
    assert.equal(chosenPaymentOrder(undefined, "asc", withNumber), null);
    assert.equal(chosenPaymentOrder("", "asc", withNumber), null);
  });

  test("a field outside the list never reaches Prisma", () => {
    for (const field of ["tenantId", "organizationId", "notes", "__proto__", "id", "number"]) {
      assert.equal(chosenPaymentOrder(field, "asc", withNumber), null);
    }
    assert.equal(isPaymentSortField("organizationId"), false);
    assert.equal(isPaymentSortField("dueDate"), true);
  });

  test("a listed column sorts both ways, the id breaking ties", () => {
    assert.deepEqual(chosenPaymentOrder("dueDate", "asc", withNumber), [
      { dueDate: "asc" },
      { id: "asc" },
    ]);
    assert.deepEqual(chosenPaymentOrder("amount", "desc", withNumber), [
      { amount: "desc" },
      { id: "asc" },
    ]);
    assert.deepEqual(chosenPaymentOrder("createdAt", "asc", withNumber), [
      { createdAt: "asc" },
      { id: "asc" },
    ]);
  });

  test("anything but asc reads as descending", () => {
    assert.deepEqual(chosenPaymentOrder("dueDate", null, withNumber), [
      { dueDate: "desc" },
      { id: "asc" },
    ]);
    assert.deepEqual(chosenPaymentOrder("dueDate", "DROP", withNumber), [
      { dueDate: "desc" },
      { id: "asc" },
    ]);
  });

  test("unpaid rows (no paid date, no number) stay last both ways", () => {
    assert.deepEqual(chosenPaymentOrder("paidDate", "asc", withNumber), [
      { paidDate: { sort: "asc", nulls: "last" } },
      { id: "asc" },
    ]);
    assert.deepEqual(chosenPaymentOrder("paymentNumber", "desc", withNumber), [
      { number: { sort: "desc", nulls: "last" } },
      { id: "asc" },
    ]);
  });

  test("the payment number is only ordered by once the column exists", () => {
    assert.equal(chosenPaymentOrder("paymentNumber", "asc", { withNumber: false }), null);
  });

  test("status orders by the due date within each status", () => {
    assert.deepEqual(chosenPaymentOrder("status", "asc", withNumber), [
      { status: "asc" },
      { dueDate: "asc" },
      { id: "asc" },
    ]);
  });

  test("every listed field gives an order", () => {
    for (const field of PAYMENT_SORT_FIELDS) {
      const order = chosenPaymentOrder(field, "asc", withNumber);
      assert.ok(Array.isArray(order), field);
    }
  });
});
