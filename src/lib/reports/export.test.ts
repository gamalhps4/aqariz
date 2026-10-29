/**
 * Exports have to survive a non-Latin name.
 *
 * `Content-Disposition` header values are ByteStrings — one byte per
 * character — so assigning a filename containing Arabic threw outright:
 * "character at index 22 has a value of 1605 which is greater than 255". Every
 * owner statement and property report named after an Arabic record failed that
 * way, which in a product shipping for Saudi Arabia is most of them.
 *
 * Nothing static caught it: the build, the typecheck and lint all pass over a
 * header that only fails when a real name reaches it. These tests are the
 * cheap version of the afternoon that found it.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jsPDF from "jspdf";
import ExcelJS from "exceljs";

import {
  canExport,
  canExportOwnReport,
  contentDisposition,
  isFormulaLike,
  isReportFormat,
  localizeSheet,
  toCsv,
  toXlsx,
  type ReportSheet,
} from "@/lib/reports/export";
import { toPdf } from "@/lib/reports/pdf";
import { drawPageFooters, formatPrintDate } from "@/lib/reports/page-footer";
import {
  documentDateFormat,
  formatIsoDay,
  isUsableDateFormat,
  slashedDateFormat,
} from "@/lib/reports/date-format";
import { loadServerLogo, toPngLogo } from "@/lib/reports/logo-image";
import {
  fitLogo,
  isPlaceholderLogo,
  pickDocumentLogo,
} from "@/lib/invoice/logo-utils";
import { arabicLineLayout, drawText } from "@/lib/invoice/pdf-i18n";
import {
  captureDrawnText,
  type DrawnText,
} from "@/lib/testing/pdf-text-capture";

/** Every byte a header value is allowed to carry. */
const isLatin1 = (value: string) =>
  [...value].every((character) => character.charCodeAt(0) <= 255);

describe("content disposition", () => {
  test("an Arabic name never reaches the header as raw bytes", () => {
    const header = contentDisposition("كشف حساب المالك", "pdf");
    assert.ok(
      isLatin1(header),
      "a header value above U+00FF throws when assigned",
    );
  });

  test("sends both forms, as RFC 6266 requires", () => {
    const header = contentDisposition("Owner Statement", "xlsx");
    assert.match(header, /^attachment; filename="Owner Statement\.xlsx"/);
    assert.match(header, /filename\*=UTF-8''/);
  });

  test("the encoded form round-trips to the original name", () => {
    const name = "مجمع الرياض السكني";
    const header = contentDisposition(name, "csv");
    const encoded = /filename\*=UTF-8''(.+)$/.exec(header)?.[1] ?? "";
    assert.equal(decodeURIComponent(encoded), `${name}.csv`);
  });

  test("falls back to a usable name when nothing is ASCII", () => {
    const header = contentDisposition("كشف حساب", "pdf");
    // Not `.pdf` with an empty stem, which some clients save as no name at all.
    assert.match(header, /filename="report\.pdf"/);
  });

  test("quotes and backslashes cannot break out of the ASCII form", () => {
    const header = contentDisposition('Owner "Bad" \\ Name', "csv");
    const ascii = /filename="([^"]*)"/.exec(header)?.[1] ?? "";
    assert.ok(!ascii.includes('"'));
    assert.ok(!ascii.includes("\\"));
  });

  test("encodes the characters encodeURIComponent leaves alone", () => {
    // RFC 5987 wants !'()* percent-encoded too.
    const header = contentDisposition("a!b'c(d)e*f", "csv");
    const encoded = /filename\*=UTF-8''(.+)$/.exec(header)?.[1] ?? "";
    for (const character of ["!", "'", "(", ")", "*"]) {
      assert.ok(
        !encoded.includes(character),
        `${character} should have been percent-encoded`,
      );
    }
    assert.equal(decodeURIComponent(encoded), "a!b'c(d)e*f.csv");
  });
});

describe("csv", () => {
  const sheet = {
    title: "Statement",
    columns: [
      { header: "Name", value: (row: { name: string; amount: number }) => row.name },
      { header: "Amount", value: (row: { name: string; amount: number }) => row.amount },
    ],
    rows: [{ name: "طلال القحطاني", amount: 1000 }],
    summary: [["Total", 1000]] as Array<[string, string | number]>,
  };

  test("carries the byte-order mark Excel needs for Arabic", () => {
    // Without it Excel opens a non-Latin name as mojibake.
    assert.equal(toCsv(sheet).charCodeAt(0), 0xfeff);
  });

  test("keeps the Arabic text intact", () => {
    assert.ok(toCsv(sheet).includes("طلال القحطاني"));
  });

  test("quotes a value containing a comma rather than splitting the row", () => {
    const risky = {
      ...sheet,
      rows: [{ name: "Doe, John", amount: 1 }],
    };
    assert.ok(toCsv(risky).includes('"Doe, John"'));
  });
});

describe("format validation", () => {
  test("accepts the three the writer produces", () => {
    assert.ok(isReportFormat("csv"));
    assert.ok(isReportFormat("xlsx"));
    assert.ok(isReportFormat("pdf"));
  });

  test("rejects anything else, so a typo is a 400 and not a surprise", () => {
    assert.equal(isReportFormat("bogus"), false);
    assert.equal(isReportFormat(""), false);
    assert.equal(isReportFormat(undefined), false);
  });
});

describe("formula guard", () => {
  test("anything that could run as a formula is neutralised", () => {
    for (const text of ["=HYPERLINK(\"x\")", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)"]) {
      assert.equal(isFormulaLike(text), true, text);
    }
  });

  test("a phone number or a signed figure is not", () => {
    // Every Saudi mobile starts with +966; these used to come out as "'+966".
    for (const text of ["+966 50 123 4567", "+966501230110", "-1500.50", "+1 (555) 010-2020"]) {
      assert.equal(isFormulaLike(text), false, text);
    }
  });
});

// ---------------------------------------------------------------------------
// Printouts: the date and page count at the foot of every page, the logo,
// the reader's language, and the letterhead on a spreadsheet.
// ---------------------------------------------------------------------------

/** How many pages a PDF has, counted from the file itself. */
const pageCount = (pdf: Buffer) =>
  (pdf.toString("latin1").match(/\/Type \/Page[^s]/g) ?? []).length;

/** 29 September, 22:30 UTC — already the 30th in Riyadh. */
const LATE_EVENING = new Date("2026-09-29T22:30:00Z");

type TenantRow = { name: string; method: string };

const tenantSheet = (count: number): ReportSheet<TenantRow> => ({
  title: "Rent Roll",
  columns: [
    { header: "Tenant", value: (row) => row.name },
    { header: "Payment method", value: (row) => row.method },
  ],
  rows: Array.from({ length: count }, (_, index) => ({
    name: `Tenant ${index + 1}`,
    method: "bank_transfer",
  })),
});

describe("the printed-on date", () => {
  test("is the office's format on a Riyadh clock", () => {
    // A server on UTC would still be on the 29th.
    assert.equal(formatPrintDate(LATE_EVENING), "30/09/2026");
    assert.equal(formatPrintDate(LATE_EVENING, "DD/MM/YYYY"), "30/09/2026");
    assert.equal(formatPrintDate(LATE_EVENING, "YYYY-MM-DD"), "2026-09-30");
    assert.equal(formatPrintDate(LATE_EVENING, "MM/DD/YYYY"), "09/30/2026");
    assert.equal(formatPrintDate(LATE_EVENING, "D.M.YY"), "30.9.26");
  });

  test("a format it cannot read falls back to the market's", () => {
    for (const format of ["", null, undefined, "dd MMM yyyy", "DD/DD/YYYY", "YYYY-MM"]) {
      assert.equal(isUsableDateFormat(format), false, String(format));
      assert.equal(formatPrintDate(LATE_EVENING, format), "30/09/2026");
    }
  });
});

describe("the foot of every page", () => {
  test("carries the date and 'page N of M' on every page of a report", async () => {
    let pdf: Buffer = Buffer.alloc(0);
    const drawn = await captureDrawnText(() => {
      pdf = toPdf(tenantSheet(80), { printedAt: LATE_EVENING });
    });

    const pages = pageCount(pdf);
    assert.ok(pages >= 3, `80 rows should run to several pages, got ${pages}`);
    for (let page = 1; page <= pages; page += 1) {
      const onPage = drawn.filter((entry) => entry.page === page);
      assert.ok(
        onPage.some((entry) => entry.text === `Page ${page} of ${pages}`),
        `page ${page} has its number`,
      );
      assert.ok(
        onPage.some((entry) => entry.text === "Printed on 30/09/2026"),
        `page ${page} has the date`,
      );
    }
  });

  test("is written and mirrored for an Arabic reader", async () => {
    const drawn = await captureDrawnText(() =>
      toPdf(localizeSheet(tenantSheet(3), "ar"), {
        rtl: true,
        lang: "ar",
        printedAt: LATE_EVENING,
      }),
    );
    const date = drawn.find((entry) => entry.text === "تاريخ الطباعة: 30/09/2026");
    const count = drawn.find((entry) => entry.text === "صفحة 1 من 1");
    // A4 landscape is 841.89pt wide with 32pt margins: the date against the
    // right edge, the count against the left.
    const at = (entry?: DrawnText) => [Math.round((entry?.x ?? 0) * 100) / 100, entry?.align];
    assert.deepEqual(at(date), [809.89, "right"]);
    assert.deepEqual(at(count), [32, "left"]);
  });

  test("is drawn once every page exists, by the shared helper too", () => {
    const calls: Array<[number, string, number, string | undefined]> = [];
    let current = 0;
    const fake = {
      internal: { pageSize: { getWidth: () => 210 } },
      getNumberOfPages: () => 3,
      setPage: (page: number) => {
        current = page;
      },
      setDrawColor: () => undefined,
      setLineWidth: () => undefined,
      line: () => undefined,
      setFontSize: () => undefined,
      setTextColor: () => undefined,
      getTextWidth: (text: string) => text.length,
      text: (text: string, x: number, _y: number, options?: { align?: string }) =>
        calls.push([current, text, x, options?.align]),
    } as unknown as jsPDF;

    drawPageFooters(
      fake,
      { lang: "en", rtl: false, printedOn: "30/09/2026", note: "Wazi" },
      {
        marginX: 20,
        baseline: 286,
        ruleY: 281,
        ruleWidth: 0.2,
        fontSize: 8,
        textColor: [0, 0, 0],
        ruleColor: [0, 0, 0],
      },
    );

    assert.deepEqual(
      calls.filter(([, text]) => text.startsWith("Page")),
      [
        [1, "Page 1 of 3", 190, "right"],
        [2, "Page 2 of 3", 190, "right"],
        [3, "Page 3 of 3", 190, "right"],
      ],
    );
    assert.equal(calls.filter(([, text]) => text === "Printed on 30/09/2026").length, 3);
    // The office's name, centred.
    assert.deepEqual(calls.find(([, text]) => text === "Wazi"), [1, "Wazi", 105, "center"]);
  });
});

describe("an empty report", () => {
  test("says so in the reader's language", async () => {
    const empty = tenantSheet(0);
    const english = (await captureDrawnText(() => toPdf(empty))).map(
      (entry) => entry.text,
    );
    assert.ok(english.includes("No records match these filters."));

    const arabic = (
      await captureDrawnText(() =>
        toPdf(localizeSheet(empty, "ar"), { rtl: true, lang: "ar" }),
      )
    ).map((entry) => entry.text);
    assert.ok(arabic.includes("لا توجد سجلات تطابق عوامل التصفية هذه"));
    assert.ok(!arabic.includes("No records match these filters."));
  });
});

describe("English exports", () => {
  test("print stored codes as words", () => {
    const sheet = localizeSheet(
      {
        title: "Payments",
        columns: [
          { header: "Tenant", value: (row: { name: string; code: string }) => row.name },
          { header: "Value", value: (row: { name: string; code: string }) => row.code },
        ],
        rows: [
          { name: "Ahmed Al-Harbi", code: "credit_card" },
          { name: "Active Holdings", code: "owner_account" },
          { name: "طلال القحطاني", code: "rent" },
          { name: "Paid-up Ltd", code: "paid" },
          // Not in the catalogue yet: still words, not a code.
          { name: "Sara", code: "in_review" },
        ],
        summary: [["  bank_transfer", 1200]],
      },
      "en",
    );

    assert.deepEqual(
      sheet.rows.map((row) => sheet.columns[1].value(row)),
      ["Credit card", "Transfer to owner", "Rent", "Paid", "In review"],
    );
    // Names are never taken for codes.
    assert.deepEqual(
      sheet.rows.map((row) => sheet.columns[0].value(row)),
      ["Ahmed Al-Harbi", "Active Holdings", "طلال القحطاني", "Paid-up Ltd", "Sara"],
    );
    assert.deepEqual(sheet.summary, [["  Bank transfer", 1200]]);
    assert.equal(sheet.title, "Payments");
  });
});

describe("the letterhead logo", () => {
  const SVG = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><rect width="480" height="160" fill="#0f766e"/></svg>',
  );

  test("is the office's own, never the app's placeholder", () => {
    assert.equal(
      pickDocumentLogo({
        logoLight: "/images/logo-light.png",
        logoDark: "https://pub-1.r2.dev/org/logo-dark.png",
        favicon: "/favicon.ico",
      }),
      "https://pub-1.r2.dev/org/logo-dark.png",
    );
    assert.equal(
      pickDocumentLogo({
        logoLight: "https://pub-1.r2.dev/org/logo.png",
        logoDark: "https://pub-1.r2.dev/org/logo-dark.png",
      }),
      "https://pub-1.r2.dev/org/logo.png",
    );
    // Placeholders everywhere: no logo at all, not PropertyPro's.
    assert.equal(
      pickDocumentLogo({
        logoLight: "/images/logo-light.png",
        logoDark: "/images/logo-dark.png",
        favicon: "/favicon.ico",
      }),
      undefined,
    );
    assert.equal(isPlaceholderLogo("/images/logo-light.png?v=2"), true);
    assert.equal(isPlaceholderLogo("https://pub-1.r2.dev/images/logo-light.png"), false);
  });

  test("keeps its proportions", () => {
    assert.deepEqual(fitLogo(480, 160, { width: 150, height: 44 }), {
      width: 132,
      height: 44,
    });
    assert.deepEqual(fitLogo(0, 160, { width: 150, height: 44 }), {
      width: 0,
      height: 0,
    });
  });

  test("any format becomes a PNG jsPDF can draw, in proportion", async () => {
    const logo = await toPngLogo(SVG);
    assert.match(logo.dataUrl, /^data:image\/png;base64,/);
    // Rendered sharp, then capped at 600px on its longest side.
    assert.deepEqual([logo.width, logo.height], [600, 200]);
  });

  test("is never fetched from outside R2, and a placeholder is no logo", async (t) => {
    t.mock.method(console, "warn", () => undefined);
    const fetchMock = t.mock.method(globalThis, "fetch", async () => {
      throw new Error("must not be fetched");
    });
    assert.equal(await loadServerLogo("/images/logo-light.png"), null);
    assert.equal(
      await loadServerLogo("http://169.254.169.254/latest/meta-data/logo.png"),
      null,
    );
    assert.equal(fetchMock.mock.callCount(), 0);
  });

  test("survives a dropped connection, and is not fetched twice", async (t) => {
    const png = Buffer.from((await toPngLogo(SVG)).dataUrl.split(",")[1], "base64");
    let calls = 0;
    t.mock.method(globalThis, "fetch", async () => {
      calls += 1;
      // The first attempt fails the way undici does when a socket drops.
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response(new Uint8Array(png), {
        headers: { "content-type": "image/png" },
      });
    });
    const url = "https://pub-test.r2.dev/org/o1/PropertyPro/branding/logos/logo_light_1.png";
    const first = await loadServerLogo(url);
    assert.ok(first, "loaded on the retry");
    assert.equal(await loadServerLogo(url), first);
    assert.equal(calls, 2, "one failure, one success, then served from memory");
  });

  test("is drawn on the report, and one that cannot be read is left off", async (t) => {
    t.mock.method(console, "warn", () => undefined);
    const logo = await toPngLogo(SVG);
    const withLogo = toPdf(tenantSheet(2), {
      letterhead: { companyName: "Wazi Property Management", logo },
    });
    assert.match(withLogo.toString("latin1"), /\/Subtype \/Image/);

    let broken: Buffer = Buffer.alloc(0);
    const drawn = await captureDrawnText(() => {
      broken = toPdf(tenantSheet(2), {
        letterhead: {
          companyName: "Wazi Property Management",
          commercialRegistration: "1010123456",
          logo: { ...logo, dataUrl: "data:image/png;base64,AAAA" },
        },
      });
    });
    assert.doesNotMatch(broken.toString("latin1"), /\/Subtype \/Image/);
    // The rest of the letterhead still prints.
    const texts = drawn.map((entry) => entry.text);
    assert.ok(texts.includes("Wazi Property Management"));
    assert.ok(texts.includes("CR: 1010123456"));
  });
});

describe("Arabic lines on a PDF", () => {
  test("a line with Arabic is laid out right to left, brackets mirrored", () => {
    for (const text of [
      "شكراً لسدادك.",
      "ضريبة القيمة المضافة على العمولة (15%)",
      "سداد الفاتورة INV-2026-0042",
    ]) {
      const layout = arabicLineLayout(text);
      assert.equal(layout?.isInputRtl, true, text);
      assert.equal(layout?.isSymmetricSwapping, true, text);
    }
  });

  test("a line without Arabic keeps jsPDF's own layout", () => {
    // Read right to left, "12,000.00 SAR" would print as "SAR 12,000.00".
    for (const text of ["12,000.00 SAR", "Ahmed Al-Harbi", "30/09/2026", ""]) {
      assert.equal(arabicLineLayout(text), undefined, text);
    }
  });

  test("lines of which only some are Arabic are drawn one at a time", () => {
    const calls: Array<[string, number, boolean]> = [];
    const fake = {
      getFontSize: () => 10,
      getLineHeightFactor: () => 1.15,
      internal: { scaleFactor: 2 },
      text: (text: string, _x: number, y: number, options?: { isInputRtl?: boolean }) =>
        calls.push([text, y, options?.isInputRtl === true]),
    } as unknown as jsPDF;

    drawText(fake, ["طريق الملك فهد، الرياض", "talal@example.com"], 10, 100);
    // 10pt × 1.15 over a scale factor of 2: the spacing jsPDF itself uses.
    assert.deepEqual(calls, [
      ["طريق الملك فهد، الرياض", 100, true],
      ["talal@example.com", 105.75, false],
    ]);
  });

  test("a report lays out its Arabic cells right to left, and only those", async () => {
    const drawn = await captureDrawnText(() =>
      toPdf(
        {
          ...tenantSheet(0),
          rows: [{ name: "طلال القحطاني", method: "cash" }],
        },
        { lang: "en" },
      ),
    );
    assert.equal(drawn.find((entry) => entry.text === "طلال القحطاني")?.rtl, true);
    assert.equal(drawn.find((entry) => entry.text === "Rent Roll")?.rtl, false);
  });
});

describe("a report's period", () => {
  const withPeriod = (period: string): ReportSheet<TenantRow> => ({
    ...tenantSheet(0),
    summary: [["Period", period]],
  });
  const periodOf = (sheet: ReportSheet<TenantRow>) => sheet.summary?.[0][1];

  test("is written in the reader's language, in the office's date format", () => {
    const period = "2026-08-31 to 2026-09-29";
    const dateFormat = "DD/MM/YYYY";
    assert.equal(
      periodOf(localizeSheet(withPeriod(period), "ar", { dateFormat })),
      "من 31/08/2026 إلى 29/09/2026",
    );
    assert.equal(
      periodOf(localizeSheet(withPeriod(period), "en", { dateFormat })),
      "31/08/2026 to 29/09/2026",
    );
  });

  test("keeps an open end, and stays ISO where no format is given (CSV)", () => {
    assert.equal(
      periodOf(
        localizeSheet(withPeriod("… to 2026-09-29"), "ar", {
          dateFormat: "DD/MM/YYYY",
        }),
      ),
      "من … إلى 29/09/2026",
    );
    assert.equal(
      periodOf(localizeSheet(withPeriod("2026-08-31 to 2026-09-29"), "en")),
      "2026-08-31 to 2026-09-29",
    );
  });

  test("a day is written in the office's format without touching a clock", () => {
    assert.equal(formatIsoDay("2026-09-29", "DD/MM/YYYY"), "29/09/2026");
    assert.equal(formatIsoDay("2026-09-29", "MM/DD/YYYY"), "09/29/2026");
    assert.equal(formatIsoDay("2026-09-29", "nonsense"), "29/09/2026");
    assert.equal(formatIsoDay("29 Sept", "DD/MM/YYYY"), "29 Sept");
  });
});

describe("a day in a cell", () => {
  type DueRow = { due: string; reference: string };
  const dueSheet: ReportSheet<DueRow> = {
    title: "Due payments",
    columns: [
      { header: "Due date", value: (row) => row.due },
      { header: "Reference", value: (row) => row.reference },
    ],
    rows: [{ due: "2026-10-04", reference: "INV-2026-10-04" }],
    summary: [["As at", "2026-10-03"]],
  };

  test("is written the office's way in a printed file, and stays ISO in a CSV", () => {
    const printed = localizeSheet(dueSheet, "ar", { dateFormat: "DD/MM/YYYY" });
    const [row] = printed.rows;
    assert.equal(printed.columns[0].value(row), "04/10/2026");
    // A reference with a date inside it is not a date.
    assert.equal(printed.columns[1].value(row), "INV-2026-10-04");
    assert.equal(printed.summary?.[0][1], "03/10/2026");

    const csv = localizeSheet(dueSheet, "ar");
    assert.equal(csv.columns[0].value(csv.rows[0]), "2026-10-04");
  });

  test("a printed file always has a format: the office's, or the market's", () => {
    assert.equal(documentDateFormat("yyyy-mm-dd"), "YYYY-MM-DD");
    for (const format of [null, undefined, "", "dd MMM yyyy"]) {
      assert.equal(documentDateFormat(format), "DD/MM/YYYY", String(format));
    }
  });

  test("an Arabic PDF writes slashes, in the office's order", () => {
    assert.equal(slashedDateFormat("DD/MM/YYYY"), "DD/MM/YYYY");
    assert.equal(slashedDateFormat("YYYY-MM-DD"), "YYYY/MM/DD");
    assert.equal(slashedDateFormat("D.M.YY"), "D/M/YY");
    assert.equal(slashedDateFormat(null), "DD/MM/YYYY");
    assert.equal(
      formatIsoDay("2026-10-04", slashedDateFormat("YYYY-MM-DD")),
      "2026/10/04",
    );
  });
});

describe("an Excel export", () => {
  const read = async (buffer: Buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    return (row: number) => String(sheet.getRow(row).getCell(1).value ?? "");
  };

  test("carries the office's letterhead above the title", async () => {
    const cell = await read(
      await toXlsx(tenantSheet(1), {
        letterhead: {
          companyName: "شركة وازي لإدارة الأملاك",
          commercialRegistration: "1010123456",
          taxNumber: "300123456700003",
        },
        lang: "ar",
      }),
    );
    assert.equal(cell(1), "شركة وازي لإدارة الأملاك");
    assert.equal(cell(2), "سجل تجاري: 1010123456   ·   الرقم الضريبي: 300123456700003");
    assert.equal(cell(4), "Rent Roll");
  });

  test("without one, starts with the title as before", async () => {
    const cell = await read(await toXlsx(tenantSheet(1)));
    assert.equal(cell(1), "Rent Roll");
  });
});

describe("an owner's own statement", () => {
  // The owner role holds reports_own and none of the office's export rights,
  // so the portal's download answered 403 for every owner.
  const owner = {
    isOwner: true,
    permissions: ["property_view", "payment_history", "reports_own"],
  };

  test("an owner may carry their own away", () => {
    assert.equal(canExport(owner, "owner_export", "owner_management"), false);
    assert.equal(canExportOwnReport(owner), true);
  });

  test("only an owner, and only with reports_own", () => {
    assert.equal(
      canExportOwnReport({ isOwner: true, permissions: ["property_view"] }),
      false,
    );
    assert.equal(
      canExportOwnReport({ isOwner: false, permissions: ["reports_own"] }),
      false,
    );
  });
});
