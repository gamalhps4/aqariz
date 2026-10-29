/**
 * PropertyPro - Which photos a listing shows
 *
 * A listing's own photos win. A listing with none shows its unit's, and a unit
 * with none shows its building's — so an office that has photographed the
 * building once gets an ad with pictures on the first save, and one that later
 * photographs the unit sees the ad pick them up without touching it. A
 * listing for a property not in the system has no unit or building to fall
 * back on, so it shows its own photos or none.
 *
 * What may be *drawn* is narrower than what may be stored. Pictures go through
 * Next's image optimiser, which only fetches from the hosts next.config.ts
 * lists (the office's R2 bucket and the demo image host); any other address
 * would not load — and on a page, an `<Image>` whose host is not listed throws.
 * So an address is stored if it is a web address at all, and drawn only if the
 * optimiser would fetch it. Keep `ALLOWED_PHOTO_HOSTS` in step with the
 * `images.remotePatterns` there.
 */

import { LISTING_LIMITS } from "./constants";

/** Hosts (and one suffix) next.config.ts lets `<Image>` load from. */
export const ALLOWED_PHOTO_HOSTS = ["picsum.photos"] as const;
export const ALLOWED_PHOTO_HOST_SUFFIXES = [".r2.dev"] as const;

/** An address a photo may be stored under: a web address or a site path. */
export function isStorablePhotoUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const url = value.trim();
  if (!url || url.length > LISTING_LIMITS.photoUrl || /\s/.test(url)) {
    return false;
  }
  if (url.startsWith("/")) return !url.startsWith("//");
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Whether the image optimiser would load this address. `r2Url` is the office
 * bucket's public address (`NEXT_PUBLIC_R2_PUBLIC_URL`), the one host that
 * depends on the deployment.
 */
export function isRenderablePhotoUrl(
  value: string,
  r2Url?: string | null,
): boolean {
  if (!isStorablePhotoUrl(value)) return false;
  if (value.startsWith("/")) return true;

  let host: string;
  try {
    host = new URL(value).hostname.toLowerCase();
  } catch {
    return false;
  }
  if ((ALLOWED_PHOTO_HOSTS as readonly string[]).includes(host)) return true;
  if (ALLOWED_PHOTO_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) {
    return true;
  }
  if (r2Url) {
    try {
      return new URL(r2Url).hostname.toLowerCase() === host;
    } catch {
      return false;
    }
  }
  return false;
}

interface WithImages {
  images?: readonly string[] | null;
}

/**
 * The photos a listing shows: its own, else its unit's, else its building's.
 * Order is the order the office put them in; repeats are dropped. A listing
 * with no unit passes neither, and gets its own.
 */
export function effectivePhotos(
  listing: { photos?: readonly string[] | null },
  unit?: WithImages | null,
  property?: WithImages | null,
): string[] {
  const pick = (list?: readonly string[] | null) =>
    [...new Set((list ?? []).filter(isStorablePhotoUrl))];
  const own = pick(listing.photos);
  if (own.length > 0) return own;
  const fromUnit = pick(unit?.images);
  if (fromUnit.length > 0) return fromUnit;
  return pick(property?.images);
}

/** The effective photos the page can actually draw. */
export function renderablePhotos(
  photos: readonly string[],
  r2Url?: string | null,
): string[] {
  return photos.filter((photo) => isRenderablePhotoUrl(photo, r2Url));
}
