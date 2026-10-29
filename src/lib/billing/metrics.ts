/**
 * PropertyPro SaaS - Platform billing metrics
 *
 * Aggregates subscription/revenue figures across ALL organizations for the
 * super-admin console. Must be called from a platform-admin context (org
 * scoping bypassed) so `Organization.find` returns every tenant.
 *
 * MRR uses the amount Stripe actually bills, mirrored onto the organization at
 * sync time, and falls back to the local plan price only for organizations
 * with no Stripe subscription (complimentary plans an operator granted). The
 * old estimate-from-plan-price approach was wrong for anyone on a promo code,
 * a grandfathered price, or an annual term.
 *
 * Annual subscriptions contribute amount/12, so MRR stays a monthly figure.
 * Only `active` subscriptions count; `past_due`/`unpaid` are surfaced
 * separately as "at risk".
 *
 * Totals cover subscriptions billed in BILLING_CURRENCY only. Anything billed
 * in another currency is reported as `excludedOtherCurrency` instead of being
 * added in unconverted — a mixed-currency sum labelled with one currency code
 * is simply a wrong number.
 */

import { db } from "@/lib/db/prisma";
import { getAllPlans, BILLING_CURRENCY, type BillingPlanKey } from "./plans";

export interface OrgBillingRow {
  /** Monthly-normalised value, so an annual plan is comparable to a monthly one. */
  id: string;
  name: string;
  slug: string;
  plan: BillingPlanKey;
  status: string;
  subscriptionStatus: string | null;
  monthlyValue: number;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
}

export interface PlatformBillingMetrics {
  currency: string;
  mrr: number;
  arr: number;
  atRiskMrr: number;
  /** Subscriptions billed in another currency, left out of the totals above. */
  excludedOtherCurrency: number;
  counts: {
    total: number;
    paying: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    free: number;
    suspended: number;
  };
  planDistribution: Array<{
    plan: BillingPlanKey;
    name: string;
    count: number;
    mrr: number;
  }>;
  organizations: OrgBillingRow[];
}

export async function getPlatformBillingMetrics(): Promise<PlatformBillingMetrics> {
  const planList = await getAllPlans();
  const planMap = new Map(planList.map((plan) => [plan.key, plan]));

  const orgs = await db.organization.findMany({
    // Closed accounts kept inflating every total, including MRR.
    where: { deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      plan: true,
      status: true,
      subscriptionStatus: true,
      stripeCustomerId: true,
      currentPeriodEnd: true,
      trialEndsAt: true,
      cancelAtPeriodEnd: true,
      createdAt: true,
      subscriptionAmount: true,
      subscriptionInterval: true,
      subscriptionCurrency: true,
    },
    orderBy: { createdAt: "desc" },
  });

  let mrr = 0;
  let atRiskMrr = 0;
  /** Paying/at-risk organizations billed in something other than BILLING_CURRENCY. */
  let otherCurrencyCount = 0;
  const counts = {
    total: 0,
    paying: 0,
    trialing: 0,
    pastDue: 0,
    canceled: 0,
    free: 0,
    suspended: 0,
  };
  const planAgg = new Map<BillingPlanKey, { count: number; mrr: number }>();
  for (const plan of planList) planAgg.set(plan.key, { count: 0, mrr: 0 });
  if (!planAgg.has("free")) planAgg.set("free", { count: 0, mrr: 0 });

  const rows: OrgBillingRow[] = orgs.map((o) => {
    counts.total++;
    if (o.status === "suspended") counts.suspended++;

    const planKey: BillingPlanKey = planMap.has(o.plan ?? "")
      ? (o.plan as BillingPlanKey)
      : "free";
    // Real billed amount first; the plan price is only a fallback for
    // organizations Stripe knows nothing about.
    const planPrice = planMap.get(planKey)?.monthlyPrice ?? 0;
    const billed = o.subscriptionAmount;
    const price =
      billed === null || billed === undefined
        ? planPrice
        : o.subscriptionInterval === "year"
          ? billed / 12
          : billed;

    // Only amounts actually billed in the reporting currency are summed. A
    // subscription in another currency is counted and reported separately
    // rather than added to the total: €100 + $100 is not 200 of anything, and
    // labelling it "USD" made the platform's headline revenue figure wrong.
    const billedCurrency = o.subscriptionCurrency ?? BILLING_CURRENCY;
    const countsTowardTotal =
      billed === null || billed === undefined
        ? true // no Stripe subscription — plan price is already in BILLING_CURRENCY
        : billedCurrency === BILLING_CURRENCY;
    const sub = o.subscriptionStatus ?? null;

    const isPaying = sub === "active";
    const isPastDue = sub === "past_due" || sub === "unpaid";
    const isTrialing = o.status === "trial" || sub === "trialing";
    const isCanceled = sub === "canceled";

    const bucket = planAgg.get(planKey);
    let monthlyValue = 0;
    if (isPaying) {
      if (countsTowardTotal) mrr += price;
      else otherCurrencyCount++;
      monthlyValue = price;
      counts.paying++;
      if (bucket) {
        bucket.count++;
        if (countsTowardTotal) bucket.mrr += price;
      }
    } else if (isPastDue) {
      if (countsTowardTotal) atRiskMrr += price;
      else otherCurrencyCount++;
      monthlyValue = price;
      counts.pastDue++;
      if (bucket) {
        bucket.count++;
        if (countsTowardTotal) bucket.mrr += price;
      }
    } else if (isTrialing) {
      counts.trialing++;
    } else if (isCanceled) {
      counts.canceled++;
    } else {
      counts.free++;
    }

    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      plan: planKey,
      status: o.status,
      subscriptionStatus: sub,
      monthlyValue,
      currentPeriodEnd: o.currentPeriodEnd
        ? new Date(o.currentPeriodEnd).toISOString()
        : null,
      trialEndsAt: o.trialEndsAt
        ? new Date(o.trialEndsAt).toISOString()
        : null,
      cancelAtPeriodEnd: Boolean(o.cancelAtPeriodEnd),
      hasStripeCustomer: Boolean(o.stripeCustomerId),
    };
  });

  const planDistribution = Array.from(planAgg.entries()).map(([key, agg]) => ({
    plan: key,
    name: planMap.get(key)?.name ?? key,
    count: agg.count,
    mrr: agg.mrr,
  }));

  return {
    currency: BILLING_CURRENCY,
    mrr,
    arr: mrr * 12,
    atRiskMrr,
    excludedOtherCurrency: otherCurrencyCount,
    counts,
    planDistribution,
    organizations: rows,
  };
}
