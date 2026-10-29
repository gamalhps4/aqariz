/**
 * A requested id or filter narrows the caller's scope. It never replaces it,
 * and the scope never replaces it.
 *
 * The easy mistake is the one over forty call sites made: spreading the scope
 * into the same object literal as the request's own keys. For an owner, and
 * for an employee narrowed to a few buildings, the building scope is keyed on
 * `id` — the very column a single-record route filters on — so whichever was
 * written second won. The first two tests below are that mistake, kept so the
 * fixture is seen to tell the two apart; the rest is what the helpers do
 * instead.
 *
 * Asserted as the rows a query returns from a fixture, not as the shape of
 * its `where`: "returned more than it should" only shows when you count.
 *
 * The scopes are written out here in the shapes lib/db/scopes.ts makes them.
 * That module is server-only and reaches the database, so it cannot be
 * imported by a test; scripts/verify-staff-scope.ts covers the real thing
 * against a real one.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { applyScope, withScope } from "@/lib/db/scope-where";
import { rowsMatching } from "@/lib/testing/where-matcher";

// Two buildings in compound A, one in compound B.
const buildings = [
  {
    id: "a1",
    compoundId: "A",
    ownerId: "owner-1",
    deletedAt: null,
    leases: [{ tenantId: "tenant-1", status: "active", deletedAt: null }],
  },
  {
    id: "a2",
    compoundId: "A",
    ownerId: "owner-1",
    deletedAt: new Date("2026-09-01T00:00:00.000Z"),
    leases: [],
  },
  {
    id: "b1",
    compoundId: "B",
    ownerId: "owner-2",
    deletedAt: null,
    leases: [{ tenantId: "tenant-2", status: "active", deletedAt: null }],
  },
];

// One contract per building.
const leases = [
  { id: "lease-a1", propertyId: "a1", tenantId: "tenant-1", deletedAt: null },
  { id: "lease-a2", propertyId: "a2", tenantId: "tenant-1", deletedAt: null },
  { id: "lease-b1", propertyId: "b1", tenantId: "tenant-2", deletedAt: null },
];

type Where = Record<string, unknown>;

/** Office staff: no filter at all. */
const unrestricted: Where = {};
/** An owner of, or an employee assigned, the two buildings in compound A. */
const holdsCompoundA: Where = { id: { in: ["a1", "a2"] } };
/** Marked restricted and assigned nothing. */
const holdsNothing: Where = { id: { in: [] } };
/** A tenant reaches a building through a live lease in it. */
const tenantOne: Where = {
  leases: {
    some: { tenantId: "tenant-1", status: { in: ["active"] }, deletedAt: null },
  },
};
/** The same two tiers on a model keyed by foreign key, such as a contract. */
const contractsInCompoundA: Where = { propertyId: { in: ["a1", "a2"] } };
const contractsOfTenantOne: Where = { tenantId: { in: ["tenant-1"] } };

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id);

describe("the spread this replaces", () => {
  test("after a requested id, the scope overwrites the id", () => {
    // `b1` is not this caller's. The lookup succeeds anyway, on a1 — and a
    // route then writes to the `b1` it was asked for.
    const where = { id: "b1", ...holdsCompoundA };
    assert.deepEqual(ids(rowsMatching(buildings, where)), ["a1", "a2"]);
  });

  test("before a requested filter, the filter overwrites the scope", () => {
    const where = { ...contractsInCompoundA, propertyId: "b1" };
    assert.deepEqual(ids(rowsMatching(leases, where)), ["lease-b1"]);
  });
});

describe("withScope: a requested id", () => {
  test("outside the scope matches nothing", () => {
    const where = withScope({ id: "b1" }, holdsCompoundA);
    assert.deepEqual(ids(rowsMatching(buildings, where)), []);
  });

  test("inside the scope matches that row and no other", () => {
    const where = withScope({ id: "a1" }, holdsCompoundA);
    assert.deepEqual(ids(rowsMatching(buildings, where)), ["a1"]);
  });

  test("resolves for office staff, whose scope is no filter", () => {
    const where = withScope({ id: "b1" }, unrestricted);
    assert.deepEqual(ids(rowsMatching(buildings, where)), ["b1"]);
  });

  test("does not resolve for someone assigned nothing", () => {
    // An empty list is a restriction, not the absence of one.
    const where = withScope({ id: "a1" }, holdsNothing);
    assert.deepEqual(ids(rowsMatching(buildings, where)), []);
  });

  test("resolves for a tenant only where they hold a lease", () => {
    assert.deepEqual(
      ids(rowsMatching(buildings, withScope({ id: "a1" }, tenantOne))),
      ["a1"],
    );
    assert.deepEqual(
      ids(rowsMatching(buildings, withScope({ id: "b1" }, tenantOne))),
      [],
    );
  });
});

describe("withScope: a requested list", () => {
  test("is cut down to the ids in scope, not widened to the whole scope", () => {
    // The bulk routes: asked for a1 and b1, holding a1 and a2. Spread, this
    // acted on a1 *and a2* — every building the caller held.
    const where = withScope({ id: { in: ["a1", "b1"] } }, holdsCompoundA);
    assert.deepEqual(ids(rowsMatching(buildings, where)), ["a1"]);
  });

  test("keeps the other conditions it was given", () => {
    const where = withScope(
      { id: { in: ["a1", "a2", "b1"] }, deletedAt: null },
      holdsCompoundA,
    );
    assert.deepEqual(ids(rowsMatching(buildings, where)), ["a1"]);
  });
});

describe("withScope: a requested filter", () => {
  test("on the column the scope is keyed on narrows to nothing", () => {
    const where = withScope({ propertyId: "b1" }, contractsInCompoundA);
    assert.deepEqual(ids(rowsMatching(leases, where)), []);
  });

  test("inside the scope returns that building's rows alone", () => {
    const where = withScope({ propertyId: "a1" }, contractsInCompoundA);
    assert.deepEqual(ids(rowsMatching(leases, where)), ["lease-a1"]);
  });

  test("cannot move a tenant onto someone else's rows", () => {
    const where = withScope({ tenantId: "tenant-2" }, contractsOfTenantOne);
    assert.deepEqual(ids(rowsMatching(leases, where)), []);
  });

  test("with no filter at all is the caller's whole scope", () => {
    const where = withScope({}, contractsInCompoundA);
    assert.deepEqual(ids(rowsMatching(leases, where)), ["lease-a1", "lease-a2"]);
  });
});

describe("withScope: the clause it builds", () => {
  test("keeps the caller's own keys at the top level", () => {
    // Where the soft-delete filter looks for `deletedAt`: naming it there,
    // even as undefined, is how a query asks for archived rows too.
    const where = withScope({ id: "a2", deletedAt: undefined }, holdsCompoundA);
    assert.equal("deletedAt" in where, true);
    assert.deepEqual(where, {
      id: "a2",
      deletedAt: undefined,
      AND: [holdsCompoundA],
    });
    assert.deepEqual(ids(rowsMatching(buildings, where)), ["a2"]);
  });

  test("adds to the clauses already AND-ed on, as a list or as one", () => {
    const listed = withScope(
      { AND: [{ compoundId: "A" }, { deletedAt: null }] },
      holdsCompoundA,
    );
    assert.deepEqual(listed.AND, [
      { compoundId: "A" },
      { deletedAt: null },
      holdsCompoundA,
    ]);
    assert.deepEqual(ids(rowsMatching(buildings, listed)), ["a1"]);

    const single = withScope({ AND: { ownerId: "owner-2" } }, holdsCompoundA);
    assert.deepEqual(single.AND, [{ ownerId: "owner-2" }, holdsCompoundA]);
    assert.deepEqual(ids(rowsMatching(buildings, single)), []);
  });

  test("adds nothing for an unrestricted scope, and still hands back a copy", () => {
    const where = { id: "b1", deletedAt: undefined };
    const scoped = withScope(where, unrestricted);
    assert.deepEqual(scoped, where);
    assert.equal("AND" in scoped, false);
    assert.equal("deletedAt" in scoped, true);
    assert.notEqual(scoped, where);
  });

  test("leaves the where and the scope it was given untouched", () => {
    const where: Where = { id: "a1", AND: [{ deletedAt: null }] };
    const scope: Where = { id: { in: ["a1"] } };
    withScope(where, scope);
    assert.deepEqual(where, { id: "a1", AND: [{ deletedAt: null }] });
    assert.deepEqual(scope, { id: { in: ["a1"] } });
  });
});

describe("applyScope", () => {
  test("narrows a where in place", () => {
    const where: Where = { id: "b1" };
    applyScope(where, holdsCompoundA);
    assert.deepEqual(where, { id: "b1", AND: [holdsCompoundA] });
    assert.deepEqual(ids(rowsMatching(buildings, where)), []);
  });

  test("cannot be undone by a filter assigned after it", () => {
    // The list routes: scope first, then `where.propertyId = …` from the
    // query string.
    const where: Where = { deletedAt: null };
    applyScope(where, contractsInCompoundA);
    where.propertyId = "b1";
    assert.deepEqual(ids(rowsMatching(leases, where)), []);

    where.propertyId = "a2";
    assert.deepEqual(ids(rowsMatching(leases, where)), ["lease-a2"]);
  });

  test("adds to the clauses already AND-ed on, as a list or as one", () => {
    const listed: Where = { AND: [{ compoundId: "A" }] };
    applyScope(listed, holdsCompoundA);
    assert.deepEqual(listed.AND, [{ compoundId: "A" }, holdsCompoundA]);

    const single: Where = { AND: { compoundId: "B" } };
    applyScope(single, holdsCompoundA);
    assert.deepEqual(single.AND, [{ compoundId: "B" }, holdsCompoundA]);
    assert.deepEqual(ids(rowsMatching(buildings, single)), []);
  });

  test("leaves a staff query exactly as it was", () => {
    const where: Where = { id: "b1" };
    applyScope(where, unrestricted);
    assert.deepEqual(where, { id: "b1" });
  });

  test("treats someone assigned nothing as restricted", () => {
    const where: Where = {};
    applyScope(where, holdsNothing);
    assert.deepEqual(ids(rowsMatching(buildings, where)), []);
  });
});
