/**
 * Which buildings an agreement governs — the owner's, and what it names.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  agreementGoverns,
  governedBy,
  type AgreementReach,
} from "@/lib/report-filters/agreement-reach";

const buildings = [
  { id: "a1", ownerId: "owner-1", compoundId: "A" },
  { id: "a2", ownerId: "owner-1", compoundId: "A" },
  { id: "a3", ownerId: "owner-1", compoundId: null },
  { id: "b1", ownerId: "owner-2", compoundId: "B" },
];

const blanket: AgreementReach = {
  ownerId: "owner-1",
  propertyId: null,
  compoundId: null,
};
const forCompound: AgreementReach = { ...blanket, compoundId: "A" };
const forBuilding: AgreementReach = { ...blanket, propertyId: "a1" };

const ids = (list: Array<{ id: string }>) => list.map((entry) => entry.id);

describe("an agreement governs buildings", () => {
  test("an owner's blanket agreement governs every building they hold", () => {
    assert.deepEqual(ids(governedBy(blanket, buildings)), ["a1", "a2", "a3"]);
  });

  test("a compound's agreement governs the buildings in that compound", () => {
    assert.deepEqual(ids(governedBy(forCompound, buildings)), ["a1", "a2"]);
  });

  test("a building's agreement governs that building alone", () => {
    assert.deepEqual(ids(governedBy(forBuilding, buildings)), ["a1"]);
  });

  test("never a building of another owner, whatever it names", () => {
    const names = { ...blanket, compoundId: "B" };
    assert.deepEqual(ids(governedBy(names, buildings)), []);
    assert.ok(!agreementGoverns({ ...blanket, propertyId: "b1" }, buildings[3]));
    assert.ok(!agreementGoverns(blanket, buildings[3]));
  });

  test("a building it names but the reader cannot see governs nothing there", () => {
    // Given only the buildings a reader holds, the rest are not in the list.
    assert.deepEqual(
      ids(governedBy(forBuilding, buildings.filter((b) => b.id !== "a1"))),
      [],
    );
  });
});
