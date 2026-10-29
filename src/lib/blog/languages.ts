/**
 * PropertyPro SaaS - Which languages a blog post is in
 *
 * One row holds both languages. A language exists when its title and its
 * content are both filled: the English version is on /blog, the Arabic one on
 * /ar/blog, and a post with only one of them is simply absent from the other
 * blog — never shown there in the wrong language. An excerpt, a cover
 * description or search text alone does not make a language.
 *
 * The rules a save must pass:
 *   - a draft needs a title in at least one language, so the console has a
 *     name to list it by;
 *   - a published post needs at least one complete language (the same rule
 *     as the CHECK in migration 20261017130000_blog_posts).
 *
 * Pure: the console, the API, the public pages and the tests share it.
 */

import type { MarketingLang } from "@/lib/marketing/landing-i18n";

export const BLOG_STATUSES = ["draft", "published"] as const;
export type BlogStatus = (typeof BLOG_STATUSES)[number];

export const BLOG_LANGS: readonly MarketingLang[] = ["en", "ar"];

/** The per-language text of a post, as the row stores it. */
export interface BlogPostText {
  titleEn: string;
  titleAr: string;
  excerptEn: string;
  excerptAr: string;
  contentEn: string;
  contentAr: string;
  seoTitleEn?: string | null;
  seoTitleAr?: string | null;
  seoDescriptionEn?: string | null;
  seoDescriptionAr?: string | null;
  coverImageAlt?: string | null;
  coverImageAltAr?: string | null;
}

function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * How far a language has got: "complete" (on the site), "partial" (a title
 * or content but not both — the console flags it), or "empty".
 */
export function languageState(
  post: Pick<BlogPostText, "titleEn" | "titleAr" | "contentEn" | "contentAr">,
  lang: MarketingLang,
): "complete" | "partial" | "empty" {
  const title = lang === "ar" ? post.titleAr : post.titleEn;
  const content = lang === "ar" ? post.contentAr : post.contentEn;
  if (filled(title) && filled(content)) return "complete";
  if (filled(title) || filled(content)) return "partial";
  return "empty";
}

/** Whether the post has `lang`: a title and content in it. */
export function hasLanguage(
  post: Pick<BlogPostText, "titleEn" | "titleAr" | "contentEn" | "contentAr">,
  lang: MarketingLang,
): boolean {
  return languageState(post, lang) === "complete";
}

/** The languages the post can be read in, English first. */
export function postLanguages(
  post: Pick<BlogPostText, "titleEn" | "titleAr" | "contentEn" | "contentAr">,
): MarketingLang[] {
  return BLOG_LANGS.filter((lang) => hasLanguage(post, lang));
}

/** Whether a post may be published: at least one complete language. */
export function canPublish(
  post: Pick<BlogPostText, "titleEn" | "titleAr" | "contentEn" | "contentAr">,
): boolean {
  return postLanguages(post).length > 0;
}

/** Whether a post may be saved at all: a title in at least one language. */
export function hasAnyTitle(post: Pick<BlogPostText, "titleEn" | "titleAr">): boolean {
  return filled(post.titleEn) || filled(post.titleAr);
}

/**
 * The name the console lists a post by: its English title, else its Arabic
 * one, with which language that was.
 */
export function displayTitle(
  post: Pick<BlogPostText, "titleEn" | "titleAr">,
): { title: string; lang: MarketingLang } {
  if (filled(post.titleEn)) return { title: post.titleEn.trim(), lang: "en" };
  return { title: (post.titleAr ?? "").trim(), lang: "ar" };
}

/** A post's words in one language, with the search fields' fallbacks applied
 * by the caller (they need the rendered content). */
export interface LocalizedPostText {
  title: string;
  excerpt: string;
  content: string;
  seoTitle: string;
  seoDescription: string;
  coverAlt: string;
}

/** The text of `post` in `lang`. A cover with no description in `lang` is
 * treated as decorative (empty alt): it sits beside the title, and reading
 * the title out twice helps no one. */
export function localizePost(post: BlogPostText, lang: MarketingLang): LocalizedPostText {
  const ar = lang === "ar";
  const title = ((ar ? post.titleAr : post.titleEn) ?? "").trim();
  return {
    title,
    excerpt: ((ar ? post.excerptAr : post.excerptEn) ?? "").trim(),
    content: (ar ? post.contentAr : post.contentEn) ?? "",
    seoTitle: ((ar ? post.seoTitleAr : post.seoTitleEn) ?? "").trim(),
    seoDescription: ((ar ? post.seoDescriptionAr : post.seoDescriptionEn) ?? "").trim(),
    coverAlt: ((ar ? post.coverImageAltAr : post.coverImageAlt) ?? "").trim(),
  };
}
