/**
 * PropertyPro - A stored listing, as a stranger is shown it
 *
 * Pure: the row `PUBLIC_LISTING_SELECT` reads, in; the `PublicListingView`
 * out. Nothing is added from anywhere else, so what a visitor can learn about
 * a listing is exactly what the select let through and this maps.
 *
 * The facts come from the unit, or — for a property not in the system — from
 * the listing's own columns, which say the same things: what it is, the area,
 * the rooms and the floor. It has no "available from" day and no building
 * year, so the page says "available now" and leaves the year out.
 */

import { dayOf } from "./dates";
import { effectivePhotos, renderablePhotos } from "./photos";
import { isListingType, isPricePeriod } from "./constants";
import type { PublicListingView } from "./public-types";

type DateLike = Date | string;

export interface PublicRow {
  id: string;
  slug: string;
  type: string;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  price: unknown;
  currency: string;
  pricePeriod: string;
  photos: string[];
  amenities: string[];
  city: string | null;
  district: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  adLicenceNumber: string | null;
  adLicenceExpiry: DateLike | null;
  publishedAt: DateLike | null;
  updatedAt: DateLike;
  propertyType: string | null;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  unit: {
    unitType: string;
    bedrooms: number;
    bathrooms: number;
    squareFootage: number;
    floor: number | null;
    availableFrom: DateLike | null;
    images: string[];
    property: { type: string; images: string[]; yearBuilt: number | null };
  } | null;
}

/** The unit type slug the page names the listing by: the unit's, or its own. */
export function publicTypeSlug(row: Pick<PublicRow, "unit" | "propertyType">): string {
  return row.unit?.unitType ?? row.propertyType ?? "";
}

function factsOf(row: PublicRow): Omit<PublicListingView["facts"], "unitTypeLabel"> {
  const { unit } = row;
  if (unit) {
    return {
      unitType: unit.unitType,
      bedrooms: unit.bedrooms,
      bathrooms: unit.bathrooms,
      area: unit.squareFootage,
      floor: unit.floor,
      availableFrom: dayOf(unit.availableFrom),
      buildingYear: unit.property.yearBuilt,
    };
  }
  return {
    unitType: row.propertyType ?? "",
    bedrooms: row.bedrooms ?? 0,
    bathrooms: row.bathrooms ?? 0,
    // Publishing asks a listing with no unit for its area, so a public one has it.
    area: row.areaSqm ?? 0,
    floor: row.floor,
    availableFrom: null,
    buildingYear: null,
  };
}

const iso = (value: DateLike) =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

export function toPublicListingView(
  row: PublicRow,
  options: {
    r2Url?: string | null;
    typeLabels?: ReadonlyMap<string, { ar: string | null; en: string | null }>;
  } = {},
): PublicListingView {
  return {
    id: row.id,
    slug: row.slug,
    type: isListingType(row.type) ? row.type : "rent",
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    price: Number(row.price) || 0,
    currency: row.currency,
    pricePeriod: isPricePeriod(row.pricePeriod) ? row.pricePeriod : "monthly",
    photos: renderablePhotos(
      effectivePhotos(row, row.unit, row.unit?.property),
      options.r2Url,
    ),
    amenities: row.amenities,
    city: row.city,
    district: row.district,
    phone: row.contactPhone,
    whatsapp: row.whatsappNumber,
    // The select guarantees both; a row without them is not public at all.
    licenceNumber: row.adLicenceNumber ?? "",
    licenceExpiry: dayOf(row.adLicenceExpiry) ?? "",
    publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
    updatedAt: iso(row.updatedAt),
    facts: {
      ...factsOf(row),
      unitTypeLabel: options.typeLabels?.get(publicTypeSlug(row)) ?? {
        ar: null,
        en: null,
      },
    },
  };
}
