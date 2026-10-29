/**
 * A mobile number typed the way it is dialled at home finds the tenant whose
 * number is stored with the country code.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { phoneSearchVariants } from "@/lib/payments/phone-search";

describe("the forms a typed mobile number is searched in", () => {
  test("dialled at home: without the leading 0, which the stored +966 replaces", () => {
    assert.deepEqual(phoneSearchVariants("0501234567"), ["501234567"]);
    assert.ok("+966501234567".includes(phoneSearchVariants("0501234567")[0]));
  });

  test("typed with spaces, dashes or brackets: the digits alone too", () => {
    assert.deepEqual(phoneSearchVariants("050 123 4567"), ["0501234567", "501234567"]);
    assert.deepEqual(phoneSearchVariants("+966 50-123-4567"), ["+966501234567"]);
    assert.deepEqual(phoneSearchVariants("(050) 1234567"), ["0501234567", "501234567"]);
  });

  test("dialled internationally with 00: without it", () => {
    assert.deepEqual(phoneSearchVariants("00966501234567"), ["966501234567"]);
  });

  test("already in the stored form, or not a phone number at all: nothing more", () => {
    assert.deepEqual(phoneSearchVariants("+966501234567"), []);
    assert.deepEqual(phoneSearchVariants("Ahmed"), []);
    assert.deepEqual(phoneSearchVariants("A102"), []);
    assert.deepEqual(phoneSearchVariants("1234"), []);
  });
});
