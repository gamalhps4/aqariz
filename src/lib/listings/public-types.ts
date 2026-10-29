/**
 * PropertyPro - What a visitor is shown
 *
 * The public pages' view of an office and of a listing: only what is meant
 * for a stranger, already narrowed to the pictures the page can draw. Types
 * only. Compare ./types.ts, the office's own view, which carries status,
 * licence state and inquiry counts a visitor must never see.
 */

import type { ListingType, PricePeriod } from "./constants";

export interface PublicOffice {
  id: string;
  slug: string;
  name: string;
  /** The office's own logo, if it uploaded one the page can draw. */
  logoUrl: string | null;
  /** Printed beside the advertising licence; null when not set or expired. */
  falLicenceNumber: string | null;
  /** The office's default numbers, for the header of its page. */
  phone: string | null;
  whatsapp: string | null;
}

export interface PublicListingView {
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
  /** Only pictures the page can draw. */
  photos: string[];
  amenities: string[];
  city: string | null;
  district: string | null;
  /** E.164. */
  phone: string | null;
  whatsapp: string | null;
  licenceNumber: string;
  licenceExpiry: string;
  publishedAt: string | null;
  updatedAt: string;
  facts: {
    unitType: string;
    /** The office's own name for the unit type, in both languages, if it has one. */
    unitTypeLabel: { ar: string | null; en: string | null };
    bedrooms: number;
    bathrooms: number;
    area: number;
    floor: number | null;
    availableFrom: string | null;
    buildingYear: number | null;
  };
}
