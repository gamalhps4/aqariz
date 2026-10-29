/**
 * PropertyPro - Property listings: the vocabulary
 *
 * A listing is an advertisement for one unit — or for a property the office
 * has not added to the system — that an office puts on its public page
 * (/o/{office}/{listing}). Everything below is a closed set the database
 * also guards with a CHECK constraint (migration 20261003160001_listings), so
 * an unknown value cannot reach a page that switches on it.
 *
 * No imports on purpose: the screens, the routes and the tests all read this.
 */

/** What the ad offers. Rent is the default; the model carries both. */
export const LISTING_TYPES = ["rent", "sale"] as const;
export type ListingType = (typeof LISTING_TYPES)[number];
export const DEFAULT_LISTING_TYPE: ListingType = "rent";

/**
 * What the price is per. A sale is one price for the property ("total"); a
 * rent is quoted per month, quarter, half year or year — the same cycles an
 * agreement or a contract uses, so a figure reads the same everywhere.
 */
export const RENT_PRICE_PERIODS = [
  "monthly",
  "quarterly",
  "semi_annual",
  "annual",
] as const;
export const PRICE_PERIODS = [...RENT_PRICE_PERIODS, "total"] as const;
export type PricePeriod = (typeof PRICE_PERIODS)[number];

/**
 * A unit's own rent is shown "per month" everywhere in the product, so a
 * listing started from a unit starts there; the office changes it when it
 * quotes the year instead.
 */
export const DEFAULT_RENT_PERIOD: PricePeriod = "monthly";

export const LISTING_STATUSES = ["draft", "published", "archived"] as const;
export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const INQUIRY_STATUSES = ["new", "contacted", "closed"] as const;
export type InquiryStatus = (typeof INQUIRY_STATUSES)[number];

/**
 * The yes/no features of a unit (balcony, central air…) a new listing's
 * amenities start from. Each has a name in the catalogue
 * (`marketing.amenity.<flag>`); `parking` is the unit's parking detail, named
 * the same way.
 */
export const UNIT_AMENITY_FLAGS = [
  "balcony",
  "patio",
  "garden",
  "dishwasher",
  "inUnitLaundry",
  "hardwoodFloors",
  "fireplace",
  "walkInClosets",
  "centralAir",
  "ceilingFans",
] as const;

/** A listing's currency. The product ships for Saudi Arabia. */
export const LISTING_CURRENCY = "SAR";

/**
 * The widest each free-text field may be. The same numbers guard the form,
 * the API and (for what is public) the page, so nothing a person typed is
 * ever longer than something that can display it.
 */
export const LISTING_LIMITS = {
  title: 160,
  description: 5000,
  city: 100,
  district: 100,
  amenity: 80,
  amenities: 40,
  photos: 30,
  photoUrl: 1000,
  licenceNumber: 40,
  phone: 30,
  slug: 60,
  slugMin: 3,
  /** The most a price can be — the ceiling every money field in the app has. */
  price: 100_000_000,
  /**
   * A listing for a property not in the system: its type (a unit category
   * slug), address line, area in m², rooms and floor. The migration holds the
   * numbers to the same bounds.
   */
  propertyType: 60,
  addressLine: 200,
  areaSqm: 1_000_000,
  rooms: 100,
  floorMin: -10,
  floorMax: 300,
} as const;

export const INQUIRY_LIMITS = {
  name: 120,
  nameMin: 2,
  phone: 30,
  email: 200,
  message: 1000,
  notes: 2000,
} as const;

/** A licence that runs out within this many days is flagged as expiring. */
export const LICENCE_EXPIRING_SOON_DAYS = 14;

/** The page size of the public office page. */
export const PUBLIC_PAGE_SIZE = 12;

/** The most listings the sitemap lists, so a very large office cannot make it huge. */
export const SITEMAP_LISTING_LIMIT = 5000;

export function isListingType(value: unknown): value is ListingType {
  return (LISTING_TYPES as readonly unknown[]).includes(value);
}

export function isPricePeriod(value: unknown): value is PricePeriod {
  return (PRICE_PERIODS as readonly unknown[]).includes(value);
}

export function isListingStatus(value: unknown): value is ListingStatus {
  return (LISTING_STATUSES as readonly unknown[]).includes(value);
}

export function isInquiryStatus(value: unknown): value is InquiryStatus {
  return (INQUIRY_STATUSES as readonly unknown[]).includes(value);
}

/** The periods a price of this type may be quoted in. */
export function periodsFor(type: ListingType): readonly PricePeriod[] {
  return type === "sale" ? ["total"] : RENT_PRICE_PERIODS;
}

/** Whether the price period fits the type: a sale is "total", a rent is not. */
export function periodFitsType(type: ListingType, period: PricePeriod): boolean {
  return periodsFor(type).includes(period);
}

/** The period a price starts with for this type. */
export function defaultPeriodFor(type: ListingType): PricePeriod {
  return type === "sale" ? "total" : DEFAULT_RENT_PERIOD;
}
