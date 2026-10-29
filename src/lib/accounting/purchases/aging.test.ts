/**
 * Payables aging: how long each thing the office owes has been due, grouped by
 * supplier, the columns adding up to the totals.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { bucketFor, buildAging, daysPastDue, type AgingAdvance, type AgingItem } from "./aging";

const day = (value: string) => new Date(`${value}T00:00:00.000Z`);
const ASOF = day("2026-10-31");

describe("the columns", () => {
  test("a bill not yet due, or due today, is current", () => {
    assert.equal(bucketFor(ASOF, day("2026-11-15")), "current");
    assert.equal(bucketFor(ASOF, day("2026-10-31")), "current");
  });

  test("one day late is the first column; thirty days still is", () => {
    assert.equal(bucketFor(ASOF, day("2026-10-30")), "d1_30");
    assert.equal(bucketFor(ASOF, day("2026-10-01")), "d1_30");
    assert.equal(daysPastDue(ASOF, day("2026-10-30")), 1);
    assert.equal(daysPastDue(ASOF, day("2026-10-01")), 30);
  });

  test("31 to 60, 61 to 90, then over 90", () => {
    assert.equal(daysPastDue(ASOF, day("2026-09-30")), 31);
    assert.equal(bucketFor(ASOF, day("2026-09-30")), "d31_60");
    assert.equal(daysPastDue(ASOF, day("2026-09-01")), 60);
    assert.equal(bucketFor(ASOF, day("2026-09-01")), "d31_60");
    assert.equal(bucketFor(ASOF, day("2026-08-31")), "d61_90");
    assert.equal(daysPastDue(ASOF, day("2026-08-02")), 90);
    assert.equal(bucketFor(ASOF, day("2026-08-02")), "d61_90");
    assert.equal(bucketFor(ASOF, day("2026-08-01")), "d90_plus");
    assert.equal(bucketFor(ASOF, day("2025-01-01")), "d90_plus");
  });
});

function item(overrides: Partial<AgingItem> = {}): AgingItem {
  return {
    kind: "bill",
    id: "b1",
    number: "BILL-000001",
    supplierId: "s1",
    supplierName: "Al Noor Maintenance",
    reference: "INV-77",
    date: day("2026-09-01"),
    dueDate: day("2026-10-01"),
    total: 1150,
    outstanding: 1150,
    ...overrides,
  };
}

describe("building the report", () => {
  test("groups by supplier and puts each bill in its column", () => {
    const report = buildAging(
      [
        item({ id: "b1", outstanding: 1000, dueDate: day("2026-11-10") }),
        item({ id: "b2", outstanding: 500, dueDate: day("2026-10-15") }),
        item({ id: "b3", outstanding: 250.5, dueDate: day("2026-06-01") }),
        item({ id: "b4", supplierId: "s2", supplierName: "Bright Cleaning", outstanding: 300, dueDate: day("2026-09-10") }),
      ],
      [],
      ASOF,
    );
    assert.equal(report.asOf, "2026-10-31");
    assert.deepEqual(
      report.rows.map((row) => row.supplierName),
      ["Al Noor Maintenance", "Bright Cleaning"],
    );
    const [noor, bright] = report.rows;
    assert.deepEqual(noor.buckets, { current: 1000, d1_30: 500, d31_60: 0, d61_90: 0, d90_plus: 250.5 });
    assert.equal(noor.outstanding, 1750.5);
    assert.deepEqual(bright.buckets, { current: 0, d1_30: 0, d31_60: 300, d61_90: 0, d90_plus: 0 });
    assert.deepEqual(report.totals.buckets, {
      current: 1000,
      d1_30: 500,
      d31_60: 300,
      d61_90: 0,
      d90_plus: 250.5,
    });
    assert.equal(report.totals.outstanding, 2050.5);
  });

  test("the columns add up to the supplier's total, to the halala", () => {
    const report = buildAging(
      [
        item({ id: "a", outstanding: 0.1, dueDate: day("2026-11-10") }),
        item({ id: "b", outstanding: 0.2, dueDate: day("2026-10-15") }),
        item({ id: "c", outstanding: 0.3, dueDate: day("2026-09-15") }),
      ],
      [],
      ASOF,
    );
    const row = report.rows[0];
    const sum = Object.values(row.buckets).reduce((a, b) => a + b, 0);
    assert.equal(Math.round(sum * 100), Math.round(row.outstanding * 100));
    assert.equal(row.outstanding, 0.6);
  });

  test("lists what makes up each supplier's figure, oldest due first", () => {
    const report = buildAging(
      [
        item({ id: "late", number: "BILL-000002", dueDate: day("2026-10-20"), outstanding: 10 }),
        item({ id: "later", number: "BILL-000003", dueDate: day("2026-10-25"), outstanding: 20 }),
        item({ id: "earlier", number: "BILL-000001", dueDate: day("2026-09-01"), outstanding: 30 }),
      ],
      [],
      ASOF,
    );
    assert.deepEqual(
      report.rows[0].items.map((entry) => entry.id),
      ["earlier", "late", "later"],
    );
    assert.equal(report.rows[0].items[0].daysPastDue, 60);
    assert.equal(report.rows[0].items[0].bucket, "d31_60");
    assert.equal(report.rows[0].items[0].dueDate, "2026-09-01");
  });

  test("a bill with nothing left is not in the report", () => {
    const report = buildAging([item({ outstanding: 0 })], [], ASOF);
    assert.deepEqual(report.rows, []);
    assert.equal(report.totals.outstanding, 0);
  });

  test("an expense approved with a supplier ages like a bill", () => {
    const report = buildAging(
      [item({ kind: "expense", id: "e1", number: "EXP-9", dueDate: day("2026-10-20"), outstanding: 80 })],
      [],
      ASOF,
    );
    assert.equal(report.rows[0].items[0].kind, "expense");
    assert.equal(report.rows[0].buckets.d1_30, 80);
  });

  test("a payment on account sits against what is owed", () => {
    const advance: AgingAdvance = {
      supplierId: "s1",
      supplierName: "Al Noor Maintenance",
      voucherId: "v1",
      number: "PV-000004",
      date: day("2026-10-10"),
      amount: 300,
    };
    const report = buildAging([item({ outstanding: 1000, dueDate: day("2026-11-10") })], [advance], ASOF);
    const row = report.rows[0];
    assert.equal(row.outstanding, 1000);
    assert.equal(row.onAccount, 300);
    assert.equal(row.net, 700);
    assert.equal(row.advances[0].number, "PV-000004");
    assert.equal(report.totals.onAccount, 300);
    assert.equal(report.totals.net, 700);
  });

  test("a supplier paid in advance with nothing owed shows what they hold of ours", () => {
    const report = buildAging(
      [],
      [{ supplierId: "s9", supplierName: "Zed Co", voucherId: "v2", number: "PV-000005", date: day("2026-10-12"), amount: 125 }],
      ASOF,
    );
    assert.equal(report.rows.length, 1);
    assert.equal(report.rows[0].outstanding, 0);
    assert.equal(report.rows[0].net, -125);
    assert.equal(report.totals.net, -125);
  });
});
