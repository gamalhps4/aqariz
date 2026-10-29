/**
 * What a stranger reads on the public pages: the price and what it is per, the
 * area, a licence date, the title in the language asked for, and the one
 * place a page picks its language.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  formatArea,
  formatDay,
  formatPeriod,
  formatPrice,
  jsonLd,
  locationLine,
  metaDescription,
  offerLabel,
  pick,
  priceLine,
  titleOf,
  unitTypeName,
} from "@/lib/listings/public-format";
import {
  directionOf,
  otherLang,
  publicText,
  publicTextGroup,
  resolvePublicLang,
} from "@/lib/listings/public-text";

describe("choosing the language", () => {
  test("Arabic unless the link says English", () => {
    assert.equal(resolvePublicLang(undefined), "ar");
    assert.equal(resolvePublicLang(""), "ar");
    assert.equal(resolvePublicLang("ar"), "ar");
    assert.equal(resolvePublicLang("fr"), "ar");
    assert.equal(resolvePublicLang("en"), "en");
    assert.equal(resolvePublicLang("EN"), "en");
    assert.equal(resolvePublicLang(["en", "ar"]), "en");
    assert.equal(resolvePublicLang(["ar", "en"]), "ar");
  });

  test("Arabic reads right to left, English left to right, and each is the other's switch", () => {
    assert.equal(directionOf("ar"), "rtl");
    assert.equal(directionOf("en"), "ltr");
    assert.equal(otherLang("ar"), "en");
    assert.equal(otherLang("en"), "ar");
  });

  test("a line is read in the language asked for, with its values filled in", () => {
    assert.equal(
      publicText("en", "marketing.public.office.pageOf", { page: 2, total: 5 }),
      "Page 2 of 5",
    );
    assert.equal(
      publicText("ar", "marketing.public.office.pageOf", { page: 2, total: 5 }),
      "صفحة 2 من 5",
    );
  });

  test("a key nobody wrote reads as the key, never as nothing", () => {
    assert.equal(publicText("ar", "marketing.public.nope"), "marketing.public.nope");
  });

  test("a group of lines for a client component is keyed by what follows the prefix", () => {
    const group = publicTextGroup("en", "marketing.public.form.");
    assert.equal(group.submit, "Send");
    assert.equal(group["error.phone_invalid"], "Please enter a valid phone number");
  });
});

describe("price and period", () => {
  test("whole riyals are written whole, halalas with two places, always in Western digits", () => {
    assert.equal(formatPrice(5000, "SAR", "en"), "SAR 5,000");
    assert.equal(formatPrice(5000, "SAR", "ar"), "5,000 ر.س");
    assert.equal(formatPrice(1250.5, "SAR", "en"), "SAR 1,250.50");
    assert.equal(formatPrice(1_200_000, "SAR", "ar"), "1,200,000 ر.س");
    assert.equal(formatPrice(900, "USD", "en"), "USD 900");
  });

  test("a rent says what it is per, a sale says nothing", () => {
    assert.equal(formatPeriod("monthly", "en"), "/ month");
    assert.equal(formatPeriod("annual", "ar"), "/ سنويًا");
    assert.equal(formatPeriod("total", "en"), "");
    assert.equal(
      priceLine({ price: 5000, currency: "SAR", pricePeriod: "monthly" }, "en"),
      "SAR 5,000 / month",
    );
    assert.equal(
      priceLine({ price: 1_200_000, currency: "SAR", pricePeriod: "total" }, "en"),
      "SAR 1,200,000",
    );
  });

  test("area and the offer", () => {
    assert.equal(formatArea(120, "en"), "120 m²");
    assert.equal(formatArea(120.5, "ar"), "120.5 م²");
    assert.equal(offerLabel("rent", "ar"), "للإيجار");
    assert.equal(offerLabel("sale", "en"), "For sale");
  });
});

describe("dates", () => {
  test("a licence day reads in the reader's language, on the day it names", () => {
    assert.equal(formatDay("2026-10-03", "en"), "3 October 2026");
    assert.match(formatDay("2026-10-03", "ar"), /3/);
    assert.match(formatDay("2026-10-03", "ar"), /2026/);
    assert.equal(formatDay(null, "en"), "");
    assert.equal(formatDay("not a day", "en"), "");
  });

  test("the first and last days of a year do not slip across a time zone", () => {
    assert.equal(formatDay("2026-01-01", "en"), "1 January 2026");
    assert.equal(formatDay("2026-12-31", "en"), "31 December 2026");
  });
});

describe("words", () => {
  test("text in the language asked for, else the other, else nothing", () => {
    assert.equal(pick("ar", "عنوان", "Title"), "عنوان");
    assert.equal(pick("en", "عنوان", "Title"), "Title");
    assert.equal(pick("en", "عنوان", ""), "عنوان");
    assert.equal(pick("ar", null, "Title"), "Title");
    assert.equal(pick("ar", "  ", null), "");
  });

  test("a listing with no title at all still has a heading", () => {
    assert.equal(titleOf({ titleAr: "", titleEn: "", type: "rent" }, "ar"), "عقار للإيجار");
    assert.equal(titleOf({ titleAr: "", titleEn: "", type: "sale" }, "en"), "Property for sale");
    assert.equal(titleOf({ titleAr: "شقة", titleEn: "Flat", type: "rent" }, "en"), "Flat");
  });

  test("the unit type is the office's own name for it, or ours, or the raw word", () => {
    const facts = (unitType: string, ar: string | null, en: string | null) => ({
      unitType,
      unitTypeLabel: { ar, en },
      bedrooms: 0,
      bathrooms: 0,
      area: 0,
      floor: null,
      availableFrom: null,
      buildingYear: null,
    });
    assert.equal(unitTypeName(facts("apartment", "شقة فاخرة", "Luxury flat"), "ar"), "شقة فاخرة");
    assert.equal(unitTypeName(facts("apartment", null, null), "ar"), "شقة");
    assert.equal(unitTypeName(facts("apartment", null, null), "en"), "Apartment");
    assert.equal(unitTypeName(facts("igloo", null, null), "en"), "igloo");
  });

  test("a place is the district first", () => {
    assert.equal(locationLine({ city: "الرياض", district: "العليا" }), "العليا · الرياض");
    assert.equal(locationLine({ city: "الرياض", district: null }), "الرياض");
    assert.equal(locationLine({ city: null, district: null }), "");
  });

  test("a page description stops at a word and never runs past 160", () => {
    const long = "word ".repeat(80);
    const short = metaDescription(long);
    assert.ok(short.length <= 160);
    assert.ok(short.endsWith("…"));
    assert.equal(metaDescription("  a   short\n text "), "a short text");
  });
});

describe("structured data", () => {
  test("cannot close the script it sits in", () => {
    const text = jsonLd({ name: "</script><script>alert(1)</script>", a: "x & y" });
    assert.ok(!text.includes("<"));
    assert.ok(!text.includes(">"));
    assert.ok(!text.includes("&"));
    assert.equal(JSON.parse(text).name, "</script><script>alert(1)</script>");
  });
});
