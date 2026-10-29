/**
 * PropertyPro SaaS - Reading the blog for the public pages
 *
 * Every read here is of published posts in one language, run without the
 * platform bypass: under the table's RLS (migration 20261017130000_blog_posts)
 * an anonymous read sees published posts and nothing else, so a mistake here
 * could not show a draft even if the filters below were wrong.
 *
 * A language counts when its title and content are both filled
 * (`languages.ts`); the API stores them trimmed, so "not empty" is the test.
 */

import "server-only";

import { cache } from "react";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import type { MarketingLang } from "@/lib/marketing/landing-i18n";
import { BLOG_PAGE_SIZE, blogPageCount } from "./paths";

/** Published, and readable in `lang`. */
export function publishedIn(lang: MarketingLang): Prisma.BlogPostWhereInput {
  return lang === "ar"
    ? { status: "published", titleAr: { not: "" }, contentAr: { not: "" } }
    : { status: "published", titleEn: { not: "" }, contentEn: { not: "" } };
}

/**
 * Whether `error` says the blog table is not there yet — the deploy is ahead
 * of migration 20261017130000_blog_posts. The pages then show an empty blog
 * and the console says what is missing, instead of either failing.
 */
export function isBlogTableMissing(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2021" || error.code === "P2022";
  }
  return /blog_posts.*does not exist/i.test(String((error as Error)?.message ?? ""));
}

const CARD_SELECT = {
  id: true,
  slug: true,
  titleEn: true,
  titleAr: true,
  excerptEn: true,
  excerptAr: true,
  coverImage: true,
  coverImageAlt: true,
  coverImageAltAr: true,
  tags: true,
  publishedAt: true,
  updatedAt: true,
} satisfies Prisma.BlogPostSelect;

export type BlogCardRow = Prisma.BlogPostGetPayload<{ select: typeof CARD_SELECT }>;

/**
 * One page of the index in `lang`, newest first. A database that cannot be
 * read gives an empty page rather than an error: the index is prerendered,
 * and a build or a revalidation without the database (or before the
 * migration) must still produce a page. Revalidation heals it.
 */
export async function listPublishedPosts(
  lang: MarketingLang,
  page: number,
): Promise<{ posts: BlogCardRow[]; total: number; pageCount: number }> {
  try {
    const where = publishedIn(lang);
    const [total, posts] = await Promise.all([
      db.blogPost.count({ where }),
      db.blogPost.findMany({
        where,
        select: CARD_SELECT,
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * BLOG_PAGE_SIZE,
        take: BLOG_PAGE_SIZE,
      }),
    ]);
    return { posts, total, pageCount: blogPageCount(total) };
  } catch (error) {
    console.error("blog: could not read the published posts", error);
    return { posts: [], total: 0, pageCount: 1 };
  }
}

/**
 * The published post at `slug`, when it can be read in `lang`; null
 * otherwise (a draft, a missing post, or a post only in the other
 * language). Memoised per render so the page and its metadata share a read.
 */
export const getPublishedPost = cache(async (slug: string, lang: MarketingLang) => {
  const post = await db.blogPost.findFirst({
    where: { slug, ...publishedIn(lang) },
  });
  return post;
});

/** Slugs to prerender at build time; none when the database is unreachable
 * (each post then renders on its first visit). */
export async function publishedSlugs(lang: MarketingLang): Promise<string[]> {
  try {
    const rows = await db.blogPost.findMany({
      where: publishedIn(lang),
      select: { slug: true },
      orderBy: { publishedAt: "desc" },
    });
    return rows.map((row) => row.slug);
  } catch (error) {
    console.error("blog: could not list the slugs to prerender", error);
    return [];
  }
}

/** How many index pages `lang` has; one when that cannot be read. */
export async function publishedPageCount(lang: MarketingLang): Promise<number> {
  try {
    return blogPageCount(await db.blogPost.count({ where: publishedIn(lang) }));
  } catch {
    return 1;
  }
}

// ---------------------------------------------------------------------------
// Posts in both languages, for the header's language switch
// ---------------------------------------------------------------------------

/**
 * Slugs of the published posts that have both languages. The header is
 * drawn on every public page and cannot know which page it is on, so it is
 * handed this list and the switch on a post picks the twin when there is one
 * (`alternateLanguagePath`). Never an error — the worst case is a switch to
 * the other blog's index.
 *
 * Read once per render (React `cache`), never kept in a module variable: the
 * console's API routes and the pages run in separate module instances, so a
 * cache here could not be emptied by a publish, and a post page regenerated
 * just after one would keep a stale switch until its next revalidation. The
 * read is one small indexed query: the marketing pages are prerendered, so
 * it runs when one is regenerated; the sign-in screens, drawn per request,
 * pay it on each view, alongside the header's other reads.
 */
export const bilingualPostSlugs = cache(async (): Promise<string[]> => {
  try {
    const rows = await db.blogPost.findMany({
      where: { AND: [publishedIn("en"), publishedIn("ar")] },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  } catch (error) {
    if (!isBlogTableMissing(error)) {
      console.error("blog: could not read the bilingual posts", error);
    }
    return [];
  }
});

// ---------------------------------------------------------------------------
// The sitemap
// ---------------------------------------------------------------------------

export interface BlogSitemapEntry {
  slug: string;
  updatedAt: Date;
  langs: MarketingLang[];
}

/** Every published post with the languages it is in. Throws on a database
 * error; the sitemap catches it. */
export async function blogSitemapEntries(): Promise<BlogSitemapEntry[]> {
  const select = { slug: true, updatedAt: true } as const;
  const [english, arabic] = await Promise.all([
    db.blogPost.findMany({ where: publishedIn("en"), select, orderBy: { publishedAt: "desc" } }),
    db.blogPost.findMany({ where: publishedIn("ar"), select, orderBy: { publishedAt: "desc" } }),
  ]);
  const entries = new Map<string, BlogSitemapEntry>();
  for (const [lang, rows] of [
    ["en", english],
    ["ar", arabic],
  ] as const) {
    for (const row of rows) {
      const entry = entries.get(row.slug) ?? { slug: row.slug, updatedAt: row.updatedAt, langs: [] };
      entry.langs.push(lang);
      entries.set(row.slug, entry);
    }
  }
  return [...entries.values()];
}
