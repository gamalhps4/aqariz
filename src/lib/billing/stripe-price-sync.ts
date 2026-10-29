/**
 * PropertyPro SaaS - Keep Stripe prices in step with the Plans console
 *
 * No `server-only` guard, deliberately: the one-off reconciliation script
 * (`pnpm sync:stripe-prices`) imports this from plain Node, where that
 * directive throws by design. `./stripe`, which actually holds the secret key,
 * is likewise unguarded — and both throw without PLATFORM_STRIPE_SECRET_KEY, which the
 * client bundle never has.
 *
 * The price a customer is shown and the price Stripe charges used to be two
 * independent values: the console stored a number, and someone separately
 * created a Stripe Price out of band and pasted its id in. Nothing compared
 * them, so the app advertised $29/month while checkout billed $19.
 *
 * Now the console is the single source of truth. Whatever the super-admin
 * types is what gets created in Stripe, and the two can no longer drift.
 *
 * Stripe Prices are **immutable** — an amount cannot be edited. Changing a
 * plan's price therefore means creating a new Price and archiving the old one.
 * That is also the correct billing behaviour: subscribers already on the old
 * Price keep it (grandfathered) until they change plan, while new checkouts
 * use the new one.
 */

import type Stripe from "stripe";
import { getBillingStripe, isBillingConfigured } from "./stripe";
import { APP_CURRENCY } from "@/lib/regional/region";

export type PriceInterval = "month" | "year";

/** Stable per-plan identifier so a re-run finds what it made last time. */
function lookupKey(planKey: string, interval: PriceInterval): string {
  return `propertypro_${planKey}_${interval}ly`;
}

/** Stripe deals in the currency's minor unit; the console deals in whole
 * currency. One conversion, in one place. */
function toMinorUnits(amount: number): number {
  return Math.round(amount * 100);
}

export function fromMinorUnits(unitAmount: number | null): number | null {
  return unitAmount === null ? null : unitAmount / 100;
}

/** Stripe's lowercase code for the app's one currency (lib/regional/region). */
const CURRENCY = APP_CURRENCY.toLowerCase();

/**
 * The product a plan's prices hang off. Reused across price changes so the
 * customer's Stripe invoice keeps saying "PropertyPro Starter" rather than
 * gaining a new product line every time the amount is edited.
 */
async function ensureProduct(
  stripe: Stripe,
  planKey: string,
  planName: string,
): Promise<string> {
  const existing = await stripe.products.search({
    query: `metadata['propertypro_plan']:'${planKey}' AND active:'true'`,
    limit: 1,
  });
  if (existing.data[0]) {
    // Keep the display name current if the admin renamed the plan.
    if (existing.data[0].name !== planName) {
      await stripe.products.update(existing.data[0].id, { name: planName });
    }
    return existing.data[0].id;
  }

  const product = await stripe.products.create({
    name: planName,
    metadata: { propertypro_plan: planKey },
  });
  return product.id;
}

export interface PriceSyncResult {
  priceId: string | null;
  /** What Stripe will actually charge, in whole currency. */
  amount: number | null;
  /** True when a new Price object had to be created. */
  created: boolean;
  /** Set when the caller must be told why no price was produced. */
  reason?: string;
}

/**
 * Return a Stripe Price id that charges exactly `amount` for this plan,
 * creating one if the current price does not (or does not exist).
 *
 * `currentPriceId` is reused untouched when its amount, currency and interval
 * already match — so saving a plan without changing its price costs one API
 * read and creates nothing.
 */
export async function syncStripePrice(input: {
  planKey: string;
  planName: string;
  amount: number | null;
  interval: PriceInterval;
  currentPriceId: string | null;
}): Promise<PriceSyncResult> {
  const { planKey, planName, amount, interval, currentPriceId } = input;

  if (!isBillingConfigured()) {
    return {
      priceId: currentPriceId,
      amount: null,
      created: false,
      reason: "Stripe is not configured",
    };
  }

  // A plan with no price (free, or an annual term the admin left blank) has
  // nothing to sell. Archive whatever was there so it cannot be checked out.
  if (amount === null || amount <= 0) {
    if (currentPriceId) {
      await archivePrice(currentPriceId);
    }
    return { priceId: null, amount: null, created: false };
  }

  const stripe = getBillingStripe();
  const target = toMinorUnits(amount);

  if (currentPriceId) {
    try {
      const price = await stripe.prices.retrieve(currentPriceId);
      const matches =
        price.active &&
        price.unit_amount === target &&
        price.currency === CURRENCY &&
        price.recurring?.interval === interval;
      if (matches) {
        return {
          priceId: price.id,
          amount: fromMinorUnits(price.unit_amount),
          created: false,
        };
      }
    } catch {
      // Deleted, from another Stripe account, or a typo — fall through and
      // mint a correct one rather than leaving the plan unsellable.
    }
  }

  const productId = await ensureProduct(stripe, planKey, planName);

  // The lookup key can only belong to one active price, so free it first.
  const key = lookupKey(planKey, interval);
  const clashes = await stripe.prices.list({
    lookup_keys: [key],
    active: true,
    limit: 100,
  });
  for (const clash of clashes.data) {
    await stripe.prices.update(clash.id, {
      lookup_key: null as never,
      active: false,
    });
  }

  const price = await stripe.prices.create({
    product: productId,
    currency: CURRENCY,
    unit_amount: target,
    recurring: { interval },
    lookup_key: key,
    metadata: { propertypro_plan: planKey },
  });

  // Retire the superseded price last: existing subscriptions keep billing on
  // an archived price, only new checkouts are prevented from using it.
  if (currentPriceId && currentPriceId !== price.id) {
    await archivePrice(currentPriceId);
  }

  return {
    priceId: price.id,
    amount: fromMinorUnits(price.unit_amount),
    created: true,
  };
}

async function archivePrice(priceId: string): Promise<void> {
  try {
    await getBillingStripe().prices.update(priceId, { active: false });
  } catch {
    // Already archived or gone — either way it is no longer sellable.
  }
}

/** What Stripe would actually charge for a price id, for display and for the
 * mismatch guard. Null when unset, unreadable, or Stripe is not configured. */
export async function readStripeAmount(
  priceId: string | null,
): Promise<{
  amount: number | null;
  interval: string | null;
  active: boolean;
  /** Stripe's lowercase code ("sar"). */
  currency: string;
  /** Whether it charges in the app's currency. */
  inAppCurrency: boolean;
} | null> {
  if (!priceId || !isBillingConfigured()) return null;
  try {
    const price = await getBillingStripe().prices.retrieve(priceId);
    return {
      amount: fromMinorUnits(price.unit_amount),
      interval: price.recurring?.interval ?? null,
      active: price.active,
      currency: price.currency,
      inAppCurrency: price.currency === CURRENCY,
    };
  } catch {
    return null;
  }
}
