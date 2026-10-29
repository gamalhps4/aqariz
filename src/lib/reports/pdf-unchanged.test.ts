/**
 * Every report that does not ask for the statement layout prints exactly as
 * it did before that layout existed.
 *
 * The agreement statement needed parts the report PDF did not have — a
 * details block, a heading over the summary, further titled tables — and
 * they were added to the shared engine as opt-in fields of the sheet. The
 * fingerprints below were recorded from the engine BEFORE that change; a
 * sheet without the new fields has to come out byte for byte the same.
 *
 * jsPDF stamps each file with its creation time (and may add a file id), so
 * those two are blanked before hashing — nothing else differs between runs.
 * If jsPDF or the report font is upgraded, the hashes move for a reason that
 * has nothing to do with this: re-record them from a clean checkout of the
 * engine and say so in the commit.
 *
 * One fingerprint has been re-recorded on purpose: the report that runs over
 * several pages and carries a letterhead. Its pages after the first now carry
 * the office's name and registration at the top, in a smaller letterhead — a
 * loose page of a printout used to say nothing about who issued it. The other
 * two fingerprints are the originals: a report that fits its page, with or
 * without a letterhead and logo, still comes out byte for byte the same.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { toPdf } from "@/lib/reports/pdf";
import type { ReportSheet } from "@/lib/reports/export";

/** 10:00 UTC is the 29th everywhere from UTC−10 to UTC+13. */
const PRINTED_AT = new Date("2026-09-29T10:00:00Z");

/** A 3×2 PNG, written by hand so no image library is involved. */
const TINY_LOGO = {
  dataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR42mOQi1rwH4YZkDkAmmEMixw9b6kAAAAASUVORK5CYII=",
  format: "PNG" as const,
  width: 3,
  height: 2,
};

function fingerprint(pdf: Buffer): string {
  const stable = pdf
    .toString("latin1")
    .replace(/\/CreationDate \(D:[^)]*\)/g, "/CreationDate ()")
    .replace(/\/ID \[ ?<[0-9A-Fa-f]+> ?<[0-9A-Fa-f]+> ?\]/g, "/ID []");
  return createHash("sha256").update(stable, "latin1").digest("hex");
}

type PaymentRow = { date: string; tenant: string; method: string; amount: number };

const arabicStatement: ReportSheet<PaymentRow> = {
  title: "كشف حساب — شركة كلين تراك",
  columns: [
    { header: "التاريخ", value: (row) => row.date },
    { header: "المستأجر", value: (row) => row.tenant },
    { header: "طريقة الدفع", value: (row) => row.method },
    { header: "المبلغ", value: (row) => row.amount },
  ],
  rows: [
    { date: "2026-08-11", tenant: "شركة كلين تراك", method: "نقدًا", amount: 3000 },
    { date: "2026-08-11", tenant: "علي احمد بن علي الزهراني", method: "تحويل للمالك", amount: 1500 },
    { date: "2026-08-12", tenant: "Clean Track Co.", method: "Ejar", amount: 4000.5 },
  ],
  summary: [
    ["الفترة", "من 01/01/2026 إلى 29/09/2026"],
    ["إجمالي المحصل", 299317],
    ["عمولة الإدارة (2%)", 5986.34],
  ],
};

type TenantRow = { name: string; unit: string; rent: number };

const englishEmpty: ReportSheet<TenantRow> = {
  title: "Rent Roll",
  columns: [
    { header: "Tenant", value: (row) => row.name },
    { header: "Unit", value: (row) => row.unit },
    { header: "Rent", value: (row) => row.rent },
  ],
  rows: [],
};

const englishLong: ReportSheet<TenantRow> = {
  title: "Occupancy Report",
  columns: [
    { header: "Tenant", value: (row) => row.name },
    { header: "Unit", value: (row) => row.unit },
    { header: "Rent", value: (row) => row.rent },
  ],
  rows: Array.from({ length: 70 }, (_, index) => ({
    name: `Tenant ${index + 1}`,
    unit: `A-${100 + index}`,
    rent: 1000 + index * 12.5,
  })),
  // Long enough to run the summary itself onto a second page.
  summary: Array.from(
    { length: 34 },
    (_, index) => [`Line ${index + 1}`, index * 3] as [string, number],
  ),
};

describe("a report without the statement layout", () => {
  test("an Arabic statement with a letterhead and logo prints as before", () => {
    const pdf = toPdf(arabicStatement, {
      rtl: true,
      lang: "ar",
      printedAt: PRINTED_AT,
      dateFormat: "DD/MM/YYYY",
      letterhead: {
        companyName: "شركة قنوات العقارية",
        commercialRegistration: "1009034239",
        taxNumber: "300000000000003",
        logo: TINY_LOGO,
      },
    });
    assert.equal(fingerprint(pdf), "522f1a60eea40f339a961ad6e94746e8f2b2d9aa2bbf31ca8c3ba29ac69d3330");
  });

  test("an empty English report prints as before", () => {
    const pdf = toPdf(englishEmpty, { printedAt: PRINTED_AT });
    assert.equal(fingerprint(pdf), "5d76c1791da3169f819b1f2d6d0ed98bd84ed901177c90cc6868aa2f85ad281c");
  });

  test("a report that runs over several pages carries its letterhead on every page", () => {
    const pdf = toPdf(englishLong, {
      printedAt: PRINTED_AT,
      letterhead: { companyName: "Qanawat Real Estate" },
      footerNote: "Qanawat Real Estate",
    });
    // Re-recorded for the letterhead on every page; was 5869d377…8a7d8c.
    assert.equal(fingerprint(pdf), "2c323d5b19681df16d6b96b46945c9ba22273f526a1464bb57ccc3d12410188c");
  });
});
