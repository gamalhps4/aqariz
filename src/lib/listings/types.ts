/**
 * PropertyPro - What the listing screens are sent
 *
 * The shapes the Marketing routes answer with and the screens read. Types
 * only — nothing here runs — so a client component can import them freely.
 * Dates are ISO strings (that is what JSON makes of a Date), money is a
 * number, and a licence expiry is a plain `YYYY-MM-DD` day.
 */

import type { LicenceState } from "./licence";
import type { ListingAbilities } from "./permissions";
import type {
  InquiryStatus,
  ListingStatus,
  ListingType,
  PricePeriod,
} from "./constants";

export type { ListingAbilities };

export interface ListingUnitDto {
  id: string;
  unitNumber: string;
  unitType: string;
  status: string;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  floor: number | null;
  rentAmount: number;
  /** Vacant and not deleted: what an advertisement needs the unit to be. */
  available: boolean;
}

export interface ListingPropertyDto {
  id: string;
  name: string;
  addressCity: string;
  addressDistrict: string | null;
}

/**
 * Why a PUBLISHED listing is not on the public page right now. Empty when it
 * is, and for a listing that is not published (nothing to explain). A listing
 * with no unit has no unit to be let, so only its licence can hide it.
 */
export type HiddenReason = "licence" | "unit_unavailable";

export interface ListingDto {
  id: string;
  slug: string;
  type: ListingType;
  titleAr: string;
  titleEn: string;
  descriptionAr: string | null;
  descriptionEn: string | null;
  price: number;
  currency: string;
  pricePeriod: PricePeriod;
  /**
   * The listing's own photos; empty means "use the unit's, then the
   * building's" — or, with no unit, no photos at all.
   */
  photos: string[];
  /** What the page would actually show: the photos above, or the fallback. */
  effectivePhotos: string[];
  amenities: string[];
  city: string | null;
  district: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  adLicenceNumber: string | null;
  adLicenceExpiry: string | null;
  licence: { state: LicenceState; daysLeft: number | null };
  status: ListingStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** A property the office has not added to the system: no unit, no building. */
  standalone: boolean;
  /**
   * What a standalone listing says about the property in place of a unit: its
   * type (a unit category slug), the office's address line, the area in m²,
   * the rooms and the floor. Null on a listing made from a unit.
   */
  propertyType: string | null;
  addressLine: string | null;
  areaSqm: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  floor: number | null;
  /** Null exactly when `standalone`. */
  unit: ListingUnitDto | null;
  property: ListingPropertyDto | null;
  hiddenReasons: HiddenReason[];
  /** /o/{office}/{listing} — where the public page is, whether or not it can be seen. */
  publicPath: string;
  inquiries: { total: number; new: number };
}

export interface ListingListSummary {
  total: number;
  draft: number;
  published: number;
  archived: number;
  /** Published but not showing (licence out of date, unit taken), or draft/published with a licence that is gone. */
  attention: number;
  newInquiries: number;
  abilities: ListingAbilities;
  /** The office's public page, for the "view page" link. */
  officePath: string;
}

export interface InquiryDto {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  message: string | null;
  status: InquiryStatus;
  assigneeId: string | null;
  assignee: { id: string; name: string } | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  listing: {
    id: string;
    slug: string;
    titleAr: string;
    titleEn: string;
    type: ListingType;
    unitNumber: string | null;
    propertyName: string | null;
    /**
     * Where a listing with no unit is — its address line, else its district
     * and city — since it has no building or unit number to name it by.
     */
    place: string | null;
  };
}

export interface InquiryListSummary {
  total: number;
  new: number;
  contacted: number;
  closed: number;
  /** Not yet taken by anyone and not closed. */
  unassigned: number;
  abilities: ListingAbilities;
}

export interface StaffMemberDto {
  id: string;
  name: string;
  email: string;
}

/** A vacant unit offered when starting a listing, with what the form prefills from. */
export interface CandidateUnitDto {
  id: string;
  unitNumber: string;
  unitType: string;
  floor: number | null;
  bedrooms: number;
  bathrooms: number;
  squareFootage: number;
  rentAmount: number;
  availableFrom: string | null;
  images: string[];
  /** The unit's feature flags (balcony, central air…), for the amenities prefill. */
  features: Record<string, unknown>;
  property: {
    id: string;
    name: string;
    type: string;
    addressCity: string;
    addressDistrict: string | null;
    images: string[];
    /** The building's amenity names. */
    amenities: string[];
  };
}

export interface OfficeSettingsDto {
  falLicenceNumber: string | null;
  falLicenceExpiry: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  /** The brokerage licence has an expiry day and it has passed. */
  falExpired: boolean;
  officeSlug: string;
}
