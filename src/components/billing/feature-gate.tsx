"use client";

/**
 * PropertyPro SaaS - Feature gate & upgrade prompt
 *
 * Wraps anything the plan may not include. On an entitled plan it renders the
 * children untouched; otherwise it shows what the feature is and how to get
 * it, instead of letting the user click through to a 402.
 *
 * `mode="disable"` keeps the control visible but inert with a tooltip-style
 * hint — the right choice when hiding it entirely would make the UI look
 * broken (a missing column in a toolbar, say).
 */

import type { ReactNode } from "react";
import Link from "next/link";
import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { planFeatureLabel } from "@/lib/billing/plan-constants";
import { useHasFeature } from "@/hooks/use-entitlements";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface FeatureGateProps {
  feature: string;
  children: ReactNode;
  /** "card" replaces the content with an upgrade panel (default);
   *  "disable" dims the content and blocks interaction;
   *  "hide" renders nothing at all. */
  mode?: "card" | "disable" | "hide";
  /** Optional one-liner explaining what the feature does for them. */
  description?: string;
}

export function FeatureGate({
  feature,
  children,
  mode = "card",
  description,
}: FeatureGateProps) {
  const { hasFeature, loading, entitlements } = useHasFeature(feature);
  const { t } = useLocalizationContext();

  // Render children while entitlements are still unknown — a flash of
  // "upgrade" on every page load would be worse than a late gate, and the
  // server refuses the action regardless.
  if (loading || hasFeature) return <>{children}</>;

  if (mode === "hide") return null;

  const label = t(`settings.billing.feature.${feature}`, {
    defaultValue: planFeatureLabel(feature),
  });

  if (mode === "disable") {
    return (
      <div className="relative inline-block">
        <div
          aria-hidden="true"
          className="pointer-events-none opacity-40 grayscale"
        >
          {children}
        </div>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="inline-flex items-center gap-1 rounded-full bg-background/90 px-2 py-0.5 text-xs font-medium shadow-sm">
            <Lock className="size-3" />
            {entitlements?.canManageBilling ? (
              <Link
                href="/dashboard/settings/billing"
                className="underline underline-offset-2"
              >
                {t("billing.gate.upgrade", { defaultValue: "Upgrade" })}
              </Link>
            ) : (
              t("billing.gate.notOnPlan", { defaultValue: "Not on your plan" })
            )}
          </span>
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed p-8 text-center">
      <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="size-5" />
      </div>
      <h3 className="mt-4 font-semibold">
        {t("billing.gate.title", { defaultValue: "{feature} is not on your plan", values: { feature: label } })}
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
        {description ??
          t("billing.gate.body", { defaultValue: "Your current plan does not include this. Upgrade to turn it on — your existing data is untouched either way." })}
      </p>
      {entitlements?.canManageBilling ? (
        <Button asChild className="mt-5">
          <Link href="/dashboard/settings/billing">
            {t("billing.notice.viewPlans", { defaultValue: "View plans" })}
          </Link>
        </Button>
      ) : (
        <p className="mt-5 text-xs text-muted-foreground">
          {t("billing.gate.askAdmin", { defaultValue: "Ask an administrator to upgrade the account." })}
        </p>
      )}
    </div>
  );
}
