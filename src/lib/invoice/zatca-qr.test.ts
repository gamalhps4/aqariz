/**
 * The ZATCA phase-1 QR code: five tag–length–value fields in base64, and a
 * symbol that is drawn the right way round on an Arabic page.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import jsPDF from "jspdf";
import { create as createQrSymbol } from "qrcode/lib/core/qrcode";
import { mirroredPdf } from "@/lib/invoice/pdf-i18n";
import {
  canCarryZatcaQr,
  drawQrCode,
  formatZatcaAmount,
  formatZatcaTimestamp,
  zatcaIssueMoment,
  zatcaQrPayload,
  zatcaTlv,
} from "@/lib/invoice/zatca-qr";

describe("the payload", () => {
  test("matches ZATCA's published example byte for byte", () => {
    assert.equal(
      zatcaQrPayload({
        sellerName: "Bobs Records",
        vatNumber: "310122393500003",
        timestamp: new Date("2022-04-25T15:30:00Z"),
        total: 1000,
        vatTotal: 150,
      }),
      "AQxCb2JzIFJlY29yZHMCDzMxMDEyMjM5MzUwMDAwMwMUMjAyMi0wNC0yNVQxNTozMDowMFoEBzEwMDAuMDAFBjE1MC4wMA==",
    );
  });

  test("an Arabic seller's name is counted in bytes, not letters", () => {
    const payload = zatcaQrPayload({
      sellerName: "مكتب الإدارة",
      vatNumber: "300000000000003",
      timestamp: new Date("2026-10-03T09:00:00.000Z"),
      total: 1150,
      vatTotal: 150,
    });
    assert.equal(
      payload,
      "ARfZhdmD2KrYqCDYp9mE2KXYr9in2LHYqQIPMzAwMDAwMDAwMDAwMDAzAxQyMDI2LTEwLTAzVDA5OjAwOjAwWgQHMTE1MC4wMAUGMTUwLjAw",
    );
  });

  test("a field longer than 255 bytes is cut on a whole letter", () => {
    const bytes = zatcaTlv({
      sellerName: "م".repeat(200),
      vatNumber: "300000000000003",
      timestamp: new Date("2026-10-03T09:00:00Z"),
      total: 1,
      vatTotal: 0,
    });
    assert.equal(bytes[0], 1);
    assert.equal(bytes[1], 254);
    assert.equal(new TextDecoder().decode(bytes.slice(2, 2 + bytes[1])), "م".repeat(127));
  });

  test("amounts print with two decimals and no sign; times to the second in UTC", () => {
    assert.equal(formatZatcaAmount(-230), "230.00");
    assert.equal(formatZatcaAmount(1234.5), "1234.50");
    assert.equal(formatZatcaTimestamp(new Date("2026-10-03T09:00:00.123Z")), "2026-10-03T09:00:00Z");
  });

  test("the issue moment is when it was written that day, else the day itself", () => {
    const day = new Date("2026-10-03T00:00:00Z");
    const created = new Date("2026-10-03T11:22:33Z");
    assert.equal(zatcaIssueMoment(day, created), created);
    assert.equal(zatcaIssueMoment(day, new Date("2026-10-05T08:00:00Z")), day);
    assert.equal(zatcaIssueMoment(day, null), day);
  });

  test("needs a seller name and a VAT number", () => {
    assert.ok(canCarryZatcaQr("Office", "300000000000003"));
    assert.ok(!canCarryZatcaQr("Office", ""));
    assert.ok(!canCarryZatcaQr(" ", "300000000000003"));
  });
});

describe("the symbol", () => {
  /** Every filled rectangle drawn on the document. */
  function capture(pdf: jsPDF) {
    const rects: Array<[number, number, number, number]> = [];
    const original = pdf.rect.bind(pdf);
    pdf.rect = ((x: number, y: number, w: number, h: number, style?: string) => {
      rects.push([x, y, w, h]);
      return original(x, y, w, h, style);
    }) as typeof pdf.rect;
    return rects;
  }

  test("is drawn as the modules, rows of runs, at its place", () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const rects = capture(pdf);
    drawQrCode(pdf, "hello", 20, 30, 29);
    const { modules } = createQrSymbol("hello", { errorCorrectionLevel: "M" });
    let dark = 0;
    for (let i = 0; i < modules.data.length; i += 1) if (modules.data[i]) dark += 1;
    const cell = 29 / modules.size;
    const covered = rects.reduce((sum, [, , w]) => sum + Math.round((w - 0.01) / cell), 0);
    assert.equal(covered, dark);
    // The finder pattern's corner is the first run, at the top-left.
    assert.deepEqual(rects[0].slice(0, 2), [20, 30]);
  });

  test("drawn on the document, not through the mirror, stays the right way round", () => {
    const pdf = new jsPDF({ unit: "mm", format: "a4" });
    const rects = capture(pdf);
    drawQrCode(pdf, "hello", 20, 30, 29);
    const direct = rects.splice(0);
    // What the mirror would have done to it: every run reflected.
    drawQrCode(mirroredPdf(pdf), "hello", 20, 30, 29);
    assert.notDeepEqual(rects, direct);
  });
});
