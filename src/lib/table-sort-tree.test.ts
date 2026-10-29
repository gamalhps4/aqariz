import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { sortTreeRows } from "./table-sort-tree";

interface Line {
  name: string;
  depth: number;
  amount: number;
}

// Income (heading) > Rent (heading) > Residential, Commercial; Income > Fees;
// Other income (heading) > Interest — depth-first, as the reports send it.
const TREE: Line[] = [
  { name: "Income", depth: 0, amount: 900 },
  { name: "Rent", depth: 1, amount: 700 },
  { name: "Residential", depth: 2, amount: 200 },
  { name: "Commercial", depth: 2, amount: 500 },
  { name: "Fees", depth: 1, amount: 200 },
  { name: "Other income", depth: 0, amount: 50 },
  { name: "Interest", depth: 1, amount: 50 },
];

const names = (rows: Line[]) => rows.map((row) => row.name);
const depth = (row: Line) => row.depth;
const amount = (row: Line) => row.amount;

describe("sortTreeRows", () => {
  test("siblings sort among themselves; each takes its sub-lines along", () => {
    assert.deepEqual(names(sortTreeRows(TREE, depth, amount, "asc")), [
      "Other income",
      "Interest",
      "Income",
      "Fees",
      "Rent",
      "Residential",
      "Commercial",
    ]);
    assert.deepEqual(names(sortTreeRows(TREE, depth, amount, "desc")), [
      "Income",
      "Rent",
      "Commercial",
      "Residential",
      "Fees",
      "Other income",
      "Interest",
    ]);
  });

  test("by name, with the reader's collator", () => {
    assert.deepEqual(names(sortTreeRows(TREE, depth, (row) => row.name, "asc")), [
      "Income",
      "Fees",
      "Rent",
      "Commercial",
      "Residential",
      "Other income",
      "Interest",
    ]);
  });

  test("a flat list sorts as a flat list", () => {
    const flat = TREE.map((row) => ({ ...row, depth: 0 }));
    assert.deepEqual(
      names(sortTreeRows(flat, depth, amount, "asc")),
      ["Other income", "Interest", "Residential", "Fees", "Commercial", "Rent", "Income"],
    );
  });

  test("keeps every row, and an empty list stays empty", () => {
    assert.equal(sortTreeRows(TREE, depth, amount, "desc").length, TREE.length);
    assert.deepEqual(sortTreeRows([], depth, amount, "asc"), []);
  });
});
