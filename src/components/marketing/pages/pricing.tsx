import type { Metadata } from "next";
import Link from "next/link";
import { Check } from "lucide-react";
import {
  BILLING_CURRENCY,
  formatPlanPrice,
  getPublicPlans,
} from "@/lib/billing/plans";
import { localizePlan } from "@/lib/billing/plan-i18n";
import { localizeHref, type MarketingLang } from "@/lib/marketing/landing-i18n";
import { languageAlternates } from "@/lib/marketing/seo";
import { siteText } from "@/lib/marketing/site-text";
import { Button } from "@/components/ui/button";
import {
  MarketingPageShell,
  MarketingPageHeader,
} from "@/components/marketing/page-shell";

export async function pricingMetadata(lang: MarketingLang): Promise<Metadata> {
  // The site name is added by the layout's title template.
  return {
    title: siteText(lang, "pricingPage.metaTitle"),
    description: siteText(lang, "pricingPage.metaDescription"),
    ...languageAlternates("/pricing", lang),
  };
}

const FAQ_KEYS = ["changePlans", "trialEnds", "tenantSeats", "paymentFails"] as const;

/**
 * The billing currency as the footnote names it: the code on the English page
 * ("SAR"), the currency's Arabic name on the Arabic one ("ريال سعودي").
 * `Intl.DisplayNames` is not the patched `NumberFormat` (see
 * `formatPlanPrice`), so it names the real currency.
 */
function currencyName(lang: MarketingLang): string {
  if (lang === "en") return BILLING_CURRENCY;
  try {
    return (
      new Intl.DisplayNames(["ar"], { type: "currency" }).of(BILLING_CURRENCY) ??
      BILLING_CURRENCY
    );
  } catch {
    return BILLING_CURRENCY;
  }
}

/** /pricing and /ar/pricing: the public plans, the limits that matter, and the FAQ. */
export async function MarketingPricingPage({ lang }: { lang: MarketingLang }) {
  const plans = (await getPublicPlans()).map((plan) => localizePlan(plan, lang));
  const text = (key: string, values?: Record<string, string | number>) =>
    siteText(lang, `pricingPage.${key}`, values);
  const unlimited = text("unlimited");

  return (
    <MarketingPageShell lang={lang}>
      <MarketingPageHeader
        eyebrow={text("eyebrow")}
        title={text("title")}
        lead={text("lead")}
      />

      <div className="mx-auto mt-14 grid max-w-7xl gap-6 px-5 sm:px-8 lg:grid-cols-4 lg:px-10">
        {plans.map((plan) => (
          <div
            key={plan.key}
            className={`relative flex flex-col rounded-2xl border p-7 ${
              plan.popular
                ? "border-blue-600 shadow-[0_20px_60px_-24px_rgba(37,99,235,.45)]"
                : "border-slate-200"
            }`}
          >
            {plan.popular && (
              <span className="absolute -top-3 start-7 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
                {text("mostPopular")}
              </span>
            )}
            <h2 className="text-lg font-semibold text-slate-900">{plan.name}</h2>
            <p className="mt-1 min-h-10 text-sm text-slate-600">
              {plan.description}
            </p>
            <p className="mt-5 flex items-baseline gap-1">
              <span className="text-4xl font-bold tracking-[-0.02em] text-slate-900">
                {plan.isCustom
                  ? siteText(lang, "pricing.custom")
                  : formatPlanPrice(plan.monthlyPrice, BILLING_CURRENCY, lang)}
              </span>
              {!plan.isCustom && (
                <span className="text-sm text-slate-500">
                  {plan.priceSuffix}
                </span>
              )}
            </p>

            <dl className="mt-6 space-y-1.5 border-y border-slate-100 py-4 text-sm text-slate-600">
              <div className="flex justify-between gap-3">
                <dt>{text("properties")}</dt>
                <dd className="font-medium text-slate-900">
                  {plan.limits.properties ?? unlimited}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{text("staffSeats")}</dt>
                <dd className="font-medium text-slate-900">
                  {plan.limits.members ?? unlimited}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt>{text("tenantAccounts")}</dt>
                <dd className="font-medium text-slate-900">{unlimited}</dd>
              </div>
            </dl>

            <ul className="mt-5 flex-1 space-y-2.5 text-sm text-slate-700">
              {plan.highlights.map((highlight) => (
                <li key={highlight} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-blue-600" />
                  <span>{highlight}</span>
                </li>
              ))}
            </ul>

            <Button
              asChild
              className={`mt-7 w-full rounded-full ${
                plan.popular
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-slate-900 hover:bg-slate-800"
              }`}
            >
              <Link href={localizeHref(plan.ctaHref, lang)}>{plan.ctaLabel}</Link>
            </Button>
          </div>
        ))}
      </div>

      <p className="mx-auto mt-8 max-w-2xl px-5 text-center text-sm text-slate-500 sm:px-8">
        {text("footnote", { currency: currencyName(lang) })}
      </p>

      <section className="mx-auto mt-20 max-w-3xl px-5 pb-24 sm:px-8">
        <h2 className="text-2xl font-bold tracking-[-0.02em] text-slate-900">
          {text("faqTitle")}
        </h2>
        <dl className="mt-8 space-y-7">
          {FAQ_KEYS.map((key) => (
            <div key={key}>
              <dt className="font-semibold text-slate-900">
                {text(`faq.${key}.question`)}
              </dt>
              <dd className="mt-2 leading-relaxed text-slate-600">
                {text(`faq.${key}.answer`)}
              </dd>
            </div>
          ))}
        </dl>
        <p className="mt-10 rounded-xl border border-slate-200 bg-slate-50 p-6 text-sm text-slate-600">
          {text("stillDeciding")}{" "}
          <Link
            href={localizeHref("/contact", lang)}
            className="font-medium text-blue-600 hover:underline"
          >
            {text("talkToUs")}
          </Link>{" "}
          {text("talkToUsAfter")}
        </p>
      </section>
    </MarketingPageShell>
  );
}
