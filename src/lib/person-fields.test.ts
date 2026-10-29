/**
 * A tenant's or an owner's name and email, as every route reads them.
 *
 * Two refusals this replaces: a one-word name came back from the tenant
 * routes as "lastName: Last name is required", in English whatever the screen
 * spoke; and an email was required by the Edit Tenant page and the import, so
 * a tenant recorded without one — most of this office's — could be neither
 * edited nor imported.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { readOptionalEmail, readPersonName } from "@/lib/person-fields";

describe("a name", () => {
  test("of one word is a name, with the second column empty", () => {
    assert.deepEqual(readPersonName({ fullName: "Mohammed" }), {
      ok: true,
      value: { firstName: "Mohammed", lastName: "" },
    });
  });

  test("of one Arabic word is a name too", () => {
    assert.deepEqual(readPersonName({ fullName: "  عبدالله  " }), {
      ok: true,
      value: { firstName: "عبدالله", lastName: "" },
    });
  });

  test("of several words keeps every part, split at the first space", () => {
    assert.deepEqual(readPersonName({ fullName: "أحمد  بن عبدالله السيد" }), {
      ok: true,
      value: { firstName: "أحمد", lastName: "بن عبدالله السيد" },
    });
  });

  test("given as two fields keeps them as typed", () => {
    // Re-splitting the joined name would turn "Al Saud" into a middle name.
    assert.deepEqual(
      readPersonName({ firstName: "Abdullah Aziz", lastName: "Al Saud" }),
      { ok: true, value: { firstName: "Abdullah Aziz", lastName: "Al Saud" } },
    );
  });

  test("given as a first name alone is a one-word name", () => {
    assert.deepEqual(readPersonName({ firstName: "Noura", lastName: "" }), {
      ok: true,
      value: { firstName: "Noura", lastName: "" },
    });
  });

  test("the one field wins over the two", () => {
    assert.deepEqual(
      readPersonName({ fullName: "Sara Ali", firstName: "x", lastName: "y" }),
      { ok: true, value: { firstName: "Sara", lastName: "Ali" } },
    );
  });

  test("that is blank is refused with a code, not a sentence", () => {
    for (const input of [{}, { fullName: "   " }, { firstName: "", lastName: " " }, { fullName: 42 }]) {
      assert.deepEqual(readPersonName(input), { ok: false, error: "NAME_REQUIRED" });
    }
  });
});

describe("an email", () => {
  test("left out is none, stored as null", () => {
    for (const blank of [undefined, null, "", "   "]) {
      assert.deepEqual(readOptionalEmail(blank), { ok: true, value: null });
    }
  });

  test("that is an address is trimmed and lowercased, as sign-in compares it", () => {
    assert.deepEqual(readOptionalEmail("  Owner@Example.SA "), {
      ok: true,
      value: "owner@example.sa",
    });
  });

  test("that is there and malformed is refused with a code", () => {
    for (const bad of ["owner", "owner@", "@example.sa", "a b@example.sa", 7]) {
      assert.deepEqual(readOptionalEmail(bad), { ok: false, error: "EMAIL_INVALID" });
    }
  });
});
