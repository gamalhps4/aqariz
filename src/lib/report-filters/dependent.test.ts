/**
 * Pickers that narrow one another: a compound leaves its buildings, a
 * building its units, a unit its contracts — and a choice that no longer fits
 * is cleared.
 *
 * One small portfolio. Compound A holds a1 and a2 (owner-1), compound B holds
 * b1 (owner-2); owner-1 also has a3 outside any compound. a1 has two units.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  agreementReaches,
  pruneSelection,
  visibleAgreements,
  visibleBuildings,
  visibleCompounds,
  visibleContracts,
  visibleOwners,
  visibleTenants,
  visibleUnits,
} from "@/lib/report-filters/dependent";
import type {
  AgreementOption,
  BuildingOption,
  ContractOption,
  FilterOptions,
} from "@/lib/report-filters/options";

const building = (
  id: string,
  ownerId: string,
  compoundId: string | null,
): BuildingOption => ({ id, label: id, hint: null, ownerId, compoundId });

const contract = (
  id: string,
  propertyId: string,
  unitId: string,
  tenantId: string,
): ContractOption => ({
  id,
  label: id,
  tenantName: tenantId,
  propertyName: propertyId,
  unitNumber: unitId,
  propertyId,
  unitId,
  tenantId,
  status: "active",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
});

const agreement = (
  id: string,
  ownerId: string,
  propertyId: string | null,
  compoundId: string | null,
): AgreementOption => ({
  id,
  label: id,
  ownerName: ownerId,
  scopeName: "",
  ownerId,
  propertyId,
  compoundId,
  status: "active",
  kind: "management",
});

const options: FilterOptions = {
  owners: [
    { id: "owner-1", label: "Owner 1" },
    { id: "owner-2", label: "Owner 2" },
  ],
  compounds: [
    { id: "A", label: "Compound A" },
    { id: "B", label: "Compound B" },
  ],
  buildings: [
    building("a1", "owner-1", "A"),
    building("a2", "owner-1", "A"),
    building("a3", "owner-1", null),
    building("b1", "owner-2", "B"),
  ],
  units: [
    { id: "u-a1-1", label: "1", hint: "a1", propertyId: "a1" },
    { id: "u-a1-2", label: "2", hint: "a1", propertyId: "a1" },
    { id: "u-a2-1", label: "1", hint: "a2", propertyId: "a2" },
    { id: "u-b1-1", label: "1", hint: "b1", propertyId: "b1" },
  ],
  tenants: [
    { id: "t-1", label: "Tenant 1" },
    { id: "t-2", label: "Tenant 2" },
    { id: "t-3", label: "Tenant 3" },
  ],
  contracts: [
    contract("c-1", "a1", "u-a1-1", "t-1"),
    contract("c-2", "a1", "u-a1-2", "t-2"),
    contract("c-3", "a2", "u-a2-1", "t-1"),
    contract("c-4", "b1", "u-b1-1", "t-3"),
  ],
  agreements: [
    agreement("g-owner1", "owner-1", null, null),
    agreement("g-compound-a", "owner-1", null, "A"),
    agreement("g-a1", "owner-1", "a1", null),
    agreement("g-owner2", "owner-2", null, null),
  ],
};

const ids = (list: Array<{ id: string }>) => list.map((entry) => entry.id);

describe("buildings", () => {
  test("all of them when nothing is chosen above", () => {
    assert.deepEqual(ids(visibleBuildings(options, {})), ["a1", "a2", "a3", "b1"]);
  });

  test("a compound leaves its own", () => {
    assert.deepEqual(ids(visibleBuildings(options, { compoundId: "A" })), [
      "a1",
      "a2",
    ]);
  });

  test("an owner leaves theirs, compound or not", () => {
    assert.deepEqual(ids(visibleBuildings(options, { ownerId: "owner-1" })), [
      "a1",
      "a2",
      "a3",
    ]);
  });

  test("an owner and a compound that share no building leave none", () => {
    assert.deepEqual(
      ids(visibleBuildings(options, { ownerId: "owner-2", compoundId: "A" })),
      [],
    );
  });
});

describe("compounds and owners", () => {
  test("an owner leaves the compounds they have a building in", () => {
    assert.deepEqual(ids(visibleCompounds(options, { ownerId: "owner-1" })), ["A"]);
    assert.deepEqual(ids(visibleCompounds(options, { ownerId: "owner-2" })), ["B"]);
    assert.deepEqual(ids(visibleCompounds(options, {})), ["A", "B"]);
  });

  test("a compound leaves the owners of its buildings", () => {
    assert.deepEqual(ids(visibleOwners(options, { compoundId: "B" })), ["owner-2"]);
    assert.deepEqual(ids(visibleOwners(options, {})), ["owner-1", "owner-2"]);
  });

  test("without the buildings, nothing can be narrowed", () => {
    const bare = { ...options, buildings: undefined };
    assert.deepEqual(ids(visibleCompounds(bare, { ownerId: "owner-1" })), ["A", "B"]);
    assert.deepEqual(ids(visibleOwners(bare, { compoundId: "A" })), [
      "owner-1",
      "owner-2",
    ]);
  });
});

describe("units", () => {
  test("a building leaves its own", () => {
    assert.deepEqual(ids(visibleUnits(options, { propertyId: "a1" })), [
      "u-a1-1",
      "u-a1-2",
    ]);
  });

  test("a compound or an owner leaves the units of the buildings it left", () => {
    assert.deepEqual(ids(visibleUnits(options, { compoundId: "A" })), [
      "u-a1-1",
      "u-a1-2",
      "u-a2-1",
    ]);
    assert.deepEqual(ids(visibleUnits(options, { ownerId: "owner-2" })), ["u-b1-1"]);
  });

  test("a building outside what the pickers above leave has no units", () => {
    assert.deepEqual(
      ids(visibleUnits(options, { compoundId: "A", propertyId: "b1" })),
      [],
    );
  });
});

describe("contracts and tenants", () => {
  test("a unit leaves its contracts", () => {
    assert.deepEqual(ids(visibleContracts(options, { unitId: "u-a1-2" })), ["c-2"]);
  });

  test("a tenant leaves their own contracts", () => {
    assert.deepEqual(ids(visibleContracts(options, { tenantId: "t-1" })), [
      "c-1",
      "c-3",
    ]);
  });

  test("a compound leaves the contracts of its buildings", () => {
    assert.deepEqual(ids(visibleContracts(options, { compoundId: "B" })), ["c-4"]);
  });

  test("a building leaves the tenants who hold a contract in it", () => {
    assert.deepEqual(ids(visibleTenants(options, { propertyId: "a1" })), [
      "t-1",
      "t-2",
    ]);
    assert.deepEqual(ids(visibleTenants(options, { unitId: "u-a1-2" })), ["t-2"]);
  });

  test("the tenant already chosen does not narrow the tenants", () => {
    // Or choosing one would leave only that one to choose among.
    assert.deepEqual(ids(visibleTenants(options, { tenantId: "t-1" })), [
      "t-1",
      "t-2",
      "t-3",
    ]);
  });

  test("a tenant with no contract where the pickers leave is not offered", () => {
    assert.deepEqual(ids(visibleTenants(options, { compoundId: "B" })), ["t-3"]);
  });
});

describe("agreements", () => {
  test("all of them when nothing is chosen", () => {
    assert.equal(visibleAgreements(options, {}).length, 4);
  });

  test("an owner leaves theirs", () => {
    assert.deepEqual(ids(visibleAgreements(options, { ownerId: "owner-2" })), [
      "g-owner2",
    ]);
  });

  test("a building leaves the agreements that govern it", () => {
    // a1: its own agreement, its compound's and the owner's blanket one — but
    // not the other owner's.
    assert.deepEqual(ids(visibleAgreements(options, { propertyId: "a1" })), [
      "g-owner1",
      "g-compound-a",
      "g-a1",
    ]);
    // a2 is not what g-a1 names.
    assert.deepEqual(ids(visibleAgreements(options, { propertyId: "a2" })), [
      "g-owner1",
      "g-compound-a",
    ]);
  });

  test("a compound leaves the agreements that reach one of its buildings", () => {
    assert.deepEqual(ids(visibleAgreements(options, { compoundId: "B" })), [
      "g-owner2",
    ]);
  });

  test("how an agreement reaches a building", () => {
    const [blanket, compoundA, onA1] = options.agreements!;
    const [a1, , a3] = options.buildings!;
    assert.ok(agreementReaches(blanket, a3));
    assert.ok(agreementReaches(compoundA, a1));
    assert.ok(!agreementReaches(compoundA, a3));
    assert.ok(agreementReaches(onA1, a1));
    assert.ok(!agreementReaches(onA1, options.buildings![1]));
  });
});

describe("clearing what no longer fits", () => {
  test("leaves a selection that still fits alone", () => {
    const selection = { ownerId: "owner-1", propertyId: "a1", unitId: "u-a1-1" };
    assert.deepEqual(pruneSelection(options, selection), selection);
  });

  test("a new compound clears a building that is not in it", () => {
    const next = pruneSelection(
      options,
      { compoundId: "B", propertyId: "a1", unitId: "u-a1-1" },
      "compoundId",
    );
    assert.equal(next.propertyId, undefined);
    // …and with the building gone, its unit goes too.
    assert.equal(next.unitId, undefined);
    assert.equal(next.compoundId, "B");
  });

  test("a new building clears a unit that is not in it", () => {
    const next = pruneSelection(
      options,
      { propertyId: "a2", unitId: "u-a1-1" },
      "propertyId",
    );
    assert.equal(next.unitId, undefined);
    assert.equal(next.propertyId, "a2");
  });

  test("a new tenant clears a contract that is not theirs", () => {
    const next = pruneSelection(
      options,
      { tenantId: "t-2", leaseId: "c-1" },
      "tenantId",
    );
    assert.equal(next.leaseId, undefined);
    assert.equal(next.tenantId, "t-2");
  });

  test("a new unit clears a tenant who holds no contract in it", () => {
    const next = pruneSelection(
      options,
      { unitId: "u-a1-2", tenantId: "t-1" },
      "unitId",
    );
    assert.equal(next.tenantId, undefined);
  });

  test("an owner and a compound that do not go together: the one just touched wins", () => {
    const pickedOwner = pruneSelection(
      options,
      { ownerId: "owner-2", compoundId: "A" },
      "ownerId",
    );
    assert.deepEqual(pickedOwner, { ownerId: "owner-2", compoundId: undefined });

    const pickedCompound = pruneSelection(
      options,
      { ownerId: "owner-2", compoundId: "A" },
      "compoundId",
    );
    assert.deepEqual(pickedCompound, { ownerId: undefined, compoundId: "A" });
  });

  test("a new owner clears an agreement that is not theirs", () => {
    const next = pruneSelection(
      options,
      { ownerId: "owner-2", agreementId: "g-a1" },
      "ownerId",
    );
    assert.equal(next.agreementId, undefined);
  });

  test("a list that was never loaded clears nothing", () => {
    const next = pruneSelection(
      { owners: options.owners },
      { ownerId: "owner-1", propertyId: "a1", unitId: "u-a1-1" },
      "ownerId",
    );
    assert.deepEqual(next, {
      ownerId: "owner-1",
      propertyId: "a1",
      unitId: "u-a1-1",
    });
  });

  test("does not change the selection it was given", () => {
    const selection = { compoundId: "B", propertyId: "a1" };
    pruneSelection(options, selection, "compoundId");
    assert.deepEqual(selection, { compoundId: "B", propertyId: "a1" });
  });
});
