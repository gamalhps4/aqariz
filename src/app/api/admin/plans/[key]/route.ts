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
import { resolvePlanPrices } from "@/lib/billing/plan-price-resolver";
import { resolveAnnualPricing } from "@/lib/billing/annual-price";
import { invalidatePlanCache, toPlanDefinition } from "@/lib/billing/plans";
import { planLimitColumns } from "@/lib/billing/plan-columns";
import type { PlanLimitKey } from "@/lib/billing/plan-constants";
import {
  readPlanMessageLimits,
  writePlanMessageLimit,
} from "@/lib/billing/plan-message-limit";
import { planUpdateSchema } from "@/lib/validations";
import { normalizeStoredModules } from "@/lib/billing/modules";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { normalizePlanTranslations } from "@/lib/billing/plan-i18n";
import {
  TRANSLATION_COLUMNS_MISSING_MESSAGE,
  translationColumnsAvailable,
} from "@/lib/marketing/translation-columns";

type RouteContext = { params?: Promise<{ key: string }> };

async function resolveKey(context: RouteContext): Promise<string | null> {
  const params = await context.params;
  return params?.key ?? null;
}

export const PATCH = withPlatformAdminAndDB()(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: RouteContext,
  ) => {
    try {
      const key = await resolveKey(context);
      if (!key) return createErrorResponse("Plan key is required", 400);

      const plan = await db.plan.findFirst({ where: { key } });
      if (!plan) return createErrorResponse("Plan not found", 404);

      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);

      const parsed = planUpdateSchema.safeParse(body.data);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.issues[0]?.message || "Invalid plan data",
          400,
        );
      }

      const updates = parsed.data as Record<string, unknown>;
      const changed: string[] = [];
      const data: Prisma.PlanUpdateInput = {};
      const withTranslations = await translationColumnsAvailable();

      for (const [field, value] of Object.entries(updates)) {
        if (value === undefined) continue;
        if (
          field === "isActive" &&
          value === false &&
          plan.isSystem
        ) {
          return createErrorResponse(
            `The ${plan.name} plan cannot be deactivated`,
            409,
          );
        }
        if (field === "limits") {
          // Each `limits.*` key lives in its own flat column. The schema
          // requires every key, so a partial `limits` object is rejected before
          // it can reach here and blank the ones it left out.
          Object.assign(
            data,
            planLimitColumns(value as Record<PlanLimitKey, number | null>),
          );
        } else if (
          field === "stripePriceId" ||
          field === "stripePriceIdYearly" ||
          field === "featuresHeader"
        ) {
          data[field] = (value as string) || null;
        } else if (field === "features") {
          // The module tree's shortest form, whatever shape arrived (the
          // console's list, or old flat keys from an older client).
          data.features = normalizeStoredModules(value as string[]);
        } else if (field === "translations") {
          // The card's Arabic; null or all-empty clears it. Its column comes
          // with a migration: before it, refuse Arabic it could not store,
          // and treat "no Arabic" as nothing to change.
          const arabic = normalizePlanTranslations(value);
          if (!withTranslations) {
            if (arabic) {
              return createErrorResponse(TRANSLATION_COLUMNS_MISSING_MESSAGE, 503);
            }
            continue;
          }
          data.translations = (arabic ?? Prisma.DbNull) as Prisma.InputJsonValue;
        } else {
          (data as Record<string, unknown>)[field] = value;
        }
        changed.push(field);
      }

      if (changed.length === 0) {
        return createErrorResponse("No changes provided", 400);
      }

      // Anything that affects what a customer is charged goes through the
      // resolver, so the console amount and the Stripe amount stay identical.
      const touchesPricing = [
        "monthlyPrice",
        "yearlyPrice",
        "stripePriceId",
        "stripePriceIdYearly",
        // The annual price is calculated from these, so a change to any of
        // them has to re-derive it — raising the monthly price while leaving a
        // stale annual figure behind is exactly the drift this guards against.
        "annualEnabled",
        "yearlyDiscountPercent",
        "yearlyPriceOverride",
        "isCustom",
        "name",
      ].some((field) => changed.includes(field));

      if (touchesPricing) {
        const isCustom =
          (updates.isCustom as boolean | undefined) ?? plan.isCustom;
        const monthlyPrice = isCustom
          ? null
          : ((updates.monthlyPrice as number | undefined) ??
            Number(plan.monthlyPrice));

        // Merge what was submitted over what the plan already had, then let the
        // shared resolver decide the annual amount. Anything the client sent as
        // `yearlyPrice` counts only as an override candidate.
        const annual = resolveAnnualPricing({
          isCustom,
          annualEnabled:
            (updates.annualEnabled as boolean | undefined) ??
            plan.annualEnabled,
          monthlyPrice: monthlyPrice ?? 0,
          yearlyDiscountPercent:
            (updates.yearlyDiscountPercent as number | undefined) ??
            Number(plan.yearlyDiscountPercent ?? 0),
          yearlyPriceOverride:
            (updates.yearlyPriceOverride as boolean | undefined) ??
            plan.yearlyPriceOverride,
          overrideAmount:
            (updates.yearlyPrice as number | null | undefined) ??
            (plan.yearlyPrice === null ? null : Number(plan.yearlyPrice)),
        });

        data.yearlyPrice = annual.yearlyPrice;
        data.annualEnabled = annual.annualEnabled;
        data.yearlyDiscountPercent = annual.yearlyDiscountPercent;
        data.yearlyPriceOverride = annual.yearlyPriceOverride;

        const priceSync = await resolvePlanPrices({
          planKey: key,
          planName: (updates.name as string | undefined) ?? plan.name,
          monthlyPrice,
          yearlyPrice: annual.yearlyPrice,
          suppliedMonthlyPriceId: changed.includes("stripePriceId")
            ? ((updates.stripePriceId as string | null) || null)
            : null,
          suppliedYearlyPriceId: changed.includes("stripePriceIdYearly")
            ? ((updates.stripePriceIdYearly as string | null) || null)
            : null,
          currentMonthlyPriceId: plan.stripePriceId,
          currentYearlyPriceId: plan.stripePriceIdYearly,
        });
        if ("error" in priceSync) {
          return createErrorResponse(priceSync.error, 422);
        }
        data.stripePriceId = priceSync.monthlyPriceId;
        data.stripePriceIdYearly = priceSync.yearlyPriceId;
      }

      const updated = await db.plan.update({
        where: { key },
        data,
        omit: { translations: !withTranslations },
      });
      // The message quota is not a Prisma field yet (plan-message-limit.ts).
      const submittedLimits = updates.limits as
        | Record<PlanLimitKey, number | null>
        | undefined;
      if (submittedLimits) {
        await writePlanMessageLimit(key, submittedLimits.messagesPerMonth);
      }
      const messageLimit = submittedLimits
        ? (submittedLimits.messagesPerMonth ?? null)
        : ((await readPlanMessageLimits()).get(key) ?? null);
      invalidatePlanCache();
      revalidatePath("/");
      // The pricing page reads the same plans and was left on its 5-minute
      // ISR window, so a price change went live on the home page instantly
      // and stayed stale here. The Arabic pages print the same cards.
      revalidatePath("/pricing");
      revalidatePath("/ar");
      revalidatePath("/ar/pricing");
      await recordPlatformAudit({
        actor: user,
        action: "plan.updated",
        targetType: "plan",
        targetId: updated.id,
        targetName: updated.name,
        summary: `Plan "${updated.name}" (${updated.key}) updated: ${changed.join(", ")}`,
        metadata: { key: updated.key, changed },
      });

      return createSuccessResponse(
        { plan: toPlanDefinition(updated, messageLimit) },
        "Plan updated",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update plan");
    }
  },
);

export const DELETE = withPlatformAdminAndDB()(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    context: RouteContext,
  ) => {
    try {
      const key = await resolveKey(context);
      if (!key) return createErrorResponse("Plan key is required", 400);

      const plan = await db.plan.findFirst({ where: { key } });
      if (!plan) return createErrorResponse("Plan not found", 404);

      if (plan.isSystem) {
        return createErrorResponse(
          `The ${plan.name} plan is required and cannot be deleted`,
          409,
        );
      }

      const orgCount = await db.organization.count({
        where: { plan: key, deletedAt: null },
      });
      if (orgCount > 0) {
        return createErrorResponse(
          `Cannot delete: ${orgCount} organization(s) are on this plan. Move them to another plan first.`,
          409,
        );
      }

      await db.plan.delete({ where: { key } });
      invalidatePlanCache();
      revalidatePath("/");
      // The pricing page reads the same plans and was left on its 5-minute
      // ISR window, so a price change went live on the home page instantly
      // and stayed stale here. The Arabic pages print the same cards.
      revalidatePath("/pricing");
      revalidatePath("/ar");
      revalidatePath("/ar/pricing");
      await recordPlatformAudit({
        actor: user,
        action: "plan.deleted",
        targetType: "plan",
        targetId: plan.id,
        targetName: plan.name,
        summary: `Plan "${plan.name}" (${plan.key}) deleted`,
        metadata: { key: plan.key },
      });

      return createSuccessResponse({ key }, "Plan deleted");
    } catch (error) {
      return handleApiError(error, "Failed to delete plan");
    }
  },
);
