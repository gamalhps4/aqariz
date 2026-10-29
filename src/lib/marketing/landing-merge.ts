/**
 * PropertyPro SaaS - Stored landing document → page content
 *
 * The `LandingPage` row is merged over `DEFAULT_LANDING` so a field or section
 * added after a document was saved still has a sensible value. Split out of
 * `@/lib/marketing/landing` (which talks to the database) so the merge rules
 * can be tested without one.
 */

import {
  CUSTOM_SECTION_BACKGROUNDS,
  CUSTOM_SECTION_ID_PATTERN,
  CUSTOM_SECTION_IMAGE_POSITIONS,
  DEFAULT_LANDING,
  LANDING_SECTION_KEYS,
  MAX_CUSTOM_SECTIONS,
  customSectionIdOf,
  customSectionKey,
  isCustomSectionKey,
  normalizeFooterColumns,
  normalizeTestimonialSlides,
  type CustomSection,
  type LandingData,
  type LandingSectionMeta,
  type LandingSlotKey,
} from "./landing-types";
import { resolveArabicOverlay } from "./landing-i18n";

/** Shallow-merge a stored content block over its default (arrays/nested objects
 * from the editor are always complete, so a shallow override is correct). */
function mergeBlock<T extends object>(fallback: T, stored: unknown): T {
  if (!stored || typeof stored !== "object") return fallback;
  return { ...fallback, ...(stored as Partial<T>) };
}

/**
 * Reconcile section meta: keep the default set, override enabled/order from the
 * document by key, and sort by order. Unknown keys in the document are ignored;
 * keys missing from the document keep their defaults (forward-compatible).
 *
 * A key added after a document was saved inherits its *default* order, which
 * will collide with whatever section already holds that slot — "howItWorks"
 * takes 3, the slot a pre-existing document gave "testimonial". Ties therefore
 * break on the default index, which lands the new section exactly where the
 * defaults put it (right after Features) rather than at the mercy of sort
 * stability. Orders are then renumbered so the next save stores no collisions.
 *
 * Custom sections (`custom:<id>`) are kept where the document put them, but
 * only while their content exists: deleting a section's content drops its
 * slot. One with content and no slot (written outside the console) goes last,
 * shown, rather than vanishing. Ties after the built-ins break on the stored
 * position.
 */
export function mergeSections(
  stored: unknown,
  customSections: Pick<CustomSection, "id">[] = [],
): LandingSectionMeta[] {
  const storedList = Array.isArray(stored)
    ? (stored as Partial<LandingSectionMeta>[])
    : [];
  const byKey = new Map<unknown, Partial<LandingSectionMeta>>();
  for (const section of storedList) {
    // First entry wins; a duplicated key must not take two slots.
    if (section && !byKey.has(section.key)) byKey.set(section.key, section);
  }

  const builtIns = LANDING_SECTION_KEYS.map((key, index) => {
    const override = byKey.get(key);
    return {
      key: key as LandingSlotKey,
      enabled: typeof override?.enabled === "boolean" ? override.enabled : true,
      order: typeof override?.order === "number" ? override.order : index,
      defaultIndex: index,
    };
  });

  const existing = new Set(customSections.map((section) => section.id));
  const placed = new Set<string>();
  const customs: typeof builtIns = [];
  storedList.forEach((section, position) => {
    const key = section?.key;
    if (!isCustomSectionKey(key)) return;
    const id = customSectionIdOf(key);
    if (!existing.has(id) || placed.has(id)) return;
    placed.add(id);
    customs.push({
      key,
      enabled: typeof section.enabled === "boolean" ? section.enabled : true,
      order:
        typeof section.order === "number"
          ? section.order
          : Number.MAX_SAFE_INTEGER,
      defaultIndex: LANDING_SECTION_KEYS.length + position,
    });
  });
  customSections.forEach((section, position) => {
    if (placed.has(section.id)) return;
    placed.add(section.id);
    customs.push({
      key: customSectionKey(section.id),
      enabled: true,
      order: Number.MAX_SAFE_INTEGER,
      defaultIndex: LANDING_SECTION_KEYS.length + storedList.length + position,
    });
  });

  return [...builtIns, ...customs]
    .sort((a, b) => a.order - b.order || a.defaultIndex - b.defaultIndex)
    .map(({ key, enabled }, index) => ({ key, enabled, order: index }));
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

/**
 * The stored custom sections, each with every field present and of the right
 * kind. Entries without a usable id, and repeats of an id, are dropped — the
 * id is what places the section and keys its Arabic text.
 */
export function normalizeCustomSections(stored: unknown): CustomSection[] {
  if (!Array.isArray(stored)) return [];
  const seen = new Set<string>();
  const sections: CustomSection[] = [];
  for (const raw of stored) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === "string" ? entry.id : "";
    if (!CUSTOM_SECTION_ID_PATTERN.test(id) || seen.has(id)) continue;
    seen.add(id);
    sections.push({
      id,
      heading: stringOr(entry.heading, ""),
      body: stringOr(entry.body, ""),
      image: stringOr(entry.image, ""),
      imageAlt: stringOr(entry.imageAlt, ""),
      imagePosition: oneOf(entry.imagePosition, CUSTOM_SECTION_IMAGE_POSITIONS, "end"),
      ctaLabel: stringOr(entry.ctaLabel, ""),
      ctaHref: stringOr(entry.ctaHref, ""),
      background: oneOf(entry.background, CUSTOM_SECTION_BACKGROUNDS, "white"),
    });
    if (sections.length >= MAX_CUSTOM_SECTIONS) break;
  }
  return sections;
}

/** The stored `translations` column's Arabic part, whatever shape it holds. */
function storedArabic(translations: unknown): unknown {
  return translations && typeof translations === "object"
    ? (translations as Record<string, unknown>).ar
    : undefined;
}

/**
 * The CTA's price line as the defaults shipped it while plans were shown in
 * dollars. Still stored word for word, nobody wrote it: it reads as today's
 * default, in riyal (and so keeps its shipped Arabic). Edited, it is the
 * operator's own copy and is left alone.
 */
const DOLLAR_PRICE_LINE = "100 units at $29";

export function withCurrentPriceLine(
  cta: LandingData["cta"],
): LandingData["cta"] {
  return cta.priceLink?.label?.trim() === DOLLAR_PRICE_LINE
    ? { ...cta, priceLink: { ...cta.priceLink, label: DEFAULT_LANDING.cta.priceLink.label } }
    : cta;
}

/**
 * The page content for a stored document (null: nothing stored yet). The
 * English blocks are merged over the defaults; the Arabic overlay comes back
 * resolved — pruned to the English structure, gaps filled from the shipped
 * translation where the English is still the shipped English.
 */
export function toLandingData(doc: Record<string, unknown> | null): LandingData {
  const source = doc ?? {};
  // seo.title/seo.description live in flat seoTitle/seoDescription columns;
  // empty strings mean "unset" and fall back to the defaults.
  const storedSeo = {
    ...(source.seoTitle ? { title: source.seoTitle as string } : {}),
    ...(source.seoDescription
      ? { description: source.seoDescription as string }
      : {}),
  };
  const customSections = normalizeCustomSections(source.customSections);
  const english = {
    header: mergeBlock(DEFAULT_LANDING.header, source.header),
    hero: mergeBlock(DEFAULT_LANDING.hero, source.hero),
    product: mergeBlock(DEFAULT_LANDING.product, source.product),
    features: mergeBlock(DEFAULT_LANDING.features, source.features),
    howItWorks: mergeBlock(DEFAULT_LANDING.howItWorks, source.howItWorks),
    // Slides get an extra pass: single-review documents predate the carousel
    // and stored the review in flat fields a shallow merge cannot promote.
    testimonial: (() => {
      const testimonial = mergeBlock(DEFAULT_LANDING.testimonial, source.testimonial);
      // Normalise from the raw block: the merge above has already supplied the
      // default `slides`, which would mask a legacy document's flat fields.
      return { ...testimonial, slides: normalizeTestimonialSlides(source.testimonial) };
    })(),
    pricing: mergeBlock(DEFAULT_LANDING.pricing, source.pricing),
    cta: withCurrentPriceLine(mergeBlock(DEFAULT_LANDING.cta, source.cta)),
    // Columns get an extra pass: pre-heading documents stored them as bare
    // link arrays, which a shallow merge would hand through unchanged.
    footer: (() => {
      const footer = mergeBlock(DEFAULT_LANDING.footer, source.footer);
      return { ...footer, columns: normalizeFooterColumns(footer.columns) };
    })(),
    seo: mergeBlock(DEFAULT_LANDING.seo, storedSeo),
    customSections,
  };

  return {
    sections: mergeSections(source.sections, customSections),
    ...english,
    translations: {
      ar: resolveArabicOverlay(english, storedArabic(source.translations)),
    },
  };
}
