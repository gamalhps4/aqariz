import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import {
  compareSortValues,
  nextSort,
  nodeText,
  sortRows,
  textDate,
  textSortValue,
} from "./table-sort";

describe("nodeText", () => {
  test("collects the strings and numbers of a rendered cell", () => {
    const cell = createElement(
      "div",
      null,
      createElement("span", null, "Unit "),
      createElement("strong", null, 12),
      false,
      null,
    );
    assert.equal(nodeText(cell).replace(/\s+/g, " ").trim(), "Unit 12");
    assert.equal(nodeText(["a", ["b", 3]]), "a b 3");
    assert.equal(nodeText(undefined), "");
  });
});

describe("textSortValue", () => {
  test("amounts become numbers", () => {
    assert.equal(textSortValue("4,750.00"), 4750);
    assert.equal(textSortValue("﷼ 4,750"), 4750);
    assert.equal(textSortValue("SAR 29"), 29);
    assert.equal(textSortValue("21.7%"), 21.7);
    assert.equal(textSortValue("١٢٬٥٠٠"), 12500);
    assert.equal(textSortValue("-3"), -3);
  });

  test("a cell that starts with money sorts by it", () => {
    assert.equal(textSortValue("﷼500.00 إيجار"), 500);
    assert.equal(textSortValue("﷼12,000.00 متبقٍ ﷼4,000.00"), 12000);
    assert.equal(textSortValue("4,750.00 rent"), 4750);
    assert.equal(textSortValue("12 Main Street"), "12 Main Street");
    assert.equal(textSortValue("2026 Plan"), "2026 Plan");
  });

  test("anything else stays text, and blanks are empty", () => {
    assert.equal(textSortValue("A101"), "A101");
    assert.equal(textSortValue("101B"), "101B");
    assert.equal(textSortValue("29 ر.س"), 29);
    assert.equal(textSortValue("$29"), 29);
    assert.equal(textSortValue("  سارة   الحربي "), "سارة الحربي");
    assert.equal(textSortValue("   "), null);
  });
});

describe("textDate", () => {
  const iso = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;

  test("the ways the app writes a day", () => {
    assert.equal(iso(textDate("1 نوفمبر 2026")), "2026-11-01");
    assert.equal(iso(textDate("15 أكتوبر 2026 15 أيام")), "2026-10-15");
    assert.equal(iso(textDate("Nov 1, 2026")), "2026-11-01");
    assert.equal(iso(textDate("1 Nov 2026")), "2026-11-01");
    assert.equal(iso(textDate("2026-11-01")), "2026-11-01");
    assert.equal(iso(textDate("01/11/2026")), "2026-11-01");
    assert.equal(iso(textDate("٠١/١١/٢٠٢٦")), "2026-11-01");
  });

  test("not a day", () => {
    assert.equal(textDate("31/02/2026"), null);
    assert.equal(textDate("سارة الحربي"), null);
    assert.equal(textDate("4,750.00"), null);
    assert.equal(textDate("A101"), null);
  });

  test("dates sort by day, not by month name", () => {
    const sorted = sortRows(
      ["1 نوفمبر 2026", "15 أكتوبر 2026", "2 يناير 2027"],
      (text) => textSortValue(text),
      "asc",
      "ar",
    );
    assert.deepEqual(sorted, ["15 أكتوبر 2026", "1 نوفمبر 2026", "2 يناير 2027"]);
  });
});

describe("compareSortValues", () => {
  test("numbers, dates and text each in their own order", () => {
    assert.ok(compareSortValues(2, 10) < 0);
    assert.ok(compareSortValues(new Date("2026-01-02"), new Date("2025-12-31")) > 0);
    // Numeric collation: "Unit 2" before "Unit 10".
    assert.ok(compareSortValues("Unit 2", "Unit 10") < 0);
    assert.ok(compareSortValues("أحمد", "سارة", "ar") < 0);
  });

  test("empties go last", () => {
    assert.ok(compareSortValues(null, 1) > 0);
    assert.ok(compareSortValues("a", undefined) < 0);
    assert.equal(compareSortValues(null, ""), 0);
  });
});

describe("sortRows", () => {
  const rows = [
    { name: "b", amount: 20 },
    { name: "a", amount: null },
    { name: "c", amount: 5 },
    { name: "d", amount: 20 },
  ];

  test("ascending and descending, empties last both ways, ties keep order", () => {
    const asc = sortRows(rows, (row) => row.amount, "asc").map((row) => row.name);
    assert.deepEqual(asc, ["c", "b", "d", "a"]);
    const desc = sortRows(rows, (row) => row.amount, "desc").map((row) => row.name);
    assert.deepEqual(desc, ["b", "d", "c", "a"]);
  });

  test("does not touch the original array", () => {
    const copy = [...rows];
    sortRows(rows, (row) => row.name, "desc");
    assert.deepEqual(rows, copy);
  });
});

describe("nextSort", () => {
  test("asc, desc, then off; another column starts at asc", () => {
    const off = { key: null, direction: "asc" as const };
    const one = nextSort(off, "name");
    assert.deepEqual(one, { key: "name", direction: "asc" });
    const two = nextSort(one, "name");
    assert.deepEqual(two, { key: "name", direction: "desc" });
    assert.deepEqual(nextSort(two, "name"), off);
    assert.deepEqual(nextSort(two, "amount"), { key: "amount", direction: "asc" });
  });

  test("a server-sorted table can keep a column on", () => {
    assert.deepEqual(
      nextSort({ key: "name", direction: "desc" }, "name", false),
      { key: "name", direction: "asc" },
    );
  });
});
