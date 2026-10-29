/**
 * The contract registers take an owner, a compound, a building, a unit, a
 * tenant and a contract — and every one of them narrows what the reader may
 * see. None replaces it.
 *
 * Counted against one small portfolio rather than compared by shape, as the
 * registers' own tests are (lib/reports/report-where.test.ts): compound A
 * holds a1 and a2 (owner-1), compound B holds b1 (owner-2). a1 has two units,
 * let to two tenants; the other two buildings have one each.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  leaseFilterWhere,
  leaseRegisterWhere,
} from "@/lib/report-filters/lease-where";
import { rowsMatching } from "@/lib/testing/where-matcher";
import type { LeaseReportType } from "@/types/lease-report";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

// Read on 1 October 2026, every date days clear of a boundary.
const endOfToday = new Date(2026, 9, 1, 23, 59, 59, 999);

const owns = { a1: "owner-1", a2: "owner-1", b1: "owner-2" } as const;
const sits = { a1: "A", a2: "A", b1: "B" } as const;

/** A contract still running on a building, in a unit, held by a tenant. */
function running(
  id: string,
  propertyId: keyof typeof owns,
  unitId: string,
  tenantId: string,
) {
  return {
    id,
    propertyId,
    unitId,
    tenantId,
    deletedAt: null,
    status: "active",
    startDate: day("2026-01-01"),
    endDate: day("2027-06-30"),
    terminatedDate: null,
    property: { ownerId: owns[propertyId], compoundId: sits[propertyId] },
  };
}

const contracts = [
  running("c-a1-101", "a1", "u-a1-101", "t-1"),
  running("c-a1-102", "a1", "u-a1-102", "t-2"),
  running("c-a2-201", "a2", "u-a2-201", "t-1"),
  running("c-b1-301", "b1", "u-b1-301", "t-3"),
];

// The readers' scopes, in the shapes lib/db/scopes.ts makes them (it cannot be
// imported here — see lib/db/scope-where.test.ts).
const staff = {};
const holdsA = { propertyId: { in: ["a1", "a2"] } };
const holdsNothing = { propertyId: { in: [] } };
const tenantOne = { tenantId: { in: ["t-1"] } };

const listed = (
  filters: Parameters<typeof leaseRegisterWhere>[1],
  scope: Parameters<typeof leaseRegisterWhere>[3],
  type: LeaseReportType = "active",
) =>
  rowsMatching(
    contracts,
    leaseRegisterWhere(type, filters, { endOfToday }, scope),
  ).map((row) => row.id);

describe("the filters on their own", () => {
  test("name nothing when nothing is asked", () => {
    assert.deepEqual(leaseFilterWhere({}), {});
  });

  test("an owner and a compound are one condition on one building", () => {
    // Two relation filters could each be met by a different building.
    assert.deepEqual(leaseFilterWhere({ ownerId: "owner-1", compoundId: "A" }), {
      property: { ownerId: "owner-1", compoundId: "A" },
    });
  });

  test("a contract, a unit and a tenant are columns of the contract", () => {
    assert.deepEqual(
      leaseFilterWhere({ leaseId: "c-1", unitId: "u-1", tenantId: "t-1" }),
      { id: "c-1", unitId: "u-1", tenantId: "t-1" },
    );
  });

  test("an empty value is no filter", () => {
    assert.deepEqual(leaseFilterWhere({ ownerId: "", unitId: "" }), {});
  });
});

describe("each filter narrows the register", () => {
  test("by owner", () => {
    assert.deepEqual(listed({ ownerId: "owner-1" }, staff), [
      "c-a1-101",
      "c-a1-102",
      "c-a2-201",
    ]);
  });

  test("by compound", () => {
    assert.deepEqual(listed({ compoundId: "B" }, staff), ["c-b1-301"]);
  });

  test("by building", () => {
    assert.deepEqual(listed({ propertyId: "a2" }, staff), ["c-a2-201"]);
  });

  test("by unit", () => {
    assert.deepEqual(listed({ unitId: "u-a1-102" }, staff), ["c-a1-102"]);
  });

  test("by tenant", () => {
    assert.deepEqual(listed({ tenantId: "t-1" }, staff), [
      "c-a1-101",
      "c-a2-201",
    ]);
  });

  test("by contract", () => {
    assert.deepEqual(listed({ leaseId: "c-b1-301" }, staff), ["c-b1-301"]);
  });

  test("by several at once, every one holding", () => {
    assert.deepEqual(
      listed({ ownerId: "owner-1", tenantId: "t-1", propertyId: "a2" }, staff),
      ["c-a2-201"],
    );
    // Filters that no contract satisfies together list none.
    assert.deepEqual(listed({ ownerId: "owner-2", tenantId: "t-1" }, staff), []);
    assert.deepEqual(listed({ compoundId: "A", propertyId: "b1" }, staff), []);
  });

  test("with nothing asked, staff get the whole register", () => {
    assert.equal(listed({}, staff).length, contracts.length);
  });
});

describe("a filter never replaces the reader's scope", () => {
  test("asked for a building they do not hold, they get nothing", () => {
    assert.deepEqual(listed({ propertyId: "b1" }, holdsA), []);
  });

  test("asked for a contract, unit, tenant, owner or compound outside it, nothing", () => {
    assert.deepEqual(listed({ leaseId: "c-b1-301" }, holdsA), []);
    assert.deepEqual(listed({ unitId: "u-b1-301" }, holdsA), []);
    assert.deepEqual(listed({ tenantId: "t-3" }, holdsA), []);
    assert.deepEqual(listed({ ownerId: "owner-2" }, holdsA), []);
    assert.deepEqual(listed({ compoundId: "B" }, holdsA), []);
  });

  test("asked for one inside it, they get exactly that", () => {
    assert.deepEqual(listed({ unitId: "u-a1-101" }, holdsA), ["c-a1-101"]);
    assert.deepEqual(listed({ compoundId: "A" }, holdsA), [
      "c-a1-101",
      "c-a1-102",
      "c-a2-201",
    ]);
  });

  test("a reader who holds nothing gets nothing, whatever is asked", () => {
    assert.deepEqual(listed({}, holdsNothing), []);
    assert.deepEqual(listed({ propertyId: "a1" }, holdsNothing), []);
    assert.deepEqual(listed({ leaseId: "c-a1-101" }, holdsNothing), []);
  });

  test("a tenant keeps to their own contracts", () => {
    assert.deepEqual(listed({}, tenantOne), ["c-a1-101", "c-a2-201"]);
    assert.deepEqual(listed({ tenantId: "t-2" }, tenantOne), []);
    assert.deepEqual(listed({ leaseId: "c-a1-102" }, tenantOne), []);
    assert.deepEqual(listed({ unitId: "u-a1-101" }, tenantOne), ["c-a1-101"]);
  });

  test("holds for every register, including the ones with an AND of their own", () => {
    const registers: LeaseReportType[] = [
      "active",
      "expiring-soon",
      "expiring",
      "expired",
      "renewed",
      "terminated",
    ];
    for (const type of registers) {
      assert.deepEqual(
        listed({ propertyId: "b1" }, holdsA, type),
        [],
        `${type} listed a building the reader does not hold`,
      );
      assert.deepEqual(
        listed({ leaseId: "c-b1-301" }, holdsA, type),
        [],
        `${type} listed a contract the reader does not hold`,
      );
    }
  });
});

describe("the register's own rule still applies beneath the filters", () => {
  test("a contract that is not running is not on the active register", () => {
    const ended = {
      ...running("c-a1-old", "a1", "u-a1-103", "t-1"),
      status: "expired",
      endDate: day("2026-03-01"),
    };
    const rows = [...contracts, ended];
    const where = leaseRegisterWhere(
      "active",
      { unitId: "u-a1-103" },
      { endOfToday },
      staff,
    );
    assert.deepEqual(rowsMatching(rows, where), []);

    const expired = leaseRegisterWhere(
      "expired",
      { unitId: "u-a1-103" },
      { endOfToday },
      staff,
    );
    assert.deepEqual(
      rowsMatching(rows, expired).map((row) => row.id),
      ["c-a1-old"],
    );
  });

  test("the date window narrows it further", () => {
    const where = leaseRegisterWhere(
      "active",
      { ownerId: "owner-1" },
      { endOfToday, from: day("2026-06-01"), to: day("2026-12-31") },
      holdsA,
    );
    // Every contract began on 1 January: none began in the window.
    assert.deepEqual(rowsMatching(contracts, where), []);
  });
});
