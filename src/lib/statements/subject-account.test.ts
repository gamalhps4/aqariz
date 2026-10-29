/**
 * A compound's, a building's and a unit's account add up.
 *
 * The building statement listed its units with no commission at all, so the
 * commission, the VAT on it and the owner's share were wrong on every unit
 * row; the building's own expenses fell into no row; and a building was read
 * as the office's for the whole period whenever an investment agreement held
 * it at the close. These pin the account that replaced it: the commission
 * run's own parts (lib/agreement-math.ts, consumed as it is), the owner's time
 * (`statementTime`), and rows that add back up to the statement.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  computeCommissionRun,
  shareOfAgreementAmount,
  type AgreementRow,
  type CommissionRun,
} from "@/lib/agreement-math";
import { settle } from "@/lib/statements/settlement";
import {
  apportion,
  buildingRowKey,
  subjectAccount,
  type AccountEntry,
  type AccountExpense,
  type AccountPayment,
} from "@/lib/statements/subject-account";

const PERIOD = {
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-03-31T23:59:59.999Z"),
};

function agreement(overrides: Partial<AgreementRow> = {}): AgreementRow {
  return {
    id: "a1",
    kind: "management",
    agreementNumber: "AGR-1",
    ownerId: "o1",
    propertyId: "p1",
    compoundId: null,
    feeType: "percentage",
    feePercentage: 5,
    feeAmount: 0,
    feeFrequency: "monthly",
    commissionBasis: "collected",
    currency: "SAR",
    startDate: new Date("2025-01-01T00:00:00.000Z"),
    endDate: null,
    status: "active",
    terminatedDate: null,
    ...overrides,
  };
}

const building = { id: "p1", name: "Tower", ownerId: "o1", compoundId: null };

function entry(
  unitId: string | null,
  day: string,
  amount: number,
  base = amount,
  propertyId = "p1",
): AccountEntry {
  return { propertyId, unitId, date: new Date(`${day}T10:00:00.000Z`), amount, base };
}

function payment(
  unitId: string | null,
  day: string,
  amount: number,
  receivedBy: "owner" | "office" = "office",
  propertyId = "p1",
): AccountPayment {
  return { propertyId, unitId, date: `${day}T10:00:00.000Z`, amount, receivedBy };
}

function expense(
  unitId: string | null,
  day: string,
  amount: number,
  propertyId = "p1",
): AccountExpense {
  return { propertyId, unitId, date: `${day}T10:00:00.000Z`, amount };
}

function run(
  agreements: AgreementRow[],
  received: AccountEntry[],
  billed: AccountEntry[] = [],
  properties = [building],
): CommissionRun {
  return computeCommissionRun({
    properties,
    portfolio: properties,
    agreements,
    period: PERIOD,
    received,
    billed,
  });
}

describe("apportion", () => {
  test("shares add back up to the amount, to the cent", () => {
    const shares = apportion(100, [1, 1, 1]);
    assert.deepEqual(shares, [33.34, 33.33, 33.33]);
    assert.equal(Math.round(shares.reduce((a, b) => a + b, 0) * 100), 10_000);
  });

  test("follows the weights, the odd cent to the largest remainder", () => {
    assert.deepEqual(apportion(500, [6000, 3000, 1000]), [300, 150, 50]);
    assert.deepEqual(apportion(0.05, [1, 2]), [0.02, 0.03]);
  });

  test("a weight at or below zero takes nothing", () => {
    assert.deepEqual(apportion(10, [0, 5, -3]), [0, 10, 0]);
    assert.deepEqual(apportion(10, [0, 0]), [0, 0]);
  });
});

describe("a building by unit", () => {
  const received = [
    entry("u1", "2026-01-10", 6_900, 6_000),
    entry("u2", "2026-02-10", 3_450, 3_000),
    // Money with no contract behind it: the building's own.
    entry(null, "2026-03-05", 1_000, 1_000),
  ];
  const billed = [
    entry("u1", "2026-01-01", 6_900, 6_000),
    entry("u2", "2026-02-01", 3_450, 3_000),
  ];
  const commissionRun = run([agreement()], received, billed);

  const account = subjectAccount({
    period: PERIOD,
    buildings: [
      { id: "p1", parts: commissionRun.byProperty[0].parts, unitIds: ["u1", "u2", "u3"] },
    ],
    payments: [
      payment("u1", "2026-01-10", 6_900),
      // Transferred to the owner: the owner's money, not the office's.
      payment("u2", "2026-02-10", 3_450, "owner"),
      payment(null, "2026-03-05", 1_000),
    ],
    expenses: [expense("u1", "2026-01-20", 200), expense(null, "2026-02-01", 100)],
    received,
    billed,
    basisOf: () => "collected",
    commissionTaxRate: 15,
    breakdown: "unit",
  });
  const row = (key: string) => account.rows.find((entry) => entry.key === key)!;

  test("each unit carries the commission on the rent it brought in", () => {
    assert.equal(commissionRun.byProperty[0].commission, 500);
    assert.equal(row("u1").commission, 300);
    assert.equal(row("u2").commission, 150);
    assert.equal(row("u3").commission, 0);
    // The building's own row carries what no unit brought in.
    assert.equal(row(buildingRowKey("p1")).commission, 50);
  });

  test("the building's own expenses and money land on its own row", () => {
    const own = row(buildingRowKey("p1"));
    assert.equal(own.expenses, 100);
    assert.equal(own.rentCollected, 1_000);
    assert.equal(own.unitId, null);
    assert.equal(row("u1").expenses, 200);
  });

  test("the VAT and the owner's share are worked out per row", () => {
    const u1 = row("u1").settlement;
    assert.equal(u1.commissionTax, 45);
    assert.equal(u1.ownerShare, 6_900 - 200 - 300 - 45);
    const u2 = row("u2").settlement;
    assert.equal(u2.collectedByOwner, 3_450);
    // The owner received it all: the owner owes the office its fee and VAT.
    assert.equal(u2.dueToOperator, 172.5);
    assert.equal(u2.dueToOwner, 0);
  });

  test("the rows add up to the statement", () => {
    const sum = (field: "rentCollected" | "expenses" | "commission" | "rentBilled") =>
      account.rows.reduce((total, entry) => total + entry[field], 0);
    assert.equal(sum("rentCollected"), account.totals.rentCollected);
    assert.equal(sum("expenses"), account.totals.expenses);
    assert.equal(sum("commission"), commissionRun.byProperty[0].commission);
    assert.equal(sum("rentBilled"), 10_350);
    assert.deepEqual(
      account.settlement,
      settle({
        collected: 11_350,
        collectedByOwner: 3_450,
        expenses: 300,
        commission: 500,
        commissionTaxRate: 15,
      }),
    );
  });

  test("units come in their order, the building's own row last", () => {
    assert.deepEqual(
      account.rows.map((entry) => entry.key),
      ["u1", "u2", "u3", buildingRowKey("p1")],
    );
  });

  test("the commission base follows the same rows", () => {
    assert.equal(row("u1").commissionBase, 6_000);
    assert.equal(row(buildingRowKey("p1")).commissionBase, 1_000);
    assert.equal(account.totals.commissionBase, 10_000);
  });
});

describe("a flat fee between units", () => {
  const flat = agreement({ feeType: "fixed", feePercentage: 0, feeAmount: 1_000 });

  test("is shared equally, the odd cent to the first units", () => {
    const commissionRun = run([flat], []);
    const part = commissionRun.byProperty[0].parts[0];
    assert.equal(part.commission, 3_000);
    const account = subjectAccount({
      period: PERIOD,
      buildings: [
        { id: "p1", parts: commissionRun.byProperty[0].parts, unitIds: ["u1", "u2", "u3", "u4", "u5", "u6", "u7"] },
      ],
      payments: [],
      expenses: [],
      received: [],
      billed: [],
      basisOf: () => "collected",
      commissionTaxRate: 15,
      breakdown: "unit",
    });
    const ids = ["u1", "u2", "u3", "u4", "u5", "u6", "u7"];
    for (const id of ids) {
      assert.equal(
        account.rows.find((row) => row.key === id)!.commission,
        shareOfAgreementAmount(3_000, ids, id),
      );
    }
    assert.equal(
      Math.round(account.rows.reduce((sum, row) => sum + row.commission, 0) * 100),
      300_000,
    );
    // No unit reads as costing the owner nothing: the fee is in every row's
    // dues, as it is in the building's.
    assert.ok(account.rows.every((row) => row.settlement.dueToOperator > 0));
  });

  test("a building with no units keeps it on its own row", () => {
    const commissionRun = run([flat], []);
    const account = subjectAccount({
      period: PERIOD,
      buildings: [{ id: "p1", parts: commissionRun.byProperty[0].parts, unitIds: [] }],
      payments: [],
      expenses: [],
      received: [],
      billed: [],
      basisOf: () => "collected",
      commissionTaxRate: 15,
      breakdown: "unit",
    });
    assert.equal(account.rows.length, 1);
    assert.equal(account.rows[0].key, buildingRowKey("p1"));
    assert.equal(account.rows[0].commission, 3_000);
  });
});

describe("investment inside the period", () => {
  // Managed at 10% to mid-February, then taken on by the office.
  const managed = agreement({
    feePercentage: 10,
    endDate: new Date("2026-02-14T00:00:00.000Z"),
  });
  const invested = agreement({
    id: "a2",
    kind: "investment",
    agreementNumber: "INV-1",
    feeType: "fixed",
    feePercentage: 0,
    feeAmount: 3_000,
    startDate: new Date("2026-02-15T00:00:00.000Z"),
  });
  const received = [
    entry("u1", "2026-01-10", 5_000),
    entry("u2", "2026-03-10", 5_000),
  ];
  const commissionRun = run([managed, invested], received);
  const parts = commissionRun.byProperty[0].parts;

  const account = subjectAccount({
    period: PERIOD,
    buildings: [{ id: "p1", parts, unitIds: ["u1", "u2"] }],
    payments: [payment("u1", "2026-01-10", 5_000), payment("u2", "2026-03-10", 5_000)],
    expenses: [expense("u1", "2026-01-15", 100), expense("u2", "2026-03-12", 400)],
    received,
    billed: [],
    basisOf: () => "collected",
    commissionTaxRate: 15,
    breakdown: "unit",
  });

  test("the whole building was read as the office's at the close", () => {
    // What the engine's whole-building reading says — and why the statement
    // does not read the rows by it.
    assert.equal(commissionRun.byProperty[0].agreementKind, "investment");
  });

  test("the owner's months still count, the office's do not", () => {
    assert.deepEqual(
      account.payments.map((row) => row.date.slice(0, 10)),
      ["2026-01-10"],
    );
    assert.deepEqual(
      account.expenses.map((row) => row.date.slice(0, 10)),
      ["2026-01-15"],
    );
    assert.equal(account.totals.rentCollected, 5_000);
    assert.equal(account.totals.commission, 500);
  });

  test("the investment rent is shared equally and owed to the owner", () => {
    const rent = parts
      .filter((part) => part.agreementKind === "investment")
      .reduce((sum, part) => sum + part.investmentRent, 0);
    assert.ok(rent > 0);
    const rows = account.rows;
    assert.equal(
      Math.round(rows.reduce((sum, row) => sum + row.investmentRent, 0) * 100),
      Math.round(rent * 100),
    );
    assert.equal(
      rows.find((row) => row.key === "u2")!.investmentRent,
      shareOfAgreementAmount(rent, ["u1", "u2"], "u2"),
    );
    assert.equal(account.settlement.investmentRent, Math.round(rent * 100) / 100);
  });
});

describe("a compound by building", () => {
  const second = { id: "p2", name: "Annex", ownerId: "o2", compoundId: null };
  const received = [
    entry("u1", "2026-01-10", 2_000, 2_000, "p1"),
    entry("x1", "2026-01-11", 1_000, 1_000, "p2"),
  ];
  const commissionRun = run([agreement()], received, [], [building, second]);
  const partsOf = new Map(commissionRun.byProperty.map((e) => [e.propertyId, e.parts]));
  const account = subjectAccount({
    period: PERIOD,
    buildings: [
      { id: "p1", parts: partsOf.get("p1")!, unitIds: ["u1"] },
      { id: "p2", parts: partsOf.get("p2")!, unitIds: ["x1"] },
    ],
    payments: [
      payment("u1", "2026-01-10", 2_000, "office", "p1"),
      payment("x1", "2026-01-11", 1_000, "office", "p2"),
    ],
    expenses: [expense(null, "2026-01-05", 50, "p2")],
    received,
    billed: [],
    basisOf: () => "collected",
    commissionTaxRate: 15,
    breakdown: "property",
  });

  test("each building is a row, settled on its own", () => {
    assert.deepEqual(account.rows.map((row) => row.key), ["p1", "p2"]);
    const [p1, p2] = account.rows;
    assert.equal(p1.commission, 100);
    assert.equal(p2.commission, 0);
    assert.equal(p2.expenses, 50);
    assert.equal(p1.unitId, null);
    assert.equal(account.totals.rentCollected, 3_000);
  });
});
