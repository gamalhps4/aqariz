/**
 * A bill and a voucher print under a number of their own, and a search can
 * name one.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { formatBillNumber, formatVoucherNumber, parseBillNumber, parseVoucherNumber } from "./numbers";

describe("formatting", () => {
  test("pads to six digits and keeps longer numbers whole", () => {
    assert.equal(formatBillNumber(12), "BILL-000012");
    assert.equal(formatVoucherNumber(45), "PV-000045");
    assert.equal(formatBillNumber(1234567), "BILL-1234567");
  });

  test("no number, no text", () => {
    for (const value of [null, undefined, 0, -1, 1.5]) {
      assert.equal(formatBillNumber(value), null);
      assert.equal(formatVoucherNumber(value), null);
    }
  });
});

describe("a search for a number", () => {
  test("every way of writing it means the same bill", () => {
    for (const text of ["BILL-000012", "bill 12", "Bill-12", "#12", "12", "000012", " 12 "]) {
      assert.equal(parseBillNumber(text), 12, text);
    }
    for (const text of ["PV-000045", "pv 45", "PV-45", "#45", "45"]) {
      assert.equal(parseVoucherNumber(text), 45, text);
    }
  });

  test("a name, a phone number or another prefix is not a number", () => {
    for (const text of ["Al Noor", "+966501234567", "PV-12", "INV-77", "", "0", null, undefined]) {
      assert.equal(parseBillNumber(text), null, String(text));
    }
    assert.equal(parseVoucherNumber("BILL-12"), null);
  });
});
