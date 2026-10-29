/**
 * The invoice a tenant is handed, and the receipt for what they paid.
 *
 * What was wrong with them showed up nowhere but on paper: invoices priced in
 * US dollars; the riyal sign drawn in a font without it, which turned every
 * amount into "1 , 2 0 0 . 0 0ýü"; a made-up US company printed as the issuer
 * of an office that had not filled in its branding; an Arabic reader handed
 * an English, left-to-right page. These pin the fixes on the PDFs every
 * screen now downloads, prints, previews and emails.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import jsPDF from "jspdf";
import { embedPdfFont, formatPdfMoney, setPdfFont } from "@/lib/invoice/pdf-text";
import { mirroredPdf, pdfLabel, formatPdfDate } from "@/lib/invoice/pdf-i18n";
import { reportFontBase64 } from "@/lib/reports/pdf-font";
import { renderInvoicePdf } from "@/lib/invoice/pdf-renderer";
import {
  DEFAULT_COMPANY_INFO,
  normalizeInvoiceForPrint,
  type InvoiceCompanyInfo,
} from "@/lib/invoice/invoice-shared";
import { normalizePaymentToReceipt } from "@/lib/invoice/receipt-data";
import { captureDrawnText } from "@/lib/testing/pdf-text-capture";

function sampleInvoice(
  overrides: Record<string, unknown> = {},
  companyInfo?: Partial<InvoiceCompanyInfo>,
) {
  return normalizeInvoiceForPrint(
    {
      _id: "inv1",
      invoiceNumber: "INV-2026-0042",
      issueDate: "2026-09-01",
      dueDate: "2026-09-10",
      status: "partial",
      currency: "SAR",
      subtotal: 12000,
      taxAmount: 0,
      totalAmount: 12000,
      amountPaid: 5000,
      balanceRemaining: 7000,
      tenantId: { firstName: "طلال", lastName: "القحطاني" },
      lineItems: [
        { description: "Installment 3", type: "rent", quantity: 1, unitPrice: 12000, total: 12000 },
      ],
      ...overrides,
    },
    companyInfo ? { companyInfo } : undefined,
  );
}

/** Every string the invoice PDF draws, in `lang`. */
function invoiceText(
  lang: "en" | "ar",
  companyInfo?: Partial<InvoiceCompanyInfo>,
) {
  return captureDrawnText(async () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    await renderInvoicePdf(pdf, sampleInvoice({}, companyInfo), {
      fontBase64: reportFontBase64(),
      lang,
      dateFormat: "DD/MM/YYYY",
      // 22:30 UTC on the 29th is already the 30th in Riyadh.
      printedAt: new Date("2026-09-29T22:30:00Z"),
    });
  });
}

describe("money on a PDF", () => {
  test("is written with the ISO code, which any font can draw", () => {
    assert.equal(formatPdfMoney(1200, "SAR"), "1,200.00 SAR");
    assert.equal(formatPdfMoney(1200.5, "sar"), "1,200.50 SAR");
  });

  test("falls back to the market's currency, and never prints -0.00", () => {
    assert.equal(formatPdfMoney(99), "99.00 SAR");
    assert.equal(formatPdfMoney(-0.000001, "SAR"), "0.00 SAR");
  });

  test("has nothing outside Latin-1 in it", () => {
    // One character outside the set is what garbled the whole string.
    assert.match(formatPdfMoney(1234567.89, "SAR"), /^[\x20-\x7E]+$/);
  });
});

describe("the invoice PDF", () => {
  test("prices in the invoice's own currency, not dollars", async () => {
    const texts = (await invoiceText("en")).map((entry) => entry.text);
    assert.ok(texts.some((text) => text.includes("12,000.00 SAR")));
    assert.ok(!texts.some((text) => text.includes("$")), "no dollar sign anywhere");
  });

  test("reads right to left, in Arabic, for an Arabic reader", async () => {
    const drawn = await invoiceText("ar");
    const due = drawn.find((entry) => entry.text === "الرصيد المستحق");
    assert.ok(due, "Balance due, in Arabic");
    assert.ok(!drawn.some((entry) => entry.text === "Balance due"));
    // The totals sit on the right in English (label at 120mm, left-aligned);
    // in Arabic they are mirrored onto the left, and the line is laid out
    // right to left.
    assert.deepEqual(
      [Math.round(due.x), due.align, due.rtl],
      [90, "right", true],
    );
  });

  test("leaves out charges that are zero", async () => {
    const texts = (await invoiceText("en")).map((entry) => entry.text);
    // A rent invoice has no shipping; the e-commerce template printed it anyway.
    assert.ok(!texts.includes("Other charges"));
    assert.ok(!texts.some((text) => text.includes("Shipping")));
  });

  test("carries the date, the office and the page count at its foot", async () => {
    const drawn = await invoiceText("en", { name: "Wazi Property Management" });
    assert.ok(drawn.some((entry) => entry.text === "Printed on 30/09/2026"));
    assert.ok(drawn.some((entry) => entry.text === "Page 1 of 1"));
    // Where "Issued with PropertyPro" used to be: the office that issued it.
    assert.ok(
      drawn.some(
        (entry) =>
          entry.text === "Wazi Property Management" && entry.align === "center",
      ),
    );
    assert.ok(!drawn.some((entry) => entry.text.includes("PropertyPro")));
  });
});

describe("an office without branding", () => {
  test("is not given someone else's name and number", async () => {
    assert.equal(DEFAULT_COMPANY_INFO.name, "");
    assert.equal(DEFAULT_COMPANY_INFO.phone, "");
    const texts = (await invoiceText("en")).map((entry) => entry.text);
    assert.ok(!texts.some((text) => text.includes("555")));
    assert.ok(!texts.some((text) => text.includes("Business Ave")));
  });
});

describe("a PDF in Arabic", () => {
  test("keeps the Arabic face when drawn through the right-to-left mirror", () => {
    // The mirror is a proxy, not the document: the font lookup used to miss
    // it and fall back to Helvetica, which prints Arabic as noise.
    const pdf = new jsPDF();
    embedPdfFont(pdf, reportFontBase64());
    const mirrored = mirroredPdf(pdf);
    setPdfFont(mirrored, "bold");
    assert.equal(pdf.getFont().fontName, "Amiri");
  });

  test("reflects positions and alignment across the page", () => {
    const calls: Array<[string, number, string | undefined]> = [];
    const fake = {
      internal: { pageSize: { getWidth: () => 210 } },
      text: (_text: string, x: number, _y: number, options?: { align?: string }) =>
        calls.push(["text", x, options?.align]),
      rect: (x: number) => calls.push(["rect", x, undefined]),
    } as unknown as jsPDF;
    const mirrored = mirroredPdf(fake);
    mirrored.text("a", 20, 10);
    mirrored.text("b", 190, 10, { align: "right" });
    mirrored.text("c", 105, 10, { align: "center" });
    mirrored.rect(20, 0, 30, 5);
    assert.deepEqual(calls, [
      ["text", 190, "right"],
      ["text", 20, "left"],
      ["text", 105, "center"],
      // A box is reflected by its far edge: 210 − 20 − 30.
      ["rect", 160, undefined],
    ]);
  });

  test("labels and dates come out in the document's language", () => {
    assert.equal(pdfLabel("ar", "leases.invoicePrint.total", "Total"), "الإجمالي");
    assert.equal(pdfLabel("en", "leases.invoicePrint.total", "Total"), "Total");
    assert.equal(
      pdfLabel("ar", "exports.document.pageOf", "Page {page} of {pages}", {
        page: 2,
        pages: 3,
      }),
      "صفحة 2 من 3",
    );
    assert.notEqual(
      formatPdfDate(new Date("2026-09-01T12:00:00Z"), "ar"),
      formatPdfDate(new Date("2026-09-01T12:00:00Z"), "en"),
    );
  });

  test("dates keep Western digits, as the footer and the screens do", () => {
    const date = formatPdfDate(new Date("2026-09-01T12:00:00Z"), "ar");
    assert.match(date, /2026/);
    assert.doesNotMatch(date, /[٠-٩]/);
  });
});

describe("the receipt a payment makes", () => {
  const company = { name: "شركة وازي", address: "", phone: "", email: "" };

  test("names the tenant whichever shape the payment carries them in", () => {
    const flat = normalizePaymentToReceipt(
      { amount: 500, tenantId: { firstName: "طلال", lastName: "القحطاني" } },
      company,
      "ar",
    );
    const nested = normalizePaymentToReceipt(
      {
        amount: 500,
        tenantId: { userId: { firstName: "طلال", lastName: "القحطاني" } },
      },
      company,
      "ar",
    );
    assert.equal(flat.tenant.name, "طلال القحطاني");
    assert.equal(nested.tenant.name, "طلال القحطاني");
  });

  test("describes a payment by its type, in the receipt's language", () => {
    const receipt = normalizePaymentToReceipt(
      { amount: 500, type: "rent" },
      company,
      "ar",
    );
    assert.equal(receipt.description, "إيجار");
  });

  test("prints a dash for what it does not know, never English", () => {
    const receipt = normalizePaymentToReceipt({ amount: 500 }, company, "ar");
    assert.deepEqual(
      [
        receipt.tenant.name,
        receipt.property.name,
        receipt.property.address,
        receipt.paymentMethod,
      ],
      ["—", "—", "—", "—"],
    );
  });
});
