/**
 * The instrument the scope tests measure with.
 *
 * Those tests say "this query returns no rows". That is only worth anything
 * if the thing doing the matching can tell rows apart — and, above all, if it
 * refuses a condition it cannot read instead of quietly calling it a miss.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { matchesWhere, rowsMatching } from "@/lib/testing/where-matcher";

const lease = {
  id: "l1",
  tenantId: "t1",
  propertyId: "a1",
  status: "active",
  endDate: new Date("2026-12-31T00:00:00.000Z"),
  terminatedDate: null,
  deletedAt: null,
  property: { ownerId: "o1", compoundId: null },
  invoices: [
    { id: "i1", status: "paid" },
    { id: "i2", status: "issued" },
  ],
};

describe("a column", () => {
  test("matches by equality, by null and by list", () => {
    assert.equal(matchesWhere(lease, { status: "active" }), true);
    assert.equal(matchesWhere(lease, { status: "expired" }), false);
    assert.equal(matchesWhere(lease, { deletedAt: null }), true);
    assert.equal(matchesWhere(lease, { terminatedDate: { not: null } }), false);
    assert.equal(matchesWhere(lease, { propertyId: { in: ["a1", "a2"] } }), true);
    assert.equal(matchesWhere(lease, { propertyId: { in: [] } }), false);
    assert.equal(matchesWhere(lease, { id: { notIn: ["l2"] } }), true);
    assert.equal(matchesWhere(lease, { terminatedDate: { notIn: [] } }), true);
    assert.equal(matchesWhere(lease, { status: { not: "active" } }), false);
  });

  test("compares dates by the instant they name", () => {
    const before = new Date("2026-12-30T00:00:00.000Z");
    const same = new Date("2026-12-31T00:00:00.000Z");
    assert.equal(matchesWhere(lease, { endDate: { gte: before } }), true);
    assert.equal(matchesWhere(lease, { endDate: { lt: same } }), false);
    assert.equal(matchesWhere(lease, { endDate: { gte: same, lte: same } }), true);
    assert.equal(matchesWhere(lease, { endDate: same }), true);
  });

  test("set to undefined is no condition, as in Prisma", () => {
    assert.equal(matchesWhere(lease, { status: undefined }), true);
    assert.equal(
      matchesWhere(lease, { deletedAt: undefined, propertyId: "a1" }),
      true,
    );
  });
});

describe("conditions together", () => {
  test("every key of a where has to hold", () => {
    assert.equal(
      matchesWhere(lease, { status: "active", propertyId: "b1" }),
      false,
    );
  });

  test("AND holds when every clause does, as a list or as one clause", () => {
    assert.equal(
      matchesWhere(lease, {
        AND: [{ status: "active" }, { propertyId: { in: ["a1"] } }],
      }),
      true,
    );
    assert.equal(
      matchesWhere(lease, { AND: [{ status: "active" }, { propertyId: "b1" }] }),
      false,
    );
    assert.equal(matchesWhere(lease, { AND: { propertyId: "b1" } }), false);
  });

  test("OR holds when any clause does, and an empty OR never", () => {
    assert.equal(
      matchesWhere(lease, { OR: [{ status: "expired" }, { tenantId: "t1" }] }),
      true,
    );
    assert.equal(matchesWhere(lease, { OR: [] }), false);
  });

  test("NOT holds when no clause does", () => {
    assert.equal(matchesWhere(lease, { NOT: { status: "expired" } }), true);
    assert.equal(matchesWhere(lease, { NOT: [{ status: "active" }] }), false);
  });
});

describe("a relation", () => {
  test("to one row is matched through the row it points at", () => {
    assert.equal(matchesWhere(lease, { property: { ownerId: "o1" } }), true);
    assert.equal(matchesWhere(lease, { property: { ownerId: "o2" } }), false);
  });

  test("to many rows is matched through some, none and every", () => {
    assert.equal(
      matchesWhere(lease, { invoices: { some: { status: "issued" } } }),
      true,
    );
    assert.equal(
      matchesWhere(lease, { invoices: { none: { status: "issued" } } }),
      false,
    );
    assert.equal(
      matchesWhere(lease, { invoices: { every: { status: "paid" } } }),
      false,
    );
  });
});

describe("what it cannot read", () => {
  test("an operator it does not know is an error, not a miss", () => {
    assert.throws(
      () => matchesWhere(lease, { status: { in: ["expired"], mode: "x" } }),
      /"mode" is not supported/,
    );
    assert.throws(
      () => matchesWhere(lease, { status: { contains: "zzz" } }),
      /"contains" is not supported/,
    );
    assert.throws(
      () => matchesWhere(lease, { status: { like: "zzz" } }),
      /cannot read the filter on "status"/,
    );
  });

  test("an operator it does not read is an error on a NULL column too", () => {
    // Not mistaken for a filter on a relation that happens to be absent.
    assert.throws(
      () => matchesWhere(lease, { terminatedDate: { contains: "2026" } }),
      /"contains" is not supported/,
    );
  });

  test("a condition it cannot read is found behind one that already failed", () => {
    assert.throws(
      () => matchesWhere(lease, { status: "expired", unitId: "u1" }),
      /the row has no "unitId"/,
    );
    assert.throws(
      () =>
        matchesWhere(lease, {
          AND: [{ status: "expired" }, { status: { contains: "x" } }],
        }),
      /"contains" is not supported/,
    );
  });

  test("a column the row does not carry is an error, not a miss", () => {
    assert.throws(
      () => matchesWhere(lease, { unitId: "u1" }),
      /the row has no "unitId"/,
    );
  });

  test("an empty filter is an error: it means different things by column", () => {
    assert.throws(() => matchesWhere(lease, { property: {} }), /empty filter/);
  });
});

test("rowsMatching keeps the fixture's order", () => {
  const rows = [
    { id: "a", n: 2 },
    { id: "b", n: 1 },
    { id: "c", n: 2 },
  ];
  assert.deepEqual(
    rowsMatching(rows, { n: 2 }).map((row) => row.id),
    ["a", "c"],
  );
});
