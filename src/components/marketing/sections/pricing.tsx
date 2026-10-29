"use client";

import Link from "next/link";
import { useState } from "react";
import { CircleDot } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PricingContent } from "@/lib/marketing/landing-types";

export interface PricingCard {
  name: string;
  /** Monthly amount, already formatted ("$29" / "Custom"). */
  price: string;
  suffix: string | null;
  /** Annual amount, formatted the same way. Null when the plan has no annual term. */
  yearlyPrice: string | null;
  yearlySuffix: string | null;
  /** Savings badge text, e.g. "Save $58" — null when there is nothing to save. */
  yearlySavings: string | null;
  cta: string;
  href: string;
  popular: boolean;
  featuresHeader: string | null;
  features: string[];
}

type Interval = "month" | "year";

/** The toggle's and the badge's words, in the page's language. */
export interface PricingLabels {
  billingPeriod: string;
  monthly: string;
  yearly: string;
  popular: string;
}

const ENGLISH_LABELS: PricingLabels = {
  billingPeriod: "Billing period",
  monthly: "Monthly",
  yearly: "Yearly",
  popular: "Popular",
};

export function PricingSection({
  content,
  plans,
  labels = ENGLISH_LABELS,
}: {
  content: PricingContent;
  plans: PricingCard[];
  labels?: PricingLabels;
}) {
  const [interval, setInterval] = useState<Interval>("month");
  // Only offer the choice when at least one plan actually has an annual term
  // configured in the Platform Console — otherwise the toggle would switch to a
  // column of unchanged prices.
  const annualOffered = plans.some((plan) => plan.yearlyPrice !== null);

  return (
    <section id="pricing" className="bg-white pt-20 lg:pt-[117.4px]">
      <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
        <div className="mx-auto mb-14 max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-blue-600">{content.eyebrow}</p>
          <h2 className="mt-4 text-4xl font-bold leading-[1.05] tracking-[-.04em] text-slate-900 sm:text-5xl">
            {content.headingLine1}
            <br />
            {content.headingLine2}
          </h2>
          <p className="mt-5 text-sm text-slate-500">{content.subtext}</p>
          {annualOffered && (
            <div
              role="group"
              aria-label={labels.billingPeriod}
              className="mx-auto mt-8 flex w-56 rounded-full bg-slate-100 p-1"
            >
              {(["month", "year"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  aria-pressed={interval === option}
                  onClick={() => setInterval(option)}
                  className={`flex-1 rounded-full py-2 text-center text-sm transition ${
                    interval === option
                      ? "bg-white font-bold text-slate-900 shadow-sm"
                      : "font-semibold text-slate-400 hover:text-slate-600"
                  }`}
                >
                  {option === "month" ? labels.monthly : labels.yearly}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="relative mx-auto max-w-6xl">
          <div className="grid rounded-2xl border border-slate-200 lg:grid-cols-4">
            {plans.map((plan, index) => {
              // A plan without an annual term keeps showing its monthly price
              // rather than disappearing from the grid.
              const showYearly = interval === "year" && plan.yearlyPrice !== null;
              const price = showYearly ? plan.yearlyPrice : plan.price;
              const suffix = showYearly ? plan.yearlySuffix : plan.suffix;
              return (
              <div
                key={plan.name}
                className={`relative flex flex-col ${index < plans.length - 1 ? "lg:border-e lg:border-slate-200" : ""} ${plan.popular ? "bg-blue-50/40" : ""}`}
              >
                {plan.popular && (
                  <span className="absolute inset-x-0 -top-7 z-10 flex h-9 items-center justify-center rounded-t-2xl bg-linear-to-r from-blue-500 to-indigo-600 text-sm font-semibold text-white shadow-md">{labels.popular}</span>
                )}
                <div className="border-b border-slate-200 px-7 pb-7 pt-8">
                  <p className="text-lg font-bold text-slate-900">{plan.name}</p>
                  <div className="mt-5 flex items-baseline gap-2">
                    <span className={`text-4xl font-bold tracking-tight ${plan.popular ? "text-blue-600" : "text-slate-900"}`}>{price}</span>
                    {suffix && <span className="text-sm text-slate-400">{suffix}</span>}
                  </div>
                  {showYearly && plan.yearlySavings && (
                    <p className="mt-2 text-xs font-semibold text-emerald-600">{plan.yearlySavings}</p>
                  )}
                </div>
                <div className="flex flex-1 flex-col px-7 pb-8 pt-7">
                  {plan.featuresHeader && <p className="mb-4 text-sm font-bold text-slate-900">{plan.featuresHeader}</p>}
                  <ul className="space-y-3.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2.5 text-sm text-slate-600">
                        <CircleDot className="size-4 shrink-0 text-pink-500" strokeWidth={2} />
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    asChild
                    variant={plan.popular ? "default" : "outline"}
                    className={`mt-10 w-full rounded-lg ${plan.popular ? "bg-linear-to-r from-blue-500 to-indigo-600 text-white hover:opacity-90" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}
                  >
                    <Link href={plan.href}>{plan.cta}</Link>
                  </Button>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
