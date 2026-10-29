/**
 * PropertyPro SaaS - Blog post addresses
 *
 * A post lives at /blog/<slug> and, when it has Arabic, /ar/blog/<slug>: one
 * slug for both languages, so the language switch is a matter of adding or
 * removing "/ar". Slugs are lowercase ASCII words joined by single hyphens —
 * a plain URL segment that never needs percent-encoding, reads the same in a
 * shared link and in a search result, and matches the CHECK in migration
 * 20261017130000_blog_posts.
 *
 * Generated from the English title. An Arabic-only post has none to work
 * from, so it gets a neutral `post-…` slug the operator can rewrite.
 *
 * Pure: the console, the API and the tests share it.
 */

export const BLOG_SLUG_MAX_LENGTH = 96;

export const BLOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Segments under /blog that are, or may become, routes of their own rather
 * than posts. "page" is taken now: /blog/page/2 is the index's second page.
 */
export const RESERVED_BLOG_SLUGS: ReadonlySet<string> = new Set([
  "page",
  "tag",
  "tags",
  "category",
  "feed",
  "rss",
]);

/**
 * The slug a title suggests: accents folded ("Café" → "cafe"), apostrophes
 * dropped ("don't" → "dont"), every other run of non-alphanumerics a single
 * hyphen, cut to the length limit without a trailing hyphen. Text with no
 * Latin letters or digits (an Arabic title) gives "".
 */
export function slugify(text: string): string {
  return (text ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2018\u2019`]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, BLOG_SLUG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** Whether `slug` may be stored: well formed, short enough, not a route. */
export function isValidBlogSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.length <= BLOG_SLUG_MAX_LENGTH &&
    BLOG_SLUG_PATTERN.test(slug) &&
    !RESERVED_BLOG_SLUGS.has(slug)
  );
}

/**
 * A slug for a post whose English title says nothing usable: "post-" and the
 * time in base 36 ("post-mgt1x2k0"), unique enough for one operator and
 * obviously a placeholder.
 */
export function fallbackBlogSlug(now: number = Date.now()): string {
  return `post-${Math.max(0, Math.floor(now)).toString(36)}`;
}

/**
 * The slug the console suggests for a title: `slugify`, nudged off a reserved
 * word ("Page" → "page-post"), or the fallback when the title has nothing to
 * build one from.
 */
export function suggestBlogSlug(title: string, now: number = Date.now()): string {
  const slug = slugify(title);
  if (!slug) return fallbackBlogSlug(now);
  if (RESERVED_BLOG_SLUGS.has(slug)) return `${slug}-post`;
  return slug;
}

/**
 * The first of `slug`, `slug-2`, `slug-3`… that `taken` does not hold — for
 * the API, when it has to make a slug up itself. Suffixes are fitted inside
 * the length limit.
 */
export function uniqueBlogSlug(slug: string, taken: ReadonlySet<string>): string {
  if (!taken.has(slug)) return slug;
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`;
    const base = slug
      .slice(0, BLOG_SLUG_MAX_LENGTH - suffix.length)
      .replace(/-+$/, "");
    const candidate = `${base}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}
