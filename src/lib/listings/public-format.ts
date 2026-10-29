/**
 * PropertyPro - Numbers, dates and words on the public pages
 *
 * Drawn on the server for a stranger, in Arabic or English. Digits are always
 * Western (1,234): that is how Saudi advertisements and the rest of this
 * product print them, and it keeps a price and a phone number one shape in
 * both languages.
 *
 * Pure: a language and a value in, a string out.
 */

import { LISTING_LIMITS, type ListingType, type PricePeriod } from "./constants";
import { dayOf } from "./dates";
import type { PublicLang } from "./public-text";
import { publicText } from "./public-text";
import type { PublicListingView } from "./public-types";

/** The currency as a reader of that language writes it. */
function currencyName(lang: PublicLang, currency: string): string {
  if (currency === "SAR") return lang === "ar" ? "ر.س" : "SAR";
  return currency;
}

/** "5,000 ر.س" / "SAR 5,000" — whole riyals unless there are halalas. */
export function formatPrice(
  amount: number,
  currency: string,
  lang: PublicLang,
): string {
  const whole = Number.isInteger(amount);
  const number = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  const unit = currencyName(lang, currency);
  return lang === "ar" ? `${number} ${unit}` : `${unit} ${number}`;
}

/** "/ شهريًا" or "per month"; nothing for a sale. */
export function formatPeriod(period: PricePeriod, lang: PublicLang): string {
  return period === "total" ? "" : publicText(lang, `marketing.period.per.${period}`);
}

/** The price and what it is per, as one line. */
export function priceLine(
  view: Pick<PublicListingView, "price" | "currency" | "pricePeriod">,
  lang: PublicLang,
): string {
  return [formatPrice(view.price, view.currency, lang), formatPeriod(view.pricePeriod, lang)]
    .filter(Boolean)
    .join(" ");
}

export function formatArea(area: number, lang: PublicLang): string {
  const number = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(area);
  return lang === "ar" ? `${number} م²` : `${number} m²`;
}

/** A `YYYY-MM-DD` day as "3 October 2026" / "٣ أكتوبر ٢٠٢٦" with Western digits. */
export function formatDay(day: string | null, lang: PublicLang): string {
  const parsed = dayOf(day);
  if (!parsed) return "";
  const date = new Date(`${parsed}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(
    lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB",
    { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" },
  ).format(date);
}

/** Text in the reader's language, falling back to the other one. */
export function pick(
  lang: PublicLang,
  arabic: string | null | undefined,
  english: string | null | undefined,
): string {
  const first = lang === "ar" ? arabic : english;
  const second = lang === "ar" ? english : arabic;
  return (first?.trim() || second?.trim() || "").trim();
}

export function titleOf(
  view: Pick<PublicListingView, "titleAr" | "titleEn" | "type">,
  lang: PublicLang,
): string {
  return (
    pick(lang, view.titleAr, view.titleEn) ||
    publicText(lang, `marketing.public.defaultTitle.${view.type}`)
  );
}

/** The unit type in the reader's language: the office's own name for it, or ours. */
export function unitTypeName(
  facts: PublicListingView["facts"],
  lang: PublicLang,
): string {
  const own = pick(lang, facts.unitTypeLabel.ar, facts.unitTypeLabel.en);
  if (own) return own;
  const key = `marketing.unitType.${facts.unitType}`;
  const known = publicText(lang, key);
  return known === key ? facts.unitType : known;
}

/** "Riyadh · Al Olaya" — the district first, as an address is found. */
export function locationLine(
  view: Pick<PublicListingView, "city" | "district">,
): string {
  return [view.district, view.city].filter(Boolean).join(" · ");
}

/** A page description of at most 160 characters, ending at a word. */
export function metaDescription(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The type of offer as a short label. */
export function offerLabel(type: ListingType, lang: PublicLang): string {
  return publicText(lang, `marketing.public.offer.${type}`);
}

/** The most amenities the page prints. */
export const PUBLIC_AMENITY_LIMIT = LISTING_LIMITS.amenities;

/** JSON for a `<script type="application/ld+json">`, safe to put in HTML. */
export function jsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}
