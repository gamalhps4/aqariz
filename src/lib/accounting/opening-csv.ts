/**
 * PropertyPro - Reading opening balances from a spreadsheet
 *
 * One row per balance: the account's code, its debit or its credit, and
 * optionally a note and the party it belongs to (an owner's payable, a
 * tenant's receivable). A header row is recognised in English or Arabic and
 * may put the columns in any order; without one the columns are taken as
 * code, debit, credit, memo, party type, party id. Commas or semicolons
 * (Excel saves Arabic-locale CSV with semicolons), quoted fields, and Arabic
 * digits are all read.
 *
 * Pure: the route resolves the codes to accounts and posts.
 */

export interface OpeningCsvRow {
  /** 1-based line in the file, for the error messages. */
  line: number;
  code: string;
  debit: string;
  credit: string;
  memo: string;
  partyType: string;
  partyId: string;
}

export interface OpeningCsvResult {
  rows: OpeningCsvRow[];
  errors: Array<{ line: number; code: "MISSING_CODE" | "NO_COLUMNS" }>;
}

type Column = "code" | "debit" | "credit" | "memo" | "partyType" | "partyId";

const HEADER_NAMES: Record<Column, readonly string[]> = {
  code: ["code", "account", "account code", "رمز الحساب", "الرمز", "رقم الحساب", "الحساب"],
  debit: ["debit", "dr", "مدين"],
  credit: ["credit", "cr", "دائن"],
  memo: ["memo", "description", "note", "notes", "البيان", "الوصف", "ملاحظات"],
  partyType: ["party type", "party_type", "نوع الطرف"],
  partyId: ["party id", "party_id", "الطرف"],
};

const DEFAULT_ORDER: Column[] = ["code", "debit", "credit", "memo", "partyType", "partyId"];

function splitRow(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function headerColumn(cell: string): Column | null {
  const name = cell.trim().toLowerCase();
  for (const column of DEFAULT_ORDER) {
    if (HEADER_NAMES[column].includes(name)) return column;
  }
  return null;
}

export function parseOpeningBalancesCsv(text: string): OpeningCsvResult {
  const lines = text.replace(/^﻿/, "").split(/\r\n|\n|\r/);
  const first = lines.find((line) => line.trim() !== "") ?? "";
  // Semicolons when they outnumber commas on the first row.
  const delimiter =
    (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ";" : ",";

  const result: OpeningCsvResult = { rows: [], errors: [] };
  let order: Column[] | null = null;

  lines.forEach((raw, index) => {
    if (raw.trim() === "") return;
    const cells = splitRow(raw, delimiter);
    const lineNumber = index + 1;

    if (order === null) {
      const columns = cells.map(headerColumn);
      if (columns.includes("code")) {
        order = columns.map((column) => column ?? ("ignored" as Column));
        return;
      }
      order = DEFAULT_ORDER;
    }

    if (cells.length < 2) {
      result.errors.push({ line: lineNumber, code: "NO_COLUMNS" });
      return;
    }
    const value = (column: Column) => {
      const position = order!.indexOf(column);
      return position >= 0 ? (cells[position] ?? "").trim() : "";
    };
    const code = value("code");
    if (!code) {
      result.errors.push({ line: lineNumber, code: "MISSING_CODE" });
      return;
    }
    result.rows.push({
      line: lineNumber,
      code,
      debit: value("debit"),
      credit: value("credit"),
      memo: value("memo"),
      partyType: value("partyType"),
      partyId: value("partyId"),
    });
  });

  return result;
}
