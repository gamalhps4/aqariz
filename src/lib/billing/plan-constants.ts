/**
 * PropertyPro SaaS - Billing plan constants (pure, no DB/prisma imports)
 *
 * Safe to import from client components and shared validation. The DB-backed
 * read/write service lives in `@/lib/billing/plans` (server only) and re-exports
 * these so existing server imports keep working.
 *
 * What a super-admin can put in a plan:
 *
 *   Modules - the menu sections and items a package includes, defined once in
 *     lib/navigation/menu-config.ts and read by lib/billing/modules.ts. Every
 *     module names the pages and API paths it owns; the page guard shows an
 *     upgrade card and `withAccessAndDB` answers 402 when the package leaves
 *     it out. `PLAN_FEATURE_KEYS` below is what a stored list may hold.
 *
 *   Plan.highlights - free-text marketing bullets for the pricing page. Support
 *     tiers, onboarding promises and anything else with no in-app boundary
 *     belong there, not here.
 *
 * `LEGACY_PLAN_FEATURES` is the flat catalog packages were stored with before
 * the module tree. Kept for the labels of lists not yet backfilled and as the
 * record of what each old key opened (modules.test.ts holds the new tree to it,
 * so no office loses a screen).
 */

import {
  ALL_MODULE_KEYS,
  apiModuleCandidates,
  isModuleKey,
  isModuleOptOut,
  moduleLabel,
  pageModuleCandidates,
} from "./modules";

export type BillingPlanKey = string;

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

export type PlanLimitKey =
  | "properties"
  | "units"
  | "members"
  | "tenants"
  | "leases"
  | "documents"
  | "storageMb"
  | "invoicesPerMonth"
  | "messagesPerMonth";

export const PLAN_LIMIT_KEYS: readonly PlanLimitKey[] = [
  "properties",
  "units",
  "members",
  "tenants",
  "leases",
  "documents",
  "storageMb",
  "invoicesPerMonth",
  "messagesPerMonth",
];

/**
 * Limits where 0 is a real setting rather than a mistake. A plan with no
 * properties is no plan, but one that sends no SMS or WhatsApp through the
 * platform's gateway is the Free package (its seed is 0, and the office's own
 * provider stays uncapped). Validation used to demand a positive number on
 * every key, so the Free plan could not be saved from the console at all.
 */
export const PLAN_LIMITS_ALLOWING_ZERO: ReadonlySet<PlanLimitKey> = new Set([
  "messagesPerMonth",
]);

/** Display metadata for each limit, used by the billing screens, the plan
 * console and the over-limit report so a number always arrives with its unit,
 * its label and the window it is measured over. */
export const PLAN_LIMIT_CATALOG: Array<{
  key: PlanLimitKey;
  label: string;
  unit: "count" | "megabytes";
  /** "total" counts every live row; "month" resets each calendar month. */
  period: "total" | "month";
  description: string;
}> = [
  {
    key: "properties",
    label: "Properties",
    unit: "count",
    period: "total",
    description: "Buildings on the books, excluding archived ones.",
  },
  {
    key: "units",
    label: "Units",
    unit: "count",
    period: "total",
    description: "Rentable units across every property.",
  },
  {
    key: "members",
    label: "Team seats",
    unit: "count",
    period: "total",
    description:
      "Staff accounts: admins and managers. Tenants and property owners are free.",
  },
  {
    key: "tenants",
    label: "Tenants",
    unit: "count",
    period: "total",
    description: "Renter accounts with portal access.",
  },
  {
    key: "leases",
    label: "Leases",
    unit: "count",
    period: "total",
    description: "Live lease agreements, excluding archived ones.",
  },
  {
    key: "documents",
    label: "Documents",
    unit: "count",
    period: "total",
    description: "Stored files, counted alongside the storage cap.",
  },
  {
    key: "storageMb",
    label: "File storage",
    unit: "megabytes",
    period: "total",
    description: "Total size of uploaded documents.",
  },
  {
    key: "invoicesPerMonth",
    label: "Invoices",
    unit: "count",
    period: "month",
    description: "Invoices raised in the current calendar month.",
  },
  {
    key: "messagesPerMonth",
    label: "SMS & WhatsApp messages",
    unit: "count",
    period: "month",
    description:
      "Messages sent this calendar month through the platform's gateway. Messages through the office's own provider account do not count.",
  },
];

export function planLimitLabel(key: PlanLimitKey): string {
  return (
    PLAN_LIMIT_CATALOG.find((limit) => limit.key === key)?.label ?? String(key)
  );
}

/** Whether the limit is measured over a calendar month rather than all time. */
export function planLimitIsMonthly(key: PlanLimitKey): boolean {
  return (
    PLAN_LIMIT_CATALOG.find((limit) => limit.key === key)?.period === "month"
  );
}

/** Render a limit or usage figure in the unit its key implies. */
export function formatPlanLimitValue(
  key: PlanLimitKey,
  value: number | null,
): string {
  if (value === null) return "Unlimited";
  if (key !== "storageMb") return value.toLocaleString();
  return value >= 1024
    ? `${(value / 1024).toFixed(value % 1024 === 0 ? 0 : 1)} GB`
    : `${value.toLocaleString()} MB`;
}

// ---------------------------------------------------------------------------
// Entitlement features
// ---------------------------------------------------------------------------

export type PlanFeatureGroup =
  | "core"
  | "operations"
  | "financials"
  | "communication"
  | "advanced";

/** One key of the flat catalog packages were stored with before the module
 * tree, with the paths it used to gate. */
export interface LegacyPlanFeature {
  key: string;
  label: string;
  description: string;
  group: PlanFeatureGroup;
  core?: boolean;
  /** API prefixes it refused with 402 (longest prefix won). */
  apiPrefixes: readonly string[];
  /** Dashboard prefixes it hid from the sidebar. */
  appPrefixes: readonly string[];
}

export const LEGACY_PLAN_FEATURES: readonly LegacyPlanFeature[] = [
  // --- Core portfolio -------------------------------------------------------
  {
    key: "properties",
    label: "Properties & units",
    description:
      "Buildings, units, compounds and property categories — the portfolio itself.",
    group: "core",
    core: true,
    apiPrefixes: [
      "/api/properties",
      "/api/units",
      "/api/compounds",
      "/api/property-categories",
    ],
    appPrefixes: ["/dashboard/properties", "/dashboard/compounds"],
  },
  {
    key: "tenants",
    label: "Tenant records",
    description:
      "Renter profiles, ledgers and the staff-side tenant directory. The renter's own portal is never gated.",
    group: "core",
    core: true,
    apiPrefixes: ["/api/tenants"],
    appPrefixes: ["/dashboard/tenants"],
  },
  {
    key: "leases",
    label: "Leases",
    description: "Lease agreements, renewals, terminations and installments.",
    group: "core",
    core: true,
    apiPrefixes: ["/api/leases"],
    appPrefixes: ["/dashboard/leases"],
  },
  {
    key: "applications",
    label: "Rental applications",
    description: "Applicant intake, screening and approval workflow.",
    group: "core",
    apiPrefixes: ["/api/applications"],
    appPrefixes: ["/dashboard/applications", "/dashboard/tenants/applications"],
  },
  {
    key: "agreements",
    label: "Agreements",
    description: "Management and brokerage agreements separate from leases.",
    group: "core",
    apiPrefixes: ["/api/agreements"],
    appPrefixes: ["/dashboard/agreements"],
  },
  {
    key: "owner_portal",
    label: "Owner portal",
    description:
      "Property-owner accounts, their read-only portfolio view and owner statements.",
    group: "core",
    apiPrefixes: ["/api/owners", "/api/clients"],
    appPrefixes: ["/dashboard/clients", "/dashboard/portfolio"],
  },

  // --- Operations -----------------------------------------------------------
  {
    key: "maintenance",
    label: "Maintenance",
    description: "Maintenance requests, work orders and emergency escalation.",
    group: "operations",
    apiPrefixes: ["/api/maintenance"],
    appPrefixes: ["/dashboard/maintenance"],
  },
  {
    key: "inspections",
    label: "Inspections",
    description: "Scheduled property inspections and their reports.",
    group: "operations",
    apiPrefixes: ["/api/inspections"],
    appPrefixes: ["/dashboard/inspections"],
  },
  {
    key: "tickets",
    label: "Support tickets",
    description: "Internal ticket queue with comments and assignment.",
    group: "operations",
    apiPrefixes: ["/api/tickets"],
    appPrefixes: ["/dashboard/tickets"],
  },
  {
    key: "calendar",
    label: "Calendar & scheduling",
    description:
      "Shared calendar, event invitations, reminders and Google Calendar sync.",
    group: "operations",
    apiPrefixes: ["/api/calendar"],
    appPrefixes: ["/dashboard/calendar"],
  },

  // --- Financials -----------------------------------------------------------
  {
    key: "accounting",
    label: "Accounting & invoicing",
    description:
      "Invoices, expenses, revenues and the transaction ledger.",
    group: "financials",
    apiPrefixes: ["/api/accounting", "/api/invoices"],
    appPrefixes: ["/dashboard/accounting"],
  },
  {
    key: "payments",
    label: "Payment collection",
    description:
      "Rent collection, payment recording, gateways and tenant payment methods.",
    group: "financials",
    apiPrefixes: ["/api/payments"],
    appPrefixes: ["/dashboard/payments"],
  },
  {
    key: "security_deposits",
    label: "Security deposits",
    description: "Deposit tracking, holds and refunds.",
    group: "financials",
    apiPrefixes: ["/api/security-deposits"],
    appPrefixes: [],
  },

  // --- Communication --------------------------------------------------------
  {
    key: "messaging",
    label: "Messaging & chat",
    description: "Conversations with tenants, owners and teammates.",
    group: "communication",
    apiPrefixes: ["/api/conversations", "/api/messages"],
    appPrefixes: ["/dashboard/messages"],
  },
  {
    key: "announcements",
    label: "Announcements",
    description: "Broadcast notices to tenants and staff.",
    group: "communication",
    apiPrefixes: ["/api/announcements"],
    appPrefixes: ["/dashboard/announcements"],
  },

  // --- Advanced -------------------------------------------------------------
  {
    key: "advanced_analytics",
    label: "Advanced analytics",
    description:
      "Financial, lease, payment and agreement reporting beyond the standard dashboard.",
    group: "advanced",
    apiPrefixes: [
      "/api/reports",
      "/api/leases/reports",
      "/api/leases/stats",
      "/api/payments/reports",
      "/api/agreements/reports",
      "/api/invoices/stats",
      "/api/tenants/statistics",
    ],
    appPrefixes: [
      "/dashboard/accounting/reports",
      "/dashboard/leases/reports",
      "/dashboard/payments/reports",
      "/dashboard/payments/analytics",
      "/dashboard/agreements/reports",
    ],
  },
  {
    key: "data_export",
    label: "Data export",
    description:
      "Exporting dashboard data as CSV/JSON. A user's own personal-data download is never gated.",
    group: "advanced",
    apiPrefixes: ["/api/dashboard/export"],
    appPrefixes: [],
  },
  {
    key: "bulk_import",
    label: "Bulk import",
    description: "CSV import of properties, units and tenants.",
    group: "advanced",
    apiPrefixes: ["/api/import"],
    appPrefixes: ["/dashboard/import"],
  },
  {
    key: "audit_log",
    label: "Audit log",
    description: "Who changed what, and when, inside the organization.",
    group: "advanced",
    apiPrefixes: ["/api/audit"],
    appPrefixes: ["/dashboard/admin/audit"],
  },
  {
    key: "custom_roles",
    label: "Custom roles",
    description:
      "Building roles beyond the built-in admin/manager/owner/tenant set.",
    group: "advanced",
    apiPrefixes: ["/api/roles"],
    appPrefixes: ["/dashboard/admin/users/roles"],
  },
] as const;

const LEGACY_KEYS: readonly string[] = LEGACY_PLAN_FEATURES.map(
  (feature) => feature.key,
);

/**
 * Every key a stored package list may hold: the module keys, plus the old
 * flat keys (read through each module's `legacy` entry until the backfill
 * rewrites them). A list may also hold opt-outs ("!<key>", see modules.ts),
 * which `isPlanFeatureKey` accepts.
 */
export const PLAN_FEATURE_KEYS: readonly string[] = [
  ...ALL_MODULE_KEYS,
  ...LEGACY_KEYS,
];

export function isPlanFeatureKey(value: string): boolean {
  return (
    isModuleKey(value) || LEGACY_KEYS.includes(value) || isModuleOptOut(value)
  );
}

/** English label of a module key or an old flat key. */
export function planFeatureLabel(key: string): string {
  if (isModuleKey(key)) return moduleLabel(key);
  return (
    LEGACY_PLAN_FEATURES.find((feature) => feature.key === key)?.label ??
    key.replaceAll("_", " ")
  );
}

// ---------------------------------------------------------------------------
// Path -> module (kept for the verify scripts; the gates use lib/billing/modules)
// ---------------------------------------------------------------------------

/**
 * The first module an API path belongs to, or null when it is open on every
 * package. The real gate asks `apiModuleCandidates`, which can name several
 * modules sharing one API (any of them opens it).
 */
export function resolveApiFeature(pathname: string): string | null {
  return apiModuleCandidates(pathname)?.[0]?.key ?? null;
}

/** The first module a dashboard path belongs to, or null when every package
 * opens it. The page guard asks `pageModuleCandidates`. */
export function resolveAppFeature(pathname: string): string | null {
  const owners = pageModuleCandidates(pathname);
  if (!owners || owners.some((node) => node.alwaysOn)) return null;
  return owners[0]?.key ?? null;
}

// ---------------------------------------------------------------------------
// Plan definition
// ---------------------------------------------------------------------------

export interface BillingPlanDefinition {
  key: BillingPlanKey;
  name: string;
  description: string;
  monthlyPrice: number;
  /** Annual charge when the plan offers a yearly term; null when it doesn't.
   * Always derived server-side from the monthly price and the discount unless
   * `yearlyPriceOverride` is set. */
  yearlyPrice: number | null;
  /** Whether a yearly term is offered at all. */
  annualEnabled: boolean;
  /** Percent off twelve months, applied to reach `yearlyPrice`. */
  yearlyDiscountPercent: number;
  /** True when `yearlyPrice` is a hand-typed amount, not the calculated one. */
  yearlyPriceOverride: boolean;
  isCustom: boolean;
  priceSuffix: string;
  stripePriceId: string | null;
  stripePriceIdYearly: string | null;
  limits: Record<PlanLimitKey, number | null>;
  /** The stored list as written (module keys, or old flat keys not yet
   * backfilled). Read it through `modules`, never with `includes`. */
  features: string[];
  /**
   * Every module key the package opens, old keys translated and sections
   * expanded; always-on modules included, platform switches not applied.
   */
  modules: string[];
  highlights: string[];
  featuresHeader: string | null;
  ctaLabel: string;
  ctaHref: string;
  popular: boolean;
  isPublic: boolean;
  isActive: boolean;
  isSystem: boolean;
  sortOrder: number;
  /** The plan card's Arabic text for /ar and /ar/pricing; each field falls
   * back to the English one (see `@/lib/billing/plan-i18n`). Absent before
   * the column's migration, and on the in-memory seed plans. */
  translations?: PlanTranslations | null;
}

/** The parts of a plan the public pricing cards print, in Arabic. */
export interface PlanArabicText {
  name?: string;
  description?: string;
  /** By position: the English list's length decides how many bullets show. */
  highlights?: string[];
  priceSuffix?: string;
  featuresHeader?: string;
  ctaLabel?: string;
}

export interface PlanTranslations {
  ar?: PlanArabicText;
}

/** Every limit unset (unlimited) — the shape callers fall back to when no plan
 * resolves, so a missing plan never reads as a zero limit. */
export function unlimitedPlanLimits(): Record<PlanLimitKey, number | null> {
  return Object.fromEntries(
    PLAN_LIMIT_KEYS.map((key) => [key, null]),
  ) as Record<PlanLimitKey, number | null>;
}

/** Every usage counter at zero. */
export function emptyPlanUsage(): Record<PlanLimitKey, number> {
  return Object.fromEntries(PLAN_LIMIT_KEYS.map((key) => [key, 0])) as Record<
    PlanLimitKey,
    number
  >;
}
