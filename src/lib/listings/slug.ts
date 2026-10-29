/**
 * PropertyPro - A listing's address on the office's page
 *
 * /o/{office}/{slug}. The slug is unique inside one office (the database
 * holds it to that), readable when the office wrote an English title, and
 * never empty when it did not: an Arabic-only listing gets `rent-b201`, built
 * from what it is, instead of a string of percent-encoded letters that
 * WhatsApp would show in full.
 *
 * A slug is made once, when the listing is created, and left alone when the
 * title changes — the link an office has already sent to a client must keep
 * working. It can be edited by hand only while the listing is a draft.
 *
 * Pure: the screens and the tests use it as well as the routes.
 */

import { LISTING_LIMITS, type ListingType } from "./constants";
import { toWesternDigits } from "./digits";

/** Lower-case words and digits joined by single dashes. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Words a listing may not be called, because they would read as something
 * else under /o/{office}/ the day the page grows a sibling route of that name.
 */
export const RESERVED_SLUGS: ReadonlySet<string> = new Set([
  "new",
  "edit",
  "all",
  "page",
  "search",
  "api",
  "admin",
  "dashboard",
  "sitemap",
  "robots",
  "o",
  "null",
  "undefined",
]);

/**
 * Letters and digits of the Latin alphabet, joined by dashes. Everything else
 * — Arabic letters, punctuation, emoji — is a separator, so an Arabic title
 * simply contributes nothing and the caller falls back to something it can
 * spell.
 */
export function slugify(text: string | null | undefined): string {
  const slug = toWesternDigits(text ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LISTING_LIMITS.slug);
  return slug.replace(/-+$/g, "");
}

export interface SlugSource {
  titleEn?: string | null;
  /** A listing with no unit: the kind of property (`apartment`, `villa`). */
  propertyType?: string | null;
  propertyName?: string | null;
  unitNumber?: string | null;
  type: ListingType;
}

/**
 * The slug a listing starts from, before it is made unique: the English title
 * when there is one, otherwise what the listing is — its type, its building's
 * Latin letters and its unit number, or for a property not in the system the
 * kind of property (`rent-villa`).
 */
export function slugBase(source: SlugSource): string {
  const fromTitle = slugify(source.titleEn);
  if (fromTitle.length >= LISTING_LIMITS.slugMin && !RESERVED_SLUGS.has(fromTitle)) {
    return fromTitle;
  }

  const composed = slugify(
    [
      source.type,
      slugify(source.propertyType),
      slugify(source.propertyName),
      slugify(source.unitNumber),
    ]
      .filter(Boolean)
      .join("-"),
  );
  if (composed.length >= LISTING_LIMITS.slugMin && !RESERVED_SLUGS.has(composed)) {
    return composed;
  }
  return `${source.type}-listing`;
}

/** Whether this is a slug a listing may have. */
export function isValidSlug(slug: string): boolean {
  return (
    slug.length >= LISTING_LIMITS.slugMin &&
    slug.length <= LISTING_LIMITS.slug &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug)
  );
}

/** A short random token, for the last resort and for a collision lost to a race. */
export function randomToken(length = 5): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function withSuffix(base: string, suffix: string): string {
  const room = LISTING_LIMITS.slug - suffix.length - 1;
  return `${base.slice(0, room).replace(/-+$/g, "")}-${suffix}`;
}

/**
 * The slug for a listing: the base if the office has not used it, otherwise
 * the base with `-2`, `-3`… and, past ninety-nine, a random token.
 *
 * `taken` is every slug of this office that starts with the base — one read,
 * not one per attempt. Two requests can still pick the same one at the same
 * moment; the database's unique index settles that, and the writer retries
 * with `randomToken`.
 */
export function pickSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  for (let attempt = 2; attempt < 100; attempt += 1) {
    const candidate = withSuffix(base, String(attempt));
    if (!taken.has(candidate)) return candidate;
  }
  return withSuffix(base, randomToken());
}

/** The same base with a random token — the retry after a lost race. */
export function randomizedSlug(base: string): string {
  return withSuffix(base, randomToken());
}
