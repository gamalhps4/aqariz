/**
 * What a credit note may take off an invoice, and what a refund paid back
 * does to it.
 *
 * The bug: only the total was checked, so on an invoice of 1,000 + 150 VAT
 * standard-rated and 500 exempt rent (1,650 in all), a credit note of 1,100
 * + 165 VAT standard-rated (1,265, under the total) went through — VAT
 * credited that was never charged.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { applyCredit, applyRefund, creditExceedsCategory } from "@/lib/invoice/credit-note";

const invoice = [
  { vatCategory: "S", net: 1_000, vat: 150 },
  { vatCategory: "E", net: 500, vat: 0 },
];

describe("a credit note, category by category", () => {
  test("more than a category charged is refused, though under the total", () => {
    const refused = creditExceedsCategory(invoice, [], [{ vatCategory: "S", net: 1_100, vat: 165 }]);
    assert.match(refused ?? "", /standard-rated lines \(1100\.00 \+ VAT 165\.00\).*\(1000\.00 \+ VAT 150\.00\)/);
  });

  test("within each category it goes through", () => {
    assert.equal(
      creditExceedsCategory(invoice, [], [
        { vatCategory: "S", net: 600, vat: 90 },
        { vatCategory: "E", net: 500, vat: 0 },
      ]),
      null,
    );
  });

  test("earlier credit notes (stored negative) count against what is left", () => {
    const earlier = [{ vatCategory: "S", net: -600, vat: -90 }];
    assert.equal(creditExceedsCategory(invoice, earlier, [{ vatCategory: "S", net: 400, vat: 60 }]), null);
    assert.match(
      creditExceedsCategory(invoice, earlier, [{ vatCategory: "S", net: 401, vat: 60.15 }]) ?? "",
      /\(400\.00 \+ VAT 60\.00\)/,
    );
  });

  test("VAT can only come off what was charged with it", () => {
    // The net fits; the VAT on it does not (exempt rent credited as taxed).
    assert.match(
      creditExceedsCategory(invoice, [], [{ vatCategory: "E", net: 500, vat: 75 }]) ?? "",
      /exempt lines/,
    );
    assert.match(
      creditExceedsCategory(invoice, [], [{ vatCategory: "Z", net: 10, vat: 0 }]) ?? "",
      /no zero-rated lines left/,
    );
  });

  test("a halala of rounding either way is not a refusal", () => {
    assert.equal(creditExceedsCategory(invoice, [], [{ vatCategory: "S", net: 1_000, vat: 150.01 }]), null);
  });
});

describe("a refund paid back", () => {
  test("a paid invoice credited leaves a refund due; paying it clears it", () => {
    // 1,150 paid, then a credit note of 230.
    const credited = applyCredit({ totalAmount: 1_150, amountPaid: 1_150, creditedAmount: 0, status: "paid" }, 230);
    assert.deepEqual(credited, { creditedAmount: 230, balanceRemaining: 0, refundDue: 230, status: "paid" });
    const refunded = applyRefund({ amountPaid: 1_150, refundDue: credited.refundDue }, 230);
    assert.deepEqual(refunded, { amountPaid: 920, refundDue: 0 });
    // A second credit note works its refund out from what was really kept.
    const again = applyCredit(
      { totalAmount: 1_150, amountPaid: refunded.amountPaid, creditedAmount: 230, status: "paid" },
      115,
    );
    assert.equal(again.refundDue, 115);
  });

  test("in part, the rest stays due", () => {
    assert.deepEqual(applyRefund({ amountPaid: 1_150, refundDue: 230 }, 100), { amountPaid: 1_050, refundDue: 130 });
  });
});
