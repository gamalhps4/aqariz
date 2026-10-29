/**
 * PropertyPro SaaS - Bring Stripe in line with the Plans console
 *
 * `pnpm sync:stripe-prices [--dry-run]`
 *
 * The console is the source of truth for price: whatever a super-admin has set
 * on each plan is what Stripe should charge. Saving a plan in the console now
 * does this automatically — this script exists for the one-off case where the
 * two are already out of step (as they were when Stripe prices had been
 * created by hand at different amounts than the plans advertised).
 *
 * Stripe Prices are immutable, so a changed amount means a new Price and the
 * old one archived. Existing subscribers keep billing on their original price.
 */

import "../lib/env/load-dotenv";
import { authDb } from "../lib/db/prisma";
import { bypassOrgScope } from "../lib/tenancy/context";
import { readStripeAmount, syncStripePrice } from "../lib/billing/stripe-price-sync";
import { isBillingConfigured } from "../lib/billing/stripe";
import { APP_CURRENCY as BILLING_CURRENCY } from "../lib/regional/region";

const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  if (!isBillingConfigured()) {
    console.error(
      "PLATFORM_STRIPE_SECRET_KEY is not set. Plan prices live in the platform's own Stripe account.",
    );
    process.exit(1);
  }

  const plans = await authDb.plan.findMany({ orderBy: { sortOrder: "asc" } });
  let changed = 0;

  for (const plan of plans) {
    const monthly = plan.isCustom ? null : Number(plan.monthlyPrice);
    const yearly =
      plan.isCustom || plan.yearlyPrice === null
        ? null
        : Number(plan.yearlyPrice);

    for (const [interval, amount, currentId, column] of [
      ["month", monthly, plan.stripePriceId, "stripePriceId"],
      ["year", yearly, plan.stripePriceIdYearly, "stripePriceIdYearly"],
    ] as const) {
      const before = await readStripeAmount(currentId);
      // A plan that charges nothing needs no Stripe price at all, so "no
      // amount and no price id" is already correct — not a change to make.
      const sellable = amount !== null && amount > 0;
      // In the app's currency too: prices made while plans were billed in
      // USD match on amount (29 = 29) and still charge dollars.
      const inSync = sellable
        ? before?.amount === amount &&
          before?.active === true &&
          before?.inAppCurrency === true
        : !currentId;

      if (inSync) {
        if (sellable) {
          console.log(`  ok       ${plan.key} ${interval}ly: ${BILLING_CURRENCY} ${amount.toFixed(2)}`);
        }
        continue;
      }

      const wasLabel = before
        ? `${before.currency.toUpperCase()} ${before.amount?.toFixed(2)}`
        : "none";
      const willLabel =
        amount === null ? "none" : `${BILLING_CURRENCY} ${amount.toFixed(2)}`;

      if (DRY_RUN) {
        console.log(`  WOULD FIX ${plan.key} ${interval}ly: ${wasLabel} → ${willLabel}`);
        changed++;
        continue;
      }

      const result = await syncStripePrice({
        planKey: plan.key,
        planName: plan.name,
        amount,
        interval,
        currentPriceId: currentId,
      });

      await authDb.plan.update({
        where: { key: plan.key },
        data: { [column]: result.priceId },
      });

      console.log(
        `  FIXED    ${plan.key} ${interval}ly: ${wasLabel} → ${willLabel}` +
          (result.priceId ? `  (${result.priceId})` : ""),
      );
      changed++;
    }
  }

  console.log(
    changed === 0
      ? "\nEverything already matches the console."
      : DRY_RUN
        ? `\n${changed} price(s) would change. Re-run without --dry-run to apply.`
        : `\n${changed} price(s) updated. Restart or wait 60s for the plan cache to expire.`,
  );
}

bypassOrgScope(main)
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
