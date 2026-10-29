/**
 * A file says what it contains, opens the way its reader reads, and prints
 * like the PDF.
 *
 * An export used to be a title and a table. Whoever received it could not tell
 * which owner it was for, which building, whether it had been filtered or cut
 * off at five thousand rows; an Arabic spreadsheet opened left to right; a
 * wide PDF clipped its dates; and only the first page of a printout said who
 * issued it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

import {
  capExportRows,
  EXPORT_ROW_LIMIT,
  localizeSheet,
  toCsv,
  toXlsx,
  type ReportSheet,
} from "@/lib/reports/export";
import { buildCsv, CSV_BOM, csvCell, withCsvBom } from "@/lib/reports/csv";
import { filtersBlock, periodText } from "@/lib/reports/filters-summary";
import { monthLabel, translateMonthCell } from "@/lib/reports/date-format";
import { printHeaderFooter } from "@/lib/reports/xlsx-print";
import { toPdf } from "@/lib/reports/pdf";
import { captureDrawnText } from "@/lib/testing/pdf-text-capture";
import { translations } from "@/locales";

/**
 * The words the catalogue has today for a key that is not this block's own.
 * Read from it rather than written out, so that rewording "Owner" or "Active"
 * in Arabic does not fail a test about where the block puts them.
 */
const arabicWord = (key: string): string => translations[key].ar;

type Row = Record<string, string | number>;

/** 3 October, 21:30 UTC: already the 4th in Riyadh. */
const PRINTED_AT = new Date("2026-10-03T21:30:00Z");

const sheetOf = (
  count: number,
  extra: Partial<ReportSheet<Row>> = {},
): ReportSheet<Row> => ({
  title: "Buildings",
  columns: [
    { header: "Building", value: (row) => row.name },
    { header: "Status", value: (row) => row.status },
    { header: "Units", value: (row) => row.units },
  ],
  rows: Array.from({ length: count }, (_, index) => ({
    name: `Tower ${index + 1}`,
    status: "active",
    units: 10 + index,
  })),
  ...extra,
});

// ---------------------------------------------------------------------------
// What the file says it contains
// ---------------------------------------------------------------------------

describe("the block that says what a file contains", () => {
  const options = { dateFormat: "DD/MM/YYYY" };

  test("counts the rows, names the period and every filter, in the reader's language", () => {
    const english = filtersBlock(
      {
        period: { from: "2026-09-01", to: "2026-09-30" },
        filters: [
          ["Owner", "Abdullah Al-Qahtani"],
          ["Building", "Al Nakheel Tower"],
          ["Status", "active"],
        ],
      },
      134,
      "en",
      options,
    );
    assert.equal(english.title, "Filters and period");
    assert.deepEqual(english.lines, [
      ["Records", 134],
      ["Period", "01/09/2026 to 30/09/2026"],
      ["Owner", "Abdullah Al-Qahtani"],
      ["Building", "Al Nakheel Tower"],
      ["Status", "Active"],
    ]);

    const arabic = filtersBlock(
      {
        period: { from: "2026-09-01", to: "2026-09-30" },
        filters: [
          ["Owner", "عبدالله القحطاني"],
          ["Status", "active"],
        ],
      },
      134,
      "ar",
      options,
    );
    assert.equal(arabic.title, "عوامل التصفية والفترة");
    assert.deepEqual(arabic.lines, [
      ["عدد السجلات", 134],
      [
        arabicWord("exports.label.period"),
        arabicWord("exports.document.period")
          .replace("{from}", "01/09/2026")
          .replace("{to}", "30/09/2026"),
      ],
      [arabicWord("exports.label.owner"), "عبدالله القحطاني"],
      [arabicWord("exports.label.status"), arabicWord("exports.value.active")],
    ]);
  });

  test("a filter that was not applied is not printed; none at all says so", () => {
    const block = filtersBlock(
      { filters: [["Owner", null], ["Search", ""], ["Archived", false], ["Status", undefined]] },
      12,
      "en",
    );
    assert.deepEqual(block.lines, [
      ["Records", 12],
      ["Filters", "None"],
    ]);
    assert.deepEqual(
      filtersBlock({ filters: [] }, 0, "ar").lines.map(([label]) => label),
      ["عدد السجلات", "عوامل التصفية"],
    );
  });

  test("a switch that is on reads as yes", () => {
    const block = filtersBlock({ filters: [["Archived", true]] }, 3, "en");
    assert.deepEqual(block.lines[1], ["Archived", "Yes"]);
    assert.deepEqual(
      filtersBlock({ filters: [["Archived", true]] }, 3, "ar").lines[1],
      [arabicWord("exports.label.archived"), arabicWord("exports.value.yes")],
    );
  });

  test("what was typed into the search box is shown as typed", () => {
    // "paid" is also a stored code; as a search it is the word the reader typed.
    const block = filtersBlock(
      { filters: [["Search", "paid"], ["Status", "paid"]] },
      1,
      "ar",
    );
    assert.deepEqual(block.lines[1], [arabicWord("exports.label.search"), "paid"]);
    assert.deepEqual(block.lines[2], [
      arabicWord("exports.label.status"),
      arabicWord("exports.value.paid"),
    ]);
  });

  test("a period with an open end, or both ends open, says so", () => {
    assert.equal(periodText({}, "en"), "All dates");
    assert.equal(periodText({}, "ar"), "كل التواريخ");
    assert.equal(periodText({ from: "2026-09-01" }, "en", options), "From 01/09/2026");
    assert.equal(periodText({ to: "2026-09-30" }, "ar", options), "حتى 30/09/2026");
    assert.equal(periodText({ from: "2026-09-01", to: "2026-09-30" }, "en"), "2026-09-01 to 2026-09-30");
  });

  test("a list read as at a day says which", () => {
    assert.deepEqual(
      filtersBlock({ asAt: "2026-10-04" }, 5, "en", options).lines[1],
      ["As at", "04/10/2026"],
    );
  });

  test("says so when the row limit cut the list short — and only then", () => {
    const cut = filtersBlock({ limit: 5000, truncated: true }, 5000, "en");
    assert.equal(cut.lines.at(-1)?.[0], "Note");
    assert.match(String(cut.lines.at(-1)?.[1]), /File limit: 5,000 rows/);
    // Exactly at the limit, and not cut, is not a warning.
    const exact = filtersBlock({ limit: 5000, truncated: false }, 5000, "en");
    assert.ok(!exact.lines.some(([label]) => label === "Note"));
    // A route that cannot tell is taken to have been cut when the file is full.
    const guess = filtersBlock({ limit: 5000 }, 5000, "en");
    assert.ok(guess.lines.some(([label]) => label === "Note"));
    assert.ok(!filtersBlock({ limit: 5000 }, 4999, "en").lines.some(([l]) => l === "Note"));
  });

  test("a route that reads one row more than it writes knows whether it cut", () => {
    const within = capExportRows(Array.from({ length: EXPORT_ROW_LIMIT }, (_, i) => i));
    assert.equal(within.truncated, false);
    assert.equal(within.rows.length, EXPORT_ROW_LIMIT);
    const over = capExportRows(Array.from({ length: EXPORT_ROW_LIMIT + 1 }, (_, i) => i));
    assert.equal(over.truncated, true);
    assert.equal(over.rows.length, EXPORT_ROW_LIMIT);
  });
});

describe("the block in each format", () => {
  const sheet = sheetOf(3, {
    filtersSummary: {
      period: {},
      filters: [
        ["Owner", "Abdullah Al-Qahtani"],
        ["Status", "active"],
      ],
    },
  });

  test("a CSV carries it under the title, after the byte-order mark", () => {
    const csv = toCsv(localizeSheet(sheet, "en"), { lang: "en" });
    assert.equal(csv.charCodeAt(0), 0xfeff);
    const lines = csv.slice(1).split("\r\n");
    assert.equal(lines[0], "Buildings");
    assert.deepEqual(lines.slice(1, 7), [
      "",
      "Filters and period",
      "Records,3",
      "Period,All dates",
      "Owner,Abdullah Al-Qahtani",
      "Status,Active",
    ]);
    assert.equal(lines[7], "");
    assert.equal(lines[8], "Building,Status,Units");
  });

  test("an Arabic CSV says it in Arabic", () => {
    const csv = toCsv(localizeSheet(sheet, "ar"), { lang: "ar" });
    assert.ok(csv.includes("عوامل التصفية والفترة"));
    assert.ok(csv.includes("عدد السجلات,3"));
    assert.ok(csv.includes(`${arabicWord("exports.label.owner")},Abdullah Al-Qahtani`));
  });

  test("a spreadsheet carries it, the count as a whole number", async () => {
    const buffer = await toXlsx(localizeSheet(sheet, "en", { dateFormat: "DD/MM/YYYY" }), {
      lang: "en",
      printedAt: PRINTED_AT,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const worksheet = workbook.worksheets[0];
    const cells = (row: number) => [
      String(worksheet.getRow(row).getCell(1).value ?? ""),
      worksheet.getRow(row).getCell(2).value,
    ];
    // Title, a blank row, the block's heading, then its lines.
    assert.equal(cells(1)[0], "Buildings");
    // A merged heading reads as the same value in every cell it spans.
    assert.equal(cells(3)[0], "Filters and period");
    assert.deepEqual(cells(4), ["Records", 3]);
    assert.deepEqual(cells(5), ["Period", "All dates"]);
    assert.deepEqual(cells(6), ["Owner", "Abdullah Al-Qahtani"]);
    assert.deepEqual(cells(7), ["Status", "Active"]);
    assert.equal(worksheet.getRow(4).getCell(2).numFmt, "#,##0");
  });

  test("a PDF prints it under the title", async () => {
    const drawn = await captureDrawnText(() =>
      toPdf(localizeSheet(sheet, "en", { dateFormat: "DD/MM/YYYY" }), {
        printedAt: PRINTED_AT,
      }),
    );
    const texts = drawn.map((entry) => entry.text);
    for (const expected of [
      "Filters and period",
      "Records",
      "3",
      "Period",
      "All dates",
      "Owner",
      "Abdullah Al-Qahtani",
      "Status",
      "Active",
    ]) {
      assert.ok(texts.includes(expected), `the PDF says "${expected}"`);
    }
    // Under the title, above the table's header.
    const y = (text: string) => drawn.find((entry) => entry.text === text)?.y ?? 0;
    assert.ok(y("Buildings") < y("Filters and period"));
    assert.ok(y("Filters and period") < y("Building"));
  });

  test("an Arabic PDF says it in Arabic, from the right edge", async () => {
    const drawn = await captureDrawnText(() =>
      toPdf(localizeSheet(sheet, "ar", { dateFormat: "DD/MM/YYYY" }), {
        rtl: true,
        lang: "ar",
        printedAt: PRINTED_AT,
      }),
    );
    const heading = drawn.find((entry) => entry.text === "عوامل التصفية والفترة");
    assert.ok(heading, "the block has its heading");
    assert.equal(heading?.align, "right");
    assert.ok(drawn.some((entry) => entry.text === "كل التواريخ"));
  });

  test("a sheet with no description prints as it always has", async () => {
    const plain = sheetOf(2);
    const csv = toCsv(localizeSheet(plain, "en"));
    assert.ok(!csv.includes("Filters and period"));
    const drawn = await captureDrawnText(() => toPdf(plain));
    assert.ok(!drawn.some((entry) => entry.text === "Filters and period"));
  });
});

// ---------------------------------------------------------------------------
// A spreadsheet opens the way its reader reads, and prints
// ---------------------------------------------------------------------------

describe("an Arabic spreadsheet", () => {
  const read = async (buffer: Buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook.worksheets[0];
  };

  test("opens right to left — a plain list too, not only a statement", async () => {
    const worksheet = await read(
      await toXlsx(localizeSheet(sheetOf(3), "ar"), { lang: "ar" }),
    );
    assert.equal(worksheet.views[0]?.rightToLeft, true);
    // And keeps its header row in view while scrolling.
    assert.equal(worksheet.views[0]?.state, "frozen");
  });

  test("an English one opens left to right", async () => {
    const worksheet = await read(await toXlsx(sheetOf(3), { lang: "en" }));
    assert.notEqual(worksheet.views[0]?.rightToLeft, true);
  });

  test("a statement still opens right to left, with nothing frozen", async () => {
    const statement = sheetOf(2, {
      document: { details: [["Owner", "x"]], summaryTitle: "Summary" },
      summary: [["Total", 1]],
    });
    const worksheet = await read(await toXlsx(statement, { lang: "ar" }));
    assert.equal(worksheet.views[0]?.rightToLeft, true);
    assert.notEqual(worksheet.views[0]?.state, "frozen");
  });
});

describe("a spreadsheet's print setup", () => {
  const read = async (buffer: Buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook.worksheets[0];
  };

  test("carries the date and 'page N of M', as the PDF's foot does", async () => {
    const worksheet = await read(
      await toXlsx(sheetOf(3), {
        lang: "en",
        dateFormat: "DD/MM/YYYY",
        printedAt: PRINTED_AT,
        letterhead: { companyName: "Wazi & Sons" },
      }),
    );
    const footer = worksheet.headerFooter.oddFooter ?? "";
    // The date is Riyadh's: the 4th, not the server's 3rd.
    assert.ok(footer.includes("Printed on 04/10/2026"), footer);
    assert.ok(footer.includes("Page &P of &N"), footer);
    // The office's name heads every printed sheet; an ampersand in it is escaped.
    assert.equal(worksheet.headerFooter.oddHeader, "&CWazi && Sons");
  });

  test("is mirrored for an Arabic reader: the date on the right", () => {
    const { oddFooter } = printHeaderFooter({
      lang: "ar",
      rtl: true,
      printedOn: "04/10/2026",
    });
    const printedOn = arabicWord("exports.document.printedOn").replace("{date}", "04/10/2026");
    const pageOf = arabicWord("exports.document.pageOf")
      .replace("{page}", "&P")
      .replace("{pages}", "&N");
    assert.equal(oddFooter, `&R${printedOn}&L${pageOf}`);
    const english = printHeaderFooter({
      lang: "en",
      rtl: false,
      printedOn: "04/10/2026",
    });
    assert.equal(english.oddFooter, "&LPrinted on 04/10/2026&RPage &P of &N");
    assert.equal(english.oddHeader, "");
  });

  test("prints landscape, one page wide, with the header row on every page", async () => {
    const worksheet = await read(await toXlsx(sheetOf(3), { lang: "en" }));
    assert.equal(worksheet.pageSetup.orientation, "landscape");
    assert.equal(worksheet.pageSetup.paperSize, 9);
    assert.equal(worksheet.pageSetup.fitToPage, true);
    assert.equal(worksheet.pageSetup.fitToWidth, 1);
    assert.equal(worksheet.pageSetup.fitToHeight, 0);
    // The header row is the one the sheet freezes under.
    const frozen = (worksheet.views[0] as { ySplit?: number } | undefined)?.ySplit;
    assert.equal(worksheet.pageSetup.printTitlesRow, `${frozen}:${frozen}`);
  });

  test("a long note wraps in its cell instead of running on", async () => {
    const note = "word ".repeat(40).trim();
    const sheet: ReportSheet<Row> = {
      title: "Inspections",
      columns: [{ header: "Notes", value: (row) => row.notes }],
      rows: [{ notes: note }, { notes: "short" }],
    };
    const worksheet = await read(await toXlsx(sheet, { lang: "en" }));
    const header = worksheet.getRow(3);
    assert.equal(String(header.getCell(1).value), "Notes");
    assert.equal(worksheet.getRow(4).getCell(1).alignment?.wrapText, true);
    assert.notEqual(worksheet.getRow(5).getCell(1).alignment?.wrapText, true);
  });
});

// ---------------------------------------------------------------------------
// One CSV writer
// ---------------------------------------------------------------------------

describe("the one CSV writer", () => {
  test("opens with the byte-order mark Excel needs to read Arabic", () => {
    const csv = buildCsv([["الاسم", "المبلغ"], ["طلال القحطاني", 1500]]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.equal(csv.charAt(0), CSV_BOM);
    assert.equal(csv.slice(1), "الاسم,المبلغ\r\nطلال القحطاني,1500");
    // Encoded as UTF-8, the file starts with EF BB BF.
    assert.deepEqual([...Buffer.from(csv, "utf-8").subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  });

  test("quotes what has to be quoted, and doubles the quotes inside", () => {
    assert.equal(csvCell('say "hi", twice'), '"say ""hi"", twice"');
    assert.equal(csvCell("line one\nline two"), '"line one\nline two"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(undefined), "");
    assert.equal(csvCell(true), "TRUE");
  });

  test("guards a cell that would run as a formula, but not a phone number", () => {
    assert.equal(csvCell("=HYPERLINK(\"x\")").startsWith("\"'="), true);
    assert.equal(csvCell("+966 50 123 4567"), "+966 50 123 4567");
    assert.equal(csvCell(-1500.5), "-1500.5");
  });

  test("an empty row is a blank line, and a mark is not added twice", () => {
    assert.equal(buildCsv([["a"], [], ["b"]], { bom: false }), "a\r\n\r\nb");
    const once = withCsvBom("a,b");
    assert.equal(withCsvBom(once), once);
    assert.equal(once.charCodeAt(0), 0xfeff);
  });
});

// ---------------------------------------------------------------------------
// Month names
// ---------------------------------------------------------------------------

describe("month names in the reader's language", () => {
  test("a month, a day or a moment is named in each language", () => {
    assert.equal(monthLabel("2026-10", "en"), "October 2026");
    assert.equal(monthLabel("2026-10", "ar"), "أكتوبر 2026");
    assert.equal(monthLabel("2026-10-04", "ar"), "أكتوبر 2026");
    assert.equal(monthLabel("2026-10", "en", "short"), "Oct 2026");
  });

  test("a moment is placed in the month it falls in at the office", () => {
    // 31 October, 22:00 UTC is already November in Riyadh.
    assert.equal(monthLabel(new Date("2026-10-31T22:00:00Z"), "en"), "November 2026");
    assert.equal(monthLabel(new Date("2026-10-31T20:00:00Z"), "en"), "October 2026");
  });

  test("the Month column of a report is translated, whatever way the route wrote it", () => {
    assert.equal(translateMonthCell("2026-09", "ar"), "سبتمبر 2026");
    assert.equal(translateMonthCell("Sep 2026", "ar"), "سبتمبر 2026");
    assert.equal(translateMonthCell("September 2026", "ar"), "سبتمبر 2026");
    // English is left as it was written; so is anything that is not a month.
    assert.equal(translateMonthCell("Sep 2026", "en"), "Sep 2026");
    assert.equal(translateMonthCell("Total", "ar"), "Total");
    assert.equal(translateMonthCell(1200, "ar"), 1200);

    const sheet: ReportSheet<Row> = {
      title: "Income & Expense Summary",
      columns: [
        { header: "Month", value: (row) => row.month },
        { header: "Income", value: (row) => row.income },
      ],
      rows: [
        { month: "Sep 2026", income: 100 },
        // Not a month, and not a stored code the catalogue words: left alone.
        { month: "No data yet", income: 100 },
      ],
    };
    const localized = localizeSheet(sheet, "ar");
    assert.deepEqual(
      localized.rows.map((row) => localized.columns[0].value(row)),
      ["سبتمبر 2026", "No data yet"],
    );
  });
});

// ---------------------------------------------------------------------------
// A PDF: every page names its issuer, and nothing is cut off
// ---------------------------------------------------------------------------

/** How many pages a PDF has, counted from the file itself. */
const pageCount = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

describe("the letterhead on every page", () => {
  test("the office's name and registration head every page, not only the first", async () => {
    let pdf: Buffer = Buffer.alloc(0);
    const drawn = await captureDrawnText(() => {
      pdf = toPdf(sheetOf(120), {
        printedAt: PRINTED_AT,
        letterhead: {
          companyName: "Wazi Property Management",
          commercialRegistration: "1010123456",
        },
      });
    });
    const pages = pageCount(pdf);
    assert.ok(pages >= 3, `120 rows run to several pages, got ${pages}`);
    for (let page = 1; page <= pages; page += 1) {
      const onPage = drawn.filter((entry) => entry.page === page).map((e) => e.text);
      assert.ok(onPage.includes("Wazi Property Management"), `page ${page} names the office`);
      assert.ok(onPage.includes("CR: 1010123456"), `page ${page} carries its registration`);
    }
  });

  test("the logo is drawn on every page, and stored once", async (t) => {
    t.mock.method(console, "warn", () => undefined);
    const logo = {
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mOQi1rwH4YZkDkAmmEMixw9b6kAAAAASUVORK5CYII=",
      format: "PNG" as const,
      width: 3,
      height: 2,
    };
    const pdf = toPdf(sheetOf(120), {
      printedAt: PRINTED_AT,
      letterhead: { companyName: "Wazi", logo },
    });
    const pages = pageCount(pdf);
    const text = pdf.toString("latin1");
    // One image object, placed on each page.
    assert.equal((text.match(/\/Subtype \/Image/g) ?? []).length, 1);
    assert.equal((text.match(/ Do\b/g) ?? []).length, pages);
  });

  test("a report with no letterhead has none, on any page", async () => {
    const drawn = await captureDrawnText(() => toPdf(sheetOf(120)));
    const pages = Math.max(...drawn.map((entry) => entry.page));
    assert.ok(pages >= 3);
    assert.ok(!drawn.some((entry) => entry.text === "Wazi"));
  });

  test("the table's header row follows it onto every page", async () => {
    const drawn = await captureDrawnText(() =>
      toPdf(sheetOf(120), {
        letterhead: { companyName: "Wazi" },
      }),
    );
    const pages = Math.max(...drawn.map((entry) => entry.page));
    for (let page = 1; page <= pages; page += 1) {
      assert.ok(
        drawn.some((e) => e.page === page && e.text === "Building"),
        `page ${page} has the header row`,
      );
    }
  });
});

describe("a wide table does not clip", () => {
  /** Eighteen columns of dates: the width at which the old fit cut them. */
  const columns = Array.from({ length: 18 }, (_, index) => `Date ${index + 1}`);
  const dates = columns.map(
    (_, index) =>
      `2026-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
  );
  const wide: ReportSheet<Row> = {
    title: "Wide dates",
    columns: columns.map((header, index) => ({
      header,
      value: () => dates[index],
    })),
    rows: Array.from({ length: 40 }, () => ({})),
  };

  test("every date is drawn whole", async () => {
    const drawn = await captureDrawnText(() => toPdf(wide));
    const cells = drawn.map((entry) => entry.text);
    assert.ok(!cells.some((text) => text.endsWith("…")), "nothing is cut with an ellipsis");
    for (const date of dates) {
      assert.equal(
        cells.filter((text) => text === date).length,
        40,
        `${date} is on every row`,
      );
    }
  });

  test("every cell starts inside the page", async () => {
    const drawn = await captureDrawnText(() => toPdf(wide));
    for (const entry of drawn) {
      assert.ok(entry.x >= 32 - 0.01 && entry.x <= 842 - 32 + 0.01, `${entry.text} at ${entry.x}`);
    }
  });

  test("the header of each column is whole too", async () => {
    const drawn = await captureDrawnText(() => toPdf(wide));
    const cells = new Set(drawn.map((entry) => entry.text));
    for (const header of columns) assert.ok(cells.has(header), header);
  });
});

describe("a long note wraps instead of being cut", () => {
  const note =
    "Tenant asked for the lease to be renewed for two more years provided the rent is held at the current level and the landlord repaints the apartment before the new term begins";
  const columns = [
    "Scheduled",
    "Type",
    "Status",
    "Building",
    "Inspector",
    "Completed",
    "Notes",
  ];
  const sheet: ReportSheet<Row> = {
    title: "Inspections",
    columns: columns.map((header) => ({ header, value: (row: Row) => row[header] })),
    rows: Array.from({ length: 6 }, (_, index) => ({
      Scheduled: "2026-09-01",
      Type: "routine",
      Status: "completed",
      Building: `Tower ${index}`,
      Inspector: "Faisal Al-Otaibi",
      Completed: "2026-09-02",
      // A running note in the first row; short ones after it.
      Notes: index === 0 ? note.repeat(2) : "short",
    })),
  };

  test("the whole note is on the page, in order, with no ellipsis", async () => {
    const doubled = `${note} ${note}`;
    const long: ReportSheet<Row> = {
      ...sheet,
      rows: sheet.rows.map((row, index) =>
        index === 0 ? { ...row, Notes: doubled } : row,
      ),
    };
    const drawn = await captureDrawnText(() => toPdf(long));
    const header = drawn.find((entry) => entry.text === "Notes");
    assert.ok(header, "the notes column has its header");
    const lines = drawn
      .filter(
        (entry) =>
          entry.x === header.x && entry.y > header.y && entry.text !== "short",
      )
      .sort((a, b) => a.y - b.y)
      .map((entry) => entry.text);
    assert.ok(lines.length > 1, "the note runs over several lines");
    assert.ok(!lines.some((line) => line.includes("…")));
    assert.equal(lines.join(" "), doubled);
    // And it never runs out of its column: no line is wider than the room
    // the column has left on the page.
    assert.ok(lines.every((line) => line.length < doubled.length));
  });

  test("the rows after a long note are pushed down, not overlapped by it", async () => {
    const long: ReportSheet<Row> = {
      ...sheet,
      rows: sheet.rows.map((row, index) =>
        index === 0 ? { ...row, Notes: `${note} ${note}` } : row,
      ),
    };
    const drawn = await captureDrawnText(() => toPdf(long));
    const y = (text: string) => drawn.find((entry) => entry.text === text)?.y ?? 0;
    const first = y("Tower 0");
    const second = y("Tower 1");
    const third = y("Tower 2");
    // The note takes several lines, so the second row sits well below the
    // first; the rows after it are one line apart.
    assert.ok(second - first > 30, `${second - first}`);
    assert.ok(third - second < 20, `${third - second}`);
  });

  test("a note of a thousand words is cut at the last line a cell may have", async () => {
    const huge: ReportSheet<Row> = {
      ...sheet,
      rows: [{ ...sheet.rows[0], Notes: Array.from({ length: 1000 }, (_, i) => `w${i}`).join(" ") }],
    };
    const drawn = await captureDrawnText(() => toPdf(huge));
    assert.ok(drawn.some((entry) => entry.text.endsWith("…")));
    // It still fits a page: the table's one row did not push the footer off.
    assert.ok(Math.max(...drawn.map((entry) => entry.page)) <= 2);
  });
});
