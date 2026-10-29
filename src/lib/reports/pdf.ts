/**
 * PropertyPro - Report PDF
 *
 * Turns the same `ReportSheet` the Excel and CSV writers consume into a
 * paginated landscape table, so all three formats are produced from one query
 * and cannot disagree about what the report says.
 *
 * Written directly with jsPDF rather than an autoTable plugin: the table this
 * needs is a header row and body rows with per-column widths, and owning the
 * layout is what makes the right-to-left mirroring below a few lines instead
 * of a fight with a plugin's own alignment logic.
 */

import jsPDF from "jspdf";
import {
  REPORT_FONT_NAME,
  REPORT_FONT_FILE,
  reportFontBase64,
} from "./pdf-font";
import type { ReportSheet } from "./export";
import type { ReportLanguage } from "./labels";
import { drawPageFooters, formatPrintDate } from "./page-footer";
import {
  filtersBlock as buildFiltersBlock,
  type FiltersBlock,
} from "./filters-summary";
import {
  clipToWidth,
  fitColumns,
  wrapText,
  type ColumnFit,
  type ColumnMeasure,
} from "./pdf-layout";
import { drawText, pdfLabel } from "@/lib/invoice/pdf-i18n";
import { fitLogo } from "@/lib/invoice/logo-utils";

/** A4 landscape in points, which is what jsPDF measures in here. */
const PAGE = { width: 842, height: 595 };
const MARGIN = { top: 44, right: 32, bottom: 40, left: 32 };

const CONTENT_WIDTH = PAGE.width - MARGIN.left - MARGIN.right;

const FONT_SIZE = {
  company: 12,
  title: 15,
  summary: 9,
  header: 8.5,
  body: 8.5,
  footer: 7.5,
};
const ROW_HEIGHT = 16;
const HEADER_HEIGHT = 18;
const SUMMARY_ROW_HEIGHT = 15;
/** The totals block is a narrow key/value list, not a full-width table. */
const SUMMARY_WIDTH = 340;
/** Space between the two columns of the filters block. */
const COLUMN_GAP = 28;

/** The room a cell's text has: the column less 4pt in from one side, 2 from the other. */
const CELL_INSET = 6;
/** How tall a line of wrapped text is, as a multiple of its type size. */
const LINE_FACTOR = 1.25;
/**
 * The most lines one cell may take. A note of a thousand words must not run
 * a page of its own; what is cut is marked, and the Excel file has it whole.
 */
const MAX_CELL_LINES = 30;
const MAX_HEADER_LINES = 3;

/** Where the letterhead starts, and the most room the logo may take. */
const LETTERHEAD_TOP = 24;
const LOGO_BOX = { width: 150, height: 44 };

/**
 * The letterhead on every page after the first is the same office, smaller:
 * its name, its registration numbers and its logo, so any loose page says who
 * issued it — without taking a fifth of the page from the table.
 */
const FULL_LETTERHEAD = {
  top: LETTERHEAD_TOP,
  logoBox: LOGO_BOX,
  companySize: FONT_SIZE.company,
  registrationSize: FONT_SIZE.footer,
  nameBaseline: 12,
  nameBottom: 16,
  registrationBaseline: 27,
  registrationBottom: 31,
  gapBelow: 8,
  gapAfterRule: 24,
};
const COMPACT_LETTERHEAD = {
  top: 20,
  logoBox: { width: 96, height: 26 },
  companySize: 10,
  registrationSize: 7,
  nameBaseline: 10,
  nameBottom: 13,
  registrationBaseline: 20,
  registrationBottom: 24,
  gapBelow: 6,
  gapAfterRule: 14,
};

/** The footer's hairline and baseline, below the last row a page can hold. */
const FOOTER_RULE_Y = PAGE.height - 32;
const FOOTER_BASELINE = PAGE.height - 20;

const COLOR = {
  text: [17, 24, 39] as const,
  muted: [107, 114, 128] as const,
  headerFill: [239, 243, 248] as const,
  rule: [191, 201, 212] as const,
  /** The line between two rows: there to guide the eye, not to be read. */
  separator: [229, 231, 235] as const,
};

/** Hairline widths, in points. */
const LINE = { rule: 0.5, separator: 0.4 };

export interface ReportPdfOptions {
  /**
   * Right-to-left page layout. Columns run from the right edge and text is
   * right-aligned — the mirror image of the Latin sheet, which is what an
   * Arabic reader expects. Letter shaping and the direction of the text
   * *within* a cell are jsPDF's job, not this flag's.
   */
  rtl?: boolean;
  /**
   * The reader's language, for the words the PDF adds itself — the footer,
   * the empty-table line, the registration labels. The sheet arrives already
   * translated. Follows `rtl` when unset, which only an Arabic reader sets.
   */
  lang?: ReportLanguage;
  /** Printed in the middle of the footer on every page. */
  footerNote?: string;
  /**
   * The office's date-format setting ("DD/MM/YYYY"), used for the printed-on
   * date in the footer. The market's format when unset.
   */
  dateFormat?: string | null;
  /** When the document counts as printed. Now, unless a test pins it. */
  printedAt?: Date;
  /**
   * Who issued this document.
   *
   * A statement an office sends to an owner is a business record, and the
   * Wazi statements this product is reconciled against carry the managing
   * company's name, commercial registration and logo above the figures.
   * Without them the file is a table that could have come from anywhere.
   *
   * Printed at the top of every page. Omitted entirely when the office has
   * not filled the details in, rather than printing an empty heading.
   */
  letterhead?: ReportLetterhead;
  /**
   * Ask the viewer to open its print dialog as soon as the file is on screen.
   * What "Print" means for a document that is made on the server.
   */
  autoPrint?: boolean;
}

export interface ReportLetterhead {
  companyName: string;
  /** Commercial registration — سجل تجاري on an Arabic statement. */
  commercialRegistration?: string | null;
  taxNumber?: string | null;
  /** Where the branding logo lives; `logo` is what was loaded from it. */
  logoUrl?: string | null;
  /**
   * The logo, decoded and ready to draw. Loaded before the PDF is drawn
   * (lib/reports/logo-image.ts), since drawing is synchronous and fetching
   * is not; left out when there is none or it could not be read.
   */
  logo?: ReportLogo | null;
}

export interface ReportLogo {
  dataUrl: string;
  format: "PNG" | "JPEG";
  /** Pixel size, so the logo is drawn in proportion. */
  width: number;
  height: number;
}

/**
 * "CR: 1010… · VAT: 3001…" — the registration line under the office's name,
 * in the reader's language, or "" when the office has recorded neither.
 */
export function registrationLine(
  letterhead: ReportLetterhead,
  lang: ReportLanguage,
): string {
  return [
    letterhead.commercialRegistration
      ? `${pdfLabel(lang, "exports.document.commercialRegistration", "CR")}: ${letterhead.commercialRegistration}`
      : null,
    letterhead.taxNumber
      ? `${pdfLabel(lang, "exports.document.taxNumber", "VAT")}: ${letterhead.taxNumber}`
      : null,
  ]
    .filter(Boolean)
    .join("   ·   ");
}

/**
 * A table as the PDF draws it: its headers and every cell's text, resolved
 * once. The report's own table and a statement's further tables are both
 * drawn from one of these.
 */
interface PdfTable {
  headers: string[];
  cells: string[][];
}

/** Smallest body text that still photocopies and reads on paper. */
const MIN_BODY_FONT = 6;
/** Shrunk to this much, a table fits without wrapping; past it, text wraps. */
const COMFORT_BODY_FONT = 7.5;
/** How narrow running text is made before the type is reduced instead. */
const COMFORT_COLUMN_WIDTH = 64;
/** Room beside a cell's text, in the columns of a table that fits. */
const COLUMN_PADDING = 8;
/** What a table only just too wide gives up before a column is cut. */
const TIGHT_COLUMN_PADDING = CELL_INSET + 0.2;
const MIN_COLUMN_WIDTH = 34;
/** A word wider than this is broken by characters rather than sizing a column to it. */
const BREAKABLE_WORD = 120;

/** How wide a string is at the type size the document is currently set to. */
const widthOf = (doc: jsPDF) => (text: string) => doc.getTextWidth(text);

/**
 * How wide each column's text is, and how narrow the column can go — the
 * widest cell it actually holds, not an even share of the page.
 *
 * Measuring the content is what keeps a 4-character status column from being
 * handed the same space as a full address. Every row is measured: a cell
 * further down that is wider than the first screenful used to be cut off, and
 * a measurement costs microseconds.
 */
function measureTable(doc: jsPDF, table: PdfTable): ColumnMeasure[] {
  doc.setFontSize(FONT_SIZE.body);
  const measure = widthOf(doc);

  /** One cell: its width on a line, and its longest word. */
  const measureText = (text: string): ColumnMeasure => {
    let natural = 0;
    let longestWord = 0;
    for (const paragraph of text.split(/\r\n|\r|\n/)) {
      natural = Math.max(natural, measure(paragraph));
      if (/\s/.test(paragraph.trim())) {
        for (const word of paragraph.split(/\s+/)) {
          if (word) longestWord = Math.max(longestWord, measure(word));
        }
      }
    }
    return {
      natural,
      // No spaces to wrap at: the cell is as narrow as it is wide, unless it
      // is so long that it would be broken by characters instead.
      minimum: longestWord > 0 ? longestWord : Math.min(natural, BREAKABLE_WORD),
    };
  };

  return table.headers.map((header, index) => {
    const seen = new Map<string, ColumnMeasure>();
    const measured = (text: string) => {
      let found = seen.get(text);
      if (!found) {
        found = measureText(text);
        seen.set(text, found);
      }
      return found;
    };

    const head = measured(header);
    let natural = head.natural;
    let minimum = head.minimum;
    for (const row of table.cells) {
      const cell = measured(row[index] ?? "");
      if (cell.natural > natural) natural = cell.natural;
      if (cell.minimum > minimum) minimum = cell.minimum;
    }
    return { natural, minimum: Math.min(minimum, natural) };
  });
}

/**
 * Fit the table to the page — see lib/reports/pdf-layout.ts for how: as it is
 * when it fits, then a little smaller, then with its running text wrapped,
 * and only a table too wide for all of that is squeezed.
 */
function fitTable(doc: jsPDF, table: PdfTable): ColumnFit {
  return fitColumns(measureTable(doc, table), {
    contentWidth: CONTENT_WIDTH,
    referenceFontSize: FONT_SIZE.body,
    maxFontSize: FONT_SIZE.body,
    comfortFontSize: COMFORT_BODY_FONT,
    minFontSize: MIN_BODY_FONT,
    padding: COLUMN_PADDING,
    tightPadding: TIGHT_COLUMN_PADDING,
    minColumnWidth: MIN_COLUMN_WIDTH,
    comfortColumnWidth: COMFORT_COLUMN_WIDTH,
  });
}

/** A table fitted to the page: its widths and the type it is drawn in. */
interface TableLayout {
  table: PdfTable;
  widths: number[];
  /** The columns whose cells may need more than one line. */
  wraps: boolean[];
  bodyFontSize: number;
  /** Headers track the body so a narrow table does not carry oversized labels. */
  headerFontSize: number;
  /** Each header as lines: one, unless its column is narrower than the words. */
  headerLines: string[][];
  headerHeight: number;
}

function lineHeight(fontSize: number): number {
  return fontSize * LINE_FACTOR;
}

/** The height of a block of `lines` lines whose first baseline is `first` down. */
function blockHeight(
  lines: number,
  fontSize: number,
  first: number,
  below: number,
): number {
  return first + (lines - 1) * lineHeight(fontSize) + below;
}

function tableLayout(
  doc: jsPDF,
  fitted: ColumnFit,
  table: PdfTable,
): TableLayout {
  const headerFontSize = Math.min(FONT_SIZE.header, fitted.fontSize);

  doc.setFontSize(headerFontSize);
  const measure = widthOf(doc);
  const headerLines = table.headers.map((header, index) => {
    const usable = fitted.widths[index] - CELL_INSET;
    if (measure(header) <= usable) return [header];
    return wrapText(header, usable, measure, MAX_HEADER_LINES);
  });
  const lines = Math.max(1, ...headerLines.map((cell) => cell.length));

  return {
    table,
    widths: fitted.widths,
    wraps: fitted.wraps,
    bodyFontSize: fitted.fontSize,
    headerFontSize,
    headerLines,
    headerHeight:
      lines === 1
        ? HEADER_HEIGHT
        : blockHeight(lines, headerFontSize, 12, 6),
  };
}

function cellText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return new Intl.NumberFormat("en-US", {
      minimumFractionDigits: Number.isInteger(value) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(value);
  }
  return String(value);
}

/**
 * Truncate to what the column can hold.
 *
 * For the places that really are one line — a letterhead's name, a heading,
 * the one cell of an unbreakable column that is still too wide. A table's
 * own cells wrap instead (see `rowLines`): the old "…" lost a long note, and
 * the full value was only in the Excel file.
 */
function fit(doc: jsPDF, text: string, width: number): string {
  return clipToWidth(text, width - CELL_INSET, widthOf(doc));
}

/** Text broken into the lines a width holds; text that fits is one line, as written. */
function wrapCell(
  doc: jsPDF,
  text: string,
  width: number,
  maxLines: number,
): string[] {
  return wrapText(text, width - CELL_INSET, widthOf(doc), maxLines);
}

export function toPdf<T>(
  sheet: ReportSheet<T>,
  options: ReportPdfOptions = {},
): Buffer {
  const rtl = Boolean(options.rtl);
  const lang: ReportLanguage = options.lang ?? (rtl ? "ar" : "en");

  const doc = new jsPDF({
    unit: "pt",
    format: "a4",
    orientation: "landscape",
  });

  // Registering the face is what makes Arabic render at all; jsPDF's own
  // Arabic parser then shapes and reverses each run for us.
  doc.addFileToVFS(REPORT_FONT_FILE, reportFontBase64());
  doc.addFont(REPORT_FONT_FILE, REPORT_FONT_NAME, "normal");
  doc.setFont(REPORT_FONT_NAME, "normal");

  // The report's own table, measured before anything is drawn.
  const main: PdfTable = {
    headers: sheet.columns.map((column) => column.header),
    cells: sheet.rows.map((row) =>
      sheet.columns.map((column) => cellText(column.value(row))),
    ),
  };
  const mainLayout = tableLayout(doc, fitTable(doc, main), main);

  const align = rtl ? "right" : "left";
  const edgeX = rtl ? PAGE.width - MARGIN.right : MARGIN.left;

  let y = MARGIN.top;

  const setColor = (rgb: readonly [number, number, number]) =>
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);

  /**
   * A hairline across `width` from the reading edge — or `offset` in from
   * it, for the second column of a block — at the current y.
   */
  const drawSeparator = (width = CONTENT_WIDTH, offset = 0) => {
    doc.setDrawColor(COLOR.separator[0], COLOR.separator[1], COLOR.separator[2]);
    doc.setLineWidth(LINE.separator);
    const from = rtl ? edgeX - offset : edgeX + offset;
    doc.line(from, y, rtl ? from - width : from + width, y);
  };

  /**
   * Left edge of a column. In RTL the same columns are laid out from the
   * right edge, so column 0 is the rightmost — the table reads in the same
   * order as the language.
   */
  const columnX = (layout: TableLayout, index: number): number => {
    const before = layout.widths
      .slice(0, index)
      .reduce((sum, w) => sum + w, 0);
    return rtl
      ? PAGE.width - MARGIN.right - before - layout.widths[index]
      : MARGIN.left + before;
  };

  /** Where text starts inside a cell, and which way it runs from there. */
  const textX = (layout: TableLayout, index: number): number =>
    rtl
      ? columnX(layout, index) + layout.widths[index] - 4
      : columnX(layout, index) + 4;

  // --- Letterhead ----------------------------------------------------------
  // The issuing office, above the report's own title, laid out like the Wazi
  // statements the client reconciles against: name and registration numbers
  // on the reading side, the logo on the other. On the first page in full; on
  // every page after it, smaller, so no page of a printout is anonymous.
  const letterhead = options.letterhead;
  const logo = letterhead?.logo;
  const hasLetterhead = Boolean(
    letterhead && (letterhead.companyName || logo),
  );

  /** Draws the letterhead at the top of the current page; returns the y below it. */
  const drawLetterhead = (compact: boolean): number => {
    if (!letterhead) return y;
    const spec = compact ? COMPACT_LETTERHEAD : FULL_LETTERHEAD;
    const top = spec.top;
    let bottom = top;

    let logoWidth = 0;
    if (logo) {
      const size = fitLogo(logo.width, logo.height, spec.logoBox);
      const logoX = rtl ? MARGIN.left : PAGE.width - MARGIN.right - size.width;
      try {
        doc.addImage(
          logo.dataUrl,
          logo.format,
          logoX,
          top,
          size.width,
          size.height,
          undefined,
          "FAST",
        );
        logoWidth = size.width;
        bottom = Math.max(bottom, top + size.height);
      } catch (error) {
        // A logo jsPDF cannot decode is left off; the letterhead still prints.
        console.warn("Report logo could not be drawn:", error);
      }
    }

    // The name must not run under the logo.
    const textWidth = CONTENT_WIDTH - (logoWidth ? logoWidth + 16 : 0);

    if (letterhead.companyName) {
      doc.setFontSize(spec.companySize);
      setColor(COLOR.text);
      drawText(
        doc,
        fit(doc, letterhead.companyName, textWidth),
        edgeX,
        top + spec.nameBaseline,
        { align },
      );
      bottom = Math.max(bottom, top + spec.nameBottom);

      const registration = registrationLine(letterhead, lang);
      if (registration) {
        doc.setFontSize(spec.registrationSize);
        setColor(COLOR.muted);
        drawText(
          doc,
          fit(doc, registration, textWidth),
          edgeX,
          top + spec.registrationBaseline,
          { align },
        );
        bottom = Math.max(bottom, top + spec.registrationBottom);
      }
    }

    const below = bottom + spec.gapBelow;
    doc.setDrawColor(COLOR.rule[0], COLOR.rule[1], COLOR.rule[2]);
    doc.setLineWidth(LINE.rule);
    doc.line(MARGIN.left, below, PAGE.width - MARGIN.right, below);
    return below + spec.gapAfterRule;
  };

  /** A new page, with the office's name and logo at the top of it. */
  const addPage = () => {
    doc.addPage();
    y = MARGIN.top;
    if (hasLetterhead) y = drawLetterhead(true);
  };

  const drawHeaderRow = (layout: TableLayout) => {
    doc.setFillColor(
      COLOR.headerFill[0],
      COLOR.headerFill[1],
      COLOR.headerFill[2],
    );
    doc.rect(MARGIN.left, y, CONTENT_WIDTH, layout.headerHeight, "F");

    doc.setFontSize(layout.headerFontSize);
    setColor(COLOR.text);
    layout.headerLines.forEach((lines, index) => {
      lines.forEach((line, row) => {
        drawText(
          doc,
          line,
          textX(layout, index),
          y + 12 + row * lineHeight(layout.headerFontSize),
          { align },
        );
      });
    });

    y += layout.headerHeight;
    doc.setDrawColor(COLOR.rule[0], COLOR.rule[1], COLOR.rule[2]);
    doc.setLineWidth(LINE.rule);
    doc.line(MARGIN.left, y, PAGE.width - MARGIN.right, y);
  };

  const newPage = (layout: TableLayout) => {
    addPage();
    drawHeaderRow(layout);
    // drawHeaderRow leaves the header size selected; rows after a page break
    // would otherwise render larger than rows before it.
    doc.setFontSize(layout.bodyFontSize);
  };

  /**
   * A row's cells as lines, and how tall the row is. A cell that fits its
   * column is one line, exactly as written; one in a narrowed column wraps
   * at its spaces onto as many lines as it needs, up to MAX_CELL_LINES.
   */
  const rowLines = (layout: TableLayout, cells: string[]) => {
    const measure = widthOf(doc);
    const lines = cells.map((cell, index) => {
      const usable = layout.widths[index] - CELL_INSET;
      if (measure(cell) <= usable) return [cell];
      // A column that was not narrowed holds its cells whole; one that is
      // still too wide here (a table squeezed past its limit) is cut.
      if (!layout.wraps[index]) return [fit(doc, cell, layout.widths[index])];
      return wrapText(cell, usable, measure, MAX_CELL_LINES);
    });
    const tallest = Math.max(1, ...lines.map((cell) => cell.length));
    return {
      lines,
      height:
        tallest === 1
          ? ROW_HEIGHT
          : blockHeight(tallest, layout.bodyFontSize, 11, 5),
    };
  };

  /** A table's rows, carrying its header row onto every page it runs to. */
  const drawRows = (layout: TableLayout) => {
    doc.setFontSize(layout.bodyFontSize);
    const step = lineHeight(layout.bodyFontSize);
    layout.table.cells.forEach((cells) => {
      const { lines, height } = rowLines(layout, cells);
      if (y + height > PAGE.height - MARGIN.bottom) newPage(layout);

      setColor(COLOR.text);
      lines.forEach((cellLines, index) => {
        cellLines.forEach((line, row) => {
          drawText(doc, line, textX(layout, index), y + 11 + row * step, {
            align,
          });
        });
      });

      y += height;
      // A line under every row rather than alternate shading: the client asked
      // for separators, and they survive a black-and-white photocopy.
      drawSeparator();
    });
  };

  const drawNoRecords = (text?: string) => {
    setColor(COLOR.muted);
    drawText(
      doc,
      text ??
        pdfLabel(lang, "exports.document.noRecords", "No records match these filters."),
      edgeX,
      y + 14,
      { align },
    );
  };

  /**
   * A key/value block: the label on the reading side, the figure at the far
   * edge of the block, a hairline under each pair so a figure cannot be read
   * against the wrong label. A label or figure too long for its place wraps
   * onto a second line rather than being cut.
   *
   * In `columns` columns, filled row by row, when a block is long enough that
   * one column would take a third of the page.
   */
  const drawPairs = (
    pairs: Array<[string, string | number]>,
    columns = 1,
    columnWidth = Math.min(SUMMARY_WIDTH, CONTENT_WIDTH),
  ) => {
    const summaryStep = lineHeight(FONT_SIZE.summary);

    for (let first = 0; first < pairs.length; first += columns) {
      doc.setFontSize(FONT_SIZE.summary);
      const cells = pairs.slice(first, first + columns).map(([label, value]) => {
        const figure = wrapCell(doc, cellText(value), columnWidth * 0.6, 4);
        const widest = Math.max(...figure.map((line) => doc.getTextWidth(line)));
        return {
          figure,
          label: wrapCell(doc, label, columnWidth - widest - 12, 3),
        };
      });
      const tallest = Math.max(
        1,
        ...cells.map((cell) => Math.max(cell.label.length, cell.figure.length)),
      );
      const height =
        tallest === 1
          ? SUMMARY_ROW_HEIGHT
          : blockHeight(tallest, FONT_SIZE.summary, 10.5, 4.5);

      if (y + height > PAGE.height - MARGIN.bottom) addPage();

      cells.forEach((cell, column) => {
        const offset = column * (columnWidth + COLUMN_GAP);
        const startX = rtl ? edgeX - offset : edgeX + offset;
        const valueX = rtl ? startX - columnWidth : startX + columnWidth;
        const valueAlign = rtl ? "left" : "right";

        doc.setFontSize(FONT_SIZE.summary);
        setColor(COLOR.muted);
        cell.label.forEach((line, row) => {
          drawText(doc, line, startX, y + 10.5 + row * summaryStep, { align });
        });
        setColor(COLOR.text);
        cell.figure.forEach((line, row) => {
          drawText(doc, line, valueX, y + 10.5 + row * summaryStep, {
            align: valueAlign,
          });
        });
      });

      y += height;
      cells.forEach((_, column) => {
        drawSeparator(columnWidth, column * (columnWidth + COLUMN_GAP));
      });
    }
  };

  /** A statement's heading over a block, kept on the page with what follows. */
  const drawHeading = (text: string, room: number) => {
    if (y + 20 + room > PAGE.height - MARGIN.bottom) addPage();
    doc.setFontSize(FONT_SIZE.company);
    setColor(COLOR.text);
    drawText(doc, fit(doc, text, CONTENT_WIDTH), edgeX, y + 12, { align });
    y += 20;
  };

  /**
   * What the file says it contains: a heading bar, then the row count, the
   * period and the filters in force, in two columns when there are enough of
   * them to need it.
   */
  const drawFiltersBlock = (block: FiltersBlock) => {
    const columns = block.lines.length > 3 ? 2 : 1;
    const columnWidth =
      columns === 2
        ? (CONTENT_WIDTH - COLUMN_GAP) / 2
        : Math.min(SUMMARY_WIDTH, CONTENT_WIDTH);
    const width = columns === 2 ? CONTENT_WIDTH : columnWidth;

    if (y + HEADER_HEIGHT + SUMMARY_ROW_HEIGHT > PAGE.height - MARGIN.bottom) {
      addPage();
    }
    const left = rtl ? edgeX - width : edgeX;
    doc.setFillColor(
      COLOR.headerFill[0],
      COLOR.headerFill[1],
      COLOR.headerFill[2],
    );
    doc.rect(left, y, width, HEADER_HEIGHT, "F");
    doc.setFontSize(FONT_SIZE.summary + 0.5);
    setColor(COLOR.text);
    drawText(
      doc,
      fit(doc, block.title, width - 8),
      rtl ? edgeX - 4 : edgeX + 4,
      y + 12.5,
      { align },
    );
    y += HEADER_HEIGHT;
    drawPairs(block.lines, columns, columnWidth);
  };

  if (hasLetterhead) y = drawLetterhead(false);

  const document = sheet.document;

  // --- Title ---------------------------------------------------------------
  // A statement centres its title, as the client's sample does.
  doc.setFontSize(FONT_SIZE.title);
  setColor(COLOR.text);
  const titleLines = wrapText(
    sheet.title,
    CONTENT_WIDTH - CELL_INSET,
    widthOf(doc),
    3,
  );
  titleLines.forEach((line, row) => {
    const baseline = y + row * lineHeight(FONT_SIZE.title);
    if (document) {
      drawText(doc, line, PAGE.width / 2, baseline, { align: "center" });
    } else {
      drawText(doc, line, edgeX, baseline, { align });
    }
  });
  y += 12 + (titleLines.length - 1) * lineHeight(FONT_SIZE.title);

  // --- Details (a statement's: whose, over what, for which period) --------
  if (document?.details?.length) {
    drawPairs(document.details);
    y += 12;
  }

  // --- What the file covers (rows, period, filters) -------------------------
  const block =
    sheet.filtersBlock ??
    (sheet.filtersSummary
      ? buildFiltersBlock(sheet.filtersSummary, sheet.rows.length, lang, {
          dateFormat: options.dateFormat,
        })
      : null);
  if (block) {
    drawFiltersBlock(block);
    y += 12;
  }

  // --- Summary (totals, the filters the report was run with) ---------------
  if (sheet.summary?.length) {
    if (document?.summaryTitle) {
      // A statement's summary sits under a heading bar — "الملخص".
      const blockWidth = Math.min(SUMMARY_WIDTH, CONTENT_WIDTH);
      if (y + HEADER_HEIGHT + SUMMARY_ROW_HEIGHT > PAGE.height - MARGIN.bottom) {
        addPage();
      }
      const left = rtl ? edgeX - blockWidth : edgeX;
      doc.setFillColor(
        COLOR.headerFill[0],
        COLOR.headerFill[1],
        COLOR.headerFill[2],
      );
      doc.rect(left, y, blockWidth, HEADER_HEIGHT, "F");
      doc.setFontSize(FONT_SIZE.summary + 0.5);
      setColor(COLOR.text);
      drawText(
        doc,
        fit(doc, document.summaryTitle, blockWidth),
        left + blockWidth / 2,
        y + 12.5,
        { align: "center" },
      );
      y += HEADER_HEIGHT;
    }
    drawPairs(sheet.summary);
    y += 12;
  } else if (!block) {
    y += 8;
  }

  // --- Table ---------------------------------------------------------------
  if (document?.tableTitle) {
    drawHeading(document.tableTitle, mainLayout.headerHeight + ROW_HEIGHT);
  }
  if (y + mainLayout.headerHeight + ROW_HEIGHT > PAGE.height - MARGIN.bottom) {
    addPage();
  }
  drawHeaderRow(mainLayout);
  drawRows(mainLayout);

  if (sheet.rows.length === 0) {
    drawNoRecords(document?.emptyText);
    y += 20;
  }

  // --- Further tables (a statement's expenses) -----------------------------
  for (const section of document?.sections ?? []) {
    y += 18;
    const table: PdfTable = {
      headers: section.headers,
      cells: section.rows.map((cells) => cells.map(cellText)),
    };
    const layout = tableLayout(doc, fitTable(doc, table), table);
    drawHeading(section.title, layout.headerHeight + ROW_HEIGHT);
    drawHeaderRow(layout);
    drawRows(layout);
    if (table.cells.length === 0) {
      drawNoRecords(section.emptyText);
      y += 20;
    }
  }

  // --- Footer --------------------------------------------------------------
  // Last, on every page at once: "page 2 of 5" needs the final count.
  doc.setFont(REPORT_FONT_NAME, "normal");
  drawPageFooters(
    doc,
    {
      lang,
      rtl,
      printedOn: formatPrintDate(options.printedAt ?? new Date(), options.dateFormat),
      note: options.footerNote,
    },
    {
      marginX: MARGIN.left,
      baseline: FOOTER_BASELINE,
      ruleY: FOOTER_RULE_Y,
      ruleWidth: LINE.rule,
      fontSize: FONT_SIZE.footer,
      textColor: COLOR.muted,
      ruleColor: COLOR.rule,
    },
  );

  if (options.autoPrint) doc.autoPrint();

  return Buffer.from(doc.output("arraybuffer"));
}
