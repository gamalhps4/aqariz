/**
 * PropertyPro SaaS - The console's list of blog posts
 *
 * How /api/admin/blog reads its query (search, status, page, sort) and orders
 * the rows. Sorting happens here rather than in SQL because a post's title is
 * whichever language it has — English, else Arabic — and the database cannot
 * order by that without raw SQL. A blog is a few hundred posts at the most,
 * read without their content, so ordering them in memory is cheap.
 *
 * Pure.
 */

import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { displayTitle, languageState, type BlogStatus } from "./languages";

export const BLOG_LIST_SORT_KEYS = ["title", "status", "published", "updated"] as const;
export type BlogListSortKey = (typeof BLOG_LIST_SORT_KEYS)[number];

export const BLOG_LIST_PAGE_SIZES = [10, 25, 50] as const;

export interface BlogListQuery {
  search: string;
  status: BlogStatus | "all";
  page: number;
  pageSize: number;
  sort: BlogListSortKey;
  direction: "asc" | "desc";
}

/** The query a request asks for, every value checked and defaulted. */
export function parseBlogListQuery(params: URLSearchParams): BlogListQuery {
  const status = params.get("status");
  const sort = params.get("sort");
  const direction = params.get("direction");
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const pageSize = Number.parseInt(params.get("pageSize") ?? "", 10);
  return {
    search: (params.get("search") ?? "").trim().slice(0, 100),
    status: status === "draft" || status === "published" ? status : "all",
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 10_000) : 1,
    pageSize: (BLOG_LIST_PAGE_SIZES as readonly number[]).includes(pageSize) ? pageSize : 25,
    sort: (BLOG_LIST_SORT_KEYS as readonly string[]).includes(sort ?? "")
      ? (sort as BlogListSortKey)
      : "updated",
    direction: direction === "asc" ? "asc" : direction === "desc" ? "desc" : sort ? "asc" : "desc",
  };
}

/** A row as the list shows it. */
export interface BlogListRow {
  id: string;
  slug: string;
  status: BlogStatus;
  titleEn: string;
  titleAr: string;
  publishedAt: Date | string | null;
  updatedAt: Date | string;
  tags: string[];
  /** Per language: on the site, half-written, or absent. */
  languages: Record<MarketingLang, "complete" | "partial" | "empty">;
}

/** The languages of a row whose content was not read: whether it has
 * content in each language comes from `withContent`. */
export function rowLanguages(
  row: { id: string; titleEn: string; titleAr: string },
  withContent: { en: ReadonlySet<string>; ar: ReadonlySet<string> },
): BlogListRow["languages"] {
  const post = {
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    contentEn: withContent.en.has(row.id) ? "x" : "",
    contentAr: withContent.ar.has(row.id) ? "x" : "",
  };
  return { en: languageState(post, "en"), ar: languageState(post, "ar") };
}

const collator = new Intl.Collator(["en", "ar"], { numeric: true, sensitivity: "base" });

function time(value: Date | string | null): number | null {
  if (value === null) return null;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * `rows` in the asked order. Ties fall back to the most recently updated
 * first, so the order is stable from one request to the next; posts never
 * published sort after published ones whichever way the date column goes.
 */
export function sortBlogRows<T extends BlogListRow>(
  rows: readonly T[],
  sort: BlogListSortKey,
  direction: "asc" | "desc",
): T[] {
  const sign = direction === "asc" ? 1 : -1;
  const byUpdated = (a: T, b: T) => (time(b.updatedAt) ?? 0) - (time(a.updatedAt) ?? 0);
  const compare = (a: T, b: T): number => {
    switch (sort) {
      case "title":
        return sign * collator.compare(displayTitle(a).title, displayTitle(b).title);
      case "status":
        return sign * a.status.localeCompare(b.status);
      case "published": {
        const left = time(a.publishedAt);
        const right = time(b.publishedAt);
        if (left === null || right === null) {
          return left === right ? 0 : left === null ? 1 : -1;
        }
        return sign * (left - right);
      }
      case "updated":
      default:
        return sign * ((time(a.updatedAt) ?? 0) - (time(b.updatedAt) ?? 0));
    }
  };
  return [...rows].sort((a, b) => compare(a, b) || byUpdated(a, b) || a.id.localeCompare(b.id));
}
