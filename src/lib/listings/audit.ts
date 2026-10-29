import "server-only";

/**
 * PropertyPro - What a listing held before a change
 *
 * The listing routes record what they did with the shared activity helpers
 * (lib/audit-domain: `recordActivity`, `auditRecordChange`,
 * `auditSettingsChange`; the builders are in lib/audit/records/listing). The
 * services answer with the row AFTER the change, so the routes that edit or
 * move a listing, or work an inquiry, read the row first — one query each — to
 * give the entry its "before". A failed read gives no "before"; it never fails
 * the request it belongs to.
 */

import { db } from "@/lib/db/prisma";

/** The columns an entry compares for a listing; the long descriptions stay out. */
const LISTING_AUDIT_SELECT = {
  titleAr: true,
  titleEn: true,
  type: true,
  slug: true,
  price: true,
  pricePeriod: true,
  city: true,
  district: true,
  contactPhone: true,
  whatsappNumber: true,
  adLicenceNumber: true,
  adLicenceExpiry: true,
  status: true,
  publishedAt: true,
  photos: true,
  amenities: true,
  propertyType: true,
  addressLine: true,
  areaSqm: true,
  bedrooms: true,
  bathrooms: true,
  floor: true,
} as const;

/** The listing as it stands now, for an entry's "before"; null when it cannot be read. */
export async function readListingBefore(
  id: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await db.listing.findFirst({
      where: { id },
      select: LISTING_AUDIT_SELECT,
    });
  } catch (error) {
    console.error("Could not read the listing for its activity entry:", error);
    return null;
  }
}

/** The inquiry as it stands now (status, who has it, the office's notes); null when it cannot be read. */
export async function readInquiryBefore(
  id: string,
): Promise<Record<string, unknown> | null> {
  try {
    return await db.listingInquiry.findFirst({
      where: { id },
      select: {
        status: true,
        notes: true,
        assignee: { select: { firstName: true, lastName: true } },
      },
    });
  } catch (error) {
    console.error("Could not read the inquiry for its activity entry:", error);
    return null;
  }
}
