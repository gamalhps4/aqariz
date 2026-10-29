/**
 * An Excel file reaches the importers as the same rows a CSV of it would.
 *
 * Offices keep contracts and collections in Excel, and "save as CSV" loses
 * things on the way: Arabic, the leading zero of an ID, the date as typed.
 * The workbook is read itself — first sheet, first row the headings — into
 * exactly what `parseCsv` produces, so no importer knows the difference.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import { parseCsv } from "@/lib/import/csv";
import {
  buildXlsx,
  cellText,
  importFileKind,
  readXlsxTable,
} from "@/lib/import/xlsx";

async function workbookBytes(
  fill: (sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook) => void,
): Promise<ArrayBuffer> {
  const workbook = new ExcelJS.Workbook();
  fill(workbook.addWorksheet("Contracts"), workbook);
  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer as unknown as ArrayBuffer).slice().buffer;
}

describe("an .xlsx upload", () => {
  test("reads to the same rows as the CSV of the same sheet", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["Building Name", "unit_number", "Start Date", "Rent Amount", "Notes"]);
      sheet.addRow(["شقق الواحة", "B201", new Date(Date.UTC(2026, 2, 1)), 1450.5, "أول عقد"]);
      sheet.addRow(["Maple Court", "1A", "01/04/2026", 1200, ""]);
    });

    const fromExcel = await readXlsxTable(bytes);
    const fromCsv = parseCsv(
      [
        "Building Name,unit_number,Start Date,Rent Amount,Notes",
        "شقق الواحة,B201,2026-03-01,1450.5,أول عقد",
        "Maple Court,1A,01/04/2026,1200,",
      ].join("\r\n"),
    );
    assert.deepEqual(fromExcel, fromCsv);
  });

  test("reads only the first sheet", async () => {
    const bytes = await workbookBytes((sheet, workbook) => {
      sheet.addRow(["unitNumber"]);
      sheet.addRow(["A101"]);
      const other = workbook.addWorksheet("Notes");
      other.addRow(["unitNumber"]);
      other.addRow(["Z999"]);
    });
    const table = await readXlsxTable(bytes);
    assert.deepEqual(table.rows, [{ unitnumber: "A101" }]);
  });

  test("keeps a blank cell between filled ones in its column and drops blank rows", async () => {
    const bytes = await workbookBytes((sheet) => {
      sheet.addRow(["a", "b", "c"]);
      sheet.getCell("A2").value = "first";
      sheet.getCell("C2").value = "third";
      // Row 3 left empty; a row with only a space in it is not a row either.
      sheet.getCell("B4").value = "  ";
      sheet.getCell("B5").value = "middle";
    });
    const table = await readXlsxTable(bytes);
    assert.deepEqual(table.rows, [
      { a: "first", b: "", c: "third" },
      { a: "", b: "middle", c: "" },
    ]);
  });

  test("refuses a file that is not a workbook, with a reason", async () => {
    const zipButNotExcel = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4]).buffer;
    await assert.rejects(readXlsxTable(zipButNotExcel), /could not be read/);
  });

  test("refuses a sheet with no heading row", async () => {
    const bytes = await workbookBytes(() => undefined);
    await assert.rejects(readXlsxTable(bytes), /empty/);
  });
});

describe("a cell", () => {
  test("is read as the text a CSV would hold", () => {
    assert.equal(cellText(null), "");
    assert.equal(cellText(undefined), "");
    assert.equal(cellText("text"), "text");
    assert.equal(cellText(1012345678), "1012345678");
    assert.equal(cellText(true), "true");
    // A date is its calendar day — Excel keeps no zone and ExcelJS hands the
    // typed day back at midnight UTC.
    assert.equal(cellText(new Date(Date.UTC(2026, 9, 4))), "2026-10-04");
    assert.equal(
      cellText({ richText: [{ text: "شقق " }, { text: "الواحة" }] }),
      "شقق الواحة",
    );
    assert.equal(
      cellText({ text: "tenant@example.com", hyperlink: "mailto:tenant@example.com" }),
      "tenant@example.com",
    );
    assert.equal(cellText({ formula: "A1*12", result: 18000 }), "18000");
    assert.equal(cellText({ error: "#N/A" } as ExcelJS.CellErrorValue), "");
  });
});

describe("the kind of an upload", () => {
  test("is told from its first bytes, not its name", () => {
    assert.equal(importFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04])), "xlsx");
    assert.equal(importFileKind(new Uint8Array([0xd0, 0xcf, 0x11, 0xe0])), "xls");
    assert.equal(importFileKind(new TextEncoder().encode("name,type\n")), "csv");
    assert.equal(importFileKind(new Uint8Array([0xef, 0xbb, 0xbf, 0x6e])), "csv");
  });
});

describe("a starter workbook", () => {
  test("reads back as its own columns and example", async () => {
    const rows = [
      ["tenantIdNumber", "tenantPhone", "startDate"],
      ["0123456789", "0501234567", "01/03/2026"],
    ];
    const buffer = await buildXlsx(rows, "leases");
    const table = await readXlsxTable(
      new Uint8Array(buffer).slice().buffer,
    );
    assert.deepEqual(table.headers, rows[0]);
    assert.deepEqual(table.rows, [
      { tenantidnumber: "0123456789", tenantphone: "0501234567", startdate: "01/03/2026" },
    ]);
  });

  test("formats every column as text, so a typed ID keeps its leading zero", async () => {
    const buffer = await buildXlsx([["idNumber"], ["0123"]]);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(new Uint8Array(buffer).slice().buffer);
    const sheet = workbook.worksheets[0];
    assert.equal(sheet.getColumn(1).numFmt, "@");
    assert.equal(sheet.getRow(1).font?.bold, true);
  });
});
