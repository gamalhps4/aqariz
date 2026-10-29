/**
 * One name field, two columns — and the round trip has to be lossless.
 *
 * The scope is explicit that a tenant's name is ONE field, because "أحمد بن
 * عبدالله السيد" has no last name to put in a second box. `User` still stores
 * two columns, so the split has to rejoin exactly, or a record prints wrongly
 * on every document it appears on.
 *
 * This is also the function `POST /api/tenants` imported and never called,
 * which is why creating a tenant failed outright with "firstName: Required".
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { splitFullName, normalizeEntityType } from "@/lib/full-name";

/** What the User row rejoins to when something reads the name back. */
const rejoin = (name: string) => {
  const { firstName, lastName } = splitFullName(name);
  return `${firstName} ${lastName}`.trim();
};

describe("splitting", () => {
  test("everything after the first space is the last name", () => {
    assert.deepEqual(splitFullName("Ahmed Al Sayed"), {
      firstName: "Ahmed",
      lastName: "Al Sayed",
    });
  });

  test("a single word leaves the last name empty rather than repeating it", () => {
    assert.deepEqual(splitFullName("Cher"), {
      firstName: "Cher",
      lastName: "",
    });
  });

  test("an Arabic name keeps every part", () => {
    assert.deepEqual(splitFullName("أحمد بن عبدالله السيد"), {
      firstName: "أحمد",
      lastName: "بن عبدالله السيد",
    });
  });
});

describe("round trip", () => {
  for (const name of [
    "Ahmed Al Sayed",
    "أحمد بن عبدالله السيد",
    "طلال القحطاني",
    "Cher",
    "Jean-Pierre de la Fontaine",
    "شركة قنوات العقارية",
  ]) {
    test(`rejoins exactly: ${name}`, () => {
      assert.equal(rejoin(name), name);
    });
  }

  test("collapses runs of whitespace before storing", () => {
    // The rejoin is lossless against the *normalised* name, which is the
    // point: what was typed sloppily is stored tidily and read back tidily.
    assert.equal(rejoin("  Ahmed   Al   Sayed  "), "Ahmed Al Sayed");
  });

  test("an empty name does not produce a stray space", () => {
    assert.equal(rejoin(""), "");
    assert.equal(rejoin("   "), "");
  });
});

describe("entity type", () => {
  test("recognises the two the form offers", () => {
    assert.equal(normalizeEntityType("individual"), "individual");
    assert.equal(normalizeEntityType("company"), "company");
  });

  test("anything else falls back to individual", () => {
    // A tenant recorded with a junk entity type is a person, not a crash.
    assert.equal(normalizeEntityType("partnership"), "individual");
    assert.equal(normalizeEntityType(undefined), "individual");
    assert.equal(normalizeEntityType(null), "individual");
    assert.equal(normalizeEntityType(42), "individual");
  });
});
