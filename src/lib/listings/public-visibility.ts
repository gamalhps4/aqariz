/**
 * PropertyPro - What the public may read
 *
 * The one definition of "this listing is on the public page", used by every
 * path that shows a listing to someone who is not signed in: the office page,
 * the listing page, the sitemap and the inquiry form (which refuses a message
 * for a listing the visitor could not have seen).
 *
 * A listing is public when ALL of these hold:
 *
 *   - it belongs to the office being asked for (the slug in the URL names the
 *     office; the query is keyed on that office's id, never on the listing
 *     alone) and that office is a live account;
 *   - it is published — not a draft, not archived;
 *   - its advertising licence is on file and has not run out;
 *   - its unit is still available, and neither the unit nor its building has
 *     been deleted — or it has no unit at all: a listing for a property not in
 *     the system has nothing that can be let or deleted under it, so the
 *     licence alone decides.
 *
 * Two parts, one rule: `publicListingWhere` is the query, `isPubliclyVisible`
 * is the same rule against a row already in hand. The tests run both over the
 * same rows (lib/testing/where-matcher), so they cannot drift apart.
 *
 * `PUBLIC_LISTING_SELECT` is the other half of the boundary: the columns that
 * may leave the building. A row read for the public never carries a tenant, a
 * lease, a deposit, the unit's internal notes or the inquiries — they are not
 * selected, so no later change to a presenter can leak them.
 */

import type { Prisma } from "@/generated/prisma/client";
import { dayOf, dayToDate } from "./dates";
import { licenceIsCurrent } from "./licence";

/**
 * An office whose public pages are live: the same statuses the public
 * branding route treats as a working account. A suspended or deleted office
 * has no public page, whatever its listings say.
 */
export const PUBLIC_ORGANIZATION_STATUSES = ["active", "trial"] as const;

/**
 * Everything that makes a listing public except which office it is on — for
 * the paths that know a listing but not (yet) its office: the sitemap, and
 * the inquiry form, which only has the listing's id.
 */
export function publicListingFilter(today: string): Prisma.ListingWhereInput {
  return {
    status: "published",
    adLicenceNumber: { not: null },
    NOT: { adLicenceNumber: "" },
    // The licence's last day is still a good day: valid through it.
    adLicenceExpiry: { gte: dayToDate(today) },
    organization: {
      status: { in: [...PUBLIC_ORGANIZATION_STATUSES] },
      deletedAt: null,
    },
    OR: [
      { unitId: null },
      {
        unit: {
          status: "available",
          deletedAt: null,
          property: { deletedAt: null },
        },
      },
    ],
  };
}

/** The listings of one office that are public today. */
export function publicListingWhere(
  organizationId: string,
  today: string,
): Prisma.ListingWhereInput {
  return { organizationId, ...publicListingFilter(today) };
}

/** The columns of a listing, its unit and its building a visitor may see. */
export const PUBLIC_LISTING_SELECT = {
  id: true,
  slug: true,
  type: true,
  titleAr: true,
  titleEn: true,
  descriptionAr: true,
  descriptionEn: true,
  price: true,
  currency: true,
  pricePeriod: true,
  photos: true,
  amenities: true,
  city: true,
  district: true,
  contactPhone: true,
  whatsappNumber: true,
  adLicenceNumber: true,
  adLicenceExpiry: true,
  publishedAt: true,
  updatedAt: true,
  // What a listing with no unit says in place of one. The address line is the
  // office's own note, like the building name and unit number this leaves out.
  propertyType: true,
  areaSqm: true,
  bedrooms: true,
  bathrooms: true,
  floor: true,
  unit: {
    select: {
      unitType: true,
      bedrooms: true,
      bathrooms: true,
      squareFootage: true,
      floor: true,
      availableFrom: true,
      images: true,
      property: {
        select: {
          type: true,
          images: true,
          yearBuilt: true,
        },
      },
    },
  },
} satisfies Prisma.ListingSelect;

/** The row shape the rule reads — a listing with its office, unit and building. */
export interface VisibilityRow {
  organizationId: string;
  status: string;
  adLicenceNumber: string | null;
  adLicenceExpiry: Date | string | null;
  organization: { status: string; deletedAt: Date | null };
  /** Null, with `unit`, for a property not in the system. */
  unitId: string | null;
  unit: {
    status: string;
    deletedAt: Date | null;
    property: { deletedAt: Date | null };
  } | null;
}

/** Whether a row already in hand is on the public page of this office today. */
export function isPubliclyVisible(
  row: VisibilityRow,
  organizationId: string,
  today: string,
): boolean {
  return (
    row.organizationId === organizationId &&
    row.status === "published" &&
    licenceIsCurrent(row.adLicenceNumber, dayOf(row.adLicenceExpiry), today) &&
    (PUBLIC_ORGANIZATION_STATUSES as readonly string[]).includes(
      row.organization.status,
    ) &&
    row.organization.deletedAt === null &&
    (row.unitId === null ||
      (row.unit !== null &&
        row.unit.status === "available" &&
        row.unit.deletedAt === null &&
        row.unit.property.deletedAt === null))
  );
}
