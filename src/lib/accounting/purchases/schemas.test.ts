/**
 * What the purchases routes accept: the supplier's payment terms, where a
 * blank field must not turn into "due at once".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { supplierBodySchema, supplierPatchSchema } from "./schemas";

describe("a supplier's payment terms", () => {
  test("a blank field is no terms, not zero days", () => {
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: "" }).paymentTermsDays, null);
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: "   " }).paymentTermsDays, null);
    assert.equal(supplierPatchSchema.parse({ paymentTermsDays: "" }).paymentTermsDays, null);
  });

  test("typed days are read as a number, and zero stays zero", () => {
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: "30" }).paymentTermsDays, 30);
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: 45 }).paymentTermsDays, 45);
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: 0 }).paymentTermsDays, 0);
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: "0" }).paymentTermsDays, 0);
  });

  test("null and absent stay as they are", () => {
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies", paymentTermsDays: null }).paymentTermsDays, null);
    assert.equal(supplierBodySchema.parse({ name: "Gulf Supplies" }).paymentTermsDays, undefined);
    // A patch that does not mention the terms leaves them alone.
    assert.equal("paymentTermsDays" in supplierPatchSchema.parse({ name: "Gulf Supplies" }), false);
  });

  test("whole days from 0 to 365 only", () => {
    for (const bad of [-1, 366, 1.5, "abc"]) {
      assert.equal(supplierBodySchema.safeParse({ name: "Gulf Supplies", paymentTermsDays: bad }).success, false, String(bad));
    }
  });
});
