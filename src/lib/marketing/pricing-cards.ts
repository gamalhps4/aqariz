/**
 * PropertyPro SaaS - The homepage's plan cards, in a language
 *
 * The plans are rows from /admin/plans; this turns them into what the pricing
 * section prints — formatted prices, the annual term and its savings, the
 * card's text — for the English or the Arabic page. The card text comes from
 * the plan's Arabic where it has some (`localizePlan`), the fixed words from
 * the catalogue, and the button follows the visitor to the Arabic page when
 * it points at one.
 */

import { annualSavings } from "@/lib/billing/annual-price";
import { BILLING_CURRENCY, formatPlanPrice } from "@/lib/billing/plans";
import { localizePlan } from "@/lib/billing/plan-i18n";
import type { BillingPlanDefinition } from "@/lib/billing/plan-constants";
import type { PricingCard } from "@/components/marketing/sections/pricing";
import { localizeHref, type MarketingLang } from "./landing-i18n";
import { siteText } from "./site-text";

export function buildPricingCards(
  plans: BillingPlanDefinition[],
  lang: MarketingLang,
): PricingCard[] {
  const money = (amount: number) => formatPlanPrice(amount, BILLING_CURRENCY, lang);
  return plans.map((source) => {
    const plan = localizePlan(source, lang);
    // An annual term is only advertised once the console has both an amount and
    // the Stripe price to charge it with — otherwise checkout would reject the
    // yearly interval the card just promised.
    const annualAvailable =
      !plan.isCustom &&
      plan.annualEnabled &&
      plan.yearlyPrice !== null &&
      Boolean(plan.stripePriceIdYearly);
    const savings = annualAvailable
      ? annualSavings(plan.monthlyPrice, plan.yearlyPrice)
      : 0;
    return {
      name: plan.name,
      price: plan.isCustom ? siteText(lang, "pricing.custom") : money(plan.monthlyPrice),
      suffix: plan.isCustom ? null : plan.priceSuffix,
      yearlyPrice: annualAvailable ? money(plan.yearlyPrice!) : null,
      yearlySuffix: annualAvailable ? siteText(lang, "pricing.perYear") : null,
      yearlySavings:
        savings > 0
          ? plan.yearlyDiscountPercent > 0
            ? siteText(lang, "pricing.saveWithPercent", {
                percent: Math.round(plan.yearlyDiscountPercent),
                amount: money(savings),
              })
            : siteText(lang, "pricing.save", { amount: money(savings) })
          : null,
      cta: plan.ctaLabel,
      href: localizeHref(plan.ctaHref, lang),
      popular: plan.popular,
      featuresHeader: plan.featuresHeader,
      features: plan.highlights,
    };
  });
}
