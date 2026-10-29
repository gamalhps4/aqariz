import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BULK_UNITS,
  findNameProblems,
  generateUnitNames,
} from "./bulk-names";

describe("generateUnitNames", () => {
  test("numbers from the starting number", () => {
    assert.deepEqual(
      generateUnitNames({ baseName: "Driver Room", start: 1, count: 3, autoNumber: true }),
      ["Driver Room 1", "Driver Room 2", "Driver Room 3"],
    );
    assert.deepEqual(
      generateUnitNames({ baseName: " غرفة سائق ", start: 7, count: 2, autoNumber: true }),
      ["غرفة سائق 7", "غرفة سائق 8"],
    );
  });

  test("a blank base name gives the bare numbers", () => {
    assert.deepEqual(
      generateUnitNames({ baseName: "", start: 101, count: 2, autoNumber: true }),
      ["101", "102"],
    );
  });

  test("without auto-numbering every row starts as the base name", () => {
    assert.deepEqual(
      generateUnitNames({ baseName: "Shop", start: 1, count: 2, autoNumber: false }),
      ["Shop", "Shop"],
    );
  });

  test("the count is capped and never negative", () => {
    assert.equal(
      generateUnitNames({ baseName: "U", start: 1, count: 10_000, autoNumber: true }).length,
      MAX_BULK_UNITS,
    );
    assert.deepEqual(generateUnitNames({ baseName: "U", start: 1, count: -3, autoNumber: true }), []);
  });
});

describe("findNameProblems", () => {
  test("flags empty, duplicate and already-used names", () => {
    const problems = findNameProblems(
      ["A 1", "", "a 1 ", "B 2", "C 3"],
      ["b 2"],
    );
    assert.equal(problems.get(0), "duplicate");
    assert.equal(problems.get(1), "empty");
    assert.equal(problems.get(2), "duplicate");
    assert.equal(problems.get(3), "exists");
    assert.equal(problems.has(4), false);
  });

  test("a name longer than the column allows is refused", () => {
    assert.equal(findNameProblems(["x".repeat(51)], []).get(0), "too_long");
  });

  test("a clean list has no problems", () => {
    assert.equal(findNameProblems(["1", "2", "3"], ["4"]).size, 0);
  });
});
