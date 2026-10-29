/**
 * PropertyPro - Report export
 *
 * One place that turns a report into a downloadable file, so every report in
 * the system exports the same way and gaining a new format is a change here
 * rather than in each route.
 *
 * Excel (.xlsx) is the format the scope asks for and the default the UI
 * offers; PDF is what gets sent to an owner, because it prints the same on
 * every machine and cannot be edited on the way; CSV stays available for
 * anything that needs to be machine-read.
 */

import ExcelJS from "exceljs";
import { noteReportExport } from "@/lib/audit/export-note";
import { registrationLine, toPdf, type ReportLetterhead } from "./pdf";
import { fitLogo } from "@/lib/invoice/logo-utils";
import { isRtlLanguage } from "@/lib/invoice/pdf-i18n";
import {
  translateLabel,
  translateValue,
  type ReportLanguage,
  type ValueOptions,
} from "./labels";
import { buildCsv, isFormulaLike, type CsvCell } from "./csv";
import {
  documentDateFormat,
  slashedDateFormat,
  translateMonthCell,
} from "./date-format";
import {
  filtersBlock as buildFiltersBlock,
  type FiltersBlock,
  type ReportFiltersSummary,
} from "./filters-summary";
import { formatPrintDate } from "./page-footer";
import { printHeaderFooter } from "./xlsx-print";

export { reportLanguage, type ReportLanguage } from "./labels";
export { isFormulaLike };
export type {
  FilterValue,
  FiltersBlock,
  ReportFiltersSummary,
} from "./filters-summary";

export type ReportFormat = "csv" | "xlsx" | "pdf";

export const REPORT_FORMATS: readonly ReportFormat[] = [
  "xlsx",
  "pdf",
  "csv",
] as const;

export function isReportFormat(value: unknown): value is ReportFormat {
  return REPORT_FORMATS.includes(value as ReportFormat);
}

/**
 * Whether this download wants a right-to-left PDF.
 *
 * The export control sets `rtl=1` when the operator's interface is Arabic.
 * It is a request parameter rather than an organization setting because the
 * same office exports the same report in both languages, depending on who is
 * asking and who the file is going to.
 */
export function isRtlReportRequest(searchParams: URLSearchParams): boolean {
  const value = searchParams.get("rtl");
  return value === "1" || value === "true";
}

/**
 * How many rows a list export will carry.
 *
 * A list export is "everything the filters match", not "the page you are
 * looking at" — that is the whole point of it. But everything is unbounded,
 * and an office that exports with no filters set should get a large file
 * rather than a failed request and a spike in the database. The cap is high
 * enough that a real filtered export is never truncated, and the caller is
 * told when it was.
 */
export const EXPORT_ROW_LIMIT = 5000;

/**
 * How many rows a route reads: one more than the file will hold, so that a
 * list exactly one row over the limit is known to have been cut, and one
 * exactly at it is known not to have been.
 */
export const EXPORT_FETCH_LIMIT = EXPORT_ROW_LIMIT + 1;

/**
 * The rows a file carries, from the rows a route read with
 * `take: EXPORT_FETCH_LIMIT` — and whether the list went on past them.
 */
export function capExportRows<R>(rows: R[]): { rows: R[]; truncated: boolean } {
  return rows.length > EXPORT_ROW_LIMIT
    ? { rows: rows.slice(0, EXPORT_ROW_LIMIT), truncated: true }
    : { rows, truncated: false };
}

/**
 * Whether this caller may carry this module's data out of the building.
 *
 * The review asked for Export as its own column beside View, Add, Edit and
 * Delete, and it is a real distinction: reading the owner payout list on
 * screen and walking out with it as a spreadsheet are different trusts. Until
 * now every export inherited the view permission of the route it sat in, so
 * anyone who could see a list could take it.
 *
 * Deliberately permissive in two directions, so that turning this on takes no
 * capability away from anyone:
 *
 *   - the module's own `*_management` permission still carries export, which
 *     is what every existing custom role was built around;
 *   - `data_export`, the original umbrella the billing plan gates on, still
 *     carries all of them.
 *
 * An office that wants a clerk to read but not export removes those two and
 * grants the narrower `*_view` permissions instead.
 */
export function canExport(
  actor: { permissions?: readonly string[]; isPlatformAdmin?: boolean },
  moduleExport: string,
  moduleManagement?: string,
): boolean {
  if (actor.isPlatformAdmin) return true;
  const held = actor.permissions ?? [];
  if (held.includes(moduleExport)) return true;
  if (held.includes("data_export")) return true;
  if (moduleManagement && held.includes(moduleManagement)) return true;
  return false;
}

/**
 * An owner carrying away their own statement — their owner's statement, or
 * the statement of one of their agreements.
 *
 * `canExport` asks for the office's export permissions, which an owner is
 * never given, so the portal's download answered 403 for every owner. Their
 * own statement is theirs to keep: `reports_own` ("run reports covering only
 * their own records") is what an owner holds for it. The route must already
 * have established that the records are the caller's own.
 */
export function canExportOwnReport(actor: {
  isOwner?: boolean;
  permissions?: readonly string[];
}): boolean {
  return Boolean(actor.isOwner) && (actor.permissions ?? []).includes("reports_own");
}

/** The refusal an export branch returns when `canExport` says no. */
export const EXPORT_DENIED_MESSAGE =
  "You do not have permission to export this data.";

export interface ReportColumn<T> {
  /** Header text written to the file. */
  header: string;
  /** Cell value for one row. Return null/undefined for an empty cell. */
  value: (row: T) => string | number | null | undefined;
}

export interface ReportSheet<T> {
  title: string;
  columns: ReportColumn<T>[];
  rows: T[];
  /** Optional key/value lines written above the table (totals, filters). */
  summary?: Array<[string, string | number]>;
  /**
   * Opt-in: the layout of a statement of account — see ReportDocument. A
   * sheet without it prints exactly as every report always has
   * (pdf-unchanged.test.ts pins that).
   */
  document?: ReportDocument;
  /**
   * What the file was run with — its row count, the period it covers and the
   * filters in force, by name. Printed as a block under the title in every
   * format, in the reader's language (see lib/reports/filters-summary.ts).
   * A route that filters its list passes it; one that does not leaves it out.
   */
  filtersSummary?: ReportFiltersSummary;
  /**
   * The same block, already in the reader's language. Written by
   * `localizeSheet`; the writers print this one when it is there and work it
   * out from `filtersSummary` themselves when it is not.
   */
  filtersBlock?: FiltersBlock;
}

/**
 * The block under the title: the sheet's own, or the one its description
 * gives. Null for a sheet that carries no description.
 */
function blockOf<T>(
  sheet: ReportSheet<T>,
  language: ReportLanguage,
  options: ValueOptions = {},
): FiltersBlock | null {
  if (sheet.filtersBlock) return sheet.filtersBlock;
  if (!sheet.filtersSummary) return null;
  return buildFiltersBlock(
    sheet.filtersSummary,
    sheet.rows.length,
    language,
    options,
  );
}

/**
 * The parts a statement of account adds to a report, laid out as the
 * statement the client reconciles against (كشف حساب إتفاقيات الإدارة): who
 * and what it is about under the title, a heading over the summary
 * ("الملخص"), a heading over the payments, and further titled tables after
 * them — the expenses. With it, an Excel sheet carries the office's logo as
 * the PDF does.
 */
export interface ReportDocument {
  /** Under the title: the agreement, the owner, the period… */
  details?: Array<[string, string | number]>;
  /** A heading over the summary. */
  summaryTitle?: string;
  /** A heading over the main table. */
  tableTitle?: string;
  /** What the PDF says under the main table when it has no rows. */
  emptyText?: string;
  /** Further tables after the main one, each under its own heading. */
  sections?: ReportSection[];
}

/** A table after the main one: its heading, its headers and its cells. */
export interface ReportSection {
  title: string;
  headers: string[];
  rows: Array<Array<string | number | null | undefined>>;
  /** What the PDF says under it when it has no rows. */
  emptyText?: string;
}

/**
 * A section from typed rows, resolved to cells here — so sections of any row
 * type can sit on one sheet.
 */
export function reportSection<R>(
  title: string,
  columns: ReportColumn<R>[],
  rows: R[],
  emptyText?: string,
): ReportSection {
  return {
    title,
    headers: columns.map((column) => column.header),
    rows: rows.map((row) => columns.map((column) => column.value(row))),
    ...(emptyText ? { emptyText } : {}),
  };
}

/**
 * The same sheet with its headings — and the stored values the catalogue
 * knows — in the reader's language. See lib/reports/labels.ts.
 *
 * English goes through it too: the headings are already English, but the
 * stored values are codes ("credit_card", "owner_account") that an English
 * reader should see as words just as an Arabic one does.
 *
 * With the office's date format, a report period is written in it too (see
 * `translateValue`).
 */
export function localizeSheet<T>(
  sheet: ReportSheet<T>,
  language: ReportLanguage,
  options: ValueOptions = {},
): ReportSheet<T> {
  return {
    ...sheet,
    title: translateLabel(sheet.title, language),
    columns: sheet.columns.map((column) => {
      // A report's months are written in English whatever the reader's
      // language; the column that holds them is named "Month".
      const months = column.header === "Month";
      return {
        header: translateLabel(column.header, language),
        value: (row: T) => {
          const translated = translateValue(column.value(row), language, options);
          return months ? translateMonthCell(translated, language) : translated;
        },
      };
    }),
    ...(sheet.filtersSummary
      ? {
          filtersBlock: buildFiltersBlock(
            sheet.filtersSummary,
            sheet.rows.length,
            language,
            options,
          ),
        }
      : {}),
    summary: sheet.summary?.map(
      ([label, value]) =>
        [
          translateLabel(label, language),
          translateValue(value, language, options),
        ] as [string, string | number],
    ),
    ...(sheet.document
      ? { document: localizeDocument(sheet.document, language, options) }
      : {}),
  };
}

function localizeDocument(
  document: ReportDocument,
  language: ReportLanguage,
  options: ValueOptions,
): ReportDocument {
  const label = (text: string | undefined) =>
    text === undefined ? undefined : translateLabel(text, language);
  return {
    details: document.details?.map(
      ([key, value]) =>
        [
          translateLabel(key, language),
          translateValue(value, language, options),
        ] as [string, string | number],
    ),
    summaryTitle: label(document.summaryTitle),
    tableTitle: label(document.tableTitle),
    emptyText: label(document.emptyText),
    sections: document.sections?.map((section) => ({
      title: translateLabel(section.title, language),
      headers: section.headers.map((header) => translateLabel(header, language)),
      rows: section.rows.map((cells) =>
        cells.map((cell) => translateValue(cell, language, options)),
      ),
      emptyText: label(section.emptyText),
    })),
  };
}

/**
 * Render one sheet as CSV text.
 *
 * Written through lib/reports/csv.ts like every CSV the product makes, so it
 * opens with the byte-order mark Excel needs for Arabic and quotes what it
 * has to. The block that says what the file covers is in it too: a CSV is
 * the format most likely to be passed around without the screen it came from.
 */
export function toCsv<T>(
  sheet: ReportSheet<T>,
  options: { lang?: ReportLanguage } = {},
): string {
  const lines: CsvCell[][] = [[sheet.title]];

  const document = sheet.document;
  if (document?.details?.length) {
    lines.push([]);
    for (const [label, value] of document.details) lines.push([label, value]);
  }

  const block = blockOf(sheet, options.lang ?? "en");
  if (block) {
    lines.push([]);
    lines.push([block.title]);
    for (const [label, value] of block.lines) lines.push([label, value]);
  }

  if (sheet.summary?.length) {
    lines.push([]);
    if (document?.summaryTitle) lines.push([document.summaryTitle]);
    for (const [label, value] of sheet.summary) lines.push([label, value]);
  }

  lines.push([]);
  if (document?.tableTitle) lines.push([document.tableTitle]);
  lines.push(sheet.columns.map((column) => column.header));

  for (const row of sheet.rows) {
    lines.push(sheet.columns.map((column) => column.value(row)));
  }

  for (const section of document?.sections ?? []) {
    lines.push([]);
    lines.push([section.title]);
    lines.push(section.headers);
    for (const cells of section.rows) lines.push(cells);
  }

  return buildCsv(lines);
}

/** Worksheet names cannot exceed 31 chars or contain : \ / ? * [ ] */
function safeSheetName(title: string): string {
  return title.replace(/[:\\/?*[\]]/g, " ").trim().slice(0, 31) || "Report";
}

/**
 * The widest a column is made, in characters. A cell with more than this
 * wraps onto further lines instead of running out of the column or being cut.
 */
const MAX_COLUMN_CHARACTERS = 50;

export interface XlsxOptions {
  letterhead?: ReportLetterhead | null;
  lang?: ReportLanguage;
  /** The office's date-format setting, for the printed-on date in the footer. */
  dateFormat?: string | null;
  /** When the workbook counts as printed. Now, unless a test pins it. */
  printedAt?: Date;
}

/**
 * Render one sheet as a real .xlsx workbook.
 *
 * Numbers are written as numbers, not text, so the recipient can sum a column
 * without retyping it — which is the whole reason the scope asks for Excel
 * rather than a spreadsheet-shaped text file.
 *
 * With a letterhead, the office's name and registration numbers head the
 * sheet above its title, as they head the PDF: a spreadsheet forwarded to an
 * owner should say who it came from as plainly as the PDF does.
 *
 * An Arabic sheet opens right to left — every Arabic sheet, not only a
 * statement's — and every sheet is set up to print: landscape, one page wide,
 * its header row repeated on each page, with the date and "page 2 of 5" in the
 * footer as the PDF has them.
 */
export async function toXlsx<T>(
  sheet: ReportSheet<T>,
  options: XlsxOptions = {},
): Promise<Buffer> {
  const lang = options.lang ?? "en";
  const rtl = isRtlLanguage(lang);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PropertyPro";
  const worksheet = workbook.addWorksheet(safeSheetName(sheet.title));

  const document = sheet.document;
  const columnCount = Math.max(
    sheet.columns.length,
    ...(document?.sections ?? []).map((section) => section.headers.length),
    2,
  );
  // Rows merged across the sheet; they say nothing about a column's width.
  const bannerRows = new Set<number>();

  const letterhead = options.letterhead;
  // A statement carries the office's logo, at the far end of the letterhead
  // from its name — as the PDF does, and as the client's sample does.
  const logo = document ? letterhead?.logo : undefined;
  // The name must not run under the logo.
  const letterheadSpan = logo ? Math.max(columnCount - 2, 1) : columnCount;
  if (letterhead?.companyName) {
    const nameRow = worksheet.addRow([letterhead.companyName]);
    nameRow.font = { bold: true, size: 12 };
    worksheet.mergeCells(nameRow.number, 1, nameRow.number, letterheadSpan);
    bannerRows.add(nameRow.number);

    const registration = registrationLine(letterhead, lang);
    if (registration) {
      const registrationRow = worksheet.addRow([registration]);
      registrationRow.font = { size: 9, color: { argb: "FF6B7280" } };
      worksheet.mergeCells(
        registrationRow.number,
        1,
        registrationRow.number,
        letterheadSpan,
      );
      bannerRows.add(registrationRow.number);
    }
    worksheet.addRow([]);
  }
  if (logo) {
    try {
      const imageId = workbook.addImage({
        base64: logo.dataUrl.replace(/^data:[^,]*,/, ""),
        extension: logo.format === "JPEG" ? "jpeg" : "png",
      });
      worksheet.addImage(imageId, {
        tl: { col: columnCount - 1, row: 0 },
        ext: fitLogo(logo.width, logo.height, { width: 120, height: 48 }),
        editAs: "oneCell",
      });
    } catch (error) {
      // A logo Excel cannot take is left off; the letterhead still prints.
      console.warn("Report logo could not be placed on the sheet:", error);
    }
  }

  const titleRow = worksheet.addRow([sheet.title]);
  titleRow.font = { bold: true, size: 14 };
  if (document) titleRow.alignment = { horizontal: "center" };
  worksheet.mergeCells(titleRow.number, 1, titleRow.number, columnCount);
  bannerRows.add(titleRow.number);

  /** A heading over a block — the summary's, a table's. */
  const addHeading = (text: string, span: number, filled: boolean) => {
    const row = worksheet.addRow([text]);
    row.font = { bold: true, size: filled ? 11 : 12 };
    if (filled) {
      row.alignment = { horizontal: "center" };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF3F8" },
      };
    }
    worksheet.mergeCells(row.number, 1, row.number, span);
    bannerRows.add(row.number);
  };

  const addPairs = (
    pairs: Array<[string, string | number]>,
    /** Whole numbers are counts, not amounts: no decimals. */
    counts = false,
  ) => {
    for (const [label, value] of pairs) {
      const row = worksheet.addRow([label, value]);
      row.getCell(1).font = { bold: true };
      if (typeof value === "number") {
        row.getCell(2).numFmt =
          counts && Number.isInteger(value) ? "#,##0" : "#,##0.00";
      } else if (value.length > MAX_COLUMN_CHARACTERS) {
        row.getCell(2).alignment = { wrapText: true, vertical: "top" };
      }
    }
  };

  const addHeaderRow = (headers: string[]) => {
    const row = worksheet.addRow(headers);
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEFF3F8" },
      };
      cell.border = { bottom: { style: "thin", color: { argb: "FFBFC9D4" } } };
    });
    return row;
  };

  const addCells = (cells: Array<string | number | null | undefined>) => {
    const values = cells.map((value) => {
      if (value === null || value === undefined) return "";
      if (typeof value === "number") return value;
      const text = String(value);
      return isFormulaLike(text) ? `'${text}` : text;
    });

    const row = worksheet.addRow(values);
    row.eachCell((cell) => {
      if (typeof cell.value === "number") cell.numFmt = "#,##0.00";
      // A long note wraps in its cell, as it does in the PDF, instead of
      // running on past the column or being cut off at its edge.
      else if (
        typeof cell.value === "string" &&
        cell.value.length > MAX_COLUMN_CHARACTERS
      ) {
        cell.alignment = { wrapText: true, vertical: "top" };
      }
    });
  };

  if (document?.details?.length) {
    worksheet.addRow([]);
    addPairs(document.details);
  }

  // What the file says it contains — rows, period, filters.
  const block = blockOf(sheet, lang, { dateFormat: options.dateFormat });
  if (block) {
    worksheet.addRow([]);
    addHeading(block.title, 2, true);
    addPairs(block.lines, true);
  }

  if (sheet.summary?.length) {
    worksheet.addRow([]);
    if (document?.summaryTitle) addHeading(document.summaryTitle, 2, true);
    addPairs(sheet.summary);
  }

  worksheet.addRow([]);
  if (document?.tableTitle) addHeading(document.tableTitle, columnCount, false);

  const headerRow = addHeaderRow(sheet.columns.map((column) => column.header));

  for (const item of sheet.rows) {
    addCells(sheet.columns.map((column) => column.value(item)));
  }

  for (const section of document?.sections ?? []) {
    worksheet.addRow([]);
    addHeading(section.title, columnCount, false);
    addHeaderRow(section.headers);
    for (const cells of section.rows) addCells(cells);
  }

  // Size each column to its widest cell so nothing opens as ####.
  worksheet.columns.forEach((column, index) => {
    const header = sheet.columns[index]?.header ?? "";
    let widest = header.length;
    column.eachCell?.({ includeEmpty: false }, (cell, rowNumber) => {
      if (bannerRows.has(rowNumber)) return;
      const length = String(cell.value ?? "").length;
      if (length > widest) widest = length;
    });
    column.width = Math.min(
      Math.max(widest + 2, 10),
      MAX_COLUMN_CHARACTERS,
    );
  });

  worksheet.views = document
    ? [
        // A statement is read top to bottom like the printout, so nothing is
        // frozen — its header block would fill the screen. An Arabic one reads
        // right to left, as the client's sample does.
        { rightToLeft: rtl },
      ]
    : [
        // Freeze everything above the data so headers stay visible while
        // scrolling. An Arabic sheet opens right to left, whichever way it
        // was built: this branch used to leave every list left to right.
        { state: "frozen", ySplit: headerRow.number, rightToLeft: rtl },
      ];

  // Printing: the PDF's footer, and a table that fits the paper.
  const { oddHeader, oddFooter } = printHeaderFooter({
    lang,
    rtl,
    printedOn: formatPrintDate(options.printedAt ?? new Date(), options.dateFormat),
    office: letterhead?.companyName,
  });
  worksheet.headerFooter = { oddHeader, oddFooter };
  worksheet.pageSetup = {
    paperSize: 9, // A4
    orientation: "landscape",
    // One page wide however many columns, as many pages tall as it takes.
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.7, bottom: 0.7, header: 0.3, footer: 0.3 },
    // The header row follows the table onto every printed page. A statement
    // has several tables with a header each, so it repeats none.
    ...(document
      ? {}
      : { printTitlesRow: `${headerRow.number}:${headerRow.number}` }),
  };

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

/** Strip anything a filesystem would choke on, keeping the reader's script. */
function safeFileName(name: string): string {
  return (
    name
      .replace(/[^\p{L}\p{N}\-_ ]/gu, "")
      .trim()
      .replace(/\s+/g, "-")
      .slice(0, 80) || "report"
  );
}

/**
 * A `Content-Disposition` value that survives a non-Latin filename.
 *
 * Header values are ByteStrings — one byte per character — so assigning a
 * name containing Arabic throws outright: "character at index 22 has a value
 * of 1605 which is greater than 255". Every export named after a record threw
 * it, because `safeFileName` keeps Unicode letters on purpose (an owner
 * called عبدالله should not download `-------.pdf`). In a product that ships
 * for Saudi Arabia that is most owner statements and most property reports.
 *
 * RFC 6266 is built for exactly this: send both forms. `filename` carries an
 * ASCII fallback for anything ancient, `filename*` carries the real name
 * percent-encoded, and every current browser prefers the second.
 */
export function contentDisposition(
  fileName: string,
  extension: string,
): string {
  const ascii =
    fileName
      .replace(/[^\x20-\x7E]/g, "")
      .replace(/["\\]/g, "")
      .trim()
      .replace(/^[-\s]+|[-\s]+$/g, "") || "report";

  // encodeURIComponent leaves !'()* alone; RFC 5987 wants them encoded.
  const encoded = encodeURIComponent(fileName).replace(
    /['()!*]/g,
    (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );

  return (
    `attachment; filename="${ascii}.${extension}"; ` +
    `filename*=UTF-8''${encoded}.${extension}`
  );
}

const CONTENT_TYPES: Record<ReportFormat, string> = {
  csv: "text/csv; charset=utf-8",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pdf: "application/pdf",
};

/**
 * Build the HTTP response for a report download.
 *
 * `dateStamp` is passed in rather than read from the clock so the caller can
 * name the file after the period it covers, not the moment it was generated.
 *
 * `rtl` mirrors the PDF's table for an Arabic reader. It is the caller's to
 * pass because only the request knows which locale asked for the file — the
 * same report is exported in both directions by different people in the same
 * office.
 */
export async function buildReportResponse<T>(
  sheet: ReportSheet<T>,
  options: {
    format: ReportFormat;
    fileName: string;
    dateStamp?: string;
    rtl?: boolean;
    /**
     * The reader's language. Headings, the title and known stored values are
     * written in it; left unset it follows `rtl`, which only an Arabic reader
     * ever set.
     */
    lang?: ReportLanguage;
    /**
     * Override the issuing office printed above a PDF or an Excel sheet.
     * Left unset, the office's own branding is used — which is what every
     * report wants, so no route has to remember to pass it.
     */
    letterhead?: ReportLetterhead | null;
    /**
     * Open the PDF's print dialog as soon as it is on screen — what "Print"
     * asks for. Ignored by the other formats.
     */
    autoPrint?: boolean;
  },
): Promise<Response> {
  const stamp = options.dateStamp ? `-${safeFileName(options.dateStamp)}` : "";
  const language: ReportLanguage = options.lang ?? (options.rtl ? "ar" : "en");
  // The file is named in the reader's language too — it is what they see in
  // their downloads folder.
  const fileName = `${safeFileName(translateLabel(options.fileName, language))}${stamp}`;

  let body: BodyInit;
  if (options.format === "csv") {
    // CSV is for machines: no letterhead, so no branding read either, and
    // dates stay ISO.
    body = toCsv(localizeSheet(sheet, language), { lang: language });
  } else {
    // Imported here rather than at the top of the file on purpose. The
    // letterhead reads branding from the database, so a static import drags a
    // Prisma client into everything that writes a CSV — and into the tests
    // for this module, which have no database and need none.
    const { getReportDocumentSettings, withLetterheadLogo } = await import(
      "./letterhead"
    );
    const settings = await getReportDocumentSettings();
    const letterhead =
      options.letterhead === undefined
        ? settings.letterhead
        : options.letterhead;
    // Every date in the file — its cells, its period, its footer — is written
    // the office's way: its setting, or the market's when it has none. An
    // Arabic PDF keeps the order but writes slashes (see slashedDateFormat).
    const dateFormat =
      options.format === "pdf" && language === "ar"
        ? slashedDateFormat(settings.dateFormat)
        : documentDateFormat(settings.dateFormat);
    const localized = localizeSheet(sheet, language, { dateFormat });

    if (options.format === "xlsx") {
      body = (await toXlsx(localized, {
        // A statement's sheet carries the logo too; no other sheet waits
        // for it.
        letterhead: sheet.document
          ? await withLetterheadLogo(letterhead)
          : letterhead,
        lang: language,
        dateFormat,
      })) as unknown as BodyInit;
    } else {
      // The PDF always draws the logo, so it always waits for it.
      body = toPdf(localized, {
        rtl: options.rtl,
        lang: language,
        letterhead: (await withLetterheadLogo(letterhead)) ?? undefined,
        dateFormat,
        autoPrint: options.autoPrint,
      }) as unknown as BodyInit;
    }
  }

  // Every export lands in the activity log: who, which report, which format.
  noteReportExport({
    report: options.fileName,
    format: options.format,
    rows: sheet.rows.length,
  });

  return new Response(body, {
    headers: {
      "Content-Type": CONTENT_TYPES[options.format],
      "Content-Disposition": contentDisposition(fileName, options.format),
      "Cache-Control": "no-store",
    },
  });
}
