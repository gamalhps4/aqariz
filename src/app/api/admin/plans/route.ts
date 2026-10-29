export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { getPlatformSettings } from "@/lib/platform/settings";
import { resolvePlanPrices } from "@/lib/billing/plan-price-resolver";
import { resolveAnnualPricing } from "@/lib/billing/annual-price";
import { readStripeAmount } from "@/lib/billing/stripe-price-sync";
import {
  BILLING_CURRENCY,
  getAllPlans,
  getTrialPlanKey,
  invalidatePlanCache,
  toPlanDefinition,
} from "@/lib/billing/plans";
import { normalizeStoredModules } from "@/lib/billing/modules";
import { getPlatformModuleSwitches } from "@/lib/billing/platform-modules";
import { planLimitColumns } from "@/lib/billing/plan-columns";
import { writePlanMessageLimit } from "@/lib/billing/plan-message-limit";
import { planCreateSchema } from "@/lib/validations";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { Prisma } from "@/generated/prisma/client";
import { normalizePlanTranslations } from "@/lib/billing/plan-i18n";
import {
  TRANSLATION_COLUMNS_MISSING_MESSAGE,
  translationColumnsAvailable,
} from "@/lib/marketing/translation-columns";

interface PlanOrgCounts {
  _id: string;
  organizations: number;
  activeSubscriptions: number;
}

async function planOrgCounts(): Promise<Map<string, PlanOrgCounts>> {
  const [byPlan, activeByPlan] = await Promise.all([
    db.organization.groupBy({ by: ["plan"], _count: { _all: true } }),
    db.organization.groupBy({
      by: ["plan"],
      where: { subscriptionStatus: "active" },
      _count: { _all: true },
    }),
  ]);
  const active = new Map(
    activeByPlan.map((item) => [item.plan, item._count._all]),
  );
  return new Map(
    byPlan.map((item) => [
      item.plan,
      {
        _id: item.plan,
        organizations: item._count._all,
        activeSubscriptions: active.get(item.plan) ?? 0,
      },
    ]),
  );
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const [plans, counts, trialPlan, platformModules] = await Promise.all([
        getAllPlans(),
        planOrgCounts(),
        getTrialPlanKey(),
        getPlatformModuleSwitches(),
      ]);

      // Read the live Stripe amount per plan. This is the only place the two
      // numbers are compared, and it is why a divergence is now visible in the
      // console instead of only at checkout.
      const stripeAmounts = new Map<
        string,
        NonNullable<Awaited<ReturnType<typeof readStripeAmount>>>
      >();
      await Promise.all(
        plans.map(async (plan) => {
          const actual = await readStripeAmount(plan.stripePriceId);
          if (actual) stripeAmounts.set(plan.key, actual);
        }),
      );

      return createSuccessResponse({
        currency: BILLING_CURRENCY,
        // The modules switched off for every package, shown beside the
        // packages so a module missing everywhere is explained.
        platformModules,
        plans: plans.map((plan) => {
          const needsStripe = !plan.isCustom && plan.monthlyPrice > 0;
          return {
            ...plan,
            stripeConfigured: !needsStripe || Boolean(plan.stripePriceId),
            // What Stripe would actually charge, so the console can show the
            // real number beside the typed one and flag any divergence.
            stripeAmount: stripeAmounts.get(plan.key)?.amount ?? null,
            // Upper-case ISO code of what Stripe bills ("USD" on a price made
            // before the app priced plans in riyal).
            stripeCurrency:
              stripeAmounts.get(plan.key)?.currency.toUpperCase() ?? null,
            // A price in another currency is as wrong as another amount: the
            // site shows riyal, so Stripe must charge riyal.
            priceMismatch:
              stripeAmounts.get(plan.key)?.amount != null &&
              (stripeAmounts.get(plan.key)!.amount !== plan.monthlyPrice ||
                !stripeAmounts.get(plan.key)!.inAppCurrency),
            organizations: counts.get(plan.key)?.organizations ?? 0,
            activeSubscriptions: counts.get(plan.key)?.activeSubscriptions ?? 0,
          };
        }),
        trial: {
          plan: trialPlan,
          // Read the same value provisioning uses. This used to report
          // SAAS_TRIAL_DAYS, an env var nothing else consults, so the Plans
          // screen could advertise a trial length the product never granted.
          days: (await getPlatformSettings()).registration.defaultTrialDays,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to load plans");
    }
  },
);

export const POST = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);

      const parsed = planCreateSchema.safeParse(body.data);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.issues[0]?.message || "Invalid plan data",
          400,
        );
      }
      const data = parsed.data;
      // The platform switches live at /api/admin/plans/platform-modules, a
      // path a plan with that key would shadow.
      if (data.key === "platform-modules") {
        return createErrorResponse("This plan key is reserved", 400);
      }

      const existing = await db.plan.findFirst({
        where: { key: data.key },
        select: { id: true },
      });
      if (existing) {
        return createErrorResponse(
          `A plan with key "${data.key}" already exists`,
          409,
        );
      }

      const { limits, translations, ...planFields } = data;

      // The card's Arabic has a column of its own, which arrives with a
      // migration; refuse Arabic it could not store rather than drop it.
      const arabic = normalizePlanTranslations(translations);
      const withTranslations = await translationColumnsAvailable();
      if (arabic && !withTranslations) {
        return createErrorResponse(TRANSLATION_COLUMNS_MISSING_MESSAGE, 503);
      }

      // The annual figure is calculated here, not accepted from the client, so
      // it always agrees with the monthly price and the discount on the form.
      const annual = resolveAnnualPricing({
        isCustom: data.isCustom,
        annualEnabled: data.annualEnabled,
        monthlyPrice: data.monthlyPrice,
        yearlyDiscountPercent: data.yearlyDiscountPercent,
        yearlyPriceOverride: data.yearlyPriceOverride,
        overrideAmount: data.yearlyPrice ?? null,
      });

      // The console is the source of truth for price. Whatever the super-admin
      // typed is created in Stripe, so the advertised amount and the charged
      // amount cannot diverge. A pasted price id that disagrees is refused.
      const priceSync = await resolvePlanPrices({
        planKey: data.key,
        planName: data.name,
        monthlyPrice: data.isCustom ? null : data.monthlyPrice,
        yearlyPrice: annual.yearlyPrice,
        suppliedMonthlyPriceId: data.stripePriceId || null,
        suppliedYearlyPriceId: data.stripePriceIdYearly || null,
        currentMonthlyPriceId: null,
        currentYearlyPriceId: null,
      });
      if ("error" in priceSync) {
        return createErrorResponse(priceSync.error, 422);
      }

      const created = await db.plan.create({
        data: {
          ...planFields,
          // Stored in the module tree's shortest form: a section ticked
          // whole is one key (and takes in items added to it later).
          features: normalizeStoredModules(planFields.features),
          stripePriceId: priceSync.monthlyPriceId,
          stripePriceIdYearly: priceSync.yearlyPriceId,
          yearlyPrice: annual.yearlyPrice,
          annualEnabled: annual.annualEnabled,
          yearlyDiscountPercent: annual.yearlyDiscountPercent,
          yearlyPriceOverride: annual.yearlyPriceOverride,
          featuresHeader: data.featuresHeader || null,
          ...planLimitColumns(limits),
          ...(withTranslations
            ? {
                translations: (arabic ?? Prisma.DbNull) as Prisma.InputJsonValue,
              }
            : {}),
        },
        omit: { translations: !withTranslations },
      });
      // The message quota is not a Prisma field yet (plan-message-limit.ts).
      await writePlanMessageLimit(created.key, limits.messagesPerMonth);

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
        action: "plan.created",
        targetType: "plan",
        targetId: created.id,
        targetName: created.name,
        summary: `Plan "${created.name}" (${created.key}) created`,
        metadata: { key: created.key, monthlyPrice: created.monthlyPrice },
      });

      return createSuccessResponse(
        { plan: toPlanDefinition(created, limits.messagesPerMonth ?? null) },
        "Plan created",
      );
    } catch (error) {
      return handleApiError(error, "Failed to create plan");
    }
  },
);
