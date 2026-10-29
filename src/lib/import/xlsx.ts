/**
 * PropertyPro - Excel (.xlsx) import files
 *
 * Offices keep their contracts and collections in Excel, and "save as CSV"
 * is a step that loses things on the way: Arabic turns into question marks
 * in older Excel builds, a national ID becomes 1.01E+09, and a date becomes
 * whatever the machine's locale prints. Reading the workbook itself avoids
 * all three.
 *
 * The first worksheet is read into exactly the rows the CSV parser produces
 * (`tableFromCells` in csv.ts), so the importers never know which kind of
 * file they were given.
 *
 * No database, so it can be tested.
 */

import ExcelJS from "exceljs";
import { tableFromCells, type ParsedCsv } from "./csv";

/**
 * An .xlsx is compressed, so the size cap the route puts on every upload
 * holds many more rows of it than of a CSV. This is roughly what the same
 * cap holds as CSV; a sheet past it is refused instead of read into memory.
 */
export const MAX_XLSX_ROWS = 50_000;

export type ImportFileKind = "csv" | "xlsx" | "xls";

/**
 * What an upload is, from its first bytes rather than its name: an .xlsx is
 * a zip archive ("PK\x03\x04"), the old binary .xls an OLE2 compound file
 * (D0 CF 11 E0). Anything else is read as CSV text. A workbook renamed to
 * .csv, or a CSV saved with an .xlsx name, still goes to the right reader.
 */
export function importFileKind(firstBytes: Uint8Array): ImportFileKind {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => firstBytes[index] === byte);
  if (starts(0x50, 0x4b, 0x03, 0x04)) return "xlsx";
  if (starts(0xd0, 0xcf, 0x11, 0xe0)) return "xls";
  return "csv";
}

/**
 * One cell as the text a CSV of the same sheet would hold.
 *
 * A date cell becomes its calendar day, "2026-03-01". Excel stores no zone,
 * and ExcelJS hands the day back at midnight UTC, so the UTC date is the day
 * that was typed; any time of day is dropped — the importers read days.
 * A formula gives its last calculated result, a link its text, rich text its
 * characters, and an error cell (#N/A) nothing.
 */
export function cellText(value: ExcelJS.CellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? ""
      : value.toISOString().slice(0, 10);
  }
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((run) => run.text).join("");
  }
  if ("hyperlink" in value) {
    return cellText(value.text as ExcelJS.CellValue);
  }
  if ("formula" in value || "sharedFormula" in value) {
    return cellText(value.result as ExcelJS.CellValue);
  }
  // { error: "#N/A" } and anything newer than this list.
  return "";
}

/**
 * The first worksheet of an .xlsx as import rows, the first row its
 * headings. Throws, with a message for the person who uploaded it, when the
 * file is not a readable workbook, has no sheet, or is over MAX_XLSX_ROWS.
 */
export async function readXlsxTable(data: ArrayBuffer): Promise<ParsedCsv> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(data);
  } catch {
    throw new Error(
      "This Excel file could not be read. Open it in Excel and save it again as .xlsx, or save it as CSV.",
    );
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("The file is empty");
  if (sheet.actualRowCount > MAX_XLSX_ROWS + 1) {
    throw new Error(
      `The sheet has more than ${MAX_XLSX_ROWS.toLocaleString("en")} rows. Split it and import in batches.`,
    );
  }

  const rows: string[][] = [];
  sheet.eachRow({ includeEmpty: false }, (row) => {
    // `row.values` is 1-based and sparse: index 0 is always empty, and a
    // blank cell between two filled ones is a hole, which Array.from reads
    // as undefined — the empty string a CSV would have there.
    const values = row.values as ExcelJS.CellValue[];
    rows.push(Array.from(values.slice(1), (value) => cellText(value).trim()));
  });

  // Blank rows go, as the CSV parser drops them: a row with only spaces or
  // an empty formula in it is not a row anyone meant to import.
  return tableFromCells(rows.filter((cells) => cells.some((cell) => cell !== "")));
}

/**
 * A one-sheet workbook — a starter template. Every column is formatted as
 * text, so what the office types stays as typed: a national ID or a phone
 * number keeps its leading zero instead of becoming a number, and a date is
 * read exactly as written.
 */
export async function buildXlsx(
  rows: string[][],
  sheetName = "Import",
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PropertyPro";
  const sheet = workbook.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const width = Math.max(0, ...rows.map((row) => row.length));
  sheet.columns = Array.from({ length: width }, (_, index) => ({
    width: Math.min(
      40,
      Math.max(12, ...rows.map((row) => (row[index] ?? "").length + 2)),
    ),
    style: { numFmt: "@" },
  }));
  rows.forEach((row) => sheet.addRow(row));
  sheet.getRow(1).font = { bold: true };

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
