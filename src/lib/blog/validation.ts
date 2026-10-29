/**
 * PropertyPro SaaS - What a blog post may hold
 *
 * The console's API checks every write here: field lengths, tag counts, the
 * slug's shape, the language rules (`languages.ts`) and where images are
 * hosted. The limits are generous for writing and small enough that one post
 * cannot become a problem for the page that draws it.
 *
 * Images — the cover and any in the content — must be on this site or on the
 * storage the console uploads to. The site's Content-Security-Policy
 * (next.config.ts, img-src) blocks every other host, so an image from
 * elsewhere would publish as a broken picture; refusing it at save time says
 * so while the operator can still do something about it.
 *
 * Pure: the hosts are passed in (`image-hosts.ts` reads them on the server).
 */

import { z } from "zod";
import { BLOG_STATUSES, canPublish, hasAnyTitle, type BlogStatus } from "./languages";
import { imageSources, parseMarkdown, safeImageUrl } from "./markdown";
import { BLOG_SLUG_MAX_LENGTH, BLOG_SLUG_PATTERN, RESERVED_BLOG_SLUGS } from "./slug";

export const BLOG_LIMITS = {
  title: 160,
  excerpt: 400,
  content: 100_000,
  seoTitle: 120,
  seoDescription: 320,
  coverImage: 2048,
  coverImageAlt: 200,
  authorName: 100,
  tags: 10,
  tag: 40,
  /** Raw tags accepted before de-duplication trims them to `tags`. */
  rawTags: 50,
} as const;

const text = (max: number, label: string) =>
  z
    .string({ invalid_type_error: `${label} must be text` })
    .trim()
    .max(max, `${label} must be ${max.toLocaleString("en-US")} characters or fewer`);

/** Every field the console edits. All optional here; `create` fills defaults. */
const fieldShape = {
  slug: z
    .string({ invalid_type_error: "Slug must be text" })
    .trim()
    .toLowerCase()
    .max(BLOG_SLUG_MAX_LENGTH, `Slug must be ${BLOG_SLUG_MAX_LENGTH} characters or fewer`),
  titleEn: text(BLOG_LIMITS.title, "English title"),
  titleAr: text(BLOG_LIMITS.title, "Arabic title"),
  excerptEn: text(BLOG_LIMITS.excerpt, "English excerpt"),
  excerptAr: text(BLOG_LIMITS.excerpt, "Arabic excerpt"),
  contentEn: text(BLOG_LIMITS.content, "English content"),
  contentAr: text(BLOG_LIMITS.content, "Arabic content"),
  seoTitleEn: text(BLOG_LIMITS.seoTitle, "English search title").nullable(),
  seoTitleAr: text(BLOG_LIMITS.seoTitle, "Arabic search title").nullable(),
  seoDescriptionEn: text(BLOG_LIMITS.seoDescription, "English search description").nullable(),
  seoDescriptionAr: text(BLOG_LIMITS.seoDescription, "Arabic search description").nullable(),
  coverImage: text(BLOG_LIMITS.coverImage, "Cover image address").nullable(),
  coverImageAlt: text(BLOG_LIMITS.coverImageAlt, "English cover description").nullable(),
  coverImageAltAr: text(BLOG_LIMITS.coverImageAlt, "Arabic cover description").nullable(),
  authorName: text(BLOG_LIMITS.authorName, "Author").nullable(),
  tags: z
    .array(z.string({ invalid_type_error: "Tags must be text" }), {
      invalid_type_error: "Tags must be a list",
    })
    .max(BLOG_LIMITS.rawTags, `A post can have at most ${BLOG_LIMITS.tags} tags`),
  status: z.enum(BLOG_STATUSES, {
    errorMap: () => ({ message: "Status must be draft or published" }),
  }),
};

/** A PATCH: any subset of the fields. Unknown keys are dropped. */
export const blogPostPatchSchema = z.object(fieldShape).partial();

/** A POST: the same fields, every one optional, defaults filled in. */
export const blogPostCreateSchema = blogPostPatchSchema;

export type BlogPostPatch = z.infer<typeof blogPostPatchSchema>;

/** A post as stored, the shape the checks below work on. */
export interface BlogPostDraft {
  slug: string;
  status: BlogStatus;
  titleEn: string;
  titleAr: string;
  excerptEn: string;
  excerptAr: string;
  contentEn: string;
  contentAr: string;
  seoTitleEn: string | null;
  seoTitleAr: string | null;
  seoDescriptionEn: string | null;
  seoDescriptionAr: string | null;
  coverImage: string | null;
  coverImageAlt: string | null;
  coverImageAltAr: string | null;
  authorName: string | null;
  tags: string[];
}

export const EMPTY_BLOG_POST: BlogPostDraft = {
  slug: "",
  status: "draft",
  titleEn: "",
  titleAr: "",
  excerptEn: "",
  excerptAr: "",
  contentEn: "",
  contentAr: "",
  seoTitleEn: null,
  seoTitleAr: null,
  seoDescriptionEn: null,
  seoDescriptionAr: null,
  coverImage: null,
  coverImageAlt: null,
  coverImageAltAr: null,
  authorName: null,
  tags: [],
};

/**
 * Tags as stored: whitespace collapsed, empty ones and repeats (ignoring
 * case) dropped, the first spelling kept, in the order given.
 */
export function normalizeTags(tags: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of tags) {
    const tag = String(raw ?? "").replace(/\s+/g, " ").trim();
    if (!tag) continue;
    const key = tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
  }
  return result;
}

/** "" and whitespace are "not set" for the optional fields. */
function nullIfBlank(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed === "" ? null : trimmed;
}

/** `patch` applied over `base`, normalised as it will be stored. */
export function mergeBlogPost(base: BlogPostDraft, patch: BlogPostPatch): BlogPostDraft {
  const pick = <K extends keyof BlogPostDraft>(key: K): BlogPostDraft[K] =>
    (patch[key as keyof BlogPostPatch] !== undefined
      ? patch[key as keyof BlogPostPatch]
      : base[key]) as BlogPostDraft[K];
  return {
    slug: (pick("slug") ?? "").trim().toLowerCase(),
    status: pick("status"),
    titleEn: (pick("titleEn") ?? "").trim(),
    titleAr: (pick("titleAr") ?? "").trim(),
    excerptEn: (pick("excerptEn") ?? "").trim(),
    excerptAr: (pick("excerptAr") ?? "").trim(),
    contentEn: (pick("contentEn") ?? "").trim(),
    contentAr: (pick("contentAr") ?? "").trim(),
    seoTitleEn: nullIfBlank(pick("seoTitleEn")),
    seoTitleAr: nullIfBlank(pick("seoTitleAr")),
    seoDescriptionEn: nullIfBlank(pick("seoDescriptionEn")),
    seoDescriptionAr: nullIfBlank(pick("seoDescriptionAr")),
    coverImage: nullIfBlank(pick("coverImage")),
    coverImageAlt: nullIfBlank(pick("coverImageAlt")),
    coverImageAltAr: nullIfBlank(pick("coverImageAltAr")),
    authorName: nullIfBlank(pick("authorName")),
    tags: normalizeTags(pick("tags") ?? []),
  };
}

/**
 * Whether an image address is one the site will show: a path on this site, or
 * https on one of `hosts` ("cdn.example.com", or "*.r2.dev" for any
 * subdomain).
 */
export function isAllowedImageUrl(url: string, hosts: readonly string[]): boolean {
  const safe = safeImageUrl(url);
  if (!safe) return false;
  if (safe.startsWith("/")) return true;
  let host: string;
  try {
    host = new URL(safe).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hosts.some((allowed) => {
    const pattern = allowed.toLowerCase();
    return pattern.startsWith("*.")
      ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
      : host === pattern;
  });
}

/** Why the image hosts are limited, said once for every message below. */
const IMAGE_HOST_HINT =
  "Upload it in the editor, or use an address on this site — images from other sites are blocked by the site's security policy.";

/**
 * The first reason `post` cannot be stored as it is, or null. Field lengths
 * are the schema's job; this is everything that depends on more than one
 * field, plus the shape of the slug, tags and image addresses.
 */
export function blogPostProblem(
  post: BlogPostDraft,
  options: { imageHosts: readonly string[] },
): string | null {
  if (!post.slug) return "The post needs a slug (its address)";
  if (!BLOG_SLUG_PATTERN.test(post.slug)) {
    return "The slug may use only lowercase letters a–z, digits and single hyphens between words";
  }
  if (RESERVED_BLOG_SLUGS.has(post.slug)) {
    return `"${post.slug}" is reserved for the blog's own pages; choose another slug`;
  }

  if (!hasAnyTitle(post)) return "Give the post a title in English or Arabic";
  if (post.status === "published" && !canPublish(post)) {
    return "A published post needs a title and content in at least one language";
  }

  if (post.tags.length > BLOG_LIMITS.tags) {
    return `A post can have at most ${BLOG_LIMITS.tags} tags`;
  }
  const longTag = post.tags.find((tag) => tag.length > BLOG_LIMITS.tag);
  if (longTag) return `Tags must be ${BLOG_LIMITS.tag} characters or fewer ("${longTag.slice(0, 20)}…")`;

  if (post.coverImage && !isAllowedImageUrl(post.coverImage, options.imageHosts)) {
    return `The cover image address cannot be used. ${IMAGE_HOST_HINT}`;
  }

  for (const [label, content] of [
    ["English", post.contentEn],
    ["Arabic", post.contentAr],
  ] as const) {
    if (!content) continue;
    const blocked = imageSources(parseMarkdown(content)).find(
      (src) => !isAllowedImageUrl(src, options.imageHosts),
    );
    if (blocked) {
      return `An image in the ${label} content is hosted elsewhere (${blocked.slice(0, 80)}). ${IMAGE_HOST_HINT}`;
    }
  }

  return null;
}

/** The first message of a failed parse, for a 400. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message || "Invalid blog post";
}
