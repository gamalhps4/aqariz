/**
 * What a stranger can read.
 *
 * The public read path runs with row-level security bypassed, so the `where`
 * clause is the whole of the isolation. These tests run that clause over rows
 * of two offices and ask which come back: only the published, licensed,
 * still-vacant listings of the office being asked for — never a draft, never
 * an archived ad, never an expired licence, never a let unit, never another
 * office's row — and that the same rule held against a row in hand
 * (`isPubliclyVisible`) says the same thing.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  PUBLIC_LISTING_SELECT,
  isPubliclyVisible,
  publicListingFilter,
  publicListingWhere,
  type VisibilityRow,
} from "@/lib/listings/public-visibility";
import { rowsMatching, matchesWhere } from "@/lib/testing/where-matcher";
import {
  publicTypeSlug,
  toPublicListingView,
  type PublicRow,
} from "@/lib/listings/public-view";
import { dayToDate } from "@/lib/listings/dates";

const TODAY = "2026-10-03";
const LIVE_ORG = { status: "active", deletedAt: null };
const VACANT = { status: "available", deletedAt: null, property: { deletedAt: null } };

interface Fixture extends VisibilityRow {
  id: string;
  type: string;
}

function listing(id: string, overrides: Partial<Fixture> = {}): Fixture {
  return {
    id,
    type: "rent",
    organizationId: "org-a",
    status: "published",
    adLicenceNumber: "7100012345",
    adLicenceExpiry: dayToDate("2027-01-01"),
    organization: { ...LIVE_ORG },
    unitId: `unit-${id}`,
    unit: { ...VACANT, property: { deletedAt: null } },
    ...overrides,
  };
}

const rows: Fixture[] = [
  listing("visible"),
  listing("sale", { type: "sale" }),
  listing("expires-today", { adLicenceExpiry: dayToDate(TODAY) }),
  listing("draft", { status: "draft" }),
  listing("archived", { status: "archived" }),
  listing("expired", { adLicenceExpiry: dayToDate("2026-10-02") }),
  listing("no-expiry", { adLicenceExpiry: null }),
  listing("no-number", { adLicenceNumber: null }),
  listing("blank-number", { adLicenceNumber: "" }),
  listing("unit-let", { unit: { ...VACANT, status: "occupied", property: { deletedAt: null } } }),
  listing("unit-maintenance", { unit: { ...VACANT, status: "maintenance", property: { deletedAt: null } } }),
  listing("unit-deleted", { unit: { ...VACANT, deletedAt: new Date(), property: { deletedAt: null } } }),
  listing("building-deleted", { unit: { ...VACANT, property: { deletedAt: new Date() } } }),
  listing("office-suspended", { organization: { status: "suspended", deletedAt: null } }),
  listing("office-deleted", { organization: { status: "active", deletedAt: new Date() } }),
  listing("other-office", { organizationId: "org-b" }),
];

const idsOf = (list: Fixture[]) => list.map((row) => row.id);

describe("the office page's query", () => {
  test("returns only published, licensed, vacant listings of that office", () => {
    const found = idsOf(rowsMatching(rows, publicListingWhere("org-a", TODAY)));
    assert.deepEqual(found, ["visible", "sale", "expires-today"]);
  });

  test("never lets a draft, an archived ad or another office's row through", () => {
    const found = new Set(idsOf(rowsMatching(rows, publicListingWhere("org-a", TODAY))));
    for (const hidden of ["draft", "archived", "other-office"]) {
      assert.equal(found.has(hidden), false, hidden);
    }
  });

  test("asking for another office returns that office's rows and none of this one's", () => {
    const found = idsOf(rowsMatching(rows, publicListingWhere("org-b", TODAY)));
    assert.deepEqual(found, ["other-office"]);
  });

  test("hides a listing whose licence has run out — and shows it again once renewed", () => {
    const where = publicListingWhere("org-a", TODAY);
    assert.equal(matchesWhere(listing("x", { adLicenceExpiry: dayToDate("2026-10-02") }), where), false);
    assert.equal(matchesWhere(listing("x", { adLicenceExpiry: dayToDate("2026-10-03") }), where), true);
    assert.equal(matchesWhere(listing("x", { adLicenceExpiry: dayToDate("2026-10-04") }), where), true);
  });

  test("the next day an expiring licence is gone", () => {
    const found = idsOf(rowsMatching(rows, publicListingWhere("org-a", "2026-10-04")));
    assert.equal(found.includes("expires-today"), false);
    assert.equal(found.includes("visible"), true);
  });

  test("a listing whose unit is let, in maintenance or deleted is hidden", () => {
    const found = new Set(idsOf(rowsMatching(rows, publicListingWhere("org-a", TODAY))));
    for (const hidden of ["unit-let", "unit-maintenance", "unit-deleted", "building-deleted"]) {
      assert.equal(found.has(hidden), false, hidden);
    }
  });

  test("a suspended or deleted office has no public page", () => {
    const found = new Set(idsOf(rowsMatching(rows, publicListingWhere("org-a", TODAY))));
    assert.equal(found.has("office-suspended"), false);
    assert.equal(found.has("office-deleted"), false);
  });
});

describe("the filter without an office (sitemap, inquiry form)", () => {
  test("applies every rule except which office", () => {
    const found = idsOf(rowsMatching(rows, publicListingFilter(TODAY)));
    assert.deepEqual(found, ["visible", "sale", "expires-today", "other-office"]);
  });

  test("an id on its own is not enough to reach a draft", () => {
    const where = { AND: [{ id: "draft" }, publicListingFilter(TODAY)] };
    assert.equal(rowsMatching(rows, where).length, 0);
    assert.equal(
      rowsMatching(rows, { AND: [{ id: "visible" }, publicListingFilter(TODAY)] }).length,
      1,
    );
  });
});

describe("the same rule against a row in hand", () => {
  test("agrees with the query for every row", () => {
    for (const today of [TODAY, "2026-10-04", "2026-12-31", "2027-01-01", "2027-01-02"]) {
      for (const orgId of ["org-a", "org-b"]) {
        const byQuery = new Set(idsOf(rowsMatching(rows, publicListingWhere(orgId, today))));
        for (const row of rows) {
          assert.equal(
            isPubliclyVisible(row, orgId, today),
            byQuery.has(row.id),
            `${row.id} for ${orgId} on ${today}`,
          );
        }
      }
    }
  });
});

describe("what leaves the building", () => {
  /** Every key named anywhere in a select, however deep. */
  function allKeys(select: Record<string, unknown>, found = new Set<string>()) {
    for (const [key, value] of Object.entries(select)) {
      found.add(key);
      if (value && typeof value === "object") {
        allKeys((value as { select?: Record<string, unknown> }).select ?? (value as Record<string, unknown>), found);
      }
    }
    return found;
  }

  test("the select names no tenant, lease, deposit, internal note or office detail", () => {
    const keys = allKeys(PUBLIC_LISTING_SELECT as unknown as Record<string, unknown>);
    for (const secret of [
      "organizationId",
      "propertyId",
      "unitId",
      "createdById",
      "status",
      "inquiries",
      "notes",
      "securityDeposit",
      "rentAmount",
      "currentTenantId",
      "currentTenant",
      "currentLeaseId",
      "leases",
      "features",
      "attachments",
      "addressStreet",
      "addressZipCode",
      "ownerId",
      "managerId",
      "owner",
      "manager",
      // A listing with no unit: the office's own note of where the property is.
      "addressLine",
    ]) {
      assert.equal(keys.has(secret), false, `${secret} must not be public`);
    }
  });

  const unit: NonNullable<PublicRow["unit"]> = {
    unitType: "apartment",
    bedrooms: 2,
    bathrooms: 1,
    squareFootage: 120,
    floor: 2,
    availableFrom: null,
    images: ["https://picsum.photos/seed/u1/800/600", "https://evil.example/x.png"],
    property: { type: "building", images: ["https://picsum.photos/seed/p1/800/600"], yearBuilt: 2019 },
  };

  const row: PublicRow = {
    id: "l1",
    slug: "rent-b201",
    type: "rent",
    titleAr: "شقة",
    titleEn: "",
    descriptionAr: null,
    descriptionEn: null,
    price: 5000,
    currency: "SAR",
    pricePeriod: "monthly",
    photos: [],
    amenities: ["مصعد"],
    city: "الرياض",
    district: "العليا",
    contactPhone: "+966501234567",
    whatsappNumber: null,
    adLicenceNumber: "7100012345",
    adLicenceExpiry: dayToDate("2027-01-01"),
    publishedAt: new Date("2026-10-01T09:00:00.000Z"),
    updatedAt: new Date("2026-10-02T09:00:00.000Z"),
    propertyType: null,
    areaSqm: null,
    bedrooms: null,
    bathrooms: null,
    floor: null,
    unit,
  };

  test("the view carries only public facts, and only pictures the page can draw", () => {
    const view = toPublicListingView(row);
    assert.deepEqual(view.photos, ["https://picsum.photos/seed/u1/800/600"]);
    assert.equal(view.licenceNumber, "7100012345");
    assert.equal(view.licenceExpiry, "2027-01-01");
    assert.equal(view.facts.area, 120);
    assert.deepEqual(
      Object.keys(view).sort(),
      [
        "amenities", "city", "currency", "descriptionAr", "descriptionEn", "district",
        "facts", "id", "licenceExpiry", "licenceNumber", "photos", "phone", "price",
        "pricePeriod", "publishedAt", "slug", "titleAr", "titleEn", "type", "updatedAt",
        "whatsapp",
      ].sort(),
    );
  });

  test("a listing's own photos win over the unit's and the building's", () => {
    const view = toPublicListingView({ ...row, photos: ["/uploads/mine.jpg"] });
    assert.deepEqual(view.photos, ["/uploads/mine.jpg"]);
  });

  test("with no unit photos the building's are used", () => {
    const view = toPublicListingView({
      ...row,
      unit: { ...unit, images: [] },
    });
    assert.deepEqual(view.photos, ["https://picsum.photos/seed/p1/800/600"]);
  });
});

describe("a listing for a property not in the system", () => {
  // No unit, so nothing can be let or deleted under it: the licence decides.
  const standalone = (id: string, overrides: Partial<Fixture> = {}) =>
    listing(id, { unitId: null, unit: null, ...overrides });

  const mixed: Fixture[] = [
    listing("unit-visible"),
    listing("unit-let", { unit: { ...VACANT, status: "occupied", property: { deletedAt: null } } }),
    standalone("standalone"),
    standalone("standalone-sale", { type: "sale" }),
    standalone("standalone-draft", { status: "draft" }),
    standalone("standalone-archived", { status: "archived" }),
    standalone("standalone-expired", { adLicenceExpiry: dayToDate("2026-10-02") }),
    standalone("standalone-no-number", { adLicenceNumber: null }),
    standalone("standalone-other-office", { organizationId: "org-b" }),
    standalone("standalone-office-suspended", {
      organization: { status: "suspended", deletedAt: null },
    }),
  ];

  test("is public when published with a current licence, whatever its lack of a unit", () => {
    const found = idsOf(rowsMatching(mixed, publicListingWhere("org-a", TODAY)));
    assert.deepEqual(found, ["unit-visible", "standalone", "standalone-sale"]);
  });

  test("is still held to the office, status and licence rules", () => {
    const found = new Set(idsOf(rowsMatching(mixed, publicListingFilter(TODAY))));
    for (const hidden of [
      "standalone-draft",
      "standalone-archived",
      "standalone-expired",
      "standalone-no-number",
      "standalone-office-suspended",
    ]) {
      assert.equal(found.has(hidden), false, hidden);
    }
    assert.equal(found.has("standalone-other-office"), true);
  });

  test("the rule in hand agrees with the query", () => {
    for (const today of [TODAY, "2026-10-04", "2027-01-02"]) {
      const byQuery = new Set(idsOf(rowsMatching(mixed, publicListingWhere("org-a", today))));
      for (const row of mixed) {
        assert.equal(isPubliclyVisible(row, "org-a", today), byQuery.has(row.id), `${row.id} on ${today}`);
      }
    }
  });

  const own: PublicRow = {
    id: "l2",
    slug: "sale-villa",
    type: "sale",
    titleAr: "فيلا للبيع",
    titleEn: "",
    descriptionAr: null,
    descriptionEn: null,
    price: 2500000,
    currency: "SAR",
    pricePeriod: "total",
    photos: [],
    amenities: [],
    city: "جدة",
    district: "الشاطئ",
    contactPhone: null,
    whatsappNumber: null,
    adLicenceNumber: "7100099999",
    adLicenceExpiry: dayToDate("2027-01-01"),
    publishedAt: null,
    updatedAt: new Date("2026-10-02T09:00:00.000Z"),
    propertyType: "villa",
    areaSqm: 450.5,
    bedrooms: 5,
    bathrooms: null,
    floor: null,
    unit: null,
  };

  test("the view reads the facts from the listing itself", () => {
    const view = toPublicListingView(own, {
      typeLabels: new Map([["villa", { ar: "فيلا", en: "Villa" }]]),
    });
    assert.deepEqual(view.facts, {
      unitType: "villa",
      unitTypeLabel: { ar: "فيلا", en: "Villa" },
      bedrooms: 5,
      bathrooms: 0,
      area: 450.5,
      floor: null,
      availableFrom: null,
      buildingYear: null,
    });
    assert.equal(publicTypeSlug(own), "villa");
  });

  test("has only its own photos, and only those the page can draw", () => {
    assert.deepEqual(toPublicListingView(own).photos, []);
    const view = toPublicListingView({
      ...own,
      photos: ["https://picsum.photos/seed/v/800/600", "https://evil.example/x.png"],
    });
    assert.deepEqual(view.photos, ["https://picsum.photos/seed/v/800/600"]);
  });
});
