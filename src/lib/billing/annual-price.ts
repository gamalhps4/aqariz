/**
 * PropertyPro SaaS - Derive a plan's annual price
 *
 * The super-admin turns the annual term on and (optionally) types a discount;
 * the yearly amount falls out of the monthly one. Keeping that arithmetic here
 * — and running it on the server for both plan create and plan update — is
 * what stops the two prices drifting apart: raise the monthly price and the
 * annual figure follows in the same write, rather than continuing to advertise
 * a discount off a price that no longer exists.
 *
 * The override exists for the cases arithmetic can't express (a negotiated
 * round number, a legacy price a customer was promised). The discount is
 * retained while overridden so switching back restores the calculated price.
 */

/** Twelve months less `discountPercent`, rounded to cents. */
export function computeAnnualPrice(
  monthlyPrice: number,
  discountPercent: number,
): number {
  const full = monthlyPrice * 12;
  const discounted = full * (1 - clampDiscount(discountPercent) / 100);
  // Round to cents; Stripe bills in minor units and a fraction of a cent would
  // be silently truncated somewhere less visible than here.
  return Math.round(discounted * 100) / 100;
}

/**
 * Capped just short of 100: a fully discounted annual term would price at zero,
 * and `syncStripePrice` archives zero-amount prices, leaving a plan advertising
 * a yearly term it has no Stripe price to sell. Give a year away with a free
 * plan, not a 100% discount.
 */
export const MAX_ANNUAL_DISCOUNT_PERCENT = 99;

export function clampDiscount(percent: number): number {
  if (!Number.isFinite(percent)) return 0;
  return Math.min(MAX_ANNUAL_DISCOUNT_PERCENT, Math.max(0, percent));
}

export interface AnnualPriceInput {
  isCustom: boolean;
  annualEnabled: boolean;
  monthlyPrice: number;
  yearlyDiscountPercent: number;
  yearlyPriceOverride: boolean;
  /** The hand-typed amount, honoured only when `yearlyPriceOverride` is set. */
  overrideAmount: number | null;
}

export interface AnnualPriceResult {
  annualEnabled: boolean;
  yearlyPrice: number | null;
  yearlyDiscountPercent: number;
  yearlyPriceOverride: boolean;
}

/**
 * The single decision point for what a plan charges annually. Both plan
 * create and plan update call this so they cannot disagree.
 */
export function resolveAnnualPricing(
  input: AnnualPriceInput,
): AnnualPriceResult {
  const discount = clampDiscount(input.yearlyDiscountPercent);

  // A custom ("contact us") plan quotes no price at all, monthly or annual.
  // A free plan has nothing to bill for a year either.
  if (input.isCustom || !input.annualEnabled || input.monthlyPrice <= 0) {
    return {
      annualEnabled: false,
      yearlyPrice: null,
      yearlyDiscountPercent: discount,
      yearlyPriceOverride: input.yearlyPriceOverride,
    };
  }

  if (input.yearlyPriceOverride) {
    // An override switched on with nothing typed yet falls back to the
    // calculated price rather than blanking the annual term mid-edit.
    const amount =
      input.overrideAmount !== null && input.overrideAmount > 0
        ? Math.round(input.overrideAmount * 100) / 100
        : computeAnnualPrice(input.monthlyPrice, discount);
    return {
      annualEnabled: true,
      yearlyPrice: amount,
      yearlyDiscountPercent: discount,
      yearlyPriceOverride: true,
    };
  }

  return {
    annualEnabled: true,
    yearlyPrice: computeAnnualPrice(input.monthlyPrice, discount),
    yearlyDiscountPercent: discount,
    yearlyPriceOverride: false,
  };
}

/** What twelve monthly payments would have cost, for a "you save X" line. */
export function annualSavings(
  monthlyPrice: number,
  yearlyPrice: number | null,
): number {
  if (yearlyPrice === null) return 0;
  return Math.round((monthlyPrice * 12 - yearlyPrice) * 100) / 100;
}
