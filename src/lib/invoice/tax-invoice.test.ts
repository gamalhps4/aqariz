/**
 * The tax invoice on paper (ZATCA phase 1), and what a credit note does.
 *
 * An office with a VAT number prints a simplified tax invoice — a tax
 * invoice when the buyer gives theirs — with both VAT numbers, VAT by rate,
 * and the QR code drawn the right way round in Arabic too. A credit note
 * prints its figures positive and names the invoice it corrects; what it
 * credits comes off that invoice's balance.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import jsPDF from "jspdf";
import { reportFontBase64 } from "@/lib/reports/pdf-font";
import { renderInvoicePdf } from "@/lib/invoice/pdf-renderer";
import { normalizeInvoiceForPrint } from "@/lib/invoice/invoice-shared";
import { captureDrawnText } from "@/lib/testing/pdf-text-capture";
import { taxDocumentTitle } from "@/lib/invoice/tax-document";
import { applyCredit, creditableLines } from "@/lib/invoice/credit-note";
import { normalizePaymentToReceipt, receiptVatAmount } from "@/lib/invoice/receipt-data";
import { computeVatInvoice } from "@/lib/invoice/vat";

const OFFICE = { name: "مكتب الإدارة", vatNumber: "300000000000003" };

/** A custom invoice as the API returns it: lines carrying their VAT. */
function customInvoice(overrides: Record<string, unknown> = {}) {
  const computed = computeVatInvoice(
    [
      { description: "Management fee", category: "management_fee", unitPrice: 1000, vatCategory: "S", vatRate: 15 },
      { description: "Rent", category: "rent", unitPrice: 3000, vatCategory: "E" },
    ],
    400,
  );
  return {
    _id: "inv1",
    invoiceNumber: "INV-000001",
    documentType: "invoice",
    customerType: "owner",
    customerName: "شركة المالك",
    issueDate: "2026-10-03",
    dueDate: "2026-10-10",
    createdAt: "2026-10-03T09:15:00.000Z",
    status: "issued",
    currency: "SAR",
    category: "management_fee",
    subtotal: computed.totals.subtotal,
    discountAmount: computed.totals.discountAmount,
    taxAmount: computed.totals.taxAmount,
    totalAmount: computed.totals.totalAmount,
    amountPaid: 0,
    balanceRemaining: computed.totals.totalAmount,
    lineItems: computed.lines.map((line) => ({
      description: line.description,
      type: line.category,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      amount: line.grossAmount,
      netAmount: line.netAmount,
      vatCategory: line.vatCategory,
      vatRate: line.vatRate,
      vatAmount: line.vatAmount,
    })),
    tenantId: null,
    ...overrides,
  };
}

async function drawn(invoice: Record<string, unknown>, lang: "en" | "ar", company = OFFICE) {
  const rects: Array<[number, number, number, number]> = [];
  const texts = await captureDrawnText(async () => {
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const original = pdf.rect.bind(pdf);
    pdf.rect = ((x: number, y: number, w: number, h: number, style?: string) => {
      rects.push([x, y, w, h]);
      return original(x, y, w, h, style);
    }) as typeof pdf.rect;
    await renderInvoicePdf(
      pdf,
      normalizeInvoiceForPrint(invoice, { companyInfo: { ...company, address: "", phone: "", email: "" } }),
      { fontBase64: reportFontBase64(), lang, printedAt: new Date("2026-10-03T10:00:00Z") },
    );
  });
  return { texts: texts.map((entry) => entry.text), entries: texts, rects };
}

describe("which tax document", () => {
  test("simplified without the buyer's VAT number, a tax invoice with it, a plain invoice without the office's", () => {
    assert.equal(taxDocumentTitle({ sellerVatNumber: "300000000000003" }).arabic, "فاتورة ضريبية مبسطة");
    assert.equal(
      taxDocumentTitle({ sellerVatNumber: "300000000000003", buyerVatNumber: "311111111111113" }).arabic,
      "فاتورة ضريبية",
    );
    assert.equal(taxDocumentTitle({}).english, "Invoice");
    assert.equal(taxDocumentTitle({ documentType: "credit_note" }).arabic, "إشعار دائن");
  });
});

describe("the normalized invoice", () => {
  test("names its buyer, keeps its VAT per line and by rate", () => {
    const invoice = normalizeInvoiceForPrint(customInvoice());
    assert.equal(invoice.buyer.name, "شركة المالك");
    assert.equal(invoice.documentType, "invoice");
    assert.deepEqual(invoice.vatBreakdown, [
      { vatCategory: "S", vatRate: 15, netAmount: 900, vatAmount: 135 },
      { vatCategory: "E", vatRate: 0, netAmount: 2700, vatAmount: 0 },
    ]);
    assert.equal(invoice.issuedAt.toISOString(), "2026-10-03T09:15:00.000Z");
  });

  test("an installment without VAT lines is one treatment: exempt", () => {
    const invoice = normalizeInvoiceForPrint({
      invoiceNumber: "RENT-000001",
      category: "rent",
      subtotal: 3000,
      taxAmount: 0,
      totalAmount: 3000,
      lineItems: [{ description: "Rent", type: "rent", amount: 3000 }],
    });
    assert.deepEqual(invoice.vatBreakdown, [
      { vatCategory: "E", vatRate: 0, netAmount: 3000, vatAmount: 0 },
    ]);
  });

  test("a credit note prints its figures positive and owes nothing", () => {
    const invoice = normalizeInvoiceForPrint(
      customInvoice({
        documentType: "credit_note",
        subtotal: -200,
        discountAmount: 0,
        taxAmount: -30,
        totalAmount: -230,
        balanceRemaining: 0,
        lineItems: [
          { description: "Fee", amount: -200, unitPrice: -200, netAmount: -200, vatCategory: "S", vatRate: 15, vatAmount: -30 },
        ],
        metadata: { originalInvoiceNumber: "INV-000001", reason: "Agreed discount" },
      }),
    );
    assert.equal(invoice.totals.total, 230);
    assert.equal(invoice.totals.taxAmount, 30);
    assert.equal(invoice.balanceRemaining, 0);
    assert.equal(invoice.lineItems[0].total, 200);
    assert.equal(invoice.originalInvoiceNumber, "INV-000001");
    assert.equal(invoice.creditReason, "Agreed discount");
  });
});

describe("the tax invoice PDF", () => {
  test("is a simplified tax invoice with the seller's VAT number, VAT by rate and a QR code", async () => {
    const { texts, rects } = await drawn(customInvoice(), "en");
    assert.ok(texts.includes("SIMPLIFIED TAX INVOICE"));
    assert.ok(texts.includes("فاتورة ضريبية مبسطة"), "the Arabic title under the English");
    assert.ok(texts.includes("VAT No. 300000000000003"));
    assert.ok(texts.includes("VAT (15%)"));
    assert.ok(texts.includes("Total excluding VAT"));
    assert.ok(texts.includes("Total including VAT"));
    assert.ok(texts.includes("Exempt"), "the exempt line says so");
    // The QR code: many small dark squares in its 30mm box at the left margin.
    const qr = rects.filter(([x, , w, h]) => x >= 20 && x + w <= 50.1 && h < 2);
    assert.ok(qr.length > 50, `QR modules drawn (${qr.length})`);
  });

  test("is a tax invoice when the buyer gives a VAT number, and prints it", async () => {
    const { texts } = await drawn(customInvoice({ customerVatNumber: "311111111111113" }), "en");
    assert.ok(texts.includes("TAX INVOICE"));
    assert.ok(texts.includes("VAT No. 311111111111113"));
  });

  test("in Arabic, the QR code sits on the left-hand margin's mirror — unreflected", async () => {
    const { texts, rects } = await drawn(customInvoice(), "ar");
    assert.ok(texts.includes("فاتورة ضريبية مبسطة"));
    assert.ok(texts.includes("الرقم الضريبي: 300000000000003"));
    const qr = rects.filter(([x, , w, h]) => x >= 160 - 0.01 && x + w <= 190.1 && h < 2);
    assert.ok(qr.length > 50, `QR modules drawn on the right (${qr.length})`);
  });

  test("without the office's VAT number it stays a plain invoice, without a QR code", async () => {
    const { texts, rects } = await drawn(customInvoice(), "en", { name: "Office", vatNumber: "" });
    assert.ok(texts.includes("INVOICE"));
    assert.ok(!texts.some((text) => text.startsWith("VAT No.")));
    assert.ok(rects.filter(([, , , h]) => h < 2).length < 10);
  });

  test("a credit note names the invoice it corrects and has no balance due", async () => {
    const { texts } = await drawn(
      customInvoice({
        documentType: "credit_note",
        invoiceNumber: "CN-000001",
        subtotal: -200,
        discountAmount: 0,
        taxAmount: -30,
        totalAmount: -230,
        balanceRemaining: 0,
        lineItems: [
          { description: "Fee", amount: -200, unitPrice: -200, netAmount: -200, vatCategory: "S", vatRate: 15, vatAmount: -30 },
        ],
        metadata: { originalInvoiceNumber: "INV-000001" },
      }),
      "en",
    );
    assert.ok(texts.includes("CREDIT NOTE"));
    assert.ok(texts.includes("Credits invoice INV-000001"));
    assert.ok(texts.some((text) => text.includes("230.00 SAR")));
    assert.ok(!texts.includes("Balance due"));
  });
});

describe("a credit note against an invoice", () => {
  test("comes off its balance; settled once nothing is left, never cancelled", () => {
    assert.deepEqual(
      applyCredit({ totalAmount: 1150, amountPaid: 0, creditedAmount: 0, status: "issued" }, 230),
      { creditedAmount: 230, balanceRemaining: 920, refundDue: 0, status: null },
    );
    assert.deepEqual(
      applyCredit({ totalAmount: 1150, amountPaid: 0, creditedAmount: 230, status: "issued" }, 920),
      { creditedAmount: 1150, balanceRemaining: 0, refundDue: 0, status: "paid" },
    );
  });

  test("on an invoice already paid, the excess is a refund due", () => {
    assert.deepEqual(
      applyCredit({ totalAmount: 1150, amountPaid: 1150, creditedAmount: 0, status: "paid" }, 230),
      { creditedAmount: 230, balanceRemaining: 0, refundDue: 230, status: "paid" },
    );
  });

  test("starts from the invoice's lines after their discount, or its JSON lines with its one treatment", () => {
    assert.deepEqual(
      creditableLines({
        category: "management_fee",
        subtotal: 4000,
        discountAmount: 400,
        taxAmount: 135,
        lineItems: [],
        lines: [
          { description: "Fee", category: "management_fee", quantity: 1, unitPrice: 1000, discountAmount: 100, vatCategory: "S", vatRate: 15 },
        ],
      }),
      [{ description: "Fee", category: "management_fee", quantity: 1, unitPrice: 900, vatCategory: "S", vatRate: 15 }],
    );
    assert.deepEqual(
      creditableLines({
        category: "rent",
        subtotal: 3000,
        discountAmount: 0,
        taxAmount: 450,
        lineItems: [{ description: "Rent", type: "rent", amount: 3000 }],
      }),
      [{ description: "Rent", category: "rent", quantity: 1, unitPrice: 3000, vatCategory: "S", vatRate: 15 }],
    );
  });
});

describe("a receipt", () => {
  test("carries the VAT inside the payment when the invoice it paid had some", () => {
    assert.equal(
      receiptVatAmount({ amount: 575, invoice: { taxAmount: 150, totalAmount: 1150 } }),
      75,
    );
    assert.equal(receiptVatAmount({ amount: 575 }), null);
    assert.equal(receiptVatAmount({ amount: 500, vatAmount: 0 }), 0);
    const receipt = normalizePaymentToReceipt(
      { amount: 575, invoice: { taxAmount: 150, totalAmount: 1150 } },
      { name: "Office", address: "", phone: "", email: "", vatNumber: "300000000000003" },
    );
    assert.equal(receipt.vatAmount, 75);
  });
});

describe("what a generator wrote, on paper", () => {
  test("an installment's lines are said in the document's language, with the billing period", async () => {
    const { texts } = await drawn(
      customInvoice({
        documentType: "invoice",
        lineItems: [
          {
            description: "Monthly Rent",
            type: "rent",
            amount: 3000,
            quantity: 1,
            unitPrice: 3000,
            periodStart: "2026-09-01T00:00:00.000Z",
            periodEnd: "2026-09-30T00:00:00.000Z",
          },
          { description: "Electricity", type: "electricity", amount: 200, quantity: 1, unitPrice: 200 },
          { description: "مصروف كتبه المكتب", type: "other", amount: 50, quantity: 1, unitPrice: 50 },
        ],
      }),
      "ar",
    );
    assert.ok(texts.includes("إيجار شهري — سبتمبر 2026"), "the rent line, by month");
    assert.ok(texts.includes("الكهرباء"), "the electricity line");
    assert.ok(texts.includes("مصروف كتبه المكتب"), "a typed line as typed");
    assert.ok(!texts.some((text) => text.includes("Monthly Rent")), "no English wording is left");
  });

  test("an unnamed line reads as the document's own word for an item", async () => {
    const { texts } = await drawn(
      customInvoice({ lineItems: [{ amount: 100, quantity: 1, unitPrice: 100 }] }),
      "ar",
    );
    assert.ok(!texts.includes("Item"));
  });

  test("a receipt's description is said in the receipt's language", () => {
    const company = { name: "Office", address: "", phone: "", email: "" };
    assert.equal(
      normalizePaymentToReceipt(
        { amount: 3000, description: "Monthly rent - September 2026", type: "rent" },
        company,
        "ar",
      ).description,
      "إيجار شهري — سبتمبر 2026",
    );
    assert.equal(
      normalizePaymentToReceipt({ amount: 3000, description: "Paid at the desk" }, company, "ar").description,
      "Paid at the desk",
    );
    assert.equal(
      normalizePaymentToReceipt({ amount: 3000, type: "security_deposit" }, company, "ar").description,
      "مبلغ التأمين",
    );
  });
});
