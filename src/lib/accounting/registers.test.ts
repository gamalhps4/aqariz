/**
 * The registers draw their rows from several tables; a page of one is the
 * merge of the sources' own pages, in one order — the one the database reads
 * each source in.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { compareRegisterRows, mergeRegisterRows, type RegisterOrdering } from "./registers";

const at = (day: string, time = "00:00:00.000") => `${day}T${time}Z`;
const row = (instant: string, rank: number, id: string, kind = "x"): RegisterOrdering & { id: string } => ({
  at: instant,
  rank,
  key: `${kind}:${id}`,
  id,
});

describe("the order", () => {
  test("by instant, then an invoice before the receipt that paid it, then by id", () => {
    const rows = [
      row(at("2026-10-02"), 2, "r2", "receipt"),
      row(at("2026-10-02"), 0, "i10", "invoice"),
      row(at("2026-10-01"), 2, "r1", "receipt"),
      row(at("2026-10-02"), 0, "i09", "invoice"),
      row(at("2026-10-02", "09:30:00.000"), 0, "i11", "invoice"),
    ];
    const ascending = [...rows].sort((a, b) => compareRegisterRows(a, b, "asc")).map((entry) => entry.id);
    assert.deepEqual(ascending, ["r1", "i09", "i10", "r2", "i11"]);
    const descending = [...rows].sort((a, b) => compareRegisterRows(a, b, "desc")).map((entry) => entry.id);
    assert.deepEqual(descending, [...ascending].reverse());
  });

  test("rows that tie on everything but the id still have one order", () => {
    const a = row(at("2026-10-01"), 0, "a");
    const b = row(at("2026-10-01"), 0, "b");
    assert.equal(compareRegisterRows(a, b, "asc"), -compareRegisterRows(b, a, "asc"));
    assert.notEqual(compareRegisterRows(a, b, "asc"), 0);
    assert.equal(compareRegisterRows(a, a, "asc"), 0);
  });

  test("ids compare as the database sorts a cuid: digits before letters, by code unit", () => {
    const rows = [row(at("2026-10-01"), 0, "cm9z"), row(at("2026-10-01"), 0, "cm10"), row(at("2026-10-01"), 0, "cma1")];
    assert.deepEqual(
      rows.sort((a, b) => compareRegisterRows(a, b, "asc")).map((entry) => entry.id),
      ["cm10", "cm9z", "cma1"],
    );
  });
});

describe("a page of several sources", () => {
  const invoices = [
    row(at("2026-10-05"), 0, "i5"),
    row(at("2026-10-03"), 0, "i3"),
    row(at("2026-10-01"), 0, "i1"),
  ];
  const receipts = [row(at("2026-10-04"), 2, "r4"), row(at("2026-10-02"), 2, "r2")];

  test("is cut from the merge of them all, newest first", () => {
    assert.deepEqual(
      mergeRegisterRows([invoices, receipts], "desc", 0, 3).map((entry) => entry.id),
      ["i5", "r4", "i3"],
    );
  });

  test("the next page carries on where the last stopped", () => {
    assert.deepEqual(
      mergeRegisterRows([invoices, receipts], "desc", 3, 3).map((entry) => entry.id),
      ["r2", "i1"],
    );
  });

  test("oldest first", () => {
    assert.deepEqual(
      mergeRegisterRows([invoices, receipts], "asc", 0, 10).map((entry) => entry.id),
      ["i1", "r2", "i3", "r4", "i5"],
    );
  });

  test("every row is on exactly one page, whichever the page size", () => {
    const all = mergeRegisterRows([invoices, receipts], "desc", 0, 100).map((entry) => entry.id);
    for (const size of [1, 2, 3, 4]) {
      const pages: string[] = [];
      for (let skip = 0; skip < all.length; skip += size) {
        // Each source is read up to the end of the page, as the service does.
        const reach = skip + size;
        pages.push(
          ...mergeRegisterRows([invoices.slice(0, reach), receipts.slice(0, reach)], "desc", skip, size).map(
            (entry) => entry.id,
          ),
        );
      }
      assert.deepEqual(pages, all, `page size ${size}`);
    }
  });

  test("a page past the end is empty, and no source at all is nothing", () => {
    assert.deepEqual(mergeRegisterRows([invoices, receipts], "desc", 10, 5), []);
    assert.deepEqual(mergeRegisterRows([], "desc", 0, 5), []);
    assert.deepEqual(mergeRegisterRows([[], []], "desc", 0, 5), []);
  });

  test("does not change the sources it was given", () => {
    const before = invoices.map((entry) => entry.id);
    mergeRegisterRows([invoices, receipts], "asc", 0, 2);
    assert.deepEqual(
      invoices.map((entry) => entry.id),
      before,
    );
  });
});
