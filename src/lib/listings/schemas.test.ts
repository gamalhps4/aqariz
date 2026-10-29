/**
 * Listing input: what the form and the API accept, field by field.
 *
 * The one distinction every update rides on: a field left out is "not given"
 * and a field sent as null or "" is "clear it" — so saving a title cannot wipe
 * the licence, and clearing the licence is possible.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  inquiryUpdateSchema,
  listingActionSchema,
  listingCreateSchema,
  listingUpdateSchema,
} from "@/lib/listings/schemas";
import {
  falLicenceIsShowable,
  mergeOfficeSettings,
  officeSettingsSchema,
  readOfficeSettings,
  withOfficeSettings,
  EMPTY_OFFICE_SETTINGS,
} from "@/lib/listings/settings";

describe("creating a listing", () => {
  test("needs a unit and nothing else", () => {
    const parsed = listingCreateSchema.safeParse({ unitId: "unit_1" });
    assert.equal(parsed.success, true);
    assert.equal(listingCreateSchema.safeParse({}).success, false);
    assert.equal(listingCreateSchema.safeParse({ unitId: "  " }).success, false);
  });

  test("cleans every field the form sends", () => {
    const parsed = listingCreateSchema.parse({
      unitId: "unit_1",
      type: "sale",
      pricePeriod: "total",
      titleAr: "  شقة للبيع  ",
      titleEn: "",
      descriptionAr: "   ",
      price: "1250000.5",
      photos: [" https://x.r2.dev/a.jpg ", "https://x.r2.dev/a.jpg", ""],
      amenities: [" مصعد ", "مصعد", "", "موقف"],
      city: " الرياض ",
      district: "",
      contactPhone: "050 123 4567",
      whatsappNumber: "٠٥٠١٢٣٤٥٦٧",
      adLicenceNumber: " ٧١٠٠٠١٢٣٤٥ ",
      adLicenceExpiry: "2027-01-15",
    });
    assert.equal(parsed.titleAr, "شقة للبيع");
    assert.equal(parsed.titleEn, "");
    assert.equal(parsed.descriptionAr, null);
    assert.equal(parsed.price, 1250000.5);
    assert.deepEqual(parsed.photos, ["https://x.r2.dev/a.jpg"]);
    assert.deepEqual(parsed.amenities, ["مصعد", "موقف"]);
    assert.equal(parsed.city, "الرياض");
    assert.equal(parsed.district, null);
    assert.equal(parsed.contactPhone, "+966501234567");
    assert.equal(parsed.whatsappNumber, "+966501234567");
    assert.equal(parsed.adLicenceNumber, "7100012345");
    assert.equal(parsed.adLicenceExpiry, "2027-01-15");
  });

  test("refuses what cannot be right", () => {
    const bad = (field: Record<string, unknown>) =>
      listingCreateSchema.safeParse({ unitId: "u", ...field }).success;
    assert.equal(bad({ type: "lease" }), false);
    assert.equal(bad({ pricePeriod: "weekly" }), false);
    assert.equal(bad({ price: -1 }), false);
    assert.equal(bad({ price: 1e12 }), false);
    assert.equal(bad({ price: "abc" }), false);
    assert.equal(bad({ contactPhone: "12345" }), false);
    assert.equal(bad({ adLicenceNumber: "<b>" }), false);
    assert.equal(bad({ adLicenceExpiry: "2026-02-30" }), false);
    assert.equal(bad({ photos: ["javascript:alert(1)"] }), false);
    assert.equal(bad({ photos: Array.from({ length: 31 }, (_, i) => `/p${i}.jpg`) }), false);
    assert.equal(bad({ amenities: ["x".repeat(81)] }), false);
    assert.equal(bad({ titleAr: "x".repeat(161) }), false);
    assert.equal(bad({ descriptionAr: "x".repeat(5001) }), false);
    assert.equal(bad({ slug: "Not A Slug" }), false);
    assert.equal(bad({ slug: "good-slug" }), true);
  });
});

describe("creating a listing for a property not in the system", () => {
  const standalone = (fields: Record<string, unknown> = {}) =>
    listingCreateSchema.safeParse({
      standalone: true,
      propertyType: "villa",
      city: "الرياض",
      ...fields,
    });

  test("needs no unit, only the property type and the city", () => {
    assert.equal(standalone().success, true);
    assert.equal(standalone({ unitId: null }).success, true);
  });

  test("is refused without its type or its city, and says which", () => {
    const paths = (result: ReturnType<typeof standalone>) =>
      result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
    assert.deepEqual(paths(standalone({ propertyType: "" })), ["propertyType"]);
    assert.deepEqual(paths(standalone({ city: "  " })), ["city"]);
    assert.deepEqual(
      paths(standalone({ propertyType: null, city: null })).sort(),
      ["city", "propertyType"],
    );
  });

  test("cannot also name a unit", () => {
    assert.equal(standalone({ unitId: "unit_1" }).success, false);
  });

  test("cleans its details: numbers from text, blank is none", () => {
    const parsed = listingCreateSchema.parse({
      standalone: true,
      propertyType: " apartment ",
      city: " جدة ",
      addressLine: "  شارع الأمير سلطان، عمارة 4  ",
      areaSqm: "135.5",
      bedrooms: "3",
      bathrooms: 2,
      floor: "",
    });
    assert.equal(parsed.standalone, true);
    assert.equal(parsed.unitId, undefined);
    assert.equal(parsed.propertyType, "apartment");
    assert.equal(parsed.city, "جدة");
    assert.equal(parsed.addressLine, "شارع الأمير سلطان، عمارة 4");
    assert.equal(parsed.areaSqm, 135.5);
    assert.equal(parsed.bedrooms, 3);
    assert.equal(parsed.bathrooms, 2);
    assert.equal(parsed.floor, null);
  });

  test("refuses details out of range", () => {
    for (const field of [
      { areaSqm: -1 },
      { areaSqm: 2_000_000 },
      { areaSqm: "big" },
      { bedrooms: 2.5 },
      { bedrooms: 101 },
      { bathrooms: -1 },
      { floor: 301 },
      { floor: -11 },
      { addressLine: "x".repeat(201) },
      { propertyType: "x".repeat(61) },
    ]) {
      assert.equal(standalone(field).success, false, JSON.stringify(field));
    }
    assert.equal(standalone({ floor: -1, bedrooms: 0 }).success, true);
  });

  test("a listing made from a unit cannot carry them: it reads them from the unit", () => {
    for (const field of [
      { propertyType: "villa" },
      { addressLine: "x" },
      { areaSqm: 100 },
      { bedrooms: 2 },
      { bathrooms: 1 },
      { floor: 3 },
    ]) {
      assert.equal(
        listingCreateSchema.safeParse({ unitId: "unit_1", ...field }).success,
        false,
        JSON.stringify(field),
      );
    }
    // Sent empty, they say nothing and do no harm.
    assert.equal(
      listingCreateSchema.safeParse({ unitId: "unit_1", areaSqm: null, addressLine: "" }).success,
      true,
    );
  });

  test("standalone: false is a listing made from a unit, and needs the unit", () => {
    assert.equal(listingCreateSchema.safeParse({ standalone: false }).success, false);
    assert.equal(
      listingCreateSchema.safeParse({ standalone: false, unitId: "unit_1" }).success,
      true,
    );
  });
});

describe("updating a listing", () => {
  test("a field left out is not given", () => {
    const parsed = listingUpdateSchema.parse({ titleAr: "عنوان جديد" });
    assert.equal(parsed.titleAr, "عنوان جديد");
    for (const key of [
      "titleEn", "descriptionAr", "price", "adLicenceNumber", "adLicenceExpiry",
      "contactPhone", "photos", "amenities", "city", "slug", "type", "pricePeriod",
    ] as const) {
      assert.equal(parsed[key], undefined, key);
    }
  });

  test("null and blank are 'clear it'", () => {
    const parsed = listingUpdateSchema.parse({
      adLicenceNumber: null,
      adLicenceExpiry: "",
      contactPhone: "  ",
      descriptionEn: null,
      city: null,
    });
    assert.equal(parsed.adLicenceNumber, null);
    assert.equal(parsed.adLicenceExpiry, null);
    assert.equal(parsed.contactPhone, null);
    assert.equal(parsed.descriptionEn, null);
    assert.equal(parsed.city, null);
  });

  test("a listing's own details are edited like any other field", () => {
    const parsed = listingUpdateSchema.parse({ areaSqm: "220", floor: null, addressLine: "" });
    assert.equal(parsed.areaSqm, 220);
    assert.equal(parsed.floor, null);
    assert.equal(parsed.addressLine, null);
    assert.equal(parsed.propertyType, undefined);
    assert.equal(parsed.bedrooms, undefined);
  });

  test("an empty photo list clears the listing's own photos", () => {
    assert.deepEqual(listingUpdateSchema.parse({ photos: [] }).photos, []);
  });

  test("state cannot be changed by an edit: a status in the body is dropped", () => {
    const parsed = listingUpdateSchema.parse({ status: "published", titleAr: "x" });
    assert.equal("status" in parsed, false);
  });
});

describe("actions and inquiry updates", () => {
  test("only the four actions", () => {
    for (const action of ["publish", "unpublish", "archive", "restore"]) {
      assert.equal(listingActionSchema.safeParse({ action }).success, true, action);
    }
    for (const action of ["delete", "", undefined, 3]) {
      assert.equal(listingActionSchema.safeParse({ action }).success, false, String(action));
    }
  });

  test("an inquiry update changes something, and only status, assignee and notes", () => {
    assert.equal(inquiryUpdateSchema.safeParse({}).success, false);
    assert.equal(inquiryUpdateSchema.safeParse({ status: "contacted" }).success, true);
    assert.equal(inquiryUpdateSchema.safeParse({ status: "spam" }).success, false);
    assert.equal(inquiryUpdateSchema.safeParse({ assigneeId: null }).success, true);
    const parsed = inquiryUpdateSchema.parse({ notes: "  Called, will visit Sunday ", name: "hacked" });
    assert.equal(parsed.notes, "Called, will visit Sunday");
    assert.equal("name" in parsed, false);
  });
});

describe("the office's listing details", () => {
  test("are read defensively from the settings document", () => {
    assert.deepEqual(readOfficeSettings(null), EMPTY_OFFICE_SETTINGS);
    assert.deepEqual(readOfficeSettings("nope"), EMPTY_OFFICE_SETTINGS);
    assert.deepEqual(readOfficeSettings({ listings: "x" }), EMPTY_OFFICE_SETTINGS);
    assert.deepEqual(
      readOfficeSettings({
        other: 1,
        listings: {
          falLicenceNumber: " ١٢٠٠٠١٢٣٤٥ ",
          falLicenceExpiry: "2027-03-01",
          contactPhone: "+966501234567",
          whatsappNumber: 5,
        },
      }),
      {
        falLicenceNumber: "1200012345",
        falLicenceExpiry: "2027-03-01",
        contactPhone: "+966501234567",
        whatsappNumber: null,
      },
    );
  });

  test("are written back into the document with every other key as it was", () => {
    const document = { theme: "x", nested: { a: 1 }, listings: { falLicenceNumber: "old" } };
    const next = withOfficeSettings(document, {
      falLicenceNumber: "1200012345",
      falLicenceExpiry: null,
      contactPhone: null,
      whatsappNumber: null,
    });
    assert.equal(next.theme, "x");
    assert.deepEqual(next.nested, { a: 1 });
    assert.deepEqual(next.listings, {
      falLicenceNumber: "1200012345",
      falLicenceExpiry: null,
      contactPhone: null,
      whatsappNumber: null,
    });
    assert.equal(document.listings.falLicenceNumber, "old", "the original is untouched");
    assert.equal(withOfficeSettings(undefined, EMPTY_OFFICE_SETTINGS).listings !== undefined, true);
  });

  test("a form that leaves a field out keeps what is stored", () => {
    const stored = {
      falLicenceNumber: "1200012345",
      falLicenceExpiry: "2027-03-01",
      contactPhone: "+966501234567",
      whatsappNumber: null,
    };
    const merged = mergeOfficeSettings(stored, officeSettingsSchema.parse({ whatsappNumber: "0551234567" }));
    assert.equal(merged.falLicenceNumber, "1200012345");
    assert.equal(merged.contactPhone, "+966501234567");
    assert.equal(merged.whatsappNumber, "+966551234567");
    const cleared = mergeOfficeSettings(stored, officeSettingsSchema.parse({ falLicenceNumber: "", falLicenceExpiry: null }));
    assert.equal(cleared.falLicenceNumber, null);
    assert.equal(cleared.falLicenceExpiry, null);
  });

  test("the brokerage licence is printed only while it is good", () => {
    const today = "2026-10-03";
    assert.equal(falLicenceIsShowable({ falLicenceNumber: null, falLicenceExpiry: null }, today), false);
    assert.equal(falLicenceIsShowable({ falLicenceNumber: "1200012345", falLicenceExpiry: null }, today), true);
    assert.equal(falLicenceIsShowable({ falLicenceNumber: "1200012345", falLicenceExpiry: today }, today), true);
    assert.equal(falLicenceIsShowable({ falLicenceNumber: "1200012345", falLicenceExpiry: "2026-10-02" }, today), false);
  });

  test("bad numbers and dates are refused", () => {
    assert.equal(officeSettingsSchema.safeParse({ contactPhone: "123" }).success, false);
    assert.equal(officeSettingsSchema.safeParse({ falLicenceNumber: "<x>" }).success, false);
    assert.equal(officeSettingsSchema.safeParse({ falLicenceExpiry: "soon" }).success, false);
  });
});
