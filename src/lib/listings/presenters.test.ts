/**
 * The staff list's badges: a published listing that is not actually on the
 * public page — its unit has been let, or its licence ran out — has to say so.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { toListingDto, type ListingRowSource } from "@/lib/listings/presenters";
import { dayToDate } from "@/lib/listings/dates";

const TODAY = "2026-10-03";

function row(
  overrides: Partial<ListingRowSource> = {},
  unit: Partial<NonNullable<ListingRowSource["unit"]>> = {},
): ListingRowSource {
  return {
    id: "l1",
    slug: "rent-b201",
    type: "rent",
    titleAr: "شقة",
    titleEn: "",
    descriptionAr: null,
    descriptionEn: null,
    price: "5000.00",
    currency: "SAR",
    pricePeriod: "monthly",
    photos: [],
    amenities: [],
    city: "الرياض",
    district: "العليا",
    contactPhone: null,
    whatsappNumber: null,
    adLicenceNumber: "7100012345",
    adLicenceExpiry: dayToDate("2027-01-01"),
    status: "published",
    publishedAt: new Date("2026-10-01T09:00:00.000Z"),
    createdAt: new Date("2026-09-30T09:00:00.000Z"),
    updatedAt: new Date("2026-10-01T09:00:00.000Z"),
    propertyType: null,
    addressLine: null,
    areaSqm: null,
    bedrooms: null,
    bathrooms: null,
    floor: null,
    unit: {
      id: "u1",
      unitNumber: "B201",
      unitType: "apartment",
      status: "available",
      bedrooms: 2,
      bathrooms: 1,
      squareFootage: 100,
      floor: 2,
      rentAmount: 5000,
      images: ["/u.jpg"],
      deletedAt: null,
      ...unit,
    },
    property: {
      id: "p1",
      name: "شقق الواحة",
      addressCity: "الرياض",
      addressDistrict: "العليا",
      images: ["/p.jpg"],
    },
    ...overrides,
  };
}

const dto = (source: ListingRowSource) =>
  toListingDto(source, { today: TODAY, organizationSlug: "demo-office" });

describe("hidden reasons", () => {
  test("a published listing that is showing has none", () => {
    assert.deepEqual(dto(row()).hiddenReasons, []);
  });

  test("a published listing whose unit has been let says so", () => {
    assert.deepEqual(dto(row({}, { status: "occupied" })).hiddenReasons, ["unit_unavailable"]);
    assert.equal(dto(row({}, { status: "occupied" })).unit?.available, false);
    assert.deepEqual(dto(row({}, { deletedAt: new Date() })).hiddenReasons, ["unit_unavailable"]);
  });

  test("a published listing whose licence has run out says so", () => {
    assert.deepEqual(
      dto(row({ adLicenceExpiry: dayToDate("2026-10-02") })).hiddenReasons,
      ["licence"],
    );
    assert.deepEqual(dto(row({ adLicenceExpiry: null })).hiddenReasons, ["licence"]);
  });

  test("both can hold at once", () => {
    assert.deepEqual(
      dto(row({ adLicenceExpiry: dayToDate("2026-01-01") }, { status: "occupied" })).hiddenReasons,
      ["licence", "unit_unavailable"],
    );
  });

  test("a licence expiring today is still showing", () => {
    const view = dto(row({ adLicenceExpiry: dayToDate(TODAY) }));
    assert.deepEqual(view.hiddenReasons, []);
    assert.equal(view.licence.state, "expiring");
  });

  test("a draft or archived listing has nothing to explain", () => {
    assert.deepEqual(dto(row({ status: "draft" }, { status: "occupied" })).hiddenReasons, []);
    assert.deepEqual(dto(row({ status: "archived", adLicenceNumber: null })).hiddenReasons, []);
  });
});

describe("the row", () => {
  test("money becomes a number, the expiry a plain day, dates ISO strings", () => {
    const view = dto(row());
    assert.equal(view.price, 5000);
    assert.equal(view.adLicenceExpiry, "2027-01-01");
    assert.equal(view.publishedAt, "2026-10-01T09:00:00.000Z");
    assert.equal(view.publicPath, "/o/demo-office/rent-b201");
  });

  test("shows the photos the page would show", () => {
    assert.deepEqual(dto(row()).effectivePhotos, ["/u.jpg"]);
    assert.deepEqual(dto(row({ photos: ["/own.jpg"] })).effectivePhotos, ["/own.jpg"]);
    assert.deepEqual(dto(row({}, { images: [] })).effectivePhotos, ["/p.jpg"]);
  });

  test("an unknown stored value falls back to a safe default instead of leaking through", () => {
    const view = dto(row({ type: "weird", status: "odd", pricePeriod: "fortnightly" }));
    assert.equal(view.type, "rent");
    assert.equal(view.status, "draft");
    assert.equal(view.pricePeriod, "monthly");
  });
});

describe("a listing for a property not in the system", () => {
  const standalone = () =>
    row({
      unit: null,
      property: null,
      photos: [],
      propertyType: "villa",
      addressLine: "شارع التخصصي، فيلا 12",
      areaSqm: 450,
      bedrooms: 5,
      bathrooms: 4,
      floor: null,
    });

  test("says so, and carries its own details with no unit or building", () => {
    const view = dto(standalone());
    assert.equal(view.standalone, true);
    assert.equal(view.unit, null);
    assert.equal(view.property, null);
    assert.equal(view.propertyType, "villa");
    assert.equal(view.addressLine, "شارع التخصصي، فيلا 12");
    assert.equal(view.areaSqm, 450);
    assert.equal(view.bedrooms, 5);
    assert.equal(view.bathrooms, 4);
    assert.equal(view.floor, null);
  });

  test("has nothing a unit being let could hide — only its licence", () => {
    assert.deepEqual(dto(standalone()).hiddenReasons, []);
    assert.deepEqual(
      dto({ ...standalone(), adLicenceExpiry: dayToDate("2026-10-02") }).hiddenReasons,
      ["licence"],
    );
  });

  test("shows its own photos, and none when it has none", () => {
    assert.deepEqual(dto(standalone()).effectivePhotos, []);
    assert.deepEqual(
      dto({ ...standalone(), photos: ["/own.jpg"] }).effectivePhotos,
      ["/own.jpg"],
    );
  });

  test("a listing made from a unit is not standalone and has no details of its own", () => {
    const view = dto(row());
    assert.equal(view.standalone, false);
    assert.equal(view.propertyType, null);
    assert.equal(view.unit?.unitNumber, "B201");
  });
});
