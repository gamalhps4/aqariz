/**
 * PropertyPro SaaS - Where the blog's pages are
 *
 *   /blog                 newest English posts      /ar/blog                Arabic
 *   /blog/page/2          the next nine             /ar/blog/page/2
 *   /blog/<slug>          one post in English       /ar/blog/<slug>         in Arabic
 *
 * Pages are path segments rather than `?page=2`: the marketing tree is
 * `force-static`, which hands every page an empty query string, so a query
 * parameter could not select a page without making the whole blog render per
 * request. A segment is prerendered and revalidated like any other path.
 *
 * Pure (the header's language switch runs it in the browser).
 */

import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { BLOG_SLUG_MAX_LENGTH, BLOG_SLUG_PATTERN } from "./slug";

/** Posts per index page: three rows of three on a wide screen. */
export const BLOG_PAGE_SIZE = 9;

function blogRoot(lang: MarketingLang): string {
  return lang === "ar" ? "/ar/blog" : "/blog";
}

/** The index in `lang`; its `page`th page when that is past the first. */
export function blogIndexPath(lang: MarketingLang, page = 1): string {
  return page > 1 ? `${blogRoot(lang)}/page/${page}` : blogRoot(lang);
}

/** One post in `lang`. */
export function blogPostPath(slug: string, lang: MarketingLang): string {
  return `${blogRoot(lang)}/${slug}`;
}

/** How many index pages `total` posts fill (at least one, the empty blog). */
export function blogPageCount(total: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / BLOG_PAGE_SIZE));
}

/**
 * The page number a `/blog/page/<n>` segment names: a whole number from 2
 * written without leading zeros. "1" is the index itself and anything else
 * is not a page — null either way, so each page has exactly one address.
 */
export function parseBlogPageParam(value: string | undefined): number | null {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return null;
  const page = Number(value);
  return page >= 2 ? page : null;
}

/** Whether a `[slug]` segment could name a post at all — checked before any
 * database read, so a malformed address is a 404 without one. */
export function isBlogSlugParam(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length <= BLOG_SLUG_MAX_LENGTH &&
    BLOG_SLUG_PATTERN.test(value)
  );
}

export type BlogRoute =
  | { kind: "index"; lang: MarketingLang }
  | { kind: "page"; lang: MarketingLang; page: number }
  | { kind: "post"; lang: MarketingLang; slug: string };

/** Which blog page `pathname` is, or null when it is not one. */
export function parseBlogPath(pathname: string | null | undefined): BlogRoute | null {
  const path = (pathname || "").split(/[?#]/)[0].replace(/\/+$/, "");
  const match = /^(\/ar)?\/blog(?:\/(.*))?$/.exec(path);
  if (!match) return null;
  const lang: MarketingLang = match[1] ? "ar" : "en";
  const rest = match[2];
  if (rest === undefined || rest === "") return { kind: "index", lang };
  const page = /^page\/([^/]+)$/.exec(rest);
  if (page) {
    const number = parseBlogPageParam(page[1]);
    return number ? { kind: "page", lang, page: number } : { kind: "index", lang };
  }
  if (!rest.includes("/") && isBlogSlugParam(rest)) return { kind: "post", lang, slug: rest };
  return { kind: "index", lang };
}
