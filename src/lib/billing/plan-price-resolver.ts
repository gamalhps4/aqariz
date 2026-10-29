import "server-only";

/**
 * PropertyPro SaaS - Resolve a plan's Stripe price ids from the console
 *
 * One decision point shared by plan create and plan update, so both behave
 * identically:
 *
 *   - The super-admin types an amount. That amount is created in Stripe and
 *     its price id stored. The console is the source of truth.
 *   - If they *also* paste a price id, it is honoured only when Stripe agrees
 *     it charges the amount they typed. A disagreement is refused with both
 *     numbers named, because silently accepting it is exactly how the app came
 *     to advertise $29 while billing $19.
 *   - A plan with no price (free, custom, or a blank annual term) ends up with
 *     no price id, and any previous one is archived so it cannot be bought.
 */

import { readStripeAmount, syncStripePrice } from "./stripe-price-sync";

export interface ResolvePlanPricesInput {
  planKey: string;
  planName: string;
  monthlyPrice: number | null;
  yearlyPrice: number | null;
  /** A price id the admin typed in, if any. */
  suppliedMonthlyPriceId: string | null;
  suppliedYearlyPriceId: string | null;
  /** What the plan is currently using. */
  currentMonthlyPriceId: string | null;
  currentYearlyPriceId: string | null;
}

export type ResolvePlanPricesResult =
  | { monthlyPriceId: string | null; yearlyPriceId: string | null }
  | { error: string };

async function resolveOne(
  label: string,
  input: {
    planKey: string;
    planName: string;
    amount: number | null;
    interval: "month" | "year";
    supplied: string | null;
    current: string | null;
  },
): Promise<{ priceId: string | null } | { error: string }> {
  const { supplied, current, amount } = input;

  // An explicitly pasted id is a claim about what Stripe will charge. Check it.
  if (supplied && supplied !== current) {
    if (amount === null || amount <= 0) {
      return {
        error: `Remove the ${label} Stripe price ID, or set a ${label} price above zero — a plan cannot charge nothing through a paid price.`,
      };
    }

    const actual = await readStripeAmount(supplied);
    if (!actual) {
      return {
        error: `Stripe does not recognise the ${label} price ID "${supplied}". Leave it blank and the correct price will be created for you.`,
      };
    }
    if (!actual.active) {
      return {
        error: `The ${label} Stripe price "${supplied}" is archived and cannot be sold. Leave it blank to have a new one created.`,
      };
    }
    if (!actual.inAppCurrency) {
      return {
        error: `The ${label} Stripe price "${supplied}" charges in ${actual.currency.toUpperCase()}. Plans are charged in SAR only — leave it blank to have a riyal price created.`,
      };
    }
    if (actual.interval !== input.interval) {
      return {
        error: `The ${label} Stripe price "${supplied}" bills ${actual.interval}ly, not ${input.interval}ly.`,
      };
    }
    if (actual.amount !== amount) {
      return {
        error: `Price mismatch: this plan says ${amount.toFixed(2)} but Stripe price "${supplied}" charges ${actual.amount?.toFixed(2) ?? "an unknown amount"}. Customers would be shown one price and billed another. Fix the amount, or clear the price ID to have a matching one created.`,
      };
    }
    return { priceId: supplied };
  }

  // No explicit id — make Stripe match what was typed.
  const synced = await syncStripePrice({
    planKey: input.planKey,
    planName: input.planName,
    amount,
    interval: input.interval,
    currentPriceId: current,
  });
  return { priceId: synced.priceId };
}

export async function resolvePlanPrices(
  input: ResolvePlanPricesInput,
): Promise<ResolvePlanPricesResult> {
  const monthly = await resolveOne("monthly", {
    planKey: input.planKey,
    planName: input.planName,
    amount: input.monthlyPrice,
    interval: "month",
    supplied: input.suppliedMonthlyPriceId,
    current: input.currentMonthlyPriceId,
  });
  if ("error" in monthly) return monthly;

  const yearly = await resolveOne("annual", {
    planKey: input.planKey,
    planName: input.planName,
    amount: input.yearlyPrice,
    interval: "year",
    supplied: input.suppliedYearlyPriceId,
    current: input.currentYearlyPriceId,
  });
  if ("error" in yearly) return yearly;

  return {
    monthlyPriceId: monthly.priceId,
    yearlyPriceId: yearly.priceId,
  };
}
