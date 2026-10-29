/**
 * PropertyPro - Regional profile
 *
 * The product serves one market at a time. Everything that differs between
 * markets — the country a new address is assumed to be in, the currency money
 * is recorded in, the language the dashboard opens in, which subdivisions an
 * address actually has — is named here once.
 *
 * This exists so that adding a second market later is *a second profile*
 * rather than a hunt through the codebase for every hardcoded "Saudi Arabia".
 * The previous defaults were US ones scattered across a Zod schema, a form's
 * `defaultValues`, seven Prisma columns and a settings row, with nothing
 * tying them together; the first non-US customer found each one the hard way.
 *
 * WHAT THIS IS NOT: a per-organization setting. An organization already
 * chooses its own currency, timezone and language through DisplaySettings,
 * and those choices win at runtime. This profile only answers "what should a
 * record that was never told look like" — the deployment's default, not a
 * tenant's preference.
 *
 * The currency and locale codes here are keys into `CURRENCIES` and `LOCALES`
 * in `services/localization.service.ts`; symbol, decimals and separators live
 * there and are not repeated here.
 *
 * KEPT IN SYNC BY HAND with the column defaults in `prisma/schema.prisma`
 * (see migration `20260920100000_saudi_regional_defaults`). Prisma's schema
 * cannot import TypeScript, so the database carries its own copy of the same
 * two values — `country` and `currency`. Changing one means changing both.
 */

export interface RegionAddressShape {
  /**
   * Whether addresses in this market are subdivided into districts — حي in
   * Saudi Arabia, where a district is how an address is actually found and is
   * more useful than the postal code. Stored in `Property.addressDistrict`.
   */
  district: boolean;
  /**
   * Whether the market has a state/province/region tier above the city.
   * Stored in `Property.addressState` whatever it is called locally.
   */
  region: boolean;
  postalCode: boolean;
}

export interface RegionProfile {
  /** ISO 3166-1 alpha-2. */
  code: string;
  /** The country name written into new address records. */
  countryName: string;
  countryNameLocal: string;
  /** ISO 4217 — a key into CURRENCIES. */
  currency: string;
  /** A key into LOCALES. */
  locale: string;
  /** The `language` DisplaySettings opens with. */
  language: string;
  rtl: boolean;
  /** IANA zone. */
  timezone: string;
  dateFormat: string;
  timeFormat: "12h" | "24h";
  address: RegionAddressShape;
  /**
   * VAT charged on the management fee, as a percentage.
   *
   * A statutory rate, not an office preference, which is why it sits in the
   * market profile beside the currency. It is charged on the *commission* —
   * the office's own service — and is unrelated to `Lease.taxRate`, which is
   * VAT on the rent and is agreed contract by contract.
   *
   * The owner statement shows it as a line of its own because the Wazi
   * statement the client reconciles against does: commission and the tax on
   * it are two amounts the owner is asked to approve separately. An office
   * that is not VAT-registered sets this to 0.
   */
  commissionTaxRate: number;
}

export const SAUDI_ARABIA: RegionProfile = {
  code: "SA",
  countryName: "Saudi Arabia",
  countryNameLocal: "المملكة العربية السعودية",
  currency: "SAR",
  locale: "ar-SA",
  language: "ar",
  rtl: true,
  timezone: "Asia/Riyadh",
  // Day-first, which is what every Saudi contract and statement prints.
  dateFormat: "DD/MM/YYYY",
  timeFormat: "12h",
  address: {
    district: true,
    region: true,
    postalCode: true,
  },
  // Saudi VAT has been 15% since July 2020.
  commissionTaxRate: 15,
};

/**
 * The market this deployment ships for.
 *
 * A constant rather than an environment variable on purpose: the schema
 * defaults, the seeded settings and the report layouts are all built for this
 * one market, so a runtime switch would promise a portability that does not
 * exist yet. When a second market is real, this becomes a lookup and the
 * promise becomes true.
 */
export const ACTIVE_REGION: RegionProfile = SAUDI_ARABIA;

export const DEFAULT_COUNTRY = ACTIVE_REGION.countryName;
export const DEFAULT_CURRENCY = ACTIVE_REGION.currency;

/**
 * The one currency the product works in: Saudi riyal. The client asked for
 * SAR "strictly … across the entire platform and website", so this is not a
 * default an office, a stored row, a cookie or an environment variable can
 * override — every place that decides a currency (display, PDFs, messages,
 * subscription prices and what Stripe charges) reads it from here.
 */
export const APP_CURRENCY = ACTIVE_REGION.currency;
export const DEFAULT_TIMEZONE = ACTIVE_REGION.timezone;
export const DEFAULT_LANGUAGE = ACTIVE_REGION.language;
export const DEFAULT_DATE_FORMAT = ACTIVE_REGION.dateFormat;

/** Whether the address form should offer a district field in this market. */
export const HAS_DISTRICT = ACTIVE_REGION.address.district;

/** VAT on the management fee, as a percentage. See `commissionTaxRate`. */
export const COMMISSION_TAX_RATE = ACTIVE_REGION.commissionTaxRate;

/**
 * A stored country, in the reader's language.
 *
 * New addresses store the English name (`DEFAULT_COUNTRY`), so an Arabic
 * reader saw "Saudi Arabia" in every Arabic address. The active region's name
 * and any two-letter code are named by the browser's own tables; anything
 * else is shown as it was typed.
 */
export function displayCountry(
  country: string | null | undefined,
  language: string,
): string {
  const stored = (country ?? "").trim();
  if (!stored) return "";
  const code =
    stored.toLowerCase() === ACTIVE_REGION.countryName.toLowerCase()
      ? ACTIVE_REGION.code
      : /^[A-Za-z]{2}$/.test(stored)
        ? stored.toUpperCase()
        : null;
  if (!code) return stored;
  try {
    return new Intl.DisplayNames([language], { type: "region" }).of(code) ?? stored;
  } catch {
    return stored;
  }
}
