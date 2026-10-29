/**
 * The nightly sweep reverses the entries "nothing asks for any more". It
 * selected invoices by due day or `lastPaymentDate`, and recording an owner's
 * receipt back-dated before the cut-over moved `lastPaymentDate` back: the
 * invoice dropped out of the sweep, its posted receipt (`<invoice>:1`) was
 * reversed, and the next write posted it again — every night.
 *
 * What it now reads again before reversing anything is pinned here.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { documentIdOf, documentKindOf, sourcesToReread } from "./document-sources";

describe("re-reading before reversing", () => {
  test("live entries whose documents the date filters missed are read again, by document", () => {
    const live = [
      // The owner's invoice: its first receipt (10 Sep) and its back-dated second (20 Aug).
      { sourceType: "invoice_settlement", sourceId: "inv-owner:1" },
      { sourceType: "invoice_settlement", sourceId: "inv-owner:2" },
      { sourceType: "invoice", sourceId: "inv-owner" },
      // Selected by date this run: nothing to re-read.
      { sourceType: "invoice", sourceId: "inv-due" },
      // A payment received before the cut-over and refunded since.
      { sourceType: "payment_refund", sourceId: "pay-old" },
      { sourceType: "expense", sourceId: "exp-1" },
      // Not a document's entry: never re-read here.
      { sourceType: "manual", sourceId: "jr-1" },
      { sourceType: "payment", sourceId: null },
    ];
    const wanted = new Set(["invoice:inv-due"]);
    const reread = sourcesToReread(live, wanted);
    assert.deepEqual(Object.fromEntries(reread), {
      invoice: ["inv-owner"],
      payment: ["pay-old"],
      expense: ["exp-1"],
    });
  });

  test("nothing is re-read when every live entry was selected", () => {
    const reread = sourcesToReread(
      [{ sourceType: "invoice_settlement", sourceId: "inv-1:1" }],
      new Set(["invoice_settlement:inv-1:1"]),
    );
    assert.equal(reread.size, 0);
  });

  test("a settlement follows its invoice", () => {
    assert.equal(documentKindOf("invoice_settlement"), "invoice");
    assert.equal(documentIdOf("invoice_settlement", "inv-9:12"), "inv-9");
    assert.equal(documentIdOf("payment", "pay:with:colons"), "pay:with:colons");
    assert.equal(documentKindOf("owner_settlement"), null);
  });
});
