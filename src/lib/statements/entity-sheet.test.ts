/**
 * The compound, building and unit statements read like the owner's.
 *
 * They exported as a generic "Statement" with totals only: no payment rows,
 * nothing saying which building or unit, whose, or for which dates, and a
 * unit under a flat fee printed the English "charged at building level" on
 * an Arabic statement. These pin the document that replaced it: the title,
 * the details, the summary, the breakdown, every payment and every expense.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import { localizeSheet, toCsv } from "@/lib/reports/export";
import type { LineTranslate } from "@/lib/statements/line-text";
import { settle } from "@/lib/statements/settlement";
import {
  entityStatementDetails,
  entityStatementTitle,
} from "@/lib/statements/entity-details";
import {
  breakdownStatementSheet,
  unitStatementSheet,
} from "@/lib/statements/entity-sheet";
import type { EntityStatement } from "@/types/entity-statement";

const arabic: LineTranslate = (key, english, values) =>
  pdfLabel("ar", key, english, values);
const english: LineTranslate = (key, fallback, values) =>
  pdfLabel("en", key, fallback, values);

function building(): EntityStatement {
  const settlement = settle({
    collected: 11_350,
    collectedByOwner: 3_450,
    expenses: 300,
    commission: 500,
    commissionTaxRate: 15,
  });
  return {
    subject: {
      kind: "property",
      id: "p1",
      name: "برج النخيل",
      code: null,
      parentName: "مجمع قنوات",
      ownerName: "ناصر العتيبي",
      address: "طريق الملك فهد، العليا، الرياض",
    },
    period: {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-03-31T23:59:59.999Z",
    },
    currency: "SAR",
    propertyCount: 1,
    unitCount: 3,
    occupiedUnits: 2,
    vacantUnits: 1,
    commissionSource: "agreements",
    commissionPercentage: 5,
    agreements: [
      {
        id: "a1",
        number: "AGR-1",
        kind: "management",
        fee: { type: "percentage", percentage: 5, amount: 0, frequency: "monthly" },
        commissionBasis: "collected",
      },
    ],
    sharedBetweenUnits: null,
    totals: {
      rentCollected: settlement.collected,
      rentBilled: 10_350,
      outstanding: 1_200,
      expenses: settlement.expenses,
      commissionBase: 10_000,
      commission: settlement.commission,
    },
    settlement,
    payments: [
      {
        paymentId: "pay1",
        date: "2026-01-10T10:00:00.000Z",
        tenantName: "شركة كلين تراك",
        propertyId: "p1",
        propertyName: "برج النخيل",
        unitId: "u1",
        unitNumber: "101",
        leaseId: "l1",
        contractNumber: "683",
        frequency: "monthly",
        contractTotal: 82_800,
        receivedBy: "office",
        paymentMethod: "cash",
        paymentType: "rent",
        amount: 6_900,
        currency: "SAR",
        notes: "دفعة يناير",
        receiptNumber: "RCP-202601-AAAAAA",
      },
    ],
    expenses: [
      {
        expenseId: "e1",
        date: "2026-02-01T10:00:00.000Z",
        propertyId: "p1",
        unitId: null,
        propertyName: "برج النخيل",
        category: "maintenance",
        description: "تنظيف الممرات",
        reference: "EXP-1",
        amount: 100,
      },
    ],
    breakdownKind: "unit",
    breakdown: [
      {
        id: "u1",
        level: "unit",
        label: "101",
        status: "occupied",
        rentBilled: 6_900,
        rentCollected: 6_900,
        collectedByOwner: 0,
        expenses: 200,
        commission: 300,
        commissionTax: 45,
        investmentRent: 0,
        ownerShare: 6_355,
      },
      {
        id: "building:p1",
        level: "building",
        label: "برج النخيل",
        status: null,
        rentBilled: 0,
        rentCollected: 1_000,
        collectedByOwner: 0,
        expenses: 100,
        commission: 50,
        commissionTax: 7.5,
        investmentRent: 0,
        ownerShare: 842.5,
      },
    ],
  };
}

const period = "2026-01-01 to 2026-03-31";

describe("the details say what, whose, where and when", () => {
  test("a building statement", () => {
    const details = entityStatementDetails(building(), english, {
      period,
      money: (amount) => amount,
    });
    const labels = details.map(([label]) => label);
    assert.deepEqual(labels.slice(0, 5), [
      "Building",
      "Compound",
      "Owner",
      "Address",
      "Period",
    ]);
    const value = (label: string) => details.find(([key]) => key === label)?.[1];
    assert.equal(value("Building"), "برج النخيل");
    assert.equal(value("Period"), period);
    assert.equal(value("Agreement"), "AGR-1 — 5% of rent collected, before VAT");
    assert.equal(value("Units"), "3 — occupied 2, vacant 1");
    // Not simply everything collected, so it is said.
    assert.equal(value("Commission charged on"), 10_000);
  });

  test("a unit statement names its building and its share of a flat fee", () => {
    const unit: EntityStatement = {
      ...building(),
      subject: { ...building().subject, kind: "unit", name: "101", parentName: "برج النخيل" },
      breakdownKind: "none",
      breakdown: [],
      sharedBetweenUnits: 12,
    };
    const details = entityStatementDetails(unit, arabic, {
      period,
      money: (amount) => amount,
    });
    const labels = details.map(([label]) => label);
    assert.equal(labels[0], "الوحدة");
    assert.equal(details[1][1], "برج النخيل");
    assert.ok(
      details.some(([, value]) => String(value).includes("12")),
      "says how many units share the fee",
    );
    assert.ok(!labels.includes("الوحدات"), "a unit is not counted in units");
  });
});

describe("titles", () => {
  test("in the reader's language, never the generic 'Statement'", () => {
    assert.equal(entityStatementTitle("compound", arabic), "كشف حساب المجمع");
    assert.equal(entityStatementTitle("unit", arabic), "كشف حساب الوحدة");
    assert.equal(entityStatementTitle("property", english), "Property statement");
  });
});

describe("the exported document", () => {
  test("a building leads with its units, then every payment and expense", () => {
    const statement = building();
    const sheet = breakdownStatementSheet(statement, {
      title: entityStatementTitle("property", arabic),
      details: [["العقار", "برج النخيل"]],
      tr: arabic,
    });
    assert.equal(sheet.document?.tableTitle, "حسب الوحدة");
    assert.deepEqual(
      sheet.document?.sections?.map((section) => section.title),
      [
        pdfLabel("ar", "clients.statement.payments.title", "Payments"),
        pdfLabel("ar", "clients.statement.expenseRows.title", "Expenses"),
      ],
    );
    // Every payment on its own row, with its note and receipt.
    const payments = sheet.document!.sections![0];
    assert.equal(payments.rows.length, 1);
    assert.ok(payments.rows[0].includes("دفعة يناير"));
    assert.ok(payments.rows[0].includes("RCP-202601-AAAAAA"));
    // The building's own row, and a unit's status, in Arabic.
    const cells = sheet.rows.map((row) => sheet.columns.map((column) => column.value(row)));
    assert.equal(cells[1][0], "على مستوى العقار");
    assert.equal(cells[0][1], "مشغولة");
    assert.equal(sheet.summary?.[1][0], "عمولة الإدارة %5");
  });

  test("a unit leads with its payments, and prints no English", () => {
    const unit: EntityStatement = {
      ...building(),
      breakdownKind: "none",
      breakdown: [],
    };
    const sheet = unitStatementSheet(unit, {
      title: entityStatementTitle("unit", arabic),
      details: [],
      tr: arabic,
    });
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.document?.sections?.length, 1);
    const csv = toCsv(localizeSheet(sheet, "ar"));
    assert.ok(!csv.includes("charged at building level"));
    assert.ok(csv.includes("تنظيف الممرات"));
  });
});
