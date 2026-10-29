/**
 * Where the next invoice number comes from.
 *
 * It was the count of numbers issued, plus one. The archive's permanent delete
 * leaves gaps, and with more than seven of them below the highest number every
 * attempt the writer allowed itself landed on a number already taken: billing
 * stopped for the organization. Starting from the highest number issued, a gap
 * changes nothing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  INVOICE_NUMBER_ATTEMPTS,
  allocateInvoiceNumber,
  formatInvoiceNumber,
  invoiceSequence,
} from "@/lib/invoice-number";

class NumberTaken extends Error {}

/**
 * An organization's invoice numbers as a set, with an insert that refuses a
 * taken number the way the unique index does.
 */
function ledger(numbers: number[], prefix = "RENT") {
  const taken = new Set(numbers.map((n) => formatInvoiceNumber(prefix, n)));
  let reads = 0;
  return {
    taken,
    get reads() {
      return reads;
    },
    allocation: {
      prefix,
      highest: async () => {
        reads += 1;
        const sequences = [...taken]
          .map((number) => invoiceSequence(number, prefix))
          .filter((sequence): sequence is number => sequence !== null);
        return sequences.length ? Math.max(...sequences) : 0;
      },
      attempt: async (invoiceNumber: string) => {
        if (taken.has(invoiceNumber)) throw new NumberTaken(invoiceNumber);
        taken.add(invoiceNumber);
        return invoiceNumber;
      },
      isNumberTaken: (error: unknown) => error instanceof NumberTaken,
    },
  };
}

describe("the next invoice number", () => {
  test("gaps below the highest number no longer wedge billing", async () => {
    // Twenty numbers issued, 3 to 10 since deleted for good. Twelve remain,
    // so the count pointed at RENT-000013 — and 13 to 20, all eight numbers
    // the writer would try, were taken.
    const issued = [1, 2, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    const book = ledger(issued);
    const number = await allocateInvoiceNumber(book.allocation);
    assert.equal(number, "RENT-000021");

    // The old rule, for contrast: start at the count, plus one.
    const countBased = ledger(issued);
    await assert.rejects(
      allocateInvoiceNumber({
        ...countBased.allocation,
        highest: async () => issued.length,
      }),
      /after 8 attempts/,
    );
  });

  test("the first invoice under a prefix is number one", async () => {
    const book = ledger([]);
    assert.equal(await allocateInvoiceNumber(book.allocation), "RENT-000001");
  });

  test("a number another writer just took is skipped, reading where it left off", async () => {
    const book = ledger([1, 2, 3]);
    let raced = false;
    const number = await allocateInvoiceNumber({
      ...book.allocation,
      attempt: async (invoiceNumber) => {
        // A concurrent run claims 4 and 5 between our read and our insert.
        if (!raced) {
          raced = true;
          book.taken.add("RENT-000004");
          book.taken.add("RENT-000005");
        }
        return book.allocation.attempt(invoiceNumber);
      },
    });
    assert.equal(number, "RENT-000006");
  });

  test("anything but a taken number is passed on, not retried", async () => {
    const book = ledger([1]);
    const periodBilled = new Error("period already invoiced");
    let attempts = 0;
    await assert.rejects(
      allocateInvoiceNumber({
        ...book.allocation,
        attempt: async () => {
          attempts += 1;
          throw periodBilled;
        },
      }),
      (error) => error === periodBilled,
    );
    assert.equal(attempts, 1);
  });

  test("a sequence that keeps moving is reported after the allowed attempts", async () => {
    let attempts = 0;
    await assert.rejects(
      allocateInvoiceNumber({
        prefix: "RENT",
        highest: async () => 0,
        attempt: async () => {
          attempts += 1;
          throw new NumberTaken();
        },
        isNumberTaken: (error) => error instanceof NumberTaken,
      }),
      /after 8 attempts/,
    );
    assert.equal(attempts, INVOICE_NUMBER_ATTEMPTS);
  });
});

describe("reading a number back", () => {
  test("the sequence of a number in this scheme", () => {
    assert.equal(invoiceSequence("RENT-000123", "RENT"), 123);
    assert.equal(invoiceSequence("RENT-1000000", "RENT"), 1_000_000);
    assert.equal(invoiceSequence("SD-000007", "SD"), 7);
  });

  test("numbers written another way are not part of the sequence", () => {
    assert.equal(invoiceSequence("RENT-000123", "SD"), null);
    assert.equal(invoiceSequence("RENTAL-000123", "RENT"), null);
    assert.equal(invoiceSequence("RENT-2026-001", "RENT"), null);
    assert.equal(invoiceSequence("INV-1727712345678", "RENT"), null);
  });

  test("numbers are padded to six digits and grow past them", () => {
    assert.equal(formatInvoiceNumber("RENT", 21), "RENT-000021");
    assert.equal(formatInvoiceNumber("RENT", 1_234_567), "RENT-1234567");
  });
});
