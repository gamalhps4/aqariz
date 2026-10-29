/**
 * PropertyPro SaaS - Landing page content service (DB-backed)
 *
 * The landing content lives in a single `LandingPage` document, managed from the
 * Platform Console (`/admin/landing`). This module is the read path used by the
 * marketing pages (English at /, Arabic at /ar) and the admin editor API.
 *
 * Mirrors `@/lib/billing/plans`: a short in-memory cache keeps the hot render
 * path cheap (mutations call `invalidateLandingCache()`), and `DEFAULT_LANDING`
 * is both the one-time seed and the fallback when the database is empty or
 * momentarily unavailable, so the page renders identically before any edit.
 * How a stored document becomes page content is `./landing-merge` (pure).
 */

import { db } from "@/lib/db/prisma";
import { processCache } from "@/lib/process-cache";
import { Prisma } from "@/generated/prisma/client";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { DEFAULT_LANDING, type LandingData } from "./landing-types";
import { toLandingData } from "./landing-merge";
import { localizeLanding, type MarketingLang } from "./landing-i18n";
import { translationColumnsAvailable } from "./translation-columns";

export type { LandingData } from "./landing-types";

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Shared by the console's route and the pages it revalidates
// (lib/process-cache): with a per-module cache a save showed only after the
// page's own copy expired, and a revalidation in between baked in the old.
const cache = processCache<LandingData>("landing-content", 60_000);
/** The Arabic content of the cached document, made once per document. */
let localized: { from: LandingData; data: LandingData } | null = null;

export function invalidateLandingCache(): void {
  cache.clear();
  localized = null;
}

/** What is drawn when nothing can be read: the defaults, Arabic resolved. */
const FALLBACK = toLandingData(null);

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/**
 * The English landing content, plus the custom sections and the Arabic
 * overlay (resolved — see `toLandingData`). This is what the console edits.
 */
export async function getLandingContent(): Promise<LandingData> {
  const fresh = cache.fresh();
  if (fresh) return fresh;
  try {
    await ensureLandingSeeded();
    // The Arabic and custom-section columns are left out of every read until
    // their migration is applied (lib/db/prisma.ts); ask for them once it is.
    const withColumns = await translationColumnsAvailable();
    const doc = await db.landingPage.findFirst({
      where: { singleton: "primary" },
      omit: { translations: !withColumns, customSections: !withColumns },
    });
    const data = toLandingData(doc as Record<string, unknown> | null);
    cache.set(data);
    return data;
  } catch (error) {
    // Keep the marketing pages working even if the database is momentarily
    // unavailable (or absent during a build).
    console.error("Failed to load landing content; using defaults", error);
    return cache.last() ?? FALLBACK;
  }
}

/**
 * The landing content as the page in `lang` draws it: English as stored, or
 * Arabic with the overlay applied and internal links pointed at /ar pages.
 */
export async function getLandingContentFor(
  lang: MarketingLang,
): Promise<LandingData> {
  const data = await getLandingContent();
  if (lang === "en") return data;
  if (localized?.from !== data) {
    localized = { from: data, data: localizeLanding(data, lang) };
  }
  return localized.data;
}

// ---------------------------------------------------------------------------
// Seeding (one-time, from DEFAULT_LANDING)
// ---------------------------------------------------------------------------

let seedChecked = false;

/**
 * Seed the singleton on a brand-new database. Idempotent and race-safe:
 * concurrent inserts collide on the unique `singleton` index and are ignored.
 * Never resurrects admin-cleared content (only seeds when no document exists).
 *
 * The Arabic overlay and the custom sections are not seeded: null reads as
 * "the shipped translation" and "none", and leaving them out keeps this
 * insert working on a database their migration has not reached.
 */
export async function ensureLandingSeeded(): Promise<void> {
  if (seedChecked) return;
  try {
    const existing = await db.landingPage.findFirst({
      where: { singleton: "primary" },
      select: { id: true },
    });
    if (!existing) {
      // landing_pages is world-readable but platform-writable under RLS, so
      // the one-time seed insert runs with an explicit bypass. The upsert
      // never overwrites admin-edited content (update is a no-op).
      const blocks = DEFAULT_LANDING;
      await bypassOrgScope(() =>
        db.landingPage.upsert({
          where: { singleton: "primary" },
          update: {},
          create: {
            singleton: "primary",
            sections: blocks.sections as unknown as Prisma.InputJsonValue,
            header: blocks.header as unknown as Prisma.InputJsonValue,
            hero: blocks.hero as unknown as Prisma.InputJsonValue,
            product: blocks.product as unknown as Prisma.InputJsonValue,
            features: blocks.features as unknown as Prisma.InputJsonValue,
            howItWorks: blocks.howItWorks as unknown as Prisma.InputJsonValue,
            testimonial: blocks.testimonial as unknown as Prisma.InputJsonValue,
            pricing: blocks.pricing as unknown as Prisma.InputJsonValue,
            cta: blocks.cta as unknown as Prisma.InputJsonValue,
            footer: blocks.footer as unknown as Prisma.InputJsonValue,
            seoTitle: blocks.seo.title,
            seoDescription: blocks.seo.description,
          },
          select: { id: true },
        }),
      );
      invalidateLandingCache();
    }
    seedChecked = true;
  } catch (error) {
    // Duplicate-key races during concurrent seeding are expected and harmless.
    console.error("Landing seeding skipped due to error", error);
  }
}
