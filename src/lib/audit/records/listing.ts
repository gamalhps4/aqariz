/**
 * PropertyPro - A property listing, its inquiries and the office's listing
 * details as activity entries hold them
 *
 * A listing is named by its title (Arabic first, as the office reads it), else
 * its public address. The entry keeps what makes it an advertisement — the
 * titles, the price and its period, the place, the contact numbers it shows
 * and the advertising licence — with the photos as a count, and the unit and
 * building as names. A listing for a property not in the system has neither,
 * and keeps the details it holds in their place (type, address, area, rooms,
 * floor), which are null on every other listing.
 *
 * The same builders read a listing from the database row and from the DTO the
 * service answers with, so a before taken from one and an after taken from the
 * other compare field for field.
 *
 * Pure: no database, nothing server-only.
 */

import {
  dateOf,
  dayOf,
  numberOf,
  personName,
  type Row,
} from "./shared";

/** A listing or inquiry from the database or as the service's DTO (an interface, not a `Row`). */
type Source = object;

/** The fields compared when a listing is edited or its state changes. */
export const LISTING_CHANGE_KEYS = [
  "titleAr",
  "titleEn",
  "listingType",
  "price",
  "pricePeriod",
  "city",
  "district",
  "contactPhone",
  "whatsappNumber",
  "adLicenceNumber",
  "adLicenceExpiry",
  "slug",
  "amenities",
  "photosCount",
  "propertyType",
  "address",
  "areaSqm",
  "bedrooms",
  "bathrooms",
  "floor",
  "status",
  "publishedAt",
] as const;

/** The fields of a state change: publishing, taking down, archiving, restoring. */
export const LISTING_STATE_KEYS = ["status", "publishedAt"] as const;

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function namesOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
    : [];
}

/**
 * The listing as an entry stores it, from a row or from the service's DTO.
 * The unit and building names come with the DTO (and with a row read with its
 * relations); they are null otherwise.
 */
export function listingSnapshot(source: Source | null | undefined): Row {
  if (!source) return {};
  const row = source as Row;
  const unit = row.unit && typeof row.unit === "object" ? (row.unit as Row) : null;
  const property =
    row.property && typeof row.property === "object" ? (row.property as Row) : null;
  return {
    titleAr: textOf(row.titleAr),
    titleEn: textOf(row.titleEn),
    listingType: textOf(row.type),
    price: numberOf(row.price),
    pricePeriod: textOf(row.pricePeriod),
    city: textOf(row.city),
    district: textOf(row.district),
    contactPhone: textOf(row.contactPhone),
    whatsappNumber: textOf(row.whatsappNumber),
    adLicenceNumber: textOf(row.adLicenceNumber),
    // A calendar day on both sides: the row holds a Date, the DTO a day.
    adLicenceExpiry: dayOf(row.adLicenceExpiry),
    slug: textOf(row.slug),
    amenities: namesOf(row.amenities),
    photosCount: Array.isArray(row.photos) ? row.photos.length : null,
    propertyType: textOf(row.propertyType),
    address: textOf(row.addressLine),
    areaSqm: numberOf(row.areaSqm),
    bedrooms: numberOf(row.bedrooms),
    bathrooms: numberOf(row.bathrooms),
    floor: numberOf(row.floor),
    status: textOf(row.status),
    publishedAt: dateOf(row.publishedAt),
    unitNumber: unit ? textOf(unit.unitNumber) : null,
    propertyName: property ? textOf(property.name) : null,
  };
}

/** What a reader knows a listing by: its title, Arabic first, else its address. */
export function listingName(source: Source | null | undefined): string | null {
  if (!source) return null;
  const row = source as Row;
  return textOf(row.titleAr) ?? textOf(row.titleEn) ?? textOf(row.slug);
}

/**
 * Where the listing is — its unit and building — for the entry's details; for
 * a property not in the system, which has neither, its address and city.
 */
export function listingPlace(source: Source | null | undefined): Row {
  const snapshot = listingSnapshot(source);
  const place: Row = {};
  if (snapshot.propertyName) place.propertyName = snapshot.propertyName;
  if (snapshot.unitNumber) place.unitNumber = snapshot.unitNumber;
  if (!snapshot.propertyName && !snapshot.unitNumber) {
    if (snapshot.address) place.address = snapshot.address;
    if (snapshot.city) place.city = snapshot.city;
  }
  return place;
}

/**
 * The action a state move reads as. Publishing and taking down are a status
 * change (draft ⇄ published); archiving and restoring are the archive's own.
 * Null when the status did not move.
 */
export function listingStateAction(
  from: string | null | undefined,
  to: string | null | undefined,
): "status_changed" | "archive" | "restore" | null {
  if (!from || !to || from === to) return null;
  if (to === "archived") return "archive";
  if (from === "archived") return "restore";
  return "status_changed";
}

/** The fields compared when an inquiry is worked. */
export const INQUIRY_CHANGE_KEYS = ["status", "assigneeName", "notes"] as const;

/**
 * An inquiry as an entry stores it. The visitor's own words, name, phone and
 * address are not copied: the entry says what the office did with it.
 */
export function inquirySnapshot(source: Source | null | undefined): Row {
  if (!source) return {};
  const row = source as Row;
  const assignee =
    row.assignee && typeof row.assignee === "object" ? row.assignee : null;
  return {
    status: textOf(row.status),
    assigneeName: assignee ? personName(assignee) : null,
    notes: typeof row.notes === "string" && row.notes.trim() ? row.notes.trim().slice(0, 300) : null,
  };
}

/** The office's listing details (settings) compared when they are saved. */
export const OFFICE_SETTINGS_KEYS = [
  "falLicenceNumber",
  "falLicenceExpiry",
  "contactPhone",
  "whatsappNumber",
] as const;
