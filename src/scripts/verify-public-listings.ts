/**
 * PropertyPro SaaS - Public listings verification (PostgreSQL / RLS edition)
 *
 * Usage:
 *   DATABASE_URL=postgresql://…@127.0.0.1:…/pp NODE_OPTIONS=--conditions=react-server \
 *     tsx --tsconfig tsconfig.scripts.json src/scripts/verify-public-listings.ts
 *
 * The public pages read with row-level security bypassed, so the `where`
 * clause in lib/listings/public-visibility.ts is the whole of the isolation.
 * public-visibility.test.ts proves that clause over plain objects; this proves
 * it against the REAL database and the REAL read functions, with two live
 * offices and one suspended one:
 *
 *   1. Only published listings with a current licence whose unit is vacant are
 *      readable — never a draft, an archived ad, an expired licence, a let
 *      unit, another office's row or a suspended office's page.
 *   2. The same rows leave the sitemap and accept an inquiry; nothing else does.
 *   3. Listings come back on their own the day a licence is renewed or a unit
 *      is vacated, and go the day after a licence runs out.
 *   4. The database itself refuses a published listing with no licence, a
 *      second live ad for one unit and type, a repeated slug in one office, and
 *      a sale priced per month.
 *   5. Under an office's own context its drafts and inquiries are visible and
 *      the other office's are not.
 *
 * It writes rows (and removes them again), so it REFUSES to run against
 * anything but a local database. Never point it at the shared one.
 */

import "../lib/env/load-dotenv";
import { randomUUID } from "crypto";
import { authDb, db } from "@/lib/db/prisma";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import { dayToDate, riyadhDay } from "@/lib/listings/dates";
import {
  getPublicListing,
  getPublicListings,
  getPublicOffice,
  listPublicPaths,
  recordInquiry,
} from "@/lib/listings/public";

function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL ?? "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    // fall through to the refusal below
  }
  if (host !== "127.0.0.1" && host !== "localhost") {
    console.error(
      `Refusing to run: DATABASE_URL points at "${host || "(unset)"}", not at a local database. ` +
        "This script writes rows.",
    );
    process.exit(2);
  }
}

let passed = 0;
let failed = 0;

function check(name: string, condition: boolean, detail?: unknown) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}`);
    if (detail !== undefined) console.error(`    ${JSON.stringify(detail)}`);
  }
}

async function rejects(name: string, fn: () => Promise<unknown>, needle: RegExp) {
  try {
    await fn();
    check(name, false, "the database accepted it");
  } catch (error) {
    const message = String((error as { message?: unknown })?.message ?? error);
    const original = JSON.stringify(
      (error as { meta?: unknown })?.meta ?? {},
    );
    check(name, needle.test(message) || needle.test(original), message.slice(-200));
  }
}

async function main() {
  assertLocalDatabase();
  const runId = randomUUID().slice(0, 8);
  const today = riyadhDay();
  const tomorrow = riyadhDay(new Date(Date.now() + 24 * 3_600_000));
  const yesterday = riyadhDay(new Date(Date.now() - 24 * 3_600_000));
  const nextYear = riyadhDay(new Date(Date.now() + 365 * 24 * 3_600_000));

  console.log("\nPublic listings verification (Postgres RLS)\n");

  const created: {
    orgs: string[];
    users: string[];
    properties: string[];
    units: string[];
    listings: string[];
  } = { orgs: [], users: [], properties: [], units: [], listings: [] };

  /** An office with a building, an owner and `unitCount` vacant units. */
  async function office(label: string, status: string, unitCount: number) {
    return bypassOrgScope(async () => {
      const org = await authDb.organization.create({
        data: {
          name: `Listing probe ${label}`,
          slug: `lp-${label}-${runId}`,
          ownerId: "probe",
          status,
          branding: { companyName: `Probe office ${label}` },
        },
      });
      created.orgs.push(org.id);
      const owner = await authDb.user.create({
        data: {
          email: `lp-${label}-${runId}@listing.test`,
          firstName: "Probe",
          lastName: label,
          organizationId: org.id,
        },
      });
      created.users.push(owner.id);
      const property = await authDb.property.create({
        data: {
          organizationId: org.id,
          name: `Probe building ${label}`,
          type: "residential_building",
          addressStreet: "1 Probe St",
          addressCity: "Riyadh",
          addressState: "Riyadh",
          addressZipCode: "11111",
          ownerId: owner.id,
        },
      });
      created.properties.push(property.id);
      const units = [];
      for (let n = 1; n <= unitCount; n += 1) {
        const unit = await authDb.unit.create({
          data: {
            organizationId: org.id,
            propertyId: property.id,
            unitNumber: `${label}${n}`,
            status: "available",
            bedrooms: 2,
            bathrooms: 1,
            squareFootage: 100,
          },
        });
        created.units.push(unit.id);
        units.push(unit);
      }
      return { org, owner, property, units };
    });
  }

  async function listing(
    ctx: Awaited<ReturnType<typeof office>>,
    unitIndex: number,
    slug: string,
    overrides: Record<string, unknown> = {},
  ) {
    return bypassOrgScope(async () => {
      const row = await authDb.listing.create({
        data: {
          organizationId: ctx.org.id,
          propertyId: ctx.property.id,
          unitId: ctx.units[unitIndex].id,
          slug,
          titleAr: `عنوان ${slug}`,
          price: 5000,
          pricePeriod: "monthly",
          status: "published",
          adLicenceNumber: "7100012345",
          adLicenceExpiry: dayToDate(nextYear),
          publishedAt: new Date(),
          ...overrides,
        },
      });
      created.listings.push(row.id);
      return row;
    });
  }

  try {
    const a = await office("a", "active", 8);
    const b = await office("b", "active", 4);
    const s = await office("s", "suspended", 1);

    // Office A: one of everything a stranger may and may not see.
    const visible = await listing(a, 0, "visible");
    const sale = await listing(a, 1, "for-sale", {
      type: "sale",
      pricePeriod: "total",
      price: 1_200_000,
    });
    const draft = await listing(a, 2, "draft", { status: "draft" });
    const archived = await listing(a, 3, "archived", { status: "archived" });
    const expired = await listing(a, 4, "expired", {
      adLicenceExpiry: dayToDate(yesterday),
    });
    const letUnit = await listing(a, 5, "let-unit");
    await bypassOrgScope(() =>
      authDb.unit.update({ where: { id: a.units[5].id }, data: { status: "occupied" } }),
    );
    const expiresToday = await listing(a, 6, "expires-today", {
      adLicenceExpiry: dayToDate(today),
    });
    const deletedUnit = await listing(a, 7, "deleted-unit");
    await bypassOrgScope(() =>
      authDb.unit.update({
        where: { id: a.units[7].id },
        data: { deletedAt: new Date() },
      }),
    );
    // Office B and the suspended office S each have one good listing.
    const bVisible = await listing(b, 0, "b-visible");
    const bDraft = await listing(b, 1, "b-draft", { status: "draft" });
    const sVisible = await listing(s, 0, "s-visible");

    // ---- 1. The office page ------------------------------------------------
    console.log("The office page");
    const officeA = await getPublicOffice(a.org.slug);
    check("an active office is found by its slug", officeA?.id === a.org.id);
    check(
      "its name comes from the office's branding",
      officeA?.name === "Probe office a",
      officeA?.name,
    );
    check("an unknown slug is nothing", (await getPublicOffice("no-such-office")) === null);
    check(
      "a suspended office has no public page",
      (await getPublicOffice(s.org.slug)) === null,
    );
    check(
      "a malformed slug is refused without a query",
      (await getPublicOffice("../etc/passwd")) === null,
    );

    const pageA = officeA ? await getPublicListings(officeA) : null;
    const slugsA = new Set(pageA?.rows.map((row) => row.slug));
    check(
      "office A lists exactly its published, licensed, vacant listings",
      slugsA.size === 3 &&
        slugsA.has("visible") &&
        slugsA.has("for-sale") &&
        slugsA.has("expires-today"),
      [...slugsA],
    );
    for (const hidden of ["draft", "archived", "expired", "let-unit", "deleted-unit", "b-visible", "b-draft", "s-visible"]) {
      check(`  …and not "${hidden}"`, !slugsA.has(hidden));
    }
    check("the total agrees with the rows", pageA?.total === 3, pageA?.total);

    const rentOnly = officeA ? await getPublicListings(officeA, { type: "rent" }) : null;
    check(
      "the type filter narrows the page",
      rentOnly?.rows.length === 2 && rentOnly.rows.every((row) => row.type === "rent"),
    );

    // ---- 2. One listing, by slug -------------------------------------------
    console.log("One listing");
    const one = officeA ? await getPublicListing(officeA.id, "visible") : null;
    check("a visible listing is read", one?.id === visible.id);
    check(
      "its licence number is public",
      one?.licenceNumber === "7100012345",
    );
    for (const hidden of ["draft", "archived", "expired", "let-unit", "deleted-unit"]) {
      check(
        `"${hidden}" is not readable by its slug`,
        !officeA || (await getPublicListing(officeA.id, hidden)) === null,
      );
    }
    check(
      "another office's slug under this office is nothing",
      !officeA || (await getPublicListing(officeA.id, "b-visible")) === null,
    );
    check(
      "…and the other way round",
      (await getPublicListing(b.org.id, "visible")) === null,
    );
    const asKeys = Object.keys(one ?? {});
    check(
      "the public view carries no internal column",
      ["organizationId", "propertyId", "unitId", "createdById", "status", "inquiries"].every(
        (key) => !asKeys.includes(key),
      ),
      asKeys,
    );

    // ---- 3. The sitemap ------------------------------------------------------
    console.log("The sitemap");
    const paths = (await listPublicPaths(5000)).map((entry) => entry.path);
    const mine = paths.filter((path) => path.includes(`-${runId}`));
    const expected = [
      `/o/${a.org.slug}`,
      `/o/${a.org.slug}/visible`,
      `/o/${a.org.slug}/for-sale`,
      `/o/${a.org.slug}/expires-today`,
      `/o/${b.org.slug}`,
      `/o/${b.org.slug}/b-visible`,
    ].sort();
    check(
      "lists the visible listings and their offices, nothing else",
      JSON.stringify([...mine].sort()) === JSON.stringify(expected),
      mine,
    );

    // ---- 4. Inquiries ----------------------------------------------------------
    console.log("Inquiries");
    const data = {
      name: "Sara",
      phone: "+966501234567",
      email: null,
      message: "Is it free?",
    };
    const ok = await recordInquiry({ listingId: visible.id, data, sourceHash: "abc123" });
    check("a visible listing takes an inquiry", ok.ok === true);
    for (const [label, row] of [
      ["a draft", draft],
      ["an archived ad", archived],
      ["an expired licence", expired],
      ["a let unit", letUnit],
      ["a deleted unit", deletedUnit],
      ["a suspended office's listing", sVisible],
    ] as const) {
      const refused = await recordInquiry({ listingId: row.id, data, sourceHash: null });
      check(`${label} does not`, refused.ok === false);
    }
    check(
      "an unknown id does not",
      (await recordInquiry({ listingId: "nope-nope-nope", data, sourceHash: null })).ok === false,
    );
    const stored = await bypassOrgScope(() =>
      authDb.listingInquiry.findMany({ where: { listingId: { in: created.listings } } }),
    );
    check(
      "exactly one inquiry was written, for the right office, with a hashed source",
      stored.length === 1 &&
        stored[0].organizationId === a.org.id &&
        stored[0].sourceIpHash === "abc123" &&
        stored[0].status === "new",
      stored,
    );

    // ---- 5. The clock and the unit change what is public -----------------------
    console.log("Renewal, expiry and vacating");
    await bypassOrgScope(() =>
      authDb.listing.update({
        where: { id: expired.id },
        data: { adLicenceExpiry: dayToDate(tomorrow) },
      }),
    );
    check(
      "a renewed licence puts the listing straight back",
      !!officeA && (await getPublicListing(officeA.id, "expired")) !== null,
    );
    await bypassOrgScope(() =>
      authDb.unit.update({ where: { id: a.units[5].id }, data: { status: "available" } }),
    );
    check(
      "a vacated unit puts its listing back",
      !!officeA && (await getPublicListing(officeA.id, "let-unit")) !== null,
    );
    await bypassOrgScope(() =>
      authDb.unit.update({ where: { id: a.units[0].id }, data: { status: "occupied" } }),
    );
    check(
      "a unit that is let takes its listing off the page",
      !!officeA && (await getPublicListing(officeA.id, "visible")) === null,
    );
    check(
      "an expiry of today is still public",
      !!officeA && (await getPublicListing(officeA.id, "expires-today")) !== null,
    );
    // The sitemap and inquiry form agree.
    check(
      "…and out of the inquiry form too",
      (await recordInquiry({ listingId: visible.id, data, sourceHash: null })).ok === false,
    );

    // ---- 6. What the database itself refuses ------------------------------------
    console.log("Constraints");
    await rejects(
      "a published listing without a licence number is refused",
      () =>
        bypassOrgScope(() =>
          authDb.listing.update({
            where: { id: draft.id },
            data: { status: "published", adLicenceNumber: null },
          }),
        ),
      /listings_published_licence_check/,
    );
    await rejects(
      "a published listing without an expiry day is refused",
      () =>
        bypassOrgScope(() =>
          authDb.listing.update({
            where: { id: draft.id },
            data: { status: "published", adLicenceNumber: "1234567", adLicenceExpiry: null },
          }),
        ),
      /listings_published_licence_check/,
    );
    await rejects(
      "a second live listing for one unit and type is refused",
      () =>
        listing(a, 1, "for-sale-again", { type: "sale", pricePeriod: "total", status: "draft" }),
      /listings_unit_type_live_unique/,
    );
    await bypassOrgScope(() =>
      authDb.listing.update({ where: { id: sale.id }, data: { status: "archived" } }),
    );
    const again = await listing(a, 1, "for-sale-again", {
      type: "sale",
      pricePeriod: "total",
      status: "draft",
    });
    check("…but is fine once the first one is archived", !!again.id);
    await rejects(
      "a repeated slug inside one office is refused",
      () => listing(a, 1, "visible", { type: "rent", status: "draft" }),
      /listings_organizationId_slug_key|slug/,
    );
    const sameSlugElsewhere = await listing(b, 2, "visible", { status: "draft" }).catch(
      (error) => error,
    );
    check(
      "the same slug in another office is fine",
      !(sameSlugElsewhere instanceof Error),
      String(sameSlugElsewhere),
    );
    await rejects(
      "a sale priced per month is refused",
      () => listing(b, 3, "bad-sale", { type: "sale", pricePeriod: "monthly", status: "draft" }),
      /listings_period_type_check/,
    );
    await rejects(
      "an unsafe slug is refused",
      () => listing(b, 3, "Not A Slug", { status: "draft" }),
      /listings_slug_check/,
    );

    // ---- 7. The office's own side ------------------------------------------------
    console.log("The office's own context");
    await runWithOrgContext({ organizationId: a.org.id, isPlatformAdmin: false }, async () => {
      const own = await db.listing.findMany({ where: { id: { in: created.listings } } });
      const slugs = new Set(own.map((row) => row.slug));
      check("office A sees its drafts and archived ads", slugs.has("draft") && slugs.has("archived"));
      check(
        "…and none of office B's",
        !slugs.has("b-visible") && !slugs.has("b-draft"),
        [...slugs],
      );
      const inquiries = await db.listingInquiry.findMany();
      check(
        "office A sees its inquiries",
        inquiries.some((row) => row.listingId === visible.id),
      );
      const foreign = await db.listing.findFirst({ where: { id: bVisible.id } });
      check("a foreign listing id resolves to nothing", foreign === null);
    });
    await runWithOrgContext({ organizationId: b.org.id, isPlatformAdmin: false }, async () => {
      const inquiries = await db.listingInquiry.findMany({
        where: { listingId: { in: created.listings } },
      });
      check("office B sees none of office A's inquiries", inquiries.length === 0, inquiries.length);
      const foreignDraft = await db.listing.findFirst({ where: { id: draft.id } });
      check("office B cannot read office A's draft", foreignDraft === null);
      await rejects(
        "office B cannot write a listing into office A",
        () =>
          db.listing.create({
            data: {
              organizationId: a.org.id,
              propertyId: a.property.id,
              unitId: a.units[2].id,
              slug: "smuggled",
              price: 1,
            },
          }),
        /row-level security|violates/,
      );
    });
    // Referenced so an unused-fixture lint stays quiet: these exist to be hidden.
    void [bDraft, deletedUnit, expiresToday];
  } finally {
    // ---- cleanup (bypass) ----------------------------------------------------------
    await bypassOrgScope(async () => {
      await authDb.listingInquiry.deleteMany({
        where: { listingId: { in: created.listings } },
      });
      await authDb.listing.deleteMany({ where: { id: { in: created.listings } } });
      await authDb.listing.deleteMany({
        where: { organizationId: { in: created.orgs } },
      });
      await authDb.unit.deleteMany({ where: { id: { in: created.units } } });
      await authDb.property.deleteMany({ where: { id: { in: created.properties } } });
      await authDb.user.deleteMany({ where: { id: { in: created.users } } });
      await authDb.organization.deleteMany({ where: { id: { in: created.orgs } } });
    }).catch((error) => console.error("cleanup failed:", error));
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
