/**
 * PropertyPro - Where a listing lives
 *
 * The public pages are on the product's own domain, under /o/ ("office"):
 *
 *   /o/{office slug}                 the office's listings
 *   /o/{office slug}/{listing slug}  one listing
 *
 * The slug is the organization's own (unique across the platform), so no
 * separate "public name" has to be kept in step with it.
 */

export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.BETTER_AUTH_URL ||
    "http://localhost:3000"
  ).replace(/\/$/, "");
}

export function officePath(organizationSlug: string): string {
  return `/o/${organizationSlug}`;
}

export function listingPath(organizationSlug: string, listingSlug: string): string {
  return `/o/${organizationSlug}/${listingSlug}`;
}

/** A path on this deployment as an absolute address — for metadata and the sitemap. */
export function absoluteUrl(path: string): string {
  return `${appBaseUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/** The organization slug a URL carries, if it is shaped like one. */
export function isOrganizationSlug(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(value) && value.length <= 63;
}
