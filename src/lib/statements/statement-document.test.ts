/**
 * The agreement statement has to read like the client's sample.
 *
 * كشف حساب إتفاقيات الإدارة: the office's name, CR and logo; a summary titled
 * الملخص with exactly eight rows, in the sample's order and words, the
 * percentage in the commission's label and nowhere else; then one row per
 * payment — التاريخ، المستأجر، الوحدة، العقد، دورة الإيجار، إجمالي العقد،
 * المستلم، المبلغ، ملاحظة، السند — and the expenses in a table of their own.
 * The screen and the exports print it from the same wording (summary.ts,
 * document.ts); these pin that wording and the exported document.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import { toCsv, toXlsx, localizeSheet } from "@/lib/reports/export";
import { toPdf } from "@/lib/reports/pdf";
import { captureDrawnText } from "@/lib/testing/pdf-text-capture";
import type { LineTranslate } from "@/lib/statements/line-text";
import { settle } from "@/lib/statements/settlement";
import {
  statementSummaryRows,
  uniformCommissionPercentage,
} from "@/lib/statements/summary";
import {
  feeDetailText,
  paymentCycleText,
  paymentNoteText,
  paymentUnitText,
  receivedByText,
  statementPaymentColumns,
} from "@/lib/statements/document";
import { statementSheet } from "@/lib/statements/statement-sheet";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import type {
  OwnerStatement,
  StatementExpenseRow,
  StatementPaymentRow,
} from "@/types/owner";

const arabic: LineTranslate = (key, english, values) =>
  pdfLabel("ar", key, english, values);
const english: LineTranslate = (key, fallback, values) =>
  pdfLabel("en", key, fallback, values);

/** The client's first sample, settled. */
const sample = settle({
  collected: 299_317,
  collectedByOwner: 222_117,
  expenses: 0,
  commission: 5_986.34,
  commissionTaxRate: 15,
});

const sampleFigures = {
  collected: sample.collected,
  commission: sample.commission,
  commissionTax: sample.commissionTax,
  expenses: sample.expenses,
  investmentRent: sample.investmentRent,
  collectedByOwner: sample.collectedByOwner,
  collectedByOperator: sample.collectedByOperator,
  dueToOwner: sample.dueToOwner,
  dueToOperator: sample.dueToOperator,
};

function payment(overrides: Partial<StatementPaymentRow> = {}): StatementPaymentRow {
  return {
    paymentId: "cmg0000000000000000a1b2c3d",
    date: "2026-08-11T00:00:00.000Z",
    tenantName: "شركة كلين تراك",
    propertyId: "p1",
    propertyName: "مجمع قنوات 102",
    unitId: "u29",
    unitNumber: "إستراحة 29",
    leaseId: "l1",
    contractNumber: "683",
    frequency: "monthly",
    contractTotal: 36_000,
    receivedBy: "office",
    paymentMethod: "cash",
    paymentType: "rent",
    amount: 3_000,
    currency: "SAR",
    notes: null,
    receiptNumber: "RCP-202608-A1B2C3",
    ...overrides,
  };
}

const expense: StatementExpenseRow = {
  expenseId: "e1",
  date: "2026-08-20T00:00:00.000Z",
  propertyId: "p1",
  unitId: null,
  propertyName: "مجمع قنوات 102",
  category: "maintenance",
  description: "إصلاح مكيف",
  reference: "INV-77",
  amount: 450,
};

function statement(): OwnerStatement {
  return {
    owner: {
      userId: "o1",
      name: "ناصر",
      email: null,
      companyName: null,
      isSelf: false,
    },
    period: {
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2026-09-29T23:59:59.999Z",
    },
    currency: "SAR",
    propertyCount: 1,
    commissionSource: "agreements",
    commissionPercentage: 2,
    totals: {
      rentCollected: sample.collected,
      rentBilled: 300_000,
      outstanding: 0,
      expenses: sample.expenses,
      commissionBase: sample.collected,
      commission: sample.commission,
      commissionTax: sample.commissionTax,
      commissionTaxRate: 15,
      investmentRent: 0,
      collectedByOwner: sample.collectedByOwner,
      collectedByOperator: sample.collectedByOperator,
      ownerShare: sample.ownerShare,
      dueToOwner: sample.dueToOwner,
      dueToOperator: sample.dueToOperator,
    },
    payments: [
      payment(),
      payment({
        paymentId: "cmg0000000000000000d4e5f6g",
        tenantName: "علي احمد بن علي الزهراني",
        unitNumber: "غرفة 65",
        contractNumber: "517",
        contractTotal: 18_000,
        receivedBy: "owner",
        paymentMethod: "owner_cash",
        amount: 1_500,
      }),
      payment({
        paymentId: "cmg0000000000000000h7i8j9k",
        paymentType: "security_deposit",
        amount: 2_000,
        notes: "دفعة التأمين",
      }),
    ],
    expenses: [expense],
    contracts: [],
    byProperty: [],
  };
}

describe("the summary — الملخص", () => {
  test("is the sample's eight rows, in its order and its words", () => {
    const rows = statementSummaryRows(sampleFigures, 2, arabic);
    assert.deepEqual(
      rows.map((row) => [row.label, row.amount]),
      [
        ["إجمالي المحصل", 299_317],
        // Stored "%2": after Arabic letters a trailing "2%" is laid out as
        // "%2" by every bidi engine (the browser's and jsPDF's alike), so the
        // sign is written first to read "2%" on the page, as the sample does.
        ["عمولة الإدارة %2", 5_986.34],
        ["ضريبة المشغل", 897.95],
        ["المصاريف", 0],
        ["مستلمة من قبل المالك", 222_117],
        ["مستلمة من قبل المشغل", 77_200],
        ["مستحقات المالك", 70_315.71],
        ["مستحقات المشغل", 0],
      ],
    );
  });

  test("carries the percentage in the commission label and nowhere else", () => {
    const labels = statementSummaryRows(sampleFigures, 2, english).map(
      (row) => row.label,
    );
    assert.deepEqual(
      labels.filter((label) => label.includes("%")),
      ["Management commission 2%"],
    );
  });

  test("a flat fee, or agreements that differ, name no rate", () => {
    const rows = statementSummaryRows(sampleFigures, null, arabic);
    assert.equal(rows[1].label, "عمولة الإدارة");
  });

  test("an investment agreement's rent is the only row the sample does not have", () => {
    const rows = statementSummaryRows(
      { ...sampleFigures, investmentRent: 10_000 },
      2,
      english,
    );
    assert.equal(rows.length, 9);
    assert.equal(rows[4].key, "investmentRent");
    assert.equal(statementSummaryRows(sampleFigures, 2, english).length, 8);
  });
});

describe("the commission's rate", () => {
  const management = (percentage: number, commission = 100) => ({
    agreementKind: "management" as const,
    fee: { type: "percentage", percentage },
    commission,
  });

  test("is the one percentage every agreement charges", () => {
    assert.equal(uniformCommissionPercentage([management(2), management(2)]), 2);
  });

  test("is left out when agreements differ, or the fee is flat", () => {
    assert.equal(uniformCommissionPercentage([management(2), management(3)]), null);
    assert.equal(
      uniformCommissionPercentage([
        {
          agreementKind: "management",
          fee: { type: "fixed", percentage: 0 },
          commission: 3_000,
        },
      ]),
      null,
    );
    assert.equal(uniformCommissionPercentage([]), null);
  });

  test("a building that earned nothing does not make it ambiguous", () => {
    assert.equal(
      uniformCommissionPercentage([management(2), management(3, 0)]),
      2,
    );
  });
});

describe("a payment's row", () => {
  test("names the unit, then its building", () => {
    assert.equal(paymentUnitText(payment()), "إستراحة 29 - مجمع قنوات 102");
  });

  test("gives the contract's cycle and who received the money", () => {
    assert.equal(paymentCycleText(payment(), arabic), "شهري");
    assert.equal(receivedByText(payment(), arabic), "المشغل");
    assert.equal(receivedByText(payment({ receivedBy: "owner" }), arabic), "المالك");
  });

  test("says when a payment is not rent, before its note", () => {
    assert.equal(paymentNoteText(payment(), arabic), "");
    assert.equal(paymentNoteText(payment({ notes: "دفعة جزئية" }), arabic), "دفعة جزئية");
    assert.equal(
      paymentNoteText(
        payment({ paymentType: "security_deposit", notes: "دفعة التأمين" }),
        arabic,
      ),
      "تأمين — دفعة التأمين",
    );
  });

  test("says a note the system wrote in the statement's language", () => {
    assert.equal(
      paymentNoteText(payment({ notes: "Recorded in bulk" }), arabic),
      "سُجِّلت ضمن عملية جماعية",
    );
    assert.equal(
      paymentNoteText(
        payment({ paymentType: "security_deposit", notes: "Required before lease commencement" }),
        arabic,
      ),
      "تأمين — مطلوب قبل بدء العقد",
    );
  });

  test("has the sample's columns, in the sample's order", () => {
    assert.deepEqual(
      statementPaymentColumns(arabic).map((column) => column.header),
      [
        "التاريخ",
        "المستأجر",
        "الوحدة",
        "العقد",
        "دورة الإيجار",
        "إجمالي العقد",
        "المستلم",
        "المبلغ",
        "ملاحظة",
        "السند",
      ],
    );
  });
});

describe("the receipt number — السند", () => {
  test("is the issued receipt's number when there is one", () => {
    assert.equal(receiptNumberFor("cmg0000000000000000a1b2c3d", "RCP-202608-A1B2C3"), "RCP-202608-A1B2C3");
  });

  test("is otherwise the number its printed receipt carries", () => {
    assert.equal(receiptNumberFor("cmg0000000000000000a1b2c3d", null), "RCP-0A1B2C3D");
    assert.equal(receiptNumberFor("cmg0000000000000000a1b2c3d", "  "), "RCP-0A1B2C3D");
  });
});

describe("the fee on the details line", () => {
  test("states the percentage in full, and what it is charged on", () => {
    const fee = { type: "percentage", percentage: 2, amount: 0, frequency: "monthly" };
    assert.equal(feeDetailText(fee, "collected", arabic), "2% من الإيجار المحصل قبل الضريبة");
    assert.equal(feeDetailText(fee, "billed", english), "2% of rent billed, before VAT");
  });

  test("a flat fee is its amount and cycle", () => {
    assert.equal(
      feeDetailText(
        { type: "fixed", percentage: 0, amount: 3_000, frequency: "monthly" },
        "collected",
        arabic,
      ),
      "3,000 / شهري",
    );
  });
});

describe("the exported statement", () => {
  const details: Array<[string, string | number]> = [
    ["الاتفاقية", "AG-7"],
    ["المالك", "ناصر"],
    ["أتعاب الإدارة", "2% من الإيجار المحصل قبل الضريبة"],
    ["الفترة", "2026-01-01 to 2026-09-29"],
  ];
  const sheet = () =>
    statementSheet(statement(), {
      title: "كشف حساب إتفاقيات الإدارة",
      details,
      tr: arabic,
    });

  test("reads top to bottom as the sample: details, summary, payments, expenses", () => {
    const lines = toCsv(localizeSheet(sheet(), "ar")).split("\r\n");
    const at = (text: string) => lines.findIndex((line) => line.startsWith(text));
    // A heading is a line of its own; "المصاريف" is also a summary row.
    const heading = (text: string) => lines.lastIndexOf(text);

    assert.ok(at("الاتفاقية") < heading("الملخص"));
    assert.ok(heading("الملخص") < at("إجمالي المحصل,"));
    assert.ok(at("مستحقات المشغل,") < heading("الدفعات"));
    assert.equal(
      lines[heading("الدفعات") + 1],
      "التاريخ,المستأجر,الوحدة,العقد,دورة الإيجار,إجمالي العقد,المستلم,المبلغ,ملاحظة,السند",
    );
    assert.ok(heading("الدفعات") < heading("المصاريف"));
    assert.equal(
      lines[heading("المصاريف") + 1],
      "التاريخ,العقار,البند,الوصف,المرجع,المبلغ",
    );

    // The period is written in the reader's words.
    assert.ok(lines.some((line) => line.startsWith("الفترة,") && line.includes("2026")));
  });

  test("prints the percentage only at the top, never in a row below", () => {
    const lines = toCsv(localizeSheet(sheet(), "ar")).split("\r\n");
    const tableStart = lines.findIndex((line) => line.startsWith("الدفعات"));
    assert.deepEqual(
      lines.slice(tableStart).filter((line) => line.includes("%")),
      [],
    );
    assert.ok(lines.slice(0, tableStart).some((line) => line.includes("عمولة الإدارة %2")));
  });

  test("draws the summary, the payments and the expenses on the PDF", async () => {
    const drawn = await captureDrawnText(() =>
      toPdf(localizeSheet(sheet(), "ar"), {
        rtl: true,
        lang: "ar",
        letterhead: { companyName: "شركة قنوات العقارية", commercialRegistration: "1009034239" },
      }),
    );
    const texts = drawn.map((entry) => entry.text);
    for (const expected of [
      "شركة قنوات العقارية",
      "كشف حساب إتفاقيات الإدارة",
      "الملخص",
      "عمولة الإدارة %2",
      "مستحقات المالك",
      "الدفعات",
      "السند",
      "شركة كلين تراك",
      "إستراحة 29 - مجمع قنوات 102",
      "المصاريف",
      "إصلاح مكيف",
    ]) {
      assert.ok(texts.includes(expected), `missing on the PDF: ${expected}`);
    }
    // In the order the sample has them. "المصاريف" is a summary row too;
    // the section's heading is the last one drawn.
    const last = (text: string) =>
      drawn.map((entry) => entry.text).lastIndexOf(text);
    const order = [last("الملخص"), last("الدفعات"), last("المصاريف")];
    assert.deepEqual([...order].sort((a, b) => a - b), order);
  });

  test("carries the letterhead, its logo and a right-to-left sheet in Excel", async () => {
    const buffer = await toXlsx(localizeSheet(sheet(), "ar"), {
      lang: "ar",
      letterhead: {
        companyName: "شركة قنوات العقارية",
        commercialRegistration: "1009034239",
        logo: {
          dataUrl:
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mOQi1rwH4YZkDkAmmEMixw9b6kAAAAASUVORK5CYII=",
          format: "PNG",
          width: 3,
          height: 2,
        },
      },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];

    const firstCells: string[] = [];
    const rowNumbers: number[] = [];
    worksheet.eachRow((row, rowNumber) => {
      firstCells.push(String(row.getCell(1).value ?? ""));
      rowNumbers.push(rowNumber);
    });

    assert.equal(firstCells[0], "شركة قنوات العقارية");
    assert.ok(firstCells.includes("الملخص"));
    assert.ok(firstCells.includes("الدفعات"));
    assert.ok(firstCells.includes("المصاريف"));
    // "المصاريف" is a summary row too; the section's heading comes last.
    assert.ok(firstCells.indexOf("الملخص") < firstCells.indexOf("الدفعات"));
    assert.ok(firstCells.indexOf("الدفعات") < firstCells.lastIndexOf("المصاريف"));

    // The summary's eight rows, with their figures as numbers.
    const summaryStart = rowNumbers[firstCells.indexOf("الملخص")] + 1;
    const figures = Array.from({ length: 8 }, (_, index) => {
      const row = worksheet.getRow(summaryStart + index);
      return [row.getCell(1).value, row.getCell(2).value];
    });
    assert.deepEqual(figures[1], ["عمولة الإدارة %2", 5_986.34]);
    assert.deepEqual(figures[6], ["مستحقات المالك", 70_315.71]);

    assert.equal(worksheet.getImages().length, 1);
    assert.equal(worksheet.views[0]?.rightToLeft, true);
  });
});
