/**
 * PropertyPro SaaS - Billing plan service (DB-backed)
 *
 * Plans live in the `Plan` collection and are managed from the Platform Console
 * (/admin/plans). This module is the read path used everywhere else: entitlement
 * limit/feature gating, Stripe checkout, MRR metrics, the public pricing API, and
 * the marketing homepage.
 *
 * A short in-memory cache keeps the hot entitlement path cheap; mutations call
 * `invalidatePlanCache()`. The historical env configuration is only used once, to
 * seed the default tiers on a fresh database (`ensureDefaultPlansSeeded`).
 */

import { db } from "@/lib/db/prisma";
import { processCache } from "@/lib/process-cache";
import { bypassOrgScope } from "@/lib/tenancy/context";
import type { Plan as PlanModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type Plan = MoneyAsNumber<PlanModel>;
import { isPlanFeatureKey } from "./plan-constants";
import { APP_CURRENCY } from "@/lib/regional/region";
import { normalizePlanTranslations } from "./plan-i18n";
import { translationColumnsAvailable } from "@/lib/marketing/translation-columns";
import {
  readPlanMessageLimits,
  writePlanMessageLimit,
} from "./plan-message-limit";
import {
  encodeModuleSelection,
  normalizeStoredModules,
  resolveModuleState,
  TOGGLEABLE_LEAF_KEYS,
  withModulesAddedLater,
} from "./modules";
import type {
  BillingPlanDefinition,
  BillingPlanKey,
} from "./plan-constants";

export type {
  BillingPlanDefinition,
  BillingPlanKey,
  PlanLimitKey,
} from "./plan-constants";
export {
  LEGACY_PLAN_FEATURES,
  PLAN_FEATURE_KEYS,
  PLAN_LIMIT_CATALOG,
  PLAN_LIMIT_KEYS,
  emptyPlanUsage,
  formatPlanLimitValue,
  isPlanFeatureKey,
  planFeatureLabel,
  planLimitIsMonthly,
  planLimitLabel,
  resolveApiFeature,
  resolveAppFeature,
  unlimitedPlanLimits,
} from "./plan-constants";

/**
 * What subscriptions are priced, shown and charged in: the app's one
 * currency (lib/regional/region). It used to come from BILLING_CURRENCY and
 * default to USD, so plans were charged in dollars on a riyal site.
 */
export const BILLING_CURRENCY = APP_CURRENCY;

/**
 * A plan amount as the public pages print it — "$29", "SAR 99" — in the
 * currency Stripe charges it in (stripe-price-sync.ts prices plans in
 * BILLING_CURRENCY). The homepage and /pricing used to write a literal "$"
 * while /pricing's footnote named the platform's default currency (SAR).
 * The Arabic pages pass `lang: "ar"`: a riyal price then carries the Arabic
 * sign ("29 ر.س.") in Western digits, as every Arabic screen in the product
 * writes it. Other currencies keep the English form ("$29") — Arabic
 * formatting writes "US$" after the number, which right to left reads "$US".
 *
 * `toLocaleString`, not `new Intl.NumberFormat`: the app patches that
 * constructor (utils/ensure-intl-currency-patch.ts) to relabel any "USD" as
 * the active currency, which would print "SAR 29" for a $29 charge.
 */
export function formatPlanPrice(
  amount: number,
  currency: string = BILLING_CURRENCY,
  lang: "en" | "ar" = "en",
): string {
  try {
    const locale = lang === "ar" && currency === "SAR" ? "ar-SA-u-nu-latn" : "en-US";
    return Math.round(amount).toLocaleString(locale, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });
  } catch {
    // An unknown code in the env must not take the homepage down.
    return `${currency} ${Math.round(amount)}`;
  }
}

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Shared by the console's routes and the pages they revalidate
// (lib/process-cache), so a price saved in /admin/plans reaches /pricing.
const cache = processCache<BillingPlanDefinition[]>("billing-plans", 60_000);

export function invalidatePlanCache(): void {
  cache.clear();
}

/** Map a Plan row to the definition shape the rest of the app consumes
 * (rebuilds the nested `limits` object from the flat columns). The message
 * quota is not on the row (plan-message-limit.ts): pass it when known. */
export function toPlanDefinition(
  row: Plan,
  messagesPerMonth: number | null = null,
): BillingPlanDefinition {
  // Drop keys nothing recognises (branding was retired from the catalog) so
  // a stale row never gates a feature every plan has; then add the modules
  // released since that start on in this package (modules.ts).
  const features = withModulesAddedLater(
    row.key,
    (row.features ?? []).filter(isPlanFeatureKey),
  );
  return {
    key: row.key,
    name: row.name,
    description: row.description ?? "",
    monthlyPrice: Number(row.monthlyPrice ?? 0),
    yearlyPrice: row.yearlyPrice === null || row.yearlyPrice === undefined
      ? null
      : Number(row.yearlyPrice),
    annualEnabled: Boolean(row.annualEnabled),
    yearlyDiscountPercent: Number(row.yearlyDiscountPercent ?? 0),
    yearlyPriceOverride: Boolean(row.yearlyPriceOverride),
    isCustom: Boolean(row.isCustom),
    priceSuffix: row.priceSuffix ?? "per month",
    stripePriceId: row.stripePriceId ?? null,
    stripePriceIdYearly: row.stripePriceIdYearly ?? null,
    limits: {
      properties: row.limitsProperties ?? null,
      members: row.limitsMembers ?? null,
      units: row.limitsUnits ?? null,
      tenants: row.limitsTenants ?? null,
      leases: row.limitsLeases ?? null,
      documents: row.limitsDocuments ?? null,
      storageMb: row.limitsStorageMb ?? null,
      invoicesPerMonth: row.limitsInvoicesPerMonth ?? null,
      messagesPerMonth,
    },
    features,
    // What the list opens, read once here: old flat keys translated, a
    // section key expanded to its items. Every gate reads this.
    modules: [...resolveModuleState(features).planEnabled],
    highlights: row.highlights ?? [],
    featuresHeader: row.featuresHeader ?? null,
    ctaLabel: row.ctaLabel ?? "Get started",
    ctaHref: row.ctaHref ?? "/auth/signup",
    popular: Boolean(row.popular),
    isPublic: Boolean(row.isPublic),
    isActive: Boolean(row.isActive),
    isSystem: Boolean(row.isSystem),
    sortOrder: Number(row.sortOrder ?? 0),
    // Only on rows read with the column (see `loadPlans`); a row read before
    // its migration simply has no Arabic.
    translations: normalizePlanTranslations(
      (row as { translations?: unknown }).translations,
    ),
  };
}

async function loadPlans(): Promise<BillingPlanDefinition[]> {
  const fresh = cache.fresh();
  if (fresh) return fresh;
  try {
    await ensureDefaultPlansSeeded();
    // `translations` is left out of every read until its migration is
    // applied (lib/db/prisma.ts): the plan cards' Arabic, nothing a gate reads.
    const withTranslations = await translationColumnsAvailable();
    const [rows, messageLimits] = await Promise.all([
      db.plan.findMany({
        orderBy: [{ sortOrder: "asc" }, { monthlyPrice: "asc" }],
        omit: { translations: !withTranslations },
      }),
      readPlanMessageLimits(),
    ]);
    const plans = rows.map((row) =>
      toPlanDefinition(row, messageLimits.get(row.key) ?? null),
    );
    // An empty collection means seeding has not succeeded yet — fall back to the
    // in-memory defaults (and don't cache) so the next call retries.
    if (plans.length === 0) return defaultPlanSeeds();
    cache.set(plans);
    return plans;
  } catch (error) {
    // Keep entitlements, billing, and the marketing homepage working even if the
    // database is momentarily unavailable (or absent during a build).
    console.error("Failed to load plans; using in-memory defaults", error);
    return cache.last() ?? defaultPlanSeeds();
  }
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

export async function getAllPlans(): Promise<BillingPlanDefinition[]> {
  return loadPlans();
}

export async function getPlanByKey(
  key: string | null | undefined,
): Promise<BillingPlanDefinition | null> {
  if (!key) return null;
  const plans = await loadPlans();
  return plans.find((plan) => plan.key === key) ?? null;
}

export async function getActivePlans(): Promise<BillingPlanDefinition[]> {
  return (await loadPlans()).filter((plan) => plan.isActive);
}

export async function getPublicPlans(): Promise<BillingPlanDefinition[]> {
  return (await loadPlans()).filter((plan) => plan.isActive && plan.isPublic);
}

export async function planExists(key: string): Promise<boolean> {
  return (await getPlanByKey(key)) !== null;
}

export async function planForStripePrice(
  priceId: string | null | undefined,
): Promise<BillingPlanKey | null> {
  if (!priceId) return null;
  const plans = await loadPlans();
  // Match monthly AND yearly price ids — matching only the monthly id sent
  // annual subscribers to the "free" plan while they were billed the year.
  return (
    plans.find(
      (plan) =>
        plan.stripePriceId === priceId || plan.stripePriceIdYearly === priceId,
    )?.key ?? null
  );
}

/** Whether a plan is usable for a new paid Stripe checkout. */
export function planIsCheckoutReady(plan: BillingPlanDefinition): boolean {
  return !plan.isCustom && plan.monthlyPrice > 0 && Boolean(plan.stripePriceId);
}

/** The plan key new organizations are granted during their trial. */
export async function getTrialPlanKey(): Promise<BillingPlanKey> {
  const configured = process.env.SAAS_TRIAL_PLAN || "professional";
  const plan = await getPlanByKey(configured);
  if (plan && plan.isActive) return plan.key;
  return "free";
}

// ---------------------------------------------------------------------------
// Seeding (one-time, from historical env defaults)
// ---------------------------------------------------------------------------

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function nonNegativeAmount(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || "");
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** A seed's module list, written in the old flat keys (the tiers were
 * designed in them) and stored in the module format. */
function seedModules(legacyKeys: string[]): string[] {
  return normalizeStoredModules(legacyKeys);
}

/**
 * Seeds for a completely empty plans table.
 *
 * `stripePriceId` is deliberately null on every seed. It used to be read from
 * STRIPE_PRICE_* env vars, which meant a fresh install could advertise the
 * seeded `monthlyPrice` while pointing at a Stripe price created separately
 * for a different amount — exactly how the app came to show $29 and bill $19.
 * The Plans console now creates the Stripe price from the amount an admin
 * sets, so a new install shows "Stripe missing" until someone opens each plan
 * and saves it. That is a deliberate pricing decision rather than a silent
 * mismatch.
 */
function defaultPlanSeeds(): BillingPlanDefinition[] {
  const seeds: Array<Omit<BillingPlanDefinition, "modules">> = [
    {
      key: "free",
      name: "Free",
      description: "For evaluating PropertyPro with a small portfolio.",
      monthlyPrice: 0,
      isCustom: false,
      priceSuffix: "per month",
      stripePriceId: null,
      stripePriceIdYearly: null,
      yearlyPrice: null,
      annualEnabled: false,
      yearlyDiscountPercent: 0,
      yearlyPriceOverride: false,
      limits: {
        properties: positiveInteger(process.env.PLAN_FREE_PROPERTIES, 3),
        members: positiveInteger(process.env.PLAN_FREE_MEMBERS, 3),
        units: positiveInteger(process.env.PLAN_FREE_UNITS, 10),
        tenants: positiveInteger(process.env.PLAN_FREE_TENANTS, 10),
        leases: positiveInteger(process.env.PLAN_FREE_LEASES, 10),
        documents: positiveInteger(process.env.PLAN_FREE_DOCUMENTS, 50),
        storageMb: positiveInteger(process.env.PLAN_FREE_STORAGE_MB, 500),
        invoicesPerMonth: positiveInteger(process.env.PLAN_FREE_INVOICES, 20),
        messagesPerMonth: positiveInteger(process.env.PLAN_FREE_MESSAGES, 0),
      },
      features: seedModules([
        "properties",
        "tenants",
        "leases",
        "maintenance",
        "messaging",
      ]),
      highlights: [
        "Up to 3 properties",
        "3 team members",
        "Core property management",
        "Custom branding",
        "Tenant chat & portal",
        "Email support",
      ],
      featuresHeader: null,
      ctaLabel: "Start for free",
      ctaHref: "/auth/signup",
      popular: false,
      isPublic: true,
      isActive: true,
      isSystem: true,
      sortOrder: 0,
    },
    {
      key: "starter",
      name: "Starter",
      description: "For small property-management teams.",
      monthlyPrice: nonNegativeAmount(process.env.PLAN_STARTER_PRICE, 29),
      isCustom: false,
      priceSuffix: "per month",
      stripePriceId: null,
      stripePriceIdYearly: null,
      yearlyPrice: null,
      annualEnabled: false,
      yearlyDiscountPercent: 0,
      yearlyPriceOverride: false,
      limits: {
        properties: positiveInteger(process.env.PLAN_STARTER_PROPERTIES, 25),
        members: positiveInteger(process.env.PLAN_STARTER_MEMBERS, 10),
        units: positiveInteger(process.env.PLAN_STARTER_UNITS, 150),
        tenants: positiveInteger(process.env.PLAN_STARTER_TENANTS, 200),
        leases: positiveInteger(process.env.PLAN_STARTER_LEASES, 200),
        documents: positiveInteger(process.env.PLAN_STARTER_DOCUMENTS, 1_000),
        storageMb: positiveInteger(process.env.PLAN_STARTER_STORAGE_MB, 5_000),
        invoicesPerMonth: positiveInteger(process.env.PLAN_STARTER_INVOICES, 500),
        messagesPerMonth: positiveInteger(process.env.PLAN_STARTER_MESSAGES, 200),
      },
      features: seedModules([
        "properties",
        "tenants",
        "leases",
        "applications",
        "maintenance",
        "tickets",
        "accounting",
        "payments",
        "messaging",
        "announcements",
        "data_export",
      ]),
      highlights: [
        "Up to 25 properties",
        "10 team members",
        "Data export",
        "Tenant chat & portal",
      ],
      featuresHeader: "Everything in Free +",
      ctaLabel: "Start free trial",
      ctaHref: "/auth/signup",
      popular: false,
      isPublic: true,
      isActive: true,
      isSystem: false,
      sortOrder: 1,
    },
    {
      key: "professional",
      name: "Professional",
      description: "For growing portfolios and operations teams.",
      monthlyPrice: nonNegativeAmount(process.env.PLAN_PROFESSIONAL_PRICE, 79),
      isCustom: false,
      priceSuffix: "per month",
      stripePriceId: null,
      stripePriceIdYearly: null,
      yearlyPrice: null,
      annualEnabled: false,
      yearlyDiscountPercent: 0,
      yearlyPriceOverride: false,
      limits: {
        properties: positiveInteger(process.env.PLAN_PROFESSIONAL_PROPERTIES, 100),
        members: positiveInteger(process.env.PLAN_PROFESSIONAL_MEMBERS, 50),
        units: positiveInteger(process.env.PLAN_PROFESSIONAL_UNITS, 1_000),
        tenants: positiveInteger(process.env.PLAN_PROFESSIONAL_TENANTS, 2_000),
        leases: positiveInteger(process.env.PLAN_PROFESSIONAL_LEASES, 2_000),
        documents: positiveInteger(process.env.PLAN_PROFESSIONAL_DOCUMENTS, 20_000),
        storageMb: positiveInteger(process.env.PLAN_PROFESSIONAL_STORAGE_MB, 50_000),
        invoicesPerMonth: positiveInteger(process.env.PLAN_PROFESSIONAL_INVOICES, 5_000),
        messagesPerMonth: positiveInteger(
          process.env.PLAN_PROFESSIONAL_MESSAGES,
          1_000,
        ),
      },
      features: seedModules([
        "properties",
        "tenants",
        "leases",
        "applications",
        "agreements",
        "owner_portal",
        "maintenance",
        "inspections",
        "tickets",
        "calendar",
        "accounting",
        "payments",
        "security_deposits",
        "messaging",
        "announcements",
        "data_export",
        "advanced_analytics",
        "bulk_import",
      ]),
      highlights: [
        "Up to 100 properties",
        "50 team members",
        "Advanced analytics",
        "Data export",
      ],
      featuresHeader: "Everything in Starter +",
      ctaLabel: "Start free trial",
      ctaHref: "/auth/signup",
      popular: true,
      isPublic: true,
      isActive: true,
      isSystem: false,
      sortOrder: 2,
    },
    {
      key: "business",
      name: "Business",
      description: "For large organizations requiring unlimited scale.",
      monthlyPrice: nonNegativeAmount(process.env.PLAN_BUSINESS_PRICE, 199),
      isCustom: false,
      priceSuffix: "per month",
      stripePriceId: null,
      stripePriceIdYearly: null,
      yearlyPrice: null,
      annualEnabled: false,
      yearlyDiscountPercent: 0,
      yearlyPriceOverride: false,
      limits: {
        properties: null,
        members: null,
        units: null,
        tenants: null,
        leases: null,
        documents: null,
        storageMb: null,
        invoicesPerMonth: null,
        messagesPerMonth: null,
      },
      // Every module in the tree: the top tier withholds nothing, and as
      // whole sections it also takes in modules added later.
      features: encodeModuleSelection(TOGGLEABLE_LEAF_KEYS),
      highlights: [
        "Unlimited properties",
        "Unlimited team members",
        "Priority support",
        "Advanced analytics",
        "Data export",
      ],
      featuresHeader: "Everything in Professional +",
      ctaLabel: "Start free trial",
      ctaHref: "/auth/signup",
      popular: false,
      isPublic: true,
      isActive: true,
      isSystem: false,
      sortOrder: 3,
    },
  ];
  return seeds.map((seed) => {
    // The fallback reads like a stored row: modules added later included.
    const features = withModulesAddedLater(seed.key, seed.features);
    return {
      ...seed,
      features,
      modules: [...resolveModuleState(features).planEnabled],
    };
  });
}

let seedChecked = false;

/**
 * Seed the default tiers on a brand-new database (table entirely empty).
 * Idempotent and race-safe: concurrent inserts collide on the unique `key`
 * index and are skipped. Never resurrects admin-deleted plans (only seeds when
 * the table is empty).
 */
export async function ensureDefaultPlansSeeded(): Promise<void> {
  if (seedChecked) return;
  try {
    const count = await db.plan.count();
    if (count === 0) {
      // The plans table is world-readable but platform-writable (RLS), so the
      // one-time seed insert must run under an explicit bypass.
      await bypassOrgScope(() =>
        db.plan.createMany({
          data: defaultPlanSeeds().map(({
            limits,
            modules: _modules,
            // Seeds carry no Arabic (plan-i18n.ts translates their wording),
            // and the insert must not name a column that may not exist yet.
            translations: _translations,
            ...seed
          }) => ({
            ...seed,
            limitsProperties: limits.properties,
            limitsMembers: limits.members,
            limitsUnits: limits.units,
            limitsTenants: limits.tenants,
            limitsLeases: limits.leases,
            limitsDocuments: limits.documents,
            limitsStorageMb: limits.storageMb,
            limitsInvoicesPerMonth: limits.invoicesPerMonth,
          })),
          skipDuplicates: true,
        }),
      );
      // The message quota is not a Prisma field yet; it follows the rows.
      for (const seed of defaultPlanSeeds()) {
        await writePlanMessageLimit(seed.key, seed.limits.messagesPerMonth);
      }
      invalidatePlanCache();
    }
    seedChecked = true;
  } catch (error) {
    // Duplicate-key races during concurrent seeding are expected and harmless.
    console.error("Plan seeding skipped due to error", error);
  }
}
