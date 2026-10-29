/**
 * A bill's arithmetic, what is left to pay, and which payments can stand.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  balanceOf,
  canApproveBill,
  canCancelBill,
  canEditBill,
  canPayBill,
  canReopenBill,
  checkAllocations,
  computeBill,
  dueDateFor,
  isOverdue,
  statusAfterPayment,
  suggestAllocations,
  type AllocatableBill,
} from "./bill-math";
import { VatInputError } from "@/lib/invoice/vat";

describe("computing a bill", () => {
  test("each line by its own VAT, the totals adding up to the lines", () => {
    const bill = computeBill([
      { description: "Pipes", accountId: "a1", quantity: 2, unitPrice: 100, vatCategory: "S", vatRate: 15 },
      { description: "Water tank", accountId: "a2", quantity: 1, unitPrice: 500, vatCategory: "Z" },
      { description: "Licence", accountId: "a3", quantity: 1, unitPrice: 50.5, vatCategory: "E" },
    ]);
    assert.deepEqual(
      bill.lines.map((line) => [line.netAmount, line.vatAmount, line.totalAmount]),
      [
        [200, 30, 230],
        [500, 0, 500],
        [50.5, 0, 50.5],
      ],
    );
    assert.equal(bill.totals.subtotal, 750.5);
    assert.equal(bill.totals.taxAmount, 30);
    assert.equal(bill.totals.totalAmount, 780.5);
  });

  test("the discount comes off before VAT, spread over the lines", () => {
    const bill = computeBill(
      [
        { description: "A", accountId: "a1", unitPrice: 100, vatCategory: "S", vatRate: 15 },
        { description: "B", accountId: "a1", unitPrice: 300, vatCategory: "S", vatRate: 15 },
      ],
      40,
    );
    assert.equal(bill.totals.discountAmount, 40);
    assert.equal(bill.totals.netAmount, 360);
    assert.equal(bill.totals.taxAmount, 54);
    assert.equal(bill.totals.totalAmount, 414);
    assert.deepEqual(
      bill.lines.map((line) => line.discountAmount),
      [10, 30],
    );
  });

  test("only a standard-rated line carries a rate", () => {
    const bill = computeBill([
      { description: "A", accountId: "a1", unitPrice: 100, vatCategory: "Z", vatRate: 15 },
    ]);
    assert.equal(bill.lines[0].vatRate, 0);
    assert.equal(bill.lines[0].vatAmount, 0);
  });

  test("a standard-rated line with no rate is at 15%", () => {
    const bill = computeBill([{ description: "A", accountId: "a1", unitPrice: 100, vatCategory: "S" }]);
    assert.equal(bill.lines[0].vatRate, 15);
    assert.equal(bill.lines[0].vatAmount, 15);
  });

  test("the cost centre and account stay with their line", () => {
    const bill = computeBill([
      { description: "A", accountId: "a1", unitPrice: 10, vatCategory: "O", propertyId: " p1 ", unitId: "" },
    ]);
    assert.equal(bill.lines[0].accountId, "a1");
    assert.equal(bill.lines[0].propertyId, "p1");
    assert.equal(bill.lines[0].unitId, null);
  });

  test("a quantity of zero or a discount above the lines is refused", () => {
    assert.throws(
      () => computeBill([{ description: "A", accountId: "a", quantity: 0, unitPrice: 1, vatCategory: "S" }]),
      VatInputError,
    );
    assert.throws(
      () => computeBill([{ description: "A", accountId: "a", unitPrice: 10, vatCategory: "S" }], 11),
      VatInputError,
    );
  });
});

describe("the due day", () => {
  const day = new Date("2026-10-04T00:00:00.000Z");
  test("is the bill's day plus the supplier's terms", () => {
    assert.equal(dueDateFor(day, 30).toISOString().slice(0, 10), "2026-11-03");
    assert.equal(dueDateFor(day, 0).toISOString().slice(0, 10), "2026-10-04");
  });
  test("with no terms it is due on its day", () => {
    assert.equal(dueDateFor(day, null).toISOString().slice(0, 10), "2026-10-04");
    assert.equal(dueDateFor(day, undefined).toISOString().slice(0, 10), "2026-10-04");
    assert.equal(dueDateFor(day, -5).toISOString().slice(0, 10), "2026-10-04");
  });
});

describe("what is left to pay", () => {
  test("is the total less what was paid, never below zero", () => {
    assert.equal(balanceOf(1150, 0), 1150);
    assert.equal(balanceOf(1150, 150.25), 999.75);
    assert.equal(balanceOf(100, 100), 0);
    assert.equal(balanceOf(100, 120), 0);
  });

  test("the status follows the payments", () => {
    assert.equal(statusAfterPayment(1150, 0), "approved");
    assert.equal(statusAfterPayment(1150, 0.01), "partially_paid");
    assert.equal(statusAfterPayment(1150, 1149.99), "partially_paid");
    assert.equal(statusAfterPayment(1150, 1150), "paid");
  });

  test("a bill is overdue once it is past due with something left", () => {
    const today = new Date("2026-10-10T00:00:00.000Z");
    const due = (day: string) => new Date(`${day}T00:00:00.000Z`);
    const base = { status: "approved", totalAmount: 100, amountPaid: 0 };
    assert.equal(isOverdue({ ...base, dueDate: due("2026-10-09") }, today), true);
    assert.equal(isOverdue({ ...base, dueDate: due("2026-10-10") }, today), false);
    assert.equal(isOverdue({ ...base, dueDate: due("2026-10-09"), amountPaid: 100, status: "paid" }, today), false);
    assert.equal(isOverdue({ ...base, dueDate: due("2026-10-09"), status: "pending" }, today), false);
  });
});

describe("what can be done to a bill", () => {
  test("only a pending bill is edited or approved", () => {
    assert.equal(canEditBill("pending"), true);
    assert.equal(canApproveBill("pending"), true);
    for (const status of ["approved", "partially_paid", "paid", "cancelled"]) {
      assert.equal(canEditBill(status), false, status);
      assert.equal(canApproveBill(status), false, status);
    }
  });

  test("an approved bill nobody paid can be reopened or cancelled", () => {
    assert.equal(canReopenBill("approved", 0), true);
    assert.equal(canCancelBill("approved", 0), true);
    assert.equal(canCancelBill("pending", 0), true);
  });

  test("a bill with money on it cannot", () => {
    assert.equal(canReopenBill("partially_paid", 10), false);
    assert.equal(canReopenBill("approved", 10), false);
    assert.equal(canCancelBill("partially_paid", 10), false);
    assert.equal(canCancelBill("paid", 100), false);
    assert.equal(canCancelBill("cancelled", 0), false);
  });

  test("only an approved bill with something left is paid", () => {
    assert.equal(canPayBill("approved"), true);
    assert.equal(canPayBill("partially_paid"), true);
    for (const status of ["pending", "paid", "cancelled"]) assert.equal(canPayBill(status), false, status);
  });
});

describe("allocating a voucher", () => {
  const bills: AllocatableBill[] = [
    { id: "b1", supplierId: "s1", status: "approved", totalAmount: 1000, amountPaid: 0 },
    { id: "b2", supplierId: "s1", status: "partially_paid", totalAmount: 500, amountPaid: 200 },
    { id: "b3", supplierId: "s2", status: "approved", totalAmount: 300, amountPaid: 0 },
    { id: "b4", supplierId: "s1", status: "pending", totalAmount: 300, amountPaid: 0 },
    { id: "b5", supplierId: "s1", status: "paid", totalAmount: 300, amountPaid: 300 },
  ];
  const check = (voucherAmount: number, allocations: Array<{ billId: string; amount: number }>) =>
    checkAllocations({ voucherAmount, supplierId: "s1", allocations, bills });

  test("a voucher may pay bills, part of them, or none", () => {
    assert.equal(check(1300, [{ billId: "b1", amount: 1000 }, { billId: "b2", amount: 300 }]), null);
    assert.equal(check(500, [{ billId: "b1", amount: 400 }]), null);
    assert.equal(check(500, []), null);
  });

  test("never more than the voucher is worth", () => {
    assert.equal(check(100, [{ billId: "b1", amount: 100.01 }])?.code, "PURCHASE_ALLOCATION_EXCEEDS_VOUCHER");
  });

  test("never more than is left on the bill", () => {
    assert.equal(check(2000, [{ billId: "b2", amount: 300.01 }])?.code, "PURCHASE_ALLOCATION_EXCEEDS_BALANCE");
    assert.equal(check(2000, [{ billId: "b2", amount: 300 }]), null);
  });

  test("only the supplier's own, owed, bills", () => {
    assert.equal(check(300, [{ billId: "b3", amount: 300 }])?.code, "PURCHASE_ALLOCATION_WRONG_SUPPLIER");
    assert.equal(check(300, [{ billId: "b4", amount: 300 }])?.code, "PURCHASE_ALLOCATION_NOT_PAYABLE");
    assert.equal(check(300, [{ billId: "b5", amount: 1 }])?.code, "PURCHASE_ALLOCATION_NOT_PAYABLE");
    assert.equal(check(300, [{ billId: "nope", amount: 1 }])?.code, "PURCHASE_ALLOCATION_BILL_MISSING");
  });

  test("amounts above zero with at most two decimals, a bill once", () => {
    assert.equal(check(300, [{ billId: "b1", amount: 0 }])?.code, "PURCHASE_ALLOCATION_AMOUNT");
    assert.equal(check(300, [{ billId: "b1", amount: -5 }])?.code, "PURCHASE_ALLOCATION_AMOUNT");
    assert.equal(check(300, [{ billId: "b1", amount: 10.005 }])?.code, "PURCHASE_ALLOCATION_AMOUNT");
    assert.equal(check(300, [{ billId: "b1", amount: Number.NaN }])?.code, "PURCHASE_ALLOCATION_AMOUNT");
    assert.equal(
      check(300, [{ billId: "b1", amount: 10 }, { billId: "b1", amount: 10 }])?.code,
      "PURCHASE_ALLOCATION_DUPLICATE",
    );
  });

  test("the refusal names the bill", () => {
    assert.equal(check(300, [{ billId: "b3", amount: 300 }])?.billId, "b3");
  });
});

describe("suggesting what to pay", () => {
  const due = (day: string) => new Date(`${day}T00:00:00.000Z`);
  const open = [
    { id: "late", dueDate: due("2026-09-01"), totalAmount: 400, amountPaid: 100 },
    { id: "soon", dueDate: due("2026-10-20"), totalAmount: 250, amountPaid: 0 },
    { id: "later", dueDate: due("2026-11-20"), totalAmount: 900, amountPaid: 0 },
  ];

  test("pays the oldest due first, each up to what is left", () => {
    assert.deepEqual(suggestAllocations(500, open), [
      { billId: "late", amount: 300 },
      { billId: "soon", amount: 200 },
    ]);
  });

  test("an amount above everything owed leaves the rest unallocated", () => {
    assert.deepEqual(
      suggestAllocations(5000, open).map((entry) => entry.amount),
      [300, 250, 900],
    );
  });

  test("a small amount pays part of the oldest", () => {
    assert.deepEqual(suggestAllocations(0.5, open), [{ billId: "late", amount: 0.5 }]);
  });

  test("nothing to spend, nothing allocated", () => {
    assert.deepEqual(suggestAllocations(0, open), []);
    assert.deepEqual(suggestAllocations(100, []), []);
  });
});
