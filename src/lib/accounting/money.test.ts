/**
 * The ledger's arithmetic and input readers: halalas, splits to the halala,
 * amounts as an accountant types them, and opening balances from a CSV.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  allocateProportionally,
  halalasToDecimal,
  proportionOf,
  toHalalas,
} from "./money";
import { checkJournalLines, parseAmount } from "./journal-validation";
import { parseOpeningBalancesCsv } from "./opening-csv";
import { receiptAccountKey, disbursementAccountKey } from "./posting/methods";

describe("halalas", () => {
  test("money in and out is exact", () => {
    assert.equal(toHalalas(0.29), 29);
    assert.equal(toHalalas("1234.56"), 123_456);
    assert.equal(toHalalas({ toString: () => "10.10" }), 1_010);
    assert.equal(toHalalas(null), 0);
    assert.equal(toHalalas("junk"), 0);
    assert.equal(halalasToDecimal(123_456), "1234.56");
    assert.equal(halalasToDecimal(5), "0.05");
    assert.equal(halalasToDecimal(-1_050), "-10.50");
  });

  test("a split always adds back up", () => {
    assert.deepEqual(allocateProportionally(100_000, [1, 1, 1]), [33_334, 33_333, 33_333]);
    assert.deepEqual(allocateProportionally(1, [1, 1]), [1, 0]);
    assert.deepEqual(allocateProportionally(10, [0, 0]), [5, 5]);
    assert.deepEqual(allocateProportionally(-10, [1, 3]), [-3, -7]);
    const parts = allocateProportionally(99_999, [3, 7, 11, 13]);
    assert.equal(parts.reduce((sum, part) => sum + part, 0), 99_999);
  });

  test("a proportion rounds to the halala", () => {
    assert.equal(proportionOf(1_000, 1, 3), 333);
    assert.equal(proportionOf(1_000, 3, 3), 1_000);
    assert.equal(proportionOf(1_000, 0, 3), 0);
    assert.equal(proportionOf(1_000, 1, 0), 0);
  });
});

describe("amounts as typed", () => {
  test("reads separators and Arabic digits, refuses garbage", () => {
    assert.equal(parseAmount("1,250.50"), 125_050);
    assert.equal(parseAmount("١٬٢٥٠٫٥"), 125_050);
    assert.equal(parseAmount(""), null);
    assert.equal(parseAmount(null), null);
    assert.ok(Number.isNaN(parseAmount("-5")));
    assert.ok(Number.isNaN(parseAmount("12abc")));
    assert.ok(Number.isNaN(parseAmount(1.005)));
  });

  test("the journal check reports the difference as it is typed", () => {
    const check = checkJournalLines([
      { accountId: "a", debit: "100" },
      { accountId: "b", credit: "60" },
      { accountId: null, debit: null, credit: null },
    ]);
    assert.equal(check.difference, 4_000);
    assert.equal(check.balanced, false);
    assert.deepEqual(check.issues.map((issue) => issue.code), ["UNBALANCED"]);
  });

  test("an empty spare row is ignored, a half-filled one is not", () => {
    const check = checkJournalLines([
      { accountId: "a", debit: "100" },
      { accountId: "b", credit: "100" },
      { accountId: "c" },
    ]);
    assert.deepEqual(check.issues.map((issue) => issue.code), ["LINE_NO_AMOUNT"]);
  });
});

describe("opening balances from a CSV", () => {
  test("an English header in any order", () => {
    const parsed = parseOpeningBalancesCsv(
      "debit,code,credit,memo\n50000,110102,,Bank at cut-over\n,210201,30000,\"Owners, total\"\n",
    );
    assert.deepEqual(parsed.errors, []);
    assert.equal(parsed.rows.length, 2);
    assert.equal(parsed.rows[0].code, "110102");
    assert.equal(parsed.rows[0].debit, "50000");
    assert.equal(parsed.rows[1].credit, "30000");
    assert.equal(parsed.rows[1].memo, "Owners, total");
  });

  test("an Arabic header with semicolons", () => {
    const parsed = parseOpeningBalancesCsv("رمز الحساب;مدين;دائن\n110101;2500;\n");
    assert.equal(parsed.rows.length, 1);
    assert.equal(parsed.rows[0].code, "110101");
    assert.equal(parsed.rows[0].debit, "2500");
  });

  test("no header: code, debit, credit", () => {
    const parsed = parseOpeningBalancesCsv("110101,100,\n,50,\n");
    assert.equal(parsed.rows.length, 1);
    assert.deepEqual(parsed.errors, [{ line: 2, code: "MISSING_CODE" }]);
  });
});

describe("payment methods", () => {
  test("money out leaves the cash box for cash, else the bank", () => {
    assert.equal(disbursementAccountKey("cash"), "cash_on_hand");
    assert.equal(disbursementAccountKey("bank_transfer"), "bank");
    assert.equal(disbursementAccountKey(null), "bank");
  });

  test("an unknown method is taken to be the bank", () => {
    assert.equal(receiptAccountKey("manual"), "bank");
    assert.equal(receiptAccountKey(undefined), "bank");
    assert.equal(receiptAccountKey(undefined, { online: true }), "gateway_clearing");
  });
});
