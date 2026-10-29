/**
 * PropertyPro SaaS - The console's blog reads and the write rules around them
 *
 * Used by the /api/admin/blog routes, which run as a platform admin (the RLS
 * bypass is on, so drafts are visible). The rules a write must pass are in
 * `validation.ts`; this holds what needs the database: the list, the slug
 * clash check, and what an audit entry says changed.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { Prisma, type BlogPost } from "@/generated/prisma/client";
import { postLanguages } from "./languages";
import {
  parseBlogListQuery,
  rowLanguages,
  sortBlogRows,
  type BlogListRow,
} from "./admin-list";
import type { BlogPostDraft } from "./validation";

/** What the console answers before migration 20261017130000_blog_posts runs. */
export const BLOG_TABLE_MISSING_MESSAGE =
  "The blog needs a database update that has not been applied yet (migration 20261017130000_blog_posts).";

/** Read without content: the list never shows it. */
const LIST_SELECT = {
  id: true,
  slug: true,
  status: true,
  titleEn: true,
  titleAr: true,
  publishedAt: true,
  updatedAt: true,
  tags: true,
} satisfies Prisma.BlogPostSelect;

/** At most this many posts are ordered in memory per request. */
const LIST_CAP = 5_000;

export async function listBlogPostsForConsole(params: URLSearchParams) {
  const query = parseBlogListQuery(params);
  const contains = { contains: query.search, mode: "insensitive" as const };
  const where: Prisma.BlogPostWhereInput = {
    ...(query.status !== "all" ? { status: query.status } : {}),
    ...(query.search
      ? {
          OR: [
            { titleEn: contains },
            { titleAr: contains },
            { slug: contains },
            { excerptEn: contains },
            { excerptAr: contains },
            { authorName: contains },
            { tags: { has: query.search } },
          ],
        }
      : {}),
  };

  // Whether each post has content in each language, without reading it.
  const [rows, english, arabic] = await Promise.all([
    db.blogPost.findMany({ where, select: LIST_SELECT, take: LIST_CAP }),
    db.blogPost.findMany({
      where: { AND: [where, { contentEn: { not: "" } }] },
      select: { id: true },
      take: LIST_CAP,
    }),
    db.blogPost.findMany({
      where: { AND: [where, { contentAr: { not: "" } }] },
      select: { id: true },
      take: LIST_CAP,
    }),
  ]);
  const withContent = {
    en: new Set(english.map((row) => row.id)),
    ar: new Set(arabic.map((row) => row.id)),
  };

  const listed: BlogListRow[] = rows.map((row) => ({
    ...row,
    status: row.status === "published" ? "published" : "draft",
    languages: rowLanguages(row, withContent),
  }));
  const sorted = sortBlogRows(listed, query.sort, query.direction);
  const start = (query.page - 1) * query.pageSize;
  return {
    posts: sorted.slice(start, start + query.pageSize),
    total: sorted.length,
    page: query.page,
    pageSize: query.pageSize,
  };
}

/** A stored row as the validation module's shape. */
export function draftOf(row: BlogPost): BlogPostDraft {
  return {
    slug: row.slug,
    status: row.status === "published" ? "published" : "draft",
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    excerptEn: row.excerptEn,
    excerptAr: row.excerptAr,
    contentEn: row.contentEn,
    contentAr: row.contentAr,
    seoTitleEn: row.seoTitleEn,
    seoTitleAr: row.seoTitleAr,
    seoDescriptionEn: row.seoDescriptionEn,
    seoDescriptionAr: row.seoDescriptionAr,
    coverImage: row.coverImage,
    coverImageAlt: row.coverImageAlt,
    coverImageAltAr: row.coverImageAltAr,
    authorName: row.authorName,
    tags: row.tags,
  };
}

/** A full post for the editor, with the languages it can be read in. */
export function consolePost(row: BlogPost) {
  return { ...row, languages: postLanguages(row) };
}

/** Whether another post already has `slug`. */
export async function slugTaken(slug: string, exceptId?: string): Promise<boolean> {
  const found = await db.blogPost.findFirst({
    where: { slug, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { id: true },
  });
  return Boolean(found);
}

/** Every slug that starts like `slug` — for making a generated one unique. */
export async function slugsLike(slug: string): Promise<Set<string>> {
  const rows = await db.blogPost.findMany({
    where: { slug: { startsWith: slug } },
    select: { slug: true },
  });
  return new Set(rows.map((row) => row.slug));
}

/** The answer to a slug that is taken. */
export function slugClashMessage(slug: string): string {
  return `Another post already uses the address /blog/${slug}. Choose a different slug.`;
}

/** Whether `error` is the unique slug index refusing a write (a race the
 * check before it lost). */
export function isSlugClash(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/** The fields an edit changed — named in the audit entry, never their text. */
export function changedFields(before: BlogPostDraft, after: BlogPostDraft): string[] {
  return (Object.keys(after) as Array<keyof BlogPostDraft>).filter(
    (key) => key !== "status" && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
}

/** What the audit entry calls a post: its title in either language. */
export function auditName(post: Pick<BlogPostDraft, "titleEn" | "titleAr" | "slug">): string {
  return post.titleEn || post.titleAr || post.slug;
}
