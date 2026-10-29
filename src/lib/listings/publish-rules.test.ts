/**
 * What a listing needs before it can go public — chiefly the REGA advertising
 * licence: required, with its expiry, and not run out. The expiry day itself is
 * still a good day; the day after is not.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  publishProblems,
  canPublish,
  type PublishCandidate,
} from "@/lib/listings/publish-rules";
import {
  isPlausibleLicenceNumber,
  licenceIsCurrent,
  licenceStatus,
  normalizeLicenceNumber,
} from "@/lib/listings/licence";
import { daysBetween, dayOf, dayToDate, parseDay, riyadhDay } from "@/lib/listings/dates";

const TODAY = "2026-10-03";

const ready: PublishCandidate = {
  titleAr: "شقة للإيجار في حي العليا",
  titleEn: "",
  price: 5000,
  type: "rent",
  pricePeriod: "monthly",
  adLicenceNumber: "7100012345",
  adLicenceExpiry: "2027-01-15",
  unitStatus: "available",
};

describe("a listing for a property not in the system", () => {
  const standalone: PublishCandidate = {
    ...ready,
    unitStatus: null,
    standalone: true,
    propertyType: "villa",
    city: "الرياض",
    areaSqm: 450,
  };

  test("may be published with no unit, given its type, city and area", () => {
    assert.deepEqual(publishProblems(standalone, TODAY), []);
  });

  test("needs what an advertisement says about the property", () => {
    assert.deepEqual(
      publishProblems({ ...standalone, propertyType: " ", city: null, areaSqm: 0 }, TODAY),
      ["property_type_missing", "city_missing", "area_missing"],
    );
    assert.deepEqual(
      publishProblems({ ...standalone, areaSqm: null }, TODAY),
      ["area_missing"],
    );
  });

  test("is held to the same title, price and licence as any listing", () => {
    assert.deepEqual(
      publishProblems(
        { ...standalone, titleAr: "", price: 0, adLicenceNumber: null, adLicenceExpiry: "2026-10-02" },
        TODAY,
      ),
      ["title_missing", "price_missing", "licence_missing", "licence_expired"],
    );
  });

  test("is never refused for a unit it does not have", () => {
    assert.equal(
      publishProblems({ ...standalone, unitStatus: "occupied", unitDeleted: true }, TODAY)
        .includes("unit_unavailable"),
      false,
    );
  });

  test("a listing made from a unit is not asked for the details", () => {
    assert.deepEqual(publishProblems({ ...ready, city: null, areaSqm: null }, TODAY), []);
  });
});

describe("the advertising licence", () => {
  test("a complete, current listing may be published", () => {
    assert.deepEqual(publishProblems(ready, TODAY), []);
    assert.equal(canPublish(ready, TODAY), true);
  });

  test("is refused without a licence number", () => {
    for (const missing of [null, undefined, "", "   "]) {
      assert.deepEqual(
        publishProblems({ ...ready, adLicenceNumber: missing }, TODAY),
        ["licence_missing"],
        String(missing),
      );
    }
  });

  test("is refused without an expiry day", () => {
    assert.deepEqual(
      publishProblems({ ...ready, adLicenceExpiry: null }, TODAY),
      ["licence_expiry_missing"],
    );
  });

  test("is refused when the licence has expired", () => {
    assert.deepEqual(
      publishProblems({ ...ready, adLicenceExpiry: "2026-10-02" }, TODAY),
      ["licence_expired"],
    );
    assert.deepEqual(
      publishProblems({ ...ready, adLicenceExpiry: "2025-01-01" }, TODAY),
      ["licence_expired"],
    );
  });

  test("the expiry day itself is still valid", () => {
    assert.deepEqual(
      publishProblems({ ...ready, adLicenceExpiry: TODAY }, TODAY),
      [],
    );
    assert.deepEqual(
      publishProblems({ ...ready, adLicenceExpiry: "2026-10-04" }, TODAY),
      [],
    );
  });

  test("a listing with neither is told about both, and an expired one with no number too", () => {
    assert.deepEqual(
      publishProblems(
        { ...ready, adLicenceNumber: null, adLicenceExpiry: null },
        TODAY,
      ),
      ["licence_missing", "licence_expiry_missing"],
    );
    assert.deepEqual(
      publishProblems(
        { ...ready, adLicenceNumber: "", adLicenceExpiry: "2020-01-01" },
        TODAY,
      ),
      ["licence_missing", "licence_expired"],
    );
  });
});

describe("the rest of what publishing asks", () => {
  test("a title in either language is enough, none is not", () => {
    assert.deepEqual(publishProblems({ ...ready, titleAr: "", titleEn: "Flat" }, TODAY), []);
    assert.deepEqual(
      publishProblems({ ...ready, titleAr: "  ", titleEn: "" }, TODAY),
      ["title_missing"],
    );
  });

  test("the price must be above zero", () => {
    for (const price of [0, -5, "abc", null, undefined, Number.NaN]) {
      assert.deepEqual(
        publishProblems({ ...ready, price }, TODAY),
        ["price_missing"],
        String(price),
      );
    }
    assert.deepEqual(publishProblems({ ...ready, price: "5000.50" }, TODAY), []);
  });

  test("a sale is priced total and a rent is not", () => {
    assert.deepEqual(
      publishProblems({ ...ready, type: "sale", pricePeriod: "monthly" }, TODAY),
      ["period_mismatch"],
    );
    assert.deepEqual(
      publishProblems({ ...ready, type: "sale", pricePeriod: "total" }, TODAY),
      [],
    );
    assert.deepEqual(
      publishProblems({ ...ready, type: "rent", pricePeriod: "total" }, TODAY),
      ["period_mismatch"],
    );
  });

  test("the unit must still be vacant", () => {
    assert.deepEqual(
      publishProblems({ ...ready, unitStatus: "occupied" }, TODAY),
      ["unit_unavailable"],
    );
    assert.deepEqual(
      publishProblems({ ...ready, unitStatus: "available", unitDeleted: true }, TODAY),
      ["unit_unavailable"],
    );
    assert.deepEqual(
      publishProblems({ ...ready, unitStatus: undefined }, TODAY),
      ["unit_unavailable"],
    );
  });

  test("every problem is listed at once, in a stable order", () => {
    assert.deepEqual(
      publishProblems(
        {
          titleAr: "",
          titleEn: "",
          price: 0,
          type: "rent",
          pricePeriod: "monthly",
          adLicenceNumber: null,
          adLicenceExpiry: null,
          unitStatus: "occupied",
        },
        TODAY,
      ),
      [
        "title_missing",
        "price_missing",
        "licence_missing",
        "licence_expiry_missing",
        "unit_unavailable",
      ],
    );
  });
});

describe("licence status", () => {
  test("missing, expired, expiring soon and valid", () => {
    assert.equal(licenceStatus(null, "2027-01-01", TODAY).state, "missing");
    assert.equal(licenceStatus("7100012345", null, TODAY).state, "missing");
    assert.equal(licenceStatus("7100012345", "2026-10-02", TODAY).state, "expired");
    assert.equal(licenceStatus("7100012345", TODAY, TODAY).state, "expiring");
    assert.equal(licenceStatus("7100012345", "2026-10-17", TODAY).state, "expiring");
    assert.equal(licenceStatus("7100012345", "2026-10-18", TODAY).state, "valid");
    assert.equal(licenceStatus("7100012345", "2026-10-02", TODAY).daysLeft, -1);
    assert.equal(licenceStatus("7100012345", "2026-10-18", TODAY).daysLeft, 15);
  });

  test("an expiring licence is still current, an expired or missing one is not", () => {
    assert.equal(licenceIsCurrent("7100012345", TODAY, TODAY), true);
    assert.equal(licenceIsCurrent("7100012345", "2026-10-02", TODAY), false);
    assert.equal(licenceIsCurrent("", "2027-01-01", TODAY), false);
  });

  test("a licence number is read in Western digits and checked loosely", () => {
    assert.equal(normalizeLicenceNumber(" ٧١٠٠٠١٢٣٤٥  "), "7100012345");
    assert.equal(normalizeLicenceNumber("   "), null);
    assert.equal(normalizeLicenceNumber(42), null);
    assert.equal(isPlausibleLicenceNumber("7100012345"), true);
    assert.equal(isPlausibleLicenceNumber("AD-2026/123"), true);
    assert.equal(isPlausibleLicenceNumber("12"), false);
    assert.equal(isPlausibleLicenceNumber("<script>"), false);
    assert.equal(isPlausibleLicenceNumber("1".repeat(41)), false);
  });
});

describe("days", () => {
  test("Riyadh's day is the one on Riyadh's clock, not UTC's", () => {
    // 22:30 UTC on the 3rd is 01:30 on the 4th in Riyadh (UTC+3).
    assert.equal(riyadhDay(new Date("2026-10-03T22:30:00.000Z")), "2026-10-04");
    assert.equal(riyadhDay(new Date("2026-10-03T20:59:00.000Z")), "2026-10-03");
  });

  test("a day is a real calendar day", () => {
    assert.equal(parseDay("2026-02-28"), "2026-02-28");
    assert.equal(parseDay("2026-02-30"), null);
    assert.equal(parseDay("2026-13-01"), null);
    assert.equal(parseDay("not a date"), null);
    assert.equal(parseDay(20261003), null);
  });

  test("a day round-trips through the DATE column's midnight-UTC value", () => {
    assert.equal(dayOf(dayToDate("2026-10-03")), "2026-10-03");
    assert.equal(dayOf("2026-10-03T00:00:00.000Z"), "2026-10-03");
    assert.equal(dayOf(null), null);
    assert.equal(daysBetween("2026-10-03", "2026-10-04"), 1);
    assert.equal(daysBetween("2026-10-03", "2026-09-30"), -3);
    assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  });
});
