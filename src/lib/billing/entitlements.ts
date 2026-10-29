import type { Organization } from "@/generated/prisma/client";
import { db } from "@/lib/db/prisma";
import { isWithinDunningGrace } from "./lifecycle";
import {
  formatPlanLimitValue,
  getPlanByKey,
  getTrialPlanKey,
  planExists,
  planFeatureLabel,
  planLimitLabel,
  type BillingPlanDefinition,
  type BillingPlanKey,
  type PlanLimitKey,
} from "./plans";
import {
  allModulesState,
  isModuleOn,
  resolveModuleState,
  type ModuleState,
} from "./modules";
import { getPlatformModuleSwitches } from "./platform-modules";

export class PlanLimitError extends Error {
  statusCode = 402;
  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

/** The organization columns its effective plan is read from. */
export const EFFECTIVE_PLAN_SELECT = {
  plan: true,
  status: true,
  trialEndsAt: true,
  subscriptionStatus: true,
  stripeSubscriptionId: true,
  pastDueSince: true,
} as const;

export type EffectivePlanFields = Pick<
  Organization,
  keyof typeof EFFECTIVE_PLAN_SELECT
>;

export async function getEffectivePlan(
  organizationId: string,
): Promise<BillingPlanKey> {
  const organization = await db.organization.findFirst({
    where: { id: organizationId },
    select: EFFECTIVE_PLAN_SELECT,
  });
  if (!organization) throw new Error("Organization not found");
  return effectivePlanOf(organization);
}

/** The plan an organization row (read with EFFECTIVE_PLAN_SELECT) is on. */
export async function effectivePlanOf(
  organization: EffectivePlanFields,
): Promise<BillingPlanKey> {
  const trialIsActive =
    organization.status === "trial" &&
    (!organization.trialEndsAt || organization.trialEndsAt > new Date());
  if (trialIsActive) return getTrialPlanKey();

  // A failed payment does not cut access off instantly — the customer keeps
  // the paid plan through the dunning grace window (see billing/lifecycle),
  // and only then drops to free. `unpaid` is Stripe's post-retry terminal
  // state and never carries entitlement.
  const status = organization.subscriptionStatus || "";
  const subscriptionIsUsable =
    ["active", "trialing"].includes(status) ||
    (status === "past_due" &&
      isWithinDunningGrace(organization.pastDueSince));
  if (
    organization.stripeSubscriptionId &&
    subscriptionIsUsable &&
    (await planExists(organization.plan))
  ) {
    return organization.plan;
  }

  // Platform admins may grant a complimentary/manual plan to an active
  // organization that has no Stripe-managed subscription. The organization
  // detail console is the only UI that writes this value, and every change is
  // captured in the platform audit trail.
  if (
    organization.status === "active" &&
    !organization.stripeSubscriptionId &&
    (await planExists(organization.plan))
  ) {
    return organization.plan;
  }

  return "free";
}

/**
 * Refuse to create when the organization is at (or would exceed) its limit.
 *
 * `adding` is how many the caller is about to create — 1 for a single create,
 * N for a bulk one. Without it a request creating 40 units at once would pass
 * a check that only asked whether the *first* one fitted.
 */
export async function enforcePlanLimit(
  organizationId: string,
  resource: PlanLimitKey,
  currentUsage: number,
  adding = 1,
): Promise<void> {
  const planKey = await getEffectivePlan(organizationId);
  const plan = (await getPlanByKey(planKey)) ?? (await getPlanByKey("free"));
  if (!plan) return; // No plans configured — never block.
  const limit = plan.limits[resource];
  if (limit !== null && currentUsage + adding > limit) {
    throw new PlanLimitError(
      `${plan.name} plan limit reached for ${planLimitLabel(resource).toLowerCase()} (${formatPlanLimitValue(resource, limit)}). Upgrade your subscription to continue.`,
    );
  }
}

export interface OrganizationModules {
  planKey: BillingPlanKey;
  /** Null when no plan resolves at all (plans not configured yet). */
  plan: BillingPlanDefinition | null;
  /** What the organization can use: its package after the platform switches. */
  state: ModuleState;
}

// The same package and switches resolve to the same state on every request;
// only the cheap lookup above them is repeated.
const stateMemo = new Map<string, ModuleState>();

function memoizedState(
  plan: BillingPlanDefinition | null,
  disabled: readonly string[],
): ModuleState {
  const memoKey = `${plan ? `${plan.key}:${plan.features.join(",")}` : "*"}|${disabled.join(",")}`;
  let state = stateMemo.get(memoKey);
  if (!state) {
    state = plan
      ? resolveModuleState(plan.features, disabled)
      : allModulesState(disabled);
    if (stateMemo.size > 100) stateMemo.clear();
    stateMemo.set(memoKey, state);
  }
  return state;
}

/**
 * The modules an organization can use. Organization-scoped reads: call it
 * inside the organization's context (every API handler already is).
 */
export async function getOrganizationModules(
  organizationId: string,
): Promise<OrganizationModules> {
  return modulesOfPlan(await getEffectivePlan(organizationId));
}

async function modulesOfPlan(
  planKey: BillingPlanKey,
): Promise<OrganizationModules> {
  const [plan, switches] = await Promise.all([
    getPlanByKey(planKey),
    getPlatformModuleSwitches(),
  ]);
  return { planKey, plan, state: memoizedState(plan, switches.disabled) };
}

/** Whether an organization can use a module (a module key or an old flat
 * key). For jobs and handlers that skip work a package does not include. */
export async function organizationHasModule(
  organizationId: string,
  key: string,
): Promise<boolean> {
  const { state } = await getOrganizationModules(organizationId);
  return isModuleOn(state, key);
}

/**
 * The same answer from an organization row the caller has already read with
 * EFFECTIVE_PLAN_SELECT: no query of its own (the plans and the platform
 * switches are cached), and no organization context needed — for the public
 * pages, where a visitor has none.
 */
export async function organizationRowHasModule(
  organization: EffectivePlanFields,
  key: string,
): Promise<boolean> {
  const { state } = await modulesOfPlan(await effectivePlanOf(organization));
  return isModuleOn(state, key);
}

/**
 * Refuse when the package does not include a module. Takes a module key or an
 * old flat key ("advanced_analytics" is on while any report it covered is).
 */
export async function requirePlanFeature(
  organizationId: string,
  feature: string,
): Promise<void> {
  const { plan, state } = await getOrganizationModules(organizationId);
  if (isModuleOn(state, feature)) return;
  throw new PlanLimitError(
    `${planFeatureLabel(feature)} is not included in the ${plan?.name ?? "current"} plan.`,
  );
}
