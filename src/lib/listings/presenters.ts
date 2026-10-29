/**
 * PropertyPro - A stored listing, as the screens are sent it
 *
 * Pure: a row, a day and a slug in, a `ListingDto` out. The one thing worth
 * reading is `hiddenReasons` — what the staff list shows as a badge when a
 * PUBLISHED listing is not actually on the public page: its unit has been let
 * since, or its advertising licence ran out. Neither changes the listing's
 * stored status (a unit that becomes vacant again, or a renewed licence, puts
 * the ad straight back), so the screen needs to be told.
 *
 * A listing for a property not in the system comes with no unit and no
 * building: `standalone`, its own details beside them, and nothing that a
 * unit being let could hide.
 */

import { licenceStatus } from "./licence";
import { dayOf } from "./dates";
import { effectivePhotos } from "./photos";
import { listingPath } from "./urls";
import {
  isListingStatus,
  isListingType,
  isPricePeriod,
  type ListingStatus,
  type ListingType,
  type PricePeriod,
} from "./constants";
import type { HiddenReason, ListingDto } from "./types";

type DateLike = Date | string;

/** The columns of a listing row, its unit and its building the presenter reads. */
export interface ListingRowSource {
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
  status: string;
  publishedAt: DateLike | null;
  createdAt: DateLike;
  updatedAt: DateLike;
  propertyType: string | null;
  addressLine: string | null;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  /** Both null for a property not in the system. */
  unit: {
    id: string;
    unitNumber: string;
    unitType: string;
    status: string;
    bedrooms: number;
    bathrooms: number;
    squareFootage: number;
    floor: number | null;
    rentAmount: unknown;
    images: string[];
    deletedAt: Date | null;
  } | null;
  property: {
    id: string;
    name: string;
    addressCity: string;
    addressDistrict: string | null;
    images: string[];
  } | null;
}

function iso(value: DateLike): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

export function toListingDto(
  row: ListingRowSource,
  context: {
    today: string;
    organizationSlug: string;
    inquiries?: { total: number; new: number };
  },
): ListingDto {
  const type: ListingType = isListingType(row.type) ? row.type : "rent";
  const status: ListingStatus = isListingStatus(row.status) ? row.status : "draft";
  const pricePeriod: PricePeriod = isPricePeriod(row.pricePeriod)
    ? row.pricePeriod
    : "monthly";

  const expiryDay = dayOf(row.adLicenceExpiry);
  const licence = licenceStatus(row.adLicenceNumber, expiryDay, context.today);
  const { unit, property } = row;
  const available =
    unit !== null && unit.status === "available" && unit.deletedAt === null;

  const hiddenReasons: HiddenReason[] = [];
  if (status === "published") {
    if (licence.state === "missing" || licence.state === "expired") {
      hiddenReasons.push("licence");
    }
    if (unit && !available) hiddenReasons.push("unit_unavailable");
  }

  return {
    id: row.id,
    slug: row.slug,
    type,
    titleAr: row.titleAr,
    titleEn: row.titleEn,
    descriptionAr: row.descriptionAr,
    descriptionEn: row.descriptionEn,
    price: Number(row.price) || 0,
    currency: row.currency,
    pricePeriod,
    photos: row.photos,
    effectivePhotos: effectivePhotos(row, unit, property),
    amenities: row.amenities,
    city: row.city,
    district: row.district,
    contactPhone: row.contactPhone,
    whatsappNumber: row.whatsappNumber,
    adLicenceNumber: row.adLicenceNumber,
    adLicenceExpiry: expiryDay,
    licence,
    status,
    publishedAt: row.publishedAt ? iso(row.publishedAt) : null,
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    standalone: unit === null,
    propertyType: row.propertyType,
    addressLine: row.addressLine,
    areaSqm: row.areaSqm,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    floor: row.floor,
    unit: unit
      ? {
          id: unit.id,
          unitNumber: unit.unitNumber,
          unitType: unit.unitType,
          status: unit.status,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          squareFootage: unit.squareFootage,
          floor: unit.floor,
          rentAmount: Number(unit.rentAmount) || 0,
          available,
        }
      : null,
    property: property
      ? {
          id: property.id,
          name: property.name,
          addressCity: property.addressCity,
          addressDistrict: property.addressDistrict,
        }
      : null,
    hiddenReasons,
    publicPath: listingPath(context.organizationSlug, row.slug),
    inquiries: context.inquiries ?? { total: 0, new: 0 },
  };
}
