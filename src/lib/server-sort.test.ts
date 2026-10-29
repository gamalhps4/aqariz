import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { keepSorted, parseSortValue } from "./server-sort";
import { nextSort } from "./table-sort";

describe("keepSorted", () => {
  test("another column starts ascending, as the header proposed", () => {
    assert.deepEqual(
      keepSorted({ key: "date", direction: "desc" }, { key: "amount", direction: "asc" }),
      { key: "amount", direction: "asc" },
    );
  });

  test("the sorted column turns around instead of going back to no order", () => {
    const current = { key: "date", direction: "desc" as const };
    assert.deepEqual(keepSorted(current, nextSort(current, "date")), {
      key: "date",
      direction: "asc",
    });
    const ascending = { key: "date", direction: "asc" as const };
    assert.deepEqual(keepSorted(ascending, nextSort(ascending, "date")), {
      key: "date",
      direction: "desc",
    });
  });
});

describe("parseSortValue", () => {
  test("splits a combined sort value at its last dash", () => {
    assert.deepEqual(parseSortValue("name-asc"), { key: "name", direction: "asc" });
    assert.deepEqual(parseSortValue("createdAt-desc"), { key: "createdAt", direction: "desc" });
    assert.deepEqual(parseSortValue("processedAt-asc"), { key: "processedAt", direction: "asc" });
  });

  test("anything but asc reads as descending", () => {
    assert.deepEqual(parseSortValue("users-desc"), { key: "users", direction: "desc" });
    assert.deepEqual(parseSortValue("name-sideways"), { key: "name", direction: "desc" });
    assert.deepEqual(parseSortValue("name"), { key: "name", direction: "desc" });
  });
});
