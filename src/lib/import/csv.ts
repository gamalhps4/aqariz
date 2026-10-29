/**
 * PropertyPro - CSV parsing
 *
 * A small RFC 4180 parser rather than a dependency: the app already ships CSV
 * *export* by hand, imports are a single well-defined shape, and a parser is
 * about eighty lines. It handles what real spreadsheet exports contain —
 * quoted fields, embedded commas and newlines, doubled quotes, CRLF endings
 * and a UTF-8 BOM — which naive `split(",")` does not.
 */

export interface ParsedCsv {
  headers: string[];
  rows: Array<Record<string, string>>;
}

const BOM = "﻿";

/** Split raw CSV text into rows of raw cells. */
export function parseCsvRows(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        // A doubled quote inside a quoted field is a literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      // Treat CRLF as one break, not two.
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  // Whatever is left when the input ends is the final field, unless the file
  // ended on a newline (in which case there is nothing pending).
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

/** Header names are matched loosely so "Unit Number", "unit_number" and
 * "unitnumber" all resolve to the same column. */
export function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

/**
 * Parse into objects keyed by normalized header.
 * Throws on an empty file or a header row with no usable columns.
 */
export function parseCsv(input: string): ParsedCsv {
  return tableFromCells(parseCsvRows(input));
}

/**
 * Rows of raw cells — the first one the headings — as the records every
 * importer reads. Shared by the CSV parser and the Excel reader (xlsx.ts), so
 * a spreadsheet saved either way reaches the importers as the same thing and
 * none of them needs to know which it was.
 */
export function tableFromCells(rows: string[][]): ParsedCsv {
  if (rows.length === 0) {
    throw new Error("The file is empty");
  }

  const rawHeaders = rows[0].map((header) => header.trim());
  const headers = rawHeaders.map(normalizeHeader);
  if (headers.every((header) => header === "")) {
    throw new Error("The first row must contain column headings");
  }

  const parsed = rows.slice(1).map((cells) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = (cells[index] ?? "").trim();
    });
    return record;
  });

  return { headers: rawHeaders, rows: parsed };
}

/** Read the first non-empty value among several accepted column spellings. */
export function pick(
  row: Record<string, string>,
  ...names: string[]
): string {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value) return value;
  }
  return "";
}

/** Spreadsheets emit "1,200.50", "$1200", "" — all of which mean a number. */
export function toNumber(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[^0-9.-]/g, "");
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toBoolean(value: string): boolean {
  return ["true", "yes", "y", "1"].includes(value.trim().toLowerCase());
}

export function toDate(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
