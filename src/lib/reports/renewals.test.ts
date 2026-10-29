/**
 * The renewed register shows the contract that took over and is filtered on
 * the day the renewal was made — not on the old contract's end date, which
 * it used to read under a label saying "renewed".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  renewalInfo,
  renewedWithin,
  successorOf,
  type SuccessorContract,
} from "@/lib/reports/renewals";

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function successor(
  overrides: Partial<SuccessorContract> & { id: string },
): SuccessorContract {
  return {
    parentLeaseId: null,
    contractNumber: null,
    startDate: day("2027-01-01"),
    endDate: day("2027-12-31"),
    status: "active",
    createdAt: day("2026-09-15"),
    ...overrides,
  };
}

describe("the contract that took over", () => {
  const named = successor({ id: "new-1", contractNumber: "EJ-2027-01" });
  const naming = successor({ id: "new-2", parentLeaseId: "old-2" });

  test("is the one the renewed contract names", () => {
    assert.equal(
      successorOf({ id: "old-1", renewedLeaseId: "new-1" }, [named, naming])?.id,
      "new-1",
    );
  });

  test("else the one that names it back", () => {
    assert.equal(
      successorOf({ id: "old-2", renewedLeaseId: null }, [named, naming])?.id,
      "new-2",
    );
  });

  test("is nobody for a contract marked renewed with neither link", () => {
    assert.equal(successorOf({ id: "old-3", renewedLeaseId: null }, [named]), null);
    assert.equal(renewalInfo(null), null);
  });

  test("carries its number, its term and the day the renewal was made", () => {
    assert.deepEqual(renewalInfo(named), {
      leaseId: "new-1",
      contractNumber: "EJ-2027-01",
      startDate: "2027-01-01T00:00:00.000Z",
      endDate: "2027-12-31T00:00:00.000Z",
      status: "active",
      renewedOn: "2026-09-15T00:00:00.000Z",
    });
  });
});

describe("the date filter on the renewed register", () => {
  // Renewed in September, months before the old term ends in December: the
  // old end date put it in December's list.
  const renewedOn = new Date("2026-09-15T10:30:00Z");
  const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

  test("reads the day the renewal was made", () => {
    assert.ok(renewedWithin(renewedOn, day("2026-09-01"), day("2026-09-30")));
    assert.ok(!renewedWithin(renewedOn, day("2026-12-01"), day("2026-12-31")));
  });

  test("includes the whole of the last day", () => {
    assert.ok(renewedWithin(renewedOn, undefined, day("2026-09-15")));
    assert.ok(!renewedWithin(renewedOn, day("2026-09-16")));
  });

  test("includes it until Riyadh's midnight, not the server's", () => {
    // 22:30 UTC on the 15th is 01:30 on the 16th in Riyadh.
    const lateEvening = new Date("2026-09-15T22:30:00Z");
    assert.ok(!renewedWithin(lateEvening, undefined, day("2026-09-15")));
    assert.ok(renewedWithin(lateEvening, undefined, day("2026-09-16")));
    // 20:30 UTC is 23:30 on the 15th: still inside.
    assert.ok(
      renewedWithin(new Date("2026-09-15T20:30:00Z"), undefined, day("2026-09-15")),
    );
  });

  test("without a filter, every renewal is listed — its date known or not", () => {
    assert.ok(renewedWithin(renewedOn));
    assert.ok(renewedWithin(null));
  });

  test("with one, a renewal whose date is not known cannot be placed in it", () => {
    assert.ok(!renewedWithin(null, new Date(2026, 8, 1)));
  });
});
