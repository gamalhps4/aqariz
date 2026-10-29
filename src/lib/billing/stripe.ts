/**
 * PropertyPro SaaS - Platform billing Stripe client
 *
 * This is the PLATFORM's Stripe account: the one subscription revenue is
 * collected into. It is reached only from the billing rail (checkout, portal,
 * plan price sync, the billing webhook, the lifecycle cron).
 *
 * It is deliberately not the same client an organization uses to collect rent
 * from its tenants. Those credentials come from the organization's own settings
 * row — see `src/lib/services/payment-config.service.ts`. The two rails shared
 * `STRIPE_SECRET_KEY` until this split, which meant any organization that had
 * not configured a gateway collected its tenants' rent into this account.
 *
 * `PLATFORM_STRIPE_SECRET_KEY` is the name to set. `STRIPE_SECRET_KEY` is still
 * read as a fallback so an existing deployment keeps working through the
 * rename, but it is deprecated: set the explicit name and drop it.
 */

import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/services/payment-config.service";

let billingStripe: Stripe | null = null;

/** The platform's own Stripe secret, under either the new or legacy name. */
export function platformStripeSecretKey(): string | undefined {
  return (
    process.env.PLATFORM_STRIPE_SECRET_KEY?.trim() ||
    process.env.STRIPE_SECRET_KEY?.trim() ||
    undefined
  );
}

/** Whether subscription billing can talk to Stripe at all. Callers that only
 * *display* prices use this to degrade quietly instead of throwing. */
export function isBillingConfigured(): boolean {
  return Boolean(platformStripeSecretKey());
}

export function getBillingStripe(): Stripe {
  const secretKey = platformStripeSecretKey();
  if (!secretKey) {
    throw new Error(
      "PLATFORM_STRIPE_SECRET_KEY is not configured. Subscription billing needs the platform's own Stripe secret key.",
    );
  }
  // Pinned rather than tracking the account default: `syncOrganizationSubscription`
  // reads item-level fields (`current_period_end`) whose shape moves between
  // API versions, and an account-level upgrade must not silently change them.
  if (!billingStripe) {
    billingStripe = new Stripe(secretKey, {
      // Cast keeps this compiling when the SDK's literal type moves ahead of
      // the pin; the pinned version is what Stripe actually serves.
      apiVersion: STRIPE_API_VERSION as Stripe.StripeConfig["apiVersion"],
    });
  }
  return billingStripe;
}
