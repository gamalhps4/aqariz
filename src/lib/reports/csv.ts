/**
 * PropertyPro - The one CSV writer
 *
 * Every CSV this product hands out is written here: the report exports, the
 * ledger, the dashboard summary, a statement a tenant saves from a page. They
 * used to be written five different ways, and four of them were wrong in the
 * same two places:
 *
 *   - no byte-order mark. Excel reads a CSV as the machine's legacy code page
 *     unless the file opens with U+FEFF, so every Arabic name arrived as
 *     mojibake;
 *   - cells that were wrapped in quotes without escaping the quotes inside
 *     them, or not quoted at all, so a name with a comma split a row in two.
 *
 * No imports from the rest of the app, so a page can use it from the browser.
 */

/**
 * The UTF-8 byte-order mark. Built from its code point rather than typed, so
 * no editor or tool can quietly drop an invisible character from the source.
 */
export const CSV_BOM = String.fromCharCode(0xfeff);

/** Lines end the way Excel writes them, and the way RFC 4180 asks. */
export const CSV_EOL = "\r\n";

export type CsvCell = string | number | boolean | null | undefined;

/**
 * A cell that starts with =, +, - or @ is executed as a formula when the file
 * is opened, which turns an exported tenant note into a code-execution vector
 * for whoever opens it. Every writer neutralises those.
 *
 * Except a value that is nothing but a signed number or a phone number:
 * digits, spaces, brackets, dots and dashes cannot call anything, and every
 * Saudi mobile number starts with "+966" — neutralising those printed
 * "'+966 50 …" in every tenant export.
 */
export function isFormulaLike(text: string): boolean {
  if (!/^[=+\-@\t\r]/.test(text)) return false;
  return !/^[+-][\d\s().-]+$/.test(text);
}

/** One cell as CSV text: formula-guarded, and quoted when it has to be. */
export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "boolean" ? (value ? "TRUE" : "FALSE") : String(value);
  if (isFormulaLike(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/** One line of cells. */
export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

export interface CsvOptions {
  /** Open the file with the byte-order mark. On unless something says otherwise. */
  bom?: boolean;
}

/**
 * Rows of cells as the text of a CSV file, byte-order mark first. An empty row
 * (`[]`) is a blank line, which is how a block is set apart from the next.
 */
export function buildCsv(
  rows: ReadonlyArray<readonly CsvCell[]>,
  options: CsvOptions = {},
): string {
  const body = rows.map(csvLine).join(CSV_EOL);
  return options.bom === false ? body : CSV_BOM + body;
}

/**
 * Text that is already CSV, opened with the byte-order mark if it is not
 * already. For a path that builds its lines itself and only needs the file to
 * open correctly.
 */
export function withCsvBom(text: string): string {
  return text.startsWith(CSV_BOM) ? text : CSV_BOM + text;
}
