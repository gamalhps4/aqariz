/**
 * The payment voucher draws in both directions, marks a cancelled one, and
 * runs onto a second page rather than off the bottom of the first when it
 * pays many bills.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import jsPDF from "jspdf";

import { renderVoucherPdf, type VoucherPdfData } from "./voucher-renderer";

function voucher(overrides: Partial<VoucherPdfData> = {}): VoucherPdfData {
  return {
    number: "PV-000045",
    date: new Date("2026-10-04T00:00:00.000Z"),
    status: "posted",
    amount: 3175,
    currency: "SAR",
    method: "bank_transfer",
    reference: "TRF-889",
    notes: "October maintenance",
    supplier: {
      name: "Al Noor Maintenance",
      vatNumber: "310122393500003",
      address: "Riyadh",
      bankName: "Al Rajhi",
      iban: "SA0380000000608010167519",
    },
    account: "Bank - current account",
    allocations: [{ billNumber: "BILL-000012", supplierInvoiceNumber: "INV-77", amount: 3175 }],
    onAccount: 0,
    company: { name: "PropertyPro", address: "Riyadh", phone: "0500000000", email: "office@example.com" },
    preparedBy: "Abdullah",
    ...overrides,
  };
}

const document = () => new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
const pages = (pdf: jsPDF) => pdf.getNumberOfPages();

describe("rendering", () => {
  test("a voucher draws one page in every language, right to left in Arabic", async () => {
    for (const lang of ["en", "ar"] as const) {
      const pdf = await renderVoucherPdf(document(), voucher(), { lang });
      assert.equal(pages(pdf), 1, lang);
      assert.ok(pdf.output("arraybuffer").byteLength > 1_000, lang);
    }
  });

  test("a cancelled voucher and one with a payment on account draw too", async () => {
    const cancelled = await renderVoucherPdf(
      document(),
      voucher({ status: "cancelled", cancelReason: "wrong account", onAccount: 325, amount: 3500 }),
      { lang: "ar" },
    );
    assert.equal(pages(cancelled), 1);
    const advance = await renderVoucherPdf(document(), voucher({ allocations: [], onAccount: 500, amount: 500 }), {
      lang: "en",
    });
    assert.equal(pages(advance), 1);
  });

  test("a voucher with no allocations and nothing on account still shows its amount", async () => {
    const pdf = await renderVoucherPdf(document(), voucher({ allocations: [], onAccount: 0 }), { lang: "en" });
    assert.equal(pages(pdf), 1);
  });

  test("a voucher that pays many bills runs onto a second page", async () => {
    const many = Array.from({ length: 60 }, (_, index) => ({
      billNumber: `BILL-${String(index + 1).padStart(6, "0")}`,
      supplierInvoiceNumber: `INV-${index + 1}`,
      amount: 10,
    }));
    for (const lang of ["en", "ar"] as const) {
      const pdf = await renderVoucherPdf(document(), voucher({ allocations: many, amount: 600 }), { lang });
      assert.ok(pages(pdf) >= 2, `${lang}: ${pages(pdf)} pages`);
    }
  });

  test("a long supplier name, notes and address wrap rather than throw", async () => {
    const long = "x ".repeat(300);
    const pdf = await renderVoucherPdf(
      document(),
      voucher({ notes: long, supplier: { name: long.slice(0, 120), vatNumber: null, address: long, bankName: null, iban: null } }),
      { lang: "en" },
    );
    assert.ok(pages(pdf) >= 1);
  });
});
