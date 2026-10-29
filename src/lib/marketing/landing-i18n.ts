/**
 * PropertyPro SaaS - The marketing site in two languages
 *
 * The Arabic pages (/ar, /ar/pricing, /ar/contact) are the English pages with
 * the words swapped. The Arabic is stored as an *overlay* of the English
 * blocks' text: the same shape, strings only. Everything else — an image, a
 * link, an icon, a star rating, how many cards there are — is read from the
 * English block, so one edit in the console changes both pages and the two can
 * never disagree about anything but language.
 *
 * Pure (no server imports): the pages, the console and the tests share it.
 */

import { blogIndexPath, blogPostPath, parseBlogPath } from "@/lib/blog/paths";
import { DEFAULT_LANDING_AR } from "./landing-ar";
import {
  DEFAULT_LANDING,
  type CustomSection,
  type CustomSectionText,
  type LandingBlockKey,
  type LandingData,
  type LandingOverlay,
  type TextOverlay,
} from "./landing-types";

export type MarketingLang = "en" | "ar";

export const MARKETING_LANGS: readonly MarketingLang[] = ["en", "ar"];

export function directionOfLang(lang: MarketingLang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

/**
 * Keys whose values are shared by both languages however they are spelled:
 * where an image is, where a link goes, which icon a tile wears, how a custom
 * section is laid out. A string under one of these is never read from the
 * overlay. Numbers and booleans (ratings, autoplay seconds, flags) are shared
 * by type and need no entry.
 */
export const SHARED_KEYS: ReadonlySet<string> = new Set([
  "id",
  "image",
  "panelImage",
  "dashboardImage",
  "href",
  "ctaHref",
  "icon",
  "imagePosition",
  "background",
]);

/** The keys holding a link, rewritten to the Arabic pages on /ar. */
const HREF_KEYS: ReadonlySet<string> = new Set(["href", "ctaHref"]);

/** The blocks an overlay may carry, besides `seo` and `custom`. */
export const LANDING_TEXT_BLOCKS: readonly LandingBlockKey[] = [
  "header",
  "hero",
  "product",
  "features",
  "howItWorks",
  "testimonial",
  "pricing",
  "cta",
  "footer",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/** English page → its Arabic twin. Pages not listed (legal, auth, the app)
 * exist in one language only. A blog post is paired by its slug instead
 * (`alternateLanguagePath`), since not every post has both languages. */
const ARABIC_PAGES: Readonly<Record<string, string>> = {
  "/": "/ar",
  "/pricing": "/ar/pricing",
  "/contact": "/ar/contact",
  "/blog": "/ar/blog",
};

const ENGLISH_PAGES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(ARABIC_PAGES).map(([en, ar]) => [ar, en]),
);

/** "/pricing/" and "/pricing" are one page. The root stays "/". */
function normalisePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

/**
 * A link as the page in `lang` should write it: on the Arabic pages, an
 * internal link to a page that has an Arabic version goes to that version —
 * "/" → "/ar", "/pricing" → "/ar/pricing", "/#features" → "/ar#features".
 *
 * Everything else is left exactly as written: external addresses, `mailto:`
 * and `tel:`, same-page anchors ("#product"), sign-in and sign-up, the legal
 * pages (English only) and links already pointing at an Arabic page.
 */
export function localizeHref(href: string, lang: MarketingLang): string {
  if (lang === "en" || typeof href !== "string") return href;
  const trimmed = href.trim();
  // Protocol-relative ("//host") is external; only a single leading slash is ours.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return href;

  const cut = trimmed.search(/[?#]/);
  const path = cut === -1 ? trimmed : trimmed.slice(0, cut);
  const rest = cut === -1 ? "" : trimmed.slice(cut);
  const arabic = ARABIC_PAGES[normalisePath(path)];
  return arabic ? `${arabic}${rest}` : href;
}

/** Which language a marketing path is in. */
export function marketingLangOf(pathname: string | null | undefined): MarketingLang {
  const path = normalisePath(pathname || "/");
  return path === "/ar" || path.startsWith("/ar/") ? "ar" : "en";
}

/**
 * The same page in the other language, for the header's language switch.
 * A page with no twin (the legal pages, a 404) falls back to the other
 * language's homepage.
 *
 * On the blog: a post goes to the same slug in the other language when it has
 * that language — `blogTwins`, the slugs of published posts in both, which
 * the header is handed — and to the other language's blog otherwise. An
 * index page past the first goes to the other blog's first page, since the
 * two blogs hold different posts and number their pages differently.
 */
export function alternateLanguagePath(
  pathname: string | null | undefined,
  blogTwins: readonly string[] = [],
): string {
  const path = normalisePath(pathname || "/");
  const lang = marketingLangOf(path);
  const blog = parseBlogPath(path);
  if (blog) {
    const other: MarketingLang = blog.lang === "ar" ? "en" : "ar";
    return blog.kind === "post" && blogTwins.includes(blog.slug)
      ? blogPostPath(blog.slug, other)
      : blogIndexPath(other);
  }
  if (lang === "ar") return ENGLISH_PAGES[path] ?? "/";
  return ARABIC_PAGES[path] ?? "/ar";
}

/** The English and Arabic paths of a page that exists in both. */
export function languagePair(englishPath: string): { en: string; ar: string } {
  const en = normalisePath(englishPath);
  return { en, ar: ARABIC_PAGES[en] ?? "/ar" };
}

/**
 * Whether a link is one the console may store: a path on this site
 * ("/pricing", "/#features"), a same-page anchor ("#product"), or an http(s)
 * address. `javascript:`, `data:` and protocol-relative links are refused —
 * the homepage renders these into `href` attributes.
 */
export function isSafeLandingHref(href: string): boolean {
  const value = href.trim();
  if (value === "") return true;
  if (/\s/.test(value)) return false;
  if (value.startsWith("#")) return true;
  if (value.startsWith("/")) return !value.startsWith("//") && !value.startsWith("/\\");
  return /^https?:\/\/[^/\s]+/i.test(value);
}

// ---------------------------------------------------------------------------
// The overlay
// ---------------------------------------------------------------------------

/**
 * `english` with each string replaced by the overlay's string at the same
 * place, when that string is non-empty. Arrays go by index and their length
 * is the English one; strings under a `SHARED_KEYS` key, numbers and booleans
 * are always the English values. `mapShared` lets the Arabic page rewrite the
 * shared links on the way through.
 */
export function overlayText<T>(
  english: T,
  overlay: unknown,
  mapShared?: (key: string, value: string) => string,
): T {
  if (typeof english === "string") {
    return (
      typeof overlay === "string" && overlay.trim() !== "" ? overlay : english
    ) as T;
  }
  if (Array.isArray(english)) {
    const list = Array.isArray(overlay) ? overlay : [];
    return english.map((item, index) =>
      overlayText(item, list[index], mapShared),
    ) as T;
  }
  if (isRecord(english)) {
    const source = isRecord(overlay) ? overlay : {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(english)) {
      if (SHARED_KEYS.has(key)) {
        result[key] =
          mapShared && typeof value === "string" ? mapShared(key, value) : value;
      } else {
        result[key] = overlayText(value, source[key], mapShared);
      }
    }
    return result as T;
  }
  return english;
}

/**
 * The overlay's text that has an English counterpart: the English shape with
 * only its translatable strings, read from `overlay`. Anything else in the
 * overlay — an image, a link, a key the English block does not have, an item
 * past the end of an English list — is dropped, so what is stored can never
 * carry more than words. Blank strings are dropped too ("not translated").
 *
 * Text is kept as written, edge spaces included: the testimonial's quote is
 * three strings set side by side, and the space at the end of one is the gap
 * before the next.
 *
 * Lists keep their positions: an untranslated item in the middle stays as an
 * empty placeholder so the ones after it still line up.
 */
export function pruneOverlay(english: unknown, overlay: unknown): unknown {
  if (typeof english === "string") {
    return typeof overlay === "string" && overlay.trim() !== ""
      ? overlay
      : undefined;
  }
  if (Array.isArray(english)) {
    if (!Array.isArray(overlay)) return undefined;
    const items = english.map((item, index) => pruneOverlay(item, overlay[index]));
    let last = items.length - 1;
    while (last >= 0 && items[last] === undefined) last -= 1;
    if (last < 0) return undefined;
    return items
      .slice(0, last + 1)
      .map((item, index) =>
        item === undefined ? emptyLike(english[index]) : item,
      );
  }
  if (isRecord(english)) {
    if (!isRecord(overlay)) return undefined;
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(english)) {
      if (SHARED_KEYS.has(key)) continue;
      const pruned = pruneOverlay(value, overlay[key]);
      if (pruned !== undefined) result[key] = pruned;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

/** The placeholder a pruned list keeps for an untranslated item. */
function emptyLike(english: unknown): unknown {
  if (typeof english === "string") return "";
  if (Array.isArray(english)) return [];
  return {};
}

/**
 * The English structure with the overlay's strings in place and every other
 * string empty — what the console's Arabic tab edits, so each input can show
 * its English counterpart as a placeholder. Shared values keep the English
 * ones (the Arabic tab does not show them).
 */
export function arabicView<T>(english: T, overlay: unknown): T {
  if (typeof english === "string") {
    return (typeof overlay === "string" ? overlay : "") as T;
  }
  if (Array.isArray(english)) {
    const list = Array.isArray(overlay) ? overlay : [];
    return english.map((item, index) => arabicView(item, list[index])) as T;
  }
  if (isRecord(english)) {
    const source = isRecord(overlay) ? overlay : {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(english)) {
      result[key] = SHARED_KEYS.has(key) ? value : arabicView(value, source[key]);
    }
    return result as T;
  }
  return english;
}

/**
 * The inverse of `arabicView`: the overlay an edited Arabic view stands for,
 * with every translatable string kept exactly as typed (empty ones included —
 * this is the console's working copy; `pruneOverlay` drops them on save) and
 * every shared value left out.
 */
export function overlayFromView(english: unknown, view: unknown): unknown {
  if (typeof english === "string") return typeof view === "string" ? view : "";
  if (Array.isArray(english)) {
    const list = Array.isArray(view) ? view : [];
    return english.map((item, index) => overlayFromView(item, list[index]));
  }
  if (isRecord(english)) {
    const source = isRecord(view) ? view : {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(english)) {
      if (SHARED_KEYS.has(key)) continue;
      result[key] = overlayFromView(value, source[key]);
    }
    return result;
  }
  return undefined;
}

/**
 * Fill the gaps in a stored overlay from the shipped translation — but only
 * where the English is still the shipped English. A field the operator has
 * rewritten in English has no Arabic until they give it one, and shows in
 * English on /ar meanwhile, rather than a translation of copy that is gone.
 */
function fillFromDefaults(
  english: unknown,
  defaultEnglish: unknown,
  defaultArabic: unknown,
  stored: unknown,
): unknown {
  if (typeof english === "string") {
    if (typeof stored === "string" && stored.trim() !== "") return stored;
    // Edge spaces do not count: the console trims what it saves, so a stored
    // "… units —" is still the shipped "… units — ".
    if (
      typeof defaultEnglish === "string" &&
      english.trim() === defaultEnglish.trim() &&
      typeof defaultArabic === "string" &&
      defaultArabic.trim() !== ""
    ) {
      return defaultArabic;
    }
    return undefined;
  }
  if (Array.isArray(english)) {
    const defaultsEn = Array.isArray(defaultEnglish) ? defaultEnglish : [];
    const defaultsAr = Array.isArray(defaultArabic) ? defaultArabic : [];
    const storedList = Array.isArray(stored) ? stored : [];
    const items = english.map((item, index) =>
      fillFromDefaults(item, defaultsEn[index], defaultsAr[index], storedList[index]),
    );
    return items.some((item) => item !== undefined)
      ? items.map((item, index) => item ?? emptyLike(english[index]))
      : undefined;
  }
  if (isRecord(english)) {
    const defaultsEn = isRecord(defaultEnglish) ? defaultEnglish : {};
    const defaultsAr = isRecord(defaultArabic) ? defaultArabic : {};
    const storedBlock = isRecord(stored) ? stored : {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(english)) {
      if (SHARED_KEYS.has(key)) continue;
      const filled = fillFromDefaults(
        value,
        defaultsEn[key],
        defaultsAr[key],
        storedBlock[key],
      );
      if (filled !== undefined) result[key] = filled;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

/**
 * The Arabic overlay the page and the console work from: what was saved,
 * pruned to the English structure, with its gaps filled from
 * `DEFAULT_LANDING_AR` wherever the English text is still the default. With
 * nothing saved this is the whole shipped translation, so /ar is Arabic
 * before anyone edits anything.
 */
export function resolveArabicOverlay(
  english: Pick<LandingData, LandingBlockKey | "seo" | "customSections">,
  stored: unknown,
): LandingOverlay {
  const source = isRecord(stored) ? stored : {};
  const defaults = DEFAULT_LANDING_AR as Record<string, unknown>;
  const result: LandingOverlay = {};

  for (const block of [...LANDING_TEXT_BLOCKS, "seo"] as const) {
    const filled = fillFromDefaults(
      english[block],
      DEFAULT_LANDING[block],
      defaults[block],
      source[block],
    );
    if (filled !== undefined) {
      (result as Record<string, unknown>)[block] = filled;
    }
  }

  // Custom sections have no shipped text; only what was saved, by id.
  const custom = pruneCustomOverlay(english.customSections, source.custom);
  if (custom) result.custom = custom;
  return result;
}

/** The saved Arabic of each custom section that still exists, by id. */
function pruneCustomOverlay(
  sections: CustomSection[],
  stored: unknown,
): Record<string, TextOverlay<CustomSectionText>> | undefined {
  if (!isRecord(stored)) return undefined;
  const result: Record<string, TextOverlay<CustomSectionText>> = {};
  for (const section of sections) {
    const pruned = pruneOverlay(customSectionText(section), stored[section.id]);
    if (pruned) result[section.id] = pruned as TextOverlay<CustomSectionText>;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function customSectionText(section: CustomSection): CustomSectionText {
  return {
    heading: section.heading,
    body: section.body,
    imageAlt: section.imageAlt,
    ctaLabel: section.ctaLabel,
  };
}

/**
 * The overlay as it is stored: pruned to the English structure, nothing
 * shared, nothing empty. Used by the console's save so a stored overlay can
 * only ever hold words for fields that exist.
 */
export function pruneLandingOverlay(
  english: Pick<LandingData, LandingBlockKey | "seo" | "customSections">,
  overlay: unknown,
): LandingOverlay {
  const source = isRecord(overlay) ? overlay : {};
  const result: LandingOverlay = {};
  for (const block of [...LANDING_TEXT_BLOCKS, "seo"] as const) {
    const pruned = pruneOverlay(english[block], source[block]);
    if (pruned !== undefined) (result as Record<string, unknown>)[block] = pruned;
  }
  const custom = pruneCustomOverlay(english.customSections, source.custom);
  if (custom) result.custom = custom;
  return result;
}

/** `overlay` without the strings that are word for word the shipped Arabic
 * at the same place. */
function withoutShipped(overlay: unknown, shipped: unknown): unknown {
  if (typeof overlay === "string") {
    const same = typeof shipped === "string" && overlay.trim() === shipped.trim();
    return same || overlay.trim() === "" ? undefined : overlay;
  }
  if (Array.isArray(overlay)) {
    const defaults = Array.isArray(shipped) ? shipped : [];
    const items = overlay.map((item, index) => withoutShipped(item, defaults[index]));
    let last = items.length - 1;
    while (last >= 0 && items[last] === undefined) last -= 1;
    if (last < 0) return undefined;
    return items
      .slice(0, last + 1)
      .map((item, index) => item ?? emptyLike(overlay[index]));
  }
  if (isRecord(overlay)) {
    const defaults = isRecord(shipped) ? shipped : {};
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(overlay)) {
      const kept = withoutShipped(value, defaults[key]);
      if (kept !== undefined) result[key] = kept;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  return undefined;
}

/**
 * What the console's save stores: the overlay pruned to the English structure
 * (`pruneLandingOverlay`), minus every string identical to the shipped Arabic
 * for the same field.
 *
 * The console is shown the shipped Arabic filled in, so it sends it back. Kept
 * out of storage, it stays tied to the English it translates: rewrite that
 * English later and /ar shows the new English until it is given Arabic,
 * rather than a stored translation of copy that is gone. Text the operator
 * actually wrote is stored as written.
 */
export function storedArabicOverlay(
  english: Pick<LandingData, LandingBlockKey | "seo" | "customSections">,
  overlay: unknown,
): LandingOverlay {
  const pruned = pruneLandingOverlay(english, overlay);
  return (withoutShipped(pruned, DEFAULT_LANDING_AR) ?? {}) as LandingOverlay;
}

// ---------------------------------------------------------------------------
// The page in a language
// ---------------------------------------------------------------------------

/**
 * The landing content as the page in `lang` draws it. English is the stored
 * blocks unchanged. Arabic is each block overlaid with `translations.ar`, the
 * custom sections overlaid by id, and every internal link pointed at the
 * Arabic page where one exists (`localizeHref`).
 *
 * `translations.ar` is expected already resolved (`resolveArabicOverlay`) —
 * `getLandingContent()` hands it over that way.
 */
export function localizeLanding(
  data: LandingData,
  lang: MarketingLang,
): LandingData {
  if (lang === "en") return data;
  const overlay: LandingOverlay = data.translations?.ar ?? {};
  const links = (key: string, value: string) =>
    HREF_KEYS.has(key) ? localizeHref(value, lang) : value;

  const localized = { ...data };
  for (const block of LANDING_TEXT_BLOCKS) {
    (localized as Record<string, unknown>)[block] = overlayText(
      data[block],
      overlay[block],
      links,
    );
  }
  localized.seo = overlayText(data.seo, overlay.seo);
  localized.customSections = data.customSections.map((section) =>
    overlayText(section, overlay.custom?.[section.id], links),
  );
  return localized;
}
