export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  getLandingContent,
  invalidateLandingCache,
} from "@/lib/marketing/landing";
import {
  isCustomSectionKey,
  LANDING_SECTION_META,
} from "@/lib/marketing/landing-types";
import { storedArabicOverlay } from "@/lib/marketing/landing-i18n";
import {
  TRANSLATION_COLUMNS_MISSING_MESSAGE,
  translationColumnsAvailable,
} from "@/lib/marketing/translation-columns";
import { landingUpdateSchema } from "@/lib/validations";
import { recordPlatformAudit } from "@/lib/platform/audit";

/** Stable text for comparing two JSON values (key order included). */
function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const landing = await getLandingContent();
      return createSuccessResponse({
        landing,
        sectionMeta: LANDING_SECTION_META,
      });
    } catch (error) {
      return handleApiError(error, "Failed to load landing content");
    }
  },
);

export const PUT = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);

      const parsed = landingUpdateSchema.safeParse(body.data);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.issues[0]?.message || "Invalid landing content",
          400,
        );
      }

      // seo.title/seo.description live in flat seoTitle/seoDescription
      // columns; the content blocks are Json columns matching their old names.
      const { seo, customSections, translations, ...blocks } = parsed.data;

      // The Arabic is stored pruned to the English structure — words for
      // fields that exist, nothing shared (images, links), nothing empty —
      // and without the shipped translation the console was shown filled in,
      // which keeps following the English it translates (landing-i18n.ts).
      const english = { ...blocks, seo, customSections };
      const arabic = storedArabicOverlay(english, translations.ar);
      // A custom section's slot goes with its content.
      const customIds = new Set(customSections.map((section) => section.id));
      const sections = blocks.sections.filter(
        (section) =>
          !isCustomSectionKey(section.key) ||
          customIds.has(section.key.slice("custom:".length)),
      );

      const before = await getLandingContent();
      const withColumns = await translationColumnsAvailable();
      if (
        !withColumns &&
        (customSections.length > 0 || Object.keys(arabic).length > 0)
      ) {
        // The columns are not there yet. A save carrying only the English and
        // the shipped Arabic loses nothing by leaving them out; Arabic the
        // operator wrote, or a custom section, would be lost silently.
        return createErrorResponse(TRANSLATION_COLUMNS_MISSING_MESSAGE, 503);
      }

      const content = {
        sections: sections as unknown as Prisma.InputJsonValue,
        header: blocks.header as unknown as Prisma.InputJsonValue,
        hero: blocks.hero as unknown as Prisma.InputJsonValue,
        product: blocks.product as unknown as Prisma.InputJsonValue,
        features: blocks.features as unknown as Prisma.InputJsonValue,
        howItWorks: blocks.howItWorks as unknown as Prisma.InputJsonValue,
        testimonial: blocks.testimonial as unknown as Prisma.InputJsonValue,
        pricing: blocks.pricing as unknown as Prisma.InputJsonValue,
        cta: blocks.cta as unknown as Prisma.InputJsonValue,
        footer: blocks.footer as unknown as Prisma.InputJsonValue,
        seoTitle: seo.title,
        seoDescription: seo.description,
        ...(withColumns
          ? {
              translations: (Object.keys(arabic).length > 0
                ? { ar: arabic }
                : Prisma.DbNull) as unknown as Prisma.InputJsonValue,
              customSections: (customSections.length > 0
                ? customSections
                : Prisma.DbNull) as unknown as Prisma.InputJsonValue,
            }
          : {}),
      };
      const saved = await db.landingPage.upsert({
        where: { singleton: "primary" },
        update: content,
        create: { singleton: "primary", ...content },
        select: { id: true },
      });

      // What changed, for the audit entry — named, never dumped.
      const beforeArabic = storedArabicOverlay(before, before.translations.ar);
      const translationsChanged = !sameJson(beforeArabic, arabic);
      const customSectionsChanged = !sameJson(
        before.customSections,
        customSections,
      );
      const notes = [
        translationsChanged ? "Arabic text changed" : null,
        customSectionsChanged ? "custom sections changed" : null,
      ].filter(Boolean);

      invalidateLandingCache();
      // The footer and header are landing content but render on the marketing
      // and auth pages too, so purge the whole public tree rather than just the
      // homepage — the Arabic pages under /ar included.
      revalidatePath("/", "layout");
      await recordPlatformAudit({
        actor: user,
        action: "landing.updated",
        targetType: "landing",
        targetId: saved.id,
        targetName: "Landing page",
        summary: notes.length
          ? `Landing page content updated (${notes.join(", ")})`
          : "Landing page content updated",
        metadata: {
          sections: sections.map((s) => ({
            key: s.key,
            enabled: s.enabled,
          })),
          translationsChanged,
          customSectionsChanged,
          customSectionCount: customSections.length,
        },
      });

      return createSuccessResponse(
        { landing: await getLandingContent() },
        "Landing page updated",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update landing content");
    }
  },
);
