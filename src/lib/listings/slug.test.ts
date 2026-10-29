/**
 * A listing's address on the office's public page.
 *
 * Made once, readable when the office wrote an English title, never empty when
 * it did not, unique inside the office, and safe in a URL. The hard cases are
 * the ones this market produces: a title written only in Arabic, a building
 * named in Arabic with a Latin unit number, and two ads for the same flat.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  RESERVED_SLUGS,
  SLUG_PATTERN,
  isValidSlug,
  pickSlug,
  randomizedSlug,
  slugBase,
  slugify,
} from "@/lib/listings/slug";

describe("slugify", () => {
  test("lower-cases, joins words with single dashes and drops punctuation", () => {
    assert.equal(slugify("Modern 2BR Apartment, Al-Olaya!"), "modern-2br-apartment-al-olaya");
    assert.equal(slugify("  --Villa   with   garden--  "), "villa-with-garden");
  });

  test("strips accents and reads Arabic-Indic digits as digits", () => {
    assert.equal(slugify("Café Résidence"), "cafe-residence");
    assert.equal(slugify("Unit ٢١٠"), "unit-210");
  });

  test("Arabic letters contribute nothing", () => {
    assert.equal(slugify("شقة فاخرة في حي العليا"), "");
    assert.equal(slugify("شقة B201 فاخرة"), "b201");
  });

  test("is capped at the slug length without ending on a dash", () => {
    const long = slugify("word ".repeat(40));
    assert.ok(long.length <= 60);
    assert.ok(!long.endsWith("-"));
    assert.match(long, SLUG_PATTERN);
  });
});

describe("slugBase", () => {
  test("uses the English title when there is one", () => {
    assert.equal(
      slugBase({ titleEn: "Luxury Villa in Al Nakheel", type: "rent" }),
      "luxury-villa-in-al-nakheel",
    );
  });

  test("an Arabic-only listing is named by what it is, not by percent-encoded letters", () => {
    assert.equal(
      slugBase({
        titleEn: "",
        propertyName: "شقق الواحة",
        unitNumber: "B201",
        type: "rent",
      }),
      "rent-b201",
    );
  });

  test("a Latin building name is kept", () => {
    assert.equal(
      slugBase({ titleEn: null, propertyName: "Maple Court", unitNumber: "4B", type: "sale" }),
      "sale-maple-court-4b",
    );
  });

  test("a listing for a property not in the system is named by the kind of property", () => {
    assert.equal(slugBase({ titleEn: "", propertyType: "villa", type: "sale" }), "sale-villa");
    // An office's own Arabic type contributes nothing, and the type alone is left.
    assert.equal(slugBase({ titleEn: "", propertyType: "غرفة_سائق", type: "rent" }), "rent");
    assert.equal(
      slugBase({ titleEn: "Sea View Villa", propertyType: "villa", type: "sale" }),
      "sea-view-villa",
    );
  });

  test("never comes out empty or as a reserved word", () => {
    assert.equal(
      slugBase({ titleEn: "", propertyName: "", unitNumber: "", type: "rent" }),
      "rent",
    );
    const base = slugBase({ titleEn: "new", propertyName: null, unitNumber: null, type: "sale" });
    assert.ok(!RESERVED_SLUGS.has(base));
    assert.ok(isValidSlug(base));
  });
});

describe("pickSlug", () => {
  test("the base if it is free", () => {
    assert.equal(pickSlug("rent-b201", new Set()), "rent-b201");
  });

  test("numbers a second ad for the same flat", () => {
    assert.equal(pickSlug("rent-b201", new Set(["rent-b201"])), "rent-b201-2");
    assert.equal(
      pickSlug("rent-b201", new Set(["rent-b201", "rent-b201-2", "rent-b201-3"])),
      "rent-b201-4",
    );
  });

  test("falls back to a random token past ninety-nine, still a valid slug", () => {
    const taken = new Set(["x"]);
    for (let n = 2; n < 100; n += 1) taken.add(`x-${n}`);
    const slug = pickSlug("x", taken);
    assert.match(slug, /^x-[a-z0-9]{5}$/);
  });

  test("the suffix never pushes a long base past the limit", () => {
    const base = "a".repeat(60);
    const slug = pickSlug(base, new Set([base]));
    assert.ok(slug.length <= 60);
    assert.ok(slug.endsWith("-2"));
    assert.match(slug, SLUG_PATTERN);
  });

  test("a retry after a lost race is a different valid slug", () => {
    const retry = randomizedSlug("rent-b201");
    assert.notEqual(retry, "rent-b201");
    assert.ok(isValidSlug(retry));
  });
});

describe("isValidSlug", () => {
  test("accepts lower-case words and digits joined by single dashes", () => {
    assert.equal(isValidSlug("rent-b201"), true);
    assert.equal(isValidSlug("a1b"), true);
  });

  test("refuses the rest", () => {
    for (const bad of [
      "ab",
      "Rent-B201",
      "rent_b201",
      "rent--b201",
      "-rent",
      "rent-",
      "شقة",
      "new",
      "api",
      "x".repeat(61),
      "rent b201",
      "../etc",
    ]) {
      assert.equal(isValidSlug(bad), false, bad);
    }
  });
});
