/**
 * PropertyPro SaaS - Dates on the blog
 *
 * "3 October 2026" on /blog, "3 أكتوبر 2026" on /ar/blog: the Gregorian
 * calendar and Western digits in both, as the listing pages and the rest of
 * the product print them, on the day it was in Riyadh when the post went out.
 *
 * Pure.
 */

import { BUSINESS_TIME_ZONE } from "@/lib/dates/business-day";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";

const formatters = new Map<MarketingLang, Intl.DateTimeFormat>();

function formatterFor(lang: MarketingLang): Intl.DateTimeFormat {
  let formatter = formatters.get(lang);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(
      lang === "ar" ? "ar-SA-u-nu-latn-ca-gregory" : "en-GB",
      { day: "numeric", month: "long", year: "numeric", timeZone: BUSINESS_TIME_ZONE },
    );
    formatters.set(lang, formatter);
  }
  return formatter;
}

/** A post's date in the page's language, or "" when there is none. */
export function formatPostDate(
  value: Date | string | null | undefined,
  lang: MarketingLang,
): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return formatterFor(lang).format(date);
}
