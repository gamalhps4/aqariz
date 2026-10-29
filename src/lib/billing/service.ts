import Stripe from "stripe";
import { db } from "@/lib/db/prisma";
import { bypassOrgScope } from "@/lib/tenancy/context";
import type { Organization as OrganizationModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// The money result extension hands back numbers, not Decimals.
type Organization = MoneyAsNumber<OrganizationModel>;
import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import {
  getPlanByKey,
  invalidatePlanCache,
  planExists,
  planForStripePrice,
  type BillingPlanDefinition,
} from "./plans";
import { getBillingStripe } from "./stripe";
import { syncStripePrice } from "./stripe-price-sync";
import { fromMinorUnits } from "@/lib/payments/amounts";

/** Stripe subscription lifecycle states mirrored onto the organization. */
export type OrganizationSubscriptionStatus =
  | "incomplete"
  | "incomplete_expired"
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "paused";

function toDate(timestamp: number | null | undefined): Date | null {
  return timestamp ? new Date(timestamp * 1000) : null;
}

export async function requireUserOrganization(
  user: AuthenticatedAccessUser,
): Promise<Organization> {
  if (!user.organizationId) throw new Error("Organization membership required");
  const organization = await db.organization.findFirst({
    where: { id: user.organizationId },
  });
  if (!organization) throw new Error("Organization not found");
  return organization;
}

export function assertCanManageBilling(
  organization: Organization,
  user: AuthenticatedAccessUser,
): void {
  if (!user.isAdmin && organization.ownerId !== user.id) {
    const error = new Error("Only organization administrators can manage billing") as Error & {
      statusCode: number;
    };
    error.statusCode = 403;
    throw error;
  }
}

async function ensureStripeCustomer(
  organization: Organization,
  user: AuthenticatedAccessUser,
): Promise<string> {
  if (organization.stripeCustomerId) return organization.stripeCustomerId;

  const stripe = getBillingStripe();
  const customer = await stripe.customers.create({
    email: user.email,
    name: organization.name,
    metadata: {
      organizationId: organization.id,
      organizationSlug: organization.slug,
    },
  });

  // Organization rows are member-readable but platform-writable under RLS, so
  // recording the customer pointer from an org-scoped request needs a bypass.
  await bypassOrgScope(() =>
    db.organization.update({
      where: { id: organization.id },
      data: { stripeCustomerId: customer.id },
    }),
  );
  return customer.id;
}

/**
 * The Stripe price a checkout charges: the plan's own, checked against Stripe
 * first. A price made while plans were billed in dollars still charges USD
 * under a riyal price tag, and one edited in Stripe can charge another
 * amount than the console shows — so a price that does not charge exactly
 * the console's amount in the app's currency (stripe-price-sync) is replaced
 * by one that does, and stored on the plan, as saving the plan would. Null
 * when the plan has no price for that term.
 */
async function sellablePriceId(
  plan: BillingPlanDefinition,
  interval: "month" | "year",
): Promise<string | null> {
  const current =
    interval === "year" ? plan.stripePriceIdYearly : plan.stripePriceId;
  const amount = interval === "year" ? plan.yearlyPrice : plan.monthlyPrice;
  if (!current || amount === null || amount <= 0) return current ?? null;

  const synced = await syncStripePrice({
    planKey: plan.key,
    planName: plan.name,
    amount,
    interval,
    currentPriceId: current,
  });
  if (synced.priceId && synced.priceId !== current) {
    await bypassOrgScope(() =>
      db.plan.update({
        where: { key: plan.key },
        data:
          interval === "year"
            ? { stripePriceIdYearly: synced.priceId }
            : { stripePriceId: synced.priceId },
      }),
    );
    invalidatePlanCache();
  }
  return synced.priceId;
}

export async function createSubscriptionCheckout(
  organization: Organization,
  user: AuthenticatedAccessUser,
  planKey: string,
  origin: string,
  interval: "month" | "year" = "month",
): Promise<Stripe.Checkout.Session> {
  const plan = await getPlanByKey(planKey);
  if (!plan || plan.key === "free" || plan.isCustom || plan.monthlyPrice <= 0) {
    throw new Error("A paid billing plan is required");
  }

  // The console's Active and Public switches only filtered the pricing page, so
  // a retired or private plan stayed purchasable by anyone who knew its key and
  // posted it here. Existing subscribers on a deactivated plan keep it — that is
  // what grandfathering means — but nobody new may join one.
  if (!plan.isActive) {
    throw new Error(`${plan.name} is no longer available`);
  }
  if (!plan.isPublic) {
    throw new Error(`${plan.name} is not open for self-service signup`);
  }

  const priceId = await sellablePriceId(plan, interval);
  if (!priceId) {
    throw new Error(
      interval === "year"
        ? `${plan.name} is not available on an annual term`
        : `Stripe price is not configured for ${plan.name}`,
    );
  }

  const managedSubscriptionStatuses: Array<OrganizationSubscriptionStatus> = [
    "incomplete",
    "trialing",
    "active",
    "past_due",
    "unpaid",
    "paused",
  ];
  if (
    organization.stripeSubscriptionId &&
    organization.subscriptionStatus &&
    managedSubscriptionStatuses.includes(
      organization.subscriptionStatus as OrganizationSubscriptionStatus,
    )
  ) {
    const error = new Error(
      "This organization already has a Stripe subscription. Use the billing portal to change it.",
    ) as Error & { statusCode: number };
    error.statusCode = 409;
    throw error;
  }

  const customerId = await ensureStripeCustomer(organization, user);
  return getBillingStripe().checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    client_reference_id: organization.id,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    // Tax is calculated by Stripe from the customer's address, which means we
    // have to collect one. Without both of these the product cannot be sold
    // anywhere VAT or sales tax applies.
    automatic_tax: { enabled: true },
    tax_id_collection: { enabled: true },
    billing_address_collection: "required",
    customer_update: { address: "auto", name: "auto" },
    success_url: `${origin}/dashboard/settings/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${origin}/dashboard/settings/billing?checkout=canceled`,
    metadata: {
      purpose: "saas_subscription",
      organizationId: organization.id,
      plan: plan.key,
      interval,
    },
    subscription_data: {
      metadata: {
        purpose: "saas_subscription",
        organizationId: organization.id,
        plan: plan.key,
        interval,
      },
    },
  });
}

export async function createCustomerPortalSession(
  organization: Organization,
  user: AuthenticatedAccessUser,
  origin: string,
): Promise<Stripe.BillingPortal.Session> {
  const customerId = await ensureStripeCustomer(organization, user);
  return getBillingStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/dashboard/settings/billing`,
  });
}

export async function findOrganizationForSubscription(
  subscription: Stripe.Subscription,
): Promise<Organization | null> {
  const organizationId = subscription.metadata.organizationId;
  if (organizationId) {
    return db.organization.findFirst({ where: { id: organizationId } });
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer.id;
  return db.organization.findFirst({ where: { stripeCustomerId: customerId } });
}

export async function syncOrganizationSubscription(
  subscription: Stripe.Subscription,
): Promise<Organization | null> {
  const organization = await findOrganizationForSubscription(subscription);
  if (!organization) return null;

  const firstItem = subscription.items.data[0];
  const priceId = firstItem?.price.id ?? null;
  const metadataPlan = subscription.metadata.plan;
  // The billed price is the truth; metadata is a fallback only. Checkout
  // stamps `plan` into metadata but the Stripe billing portal changes the
  // price WITHOUT touching metadata — resolving metadata first kept an org on
  // stale limits after a portal upgrade.
  // A price the plans no longer hold (one replaced when plans moved to
  // riyal, or an amount edited since) still names its plan in its own
  // metadata (stripe-price-sync stamps it), ahead of the subscription's.
  const pricePlan = firstItem?.price?.metadata?.propertypro_plan;
  const resolvedPlan =
    (await planForStripePrice(priceId)) ||
    (pricePlan && (await planExists(pricePlan)) ? pricePlan : null) ||
    (metadataPlan && (await planExists(metadataPlan)) ? metadataPlan : null) ||
    "free";

  // Mirror what Stripe actually bills, so revenue reporting stops guessing
  // from the local plan price. `unit_amount` is in the currency's minor unit —
  // converted currency-aware (JPY has none, so /100 under-reported 100x).
  const price = firstItem?.price;
  const quantity = firstItem?.quantity ?? 1;
  const subscriptionAmount =
    typeof price?.unit_amount === "number"
      ? fromMinorUnits(price.unit_amount * quantity, price.currency)
      : null;

  // `organizations` is member-readable but platform-writable under RLS, so
  // mirroring Stripe's state needs a bypass — the same one `ensureStripeCustomer`
  // uses. Without it this threw for every caller that was not the webhook, which
  // is exactly the checkout-reconcile path that exists to close the redirect race.
  return bypassOrgScope(() =>
    db.organization.update({
      where: { id: organization.id },
      data: {
        stripeSubscriptionId: subscription.id,
        stripePriceId: priceId,
        subscriptionStatus: subscription.status,
        subscriptionAmount,
        subscriptionCurrency: price?.currency?.toUpperCase() ?? null,
        subscriptionInterval: price?.recurring?.interval ?? null,
        plan: resolvedPlan,
        currentPeriodEnd: toDate(firstItem?.current_period_end),
        trialEndsAt: toDate(subscription.trial_end),
        cancelAtPeriodEnd: subscription.cancel_at_period_end,
        ...(organization.status === "trial" &&
        ["active", "trialing"].includes(subscription.status)
          ? { status: "active" }
          : {}),
      },
    }),
  );
}

export async function clearCanceledSubscription(
  subscription: Stripe.Subscription,
): Promise<Organization | null> {
  const organization = await syncOrganizationSubscription(subscription);
  if (!organization) return null;
  return bypassOrgScope(() =>
    db.organization.update({
      where: { id: organization.id },
      data: {
        plan: "free",
        stripePriceId: null,
        cancelAtPeriodEnd: false,
        // Leaving the last amount behind would keep a cancelled organization
        // contributing to MRR.
        subscriptionAmount: null,
        subscriptionCurrency: null,
        subscriptionInterval: null,
      },
    }),
  );
}
