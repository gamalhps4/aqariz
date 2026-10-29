"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  PLAN_LIMIT_CATALOG,
  formatPlanLimitValue,
  type PlanLimitKey,
} from "@/lib/billing/plan-constants";
import { summarizeModules } from "@/lib/billing/modules";
import { BillingSkeleton } from "@/components/settings/billing-skeleton";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { formatCurrency } from "@/lib/utils/formatting";
import { APP_CURRENCY } from "@/lib/regional/region";

interface Plan {
  key: string;
  name: string;
  description: string;
  available: boolean;
  annualAvailable: boolean;
  monthlyPrice: number;
  yearlyPrice: number | null;
  currency?: string;
  limits: Record<PlanLimitKey, number | null>;
  features: string[];
  modules: string[];
}

interface Overage {
  key: PlanLimitKey;
  limit: number;
  usage: number;
  over: number;
}

interface SubscriptionData {
  organization: {
    plan: string;
    status?: string | null;
    trialEndsAt?: string | null;
    currentPeriodEnd?: string | null;
    cancelAtPeriodEnd: boolean;
    hasCustomer: boolean;
    hasSubscription: boolean;
  };
  usage: Record<PlanLimitKey, number>;
  overages: Overage[];
}

function formatDay(value: string | null | undefined, language: string): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString(language, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Pure fetch — kept outside the component so the effects below can setState
 * from a promise callback rather than synchronously in the effect body. */
async function fetchBilling(): Promise<{
  plans: Plan[];
  subscription: SubscriptionData;
}> {
  const [plansResponse, subscriptionResponse] = await Promise.all([
    fetch("/api/billing/plans"),
    fetch("/api/billing/subscription"),
  ]);
  const plansPayload = await plansResponse.json();
  const subscriptionPayload = await subscriptionResponse.json();
  if (!plansResponse.ok || !subscriptionResponse.ok) {
    throw new Error(
      plansPayload.error ||
        subscriptionPayload.error ||
        "Unable to load billing",
    );
  }
  return { plans: plansPayload.data, subscription: subscriptionPayload.data };
}

export default function BillingSettingsPage() {
  const router = useRouter();
  const { t, language } = useLocalizationContext();
  const limitLabel = (key: string, english: string) =>
    t(`settings.billing.limit.${key}`, { defaultValue: english });
  const limitValue = (key: PlanLimitKey, value: number | null) =>
    value === null
      ? t("settings.billing.unlimited", { defaultValue: "Unlimited" })
      : formatPlanLimitValue(key, value);
  const searchParams = useSearchParams();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [subscription, setSubscription] = useState<SubscriptionData | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [handledSession, setHandledSession] = useState<string | null>(null);

  // The checkout session we still owe the customer an answer about. Derived
  // rather than stored, so there is no state to set synchronously.
  const pendingSessionId =
    searchParams.get("checkout") === "success"
      ? searchParams.get("session_id")
      : null;
  const confirming = Boolean(
    pendingSessionId && handledSession !== pendingSessionId,
  );

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    fetchBilling()
      .then((data) => {
        if (!active) return;
        setPlans(data.plans);
        setSubscription(data.subscription);
      })
      .catch((error) => {
        if (!active) return;
        toast.error(
          error instanceof Error ? error.message : t("settings.billing.loadFailed", { defaultValue: "Could not load your plan" }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadToken, t]);

  // Returning from Stripe. The webhook may not have landed yet, so confirm the
  // session directly instead of showing the customer their old plan.
  useEffect(() => {
    if (searchParams.get("checkout") === "canceled") {
      toast.info(t("settings.billing.checkoutCanceled", { defaultValue: "Checkout canceled — nothing was changed." }));
      router.replace("/dashboard/settings/billing");
      return;
    }
    if (!pendingSessionId || handledSession === pendingSessionId) return;

    let active = true;
    fetch("/api/billing/reconcile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: pendingSessionId }),
    })
      .then((response) =>
        response.json().then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok) {
          throw new Error(payload?.error || t("settings.billing.confirmFailed", { defaultValue: "Could not confirm the payment" }));
        }
        if (payload?.data?.reconciled) {
          toast.success(t("settings.billing.active", { defaultValue: "Your subscription is active — thank you!" }));
        } else {
          // Stripe has the payment but the subscription isn't live yet; the
          // webhook will finish it shortly.
          toast.info(t("settings.billing.pending", { defaultValue: "Payment received. Your plan will update in a moment." }));
        }
        reload();
      })
      .catch((error) => {
        if (active) {
          toast.error(
            error instanceof Error
              ? error.message
              : t("settings.billing.confirmFailed", { defaultValue: "Could not confirm the payment" }),
          );
        }
      })
      .finally(() => {
        if (!active) return;
        setHandledSession(pendingSessionId);
        router.replace("/dashboard/settings/billing");
      });

    return () => {
      active = false;
    };
  }, [pendingSessionId, handledSession, searchParams, router, reload, t]);

  async function redirectFrom(endpoint: string, body?: object) {
    setAction(endpoint);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const payload = await response.json();
      if (!response.ok || !payload.data?.url) {
        throw new Error(payload.error || t("settings.billing.actionFailed", { defaultValue: "Could not open billing. Try again." }));
      }
      window.location.assign(payload.data.url);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t("settings.billing.actionFailed", { defaultValue: "Could not open billing. Try again." }),
      );
      setAction(null);
    }
  }

  if (loading) {
    return <BillingSkeleton />;
  }

  const organization = subscription?.organization;
  const currentPlan = plans.find((plan) => plan.key === organization?.plan);
  const overages = subscription?.overages ?? [];

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("settings.billing.title", { defaultValue: "Billing & plans" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("settings.billing.onPlan", { defaultValue: "You are on the {plan} plan.", values: { plan: currentPlan?.name ?? organization?.plan ?? "Free" } })}
            {organization?.status === "trialing" && organization.trialEndsAt
              ? " " + t("settings.billing.trialEnds", { defaultValue: "The trial ends {date}.", values: { date: formatDay(organization.trialEndsAt, language) } })
              : organization?.currentPeriodEnd && !organization.cancelAtPeriodEnd
                ? " " + t("settings.billing.renews", { defaultValue: "It renews {date}.", values: { date: formatDay(organization.currentPeriodEnd, language) } })
                : ""}
          </p>
        </div>
        {organization?.hasCustomer && (
          <Button
            variant="outline"
            disabled={Boolean(action) || confirming}
            onClick={() => void redirectFrom("/api/billing/portal")}
          >
            {confirming ? (
              <>
                <Loader2 className="me-2 size-4 animate-spin" />
                {t("settings.billing.confirming", { defaultValue: "Confirming…" })}
              </>
            ) : (
              t("settings.billing.manage", { defaultValue: "Manage subscription" })
            )}
          </Button>
        )}
      </div>

      {/* A cancellation scheduled in the Stripe portal used to be invisible
          here — the customer saw a normal active plan until it vanished. */}
      {organization?.cancelAtPeriodEnd && (
        <Card className="border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/30">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              {t("settings.billing.endingTitle", { defaultValue: "Subscription ending" })}
            </CardTitle>
            <CardDescription>
              {t("settings.billing.endingBody", { defaultValue: "Your plan ends on {date}. You keep full access until then, and nothing is deleted afterwards — the account moves to the Free plan.", values: { date: formatDay(organization.currentPeriodEnd, language) } })}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={Boolean(action)}
              onClick={() => void redirectFrom("/api/billing/portal")}
            >
              {t("settings.billing.resume", { defaultValue: "Keep my subscription" })}
            </Button>
          </CardContent>
        </Card>
      )}

      {overages.length > 0 && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-destructive" />
              {t("settings.billing.overTitle", { defaultValue: "Over your plan limits" })}
            </CardTitle>
            <CardDescription>
              {t("settings.billing.overBody", { defaultValue: "Everything you have keeps working, but you cannot add more until you are back within the limits or on a larger plan." })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {overages.map((overage) => (
              <p key={overage.key}>
                <span className="font-medium">
                  {limitLabel(
                    overage.key,
                    PLAN_LIMIT_CATALOG.find((l) => l.key === overage.key)?.label ??
                      overage.key,
                  )}
                </span>
                :{" "}
                {t("settings.billing.overLine", { defaultValue: "{used} of {limit} — {over} over", values: { used: limitValue(overage.key, overage.usage), limit: limitValue(overage.key, overage.limit), over: limitValue(overage.key, overage.over) } })}
              </p>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            {t("settings.billing.usage", { defaultValue: "What you are using" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_LIMIT_CATALOG.map((limit) => {
            const used = subscription?.usage?.[limit.key] ?? 0;
            const cap = currentPlan?.limits?.[limit.key] ?? null;
            const pct = cap ? Math.min(100, Math.round((used / cap) * 100)) : 0;
            return (
              <div key={limit.key} className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="text-muted-foreground">
                    {limitLabel(limit.key, limit.label)}
                  </span>
                  <span className="font-medium tabular-nums">
                    {limitValue(limit.key, used)}
                    <span className="text-muted-foreground">
                      {" / "}
                      {limitValue(limit.key, cap)}
                    </span>
                  </span>
                </div>
                {cap !== null && (
                  <Progress
                    value={pct}
                    className={pct >= 100 ? "[&>div]:bg-destructive" : undefined}
                  />
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Only offer the choice when at least one plan actually has an annual
          price configured — otherwise the toggle is a dead control. */}
      {plans.some((plan) => plan.annualAvailable) && (
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-full border p-1">
            {(["month", "year"] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setInterval(option)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
                  interval === option
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {option === "month"
                  ? t("settings.billing.monthly", { defaultValue: "Monthly" })
                  : t("settings.billing.annual", { defaultValue: "Annual" })}
              </button>
            ))}
          </div>
          {interval === "year" && (
            <span className="text-sm text-muted-foreground">
              {t("settings.billing.billedYearly", { defaultValue: "Billed once a year." })}
            </span>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {plans.map((plan) => {
          const current = organization?.plan === plan.key;
          return (
            <Card
              key={plan.key}
              className={current ? "border-primary" : undefined}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{plan.name}</CardTitle>
                  {current && <Badge>{t("settings.billing.current", { defaultValue: "Current" })}</Badge>}
                </div>
                {plan.key !== "free" && (
                  <p className="flex items-baseline gap-1">
                    <span className="text-2xl font-semibold tabular-nums">
                      {formatCurrency(
                        Math.round(
                          interval === "year" && plan.yearlyPrice !== null
                            ? plan.yearlyPrice
                            : plan.monthlyPrice,
                        ),
                        plan.currency ?? APP_CURRENCY,
                        { minimumFractionDigits: 0, maximumFractionDigits: 0 },
                      )}
                    </span>
                    <span className="text-sm text-muted-foreground">
                      {interval === "year" && plan.annualAvailable
                        ? t("settings.billing.perYear", { defaultValue: "per year" })
                        : t("settings.billing.perMonth", { defaultValue: "per month" })}
                    </span>
                  </p>
                )}
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <dl className="space-y-1 text-muted-foreground">
                  {PLAN_LIMIT_CATALOG.map((limit) => (
                    <div key={limit.key} className="flex justify-between gap-2">
                      <dt>{limitLabel(limit.key, limit.label)}</dt>
                      <dd className="font-medium text-foreground tabular-nums">
                        {limitValue(limit.key, plan.limits?.[limit.key] ?? null)}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="flex flex-wrap gap-1">
                  {summarizeModules(new Set(plan.modules))
                    .filter((row) => row.enabled > 0)
                    .map((row) => (
                      <span
                        key={row.key}
                        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                      >
                        <Check className="h-3 w-3 text-emerald-600" />
                        {t(row.title, { defaultValue: row.label })}
                        {row.enabled < row.total && (
                          <span className="tabular-nums text-muted-foreground">
                            {t("platform.planForm.modules.count", {
                              defaultValue: "{enabled} of {total}",
                              values: { enabled: row.enabled, total: row.total },
                            })}
                          </span>
                        )}
                      </span>
                    ))}
                </div>
                <Button
                  className="w-full"
                  disabled={
                    current ||
                    !plan.available ||
                    (interval === "year" && !plan.annualAvailable) ||
                    plan.key === "free" ||
                    Boolean(action) ||
                    confirming
                  }
                  onClick={() =>
                    void redirectFrom("/api/billing/checkout", {
                      plan: plan.key,
                      interval,
                    })
                  }
                >
                  {current
                    ? t("settings.billing.currentPlan", { defaultValue: "Current plan" })
                    : interval === "year" && !plan.annualAvailable
                      ? t("settings.billing.monthlyOnly", { defaultValue: "Monthly only" })
                      : plan.available
                        ? t("settings.billing.choose", { defaultValue: "Choose plan" })
                        : t("settings.billing.unavailable", { defaultValue: "Unavailable" })}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {organization?.hasSubscription && !organization.cancelAtPeriodEnd && (
        <p className="text-sm text-muted-foreground">
          {t("settings.billing.cancelHint", { defaultValue: "To cancel or change the payment method, use" })}{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-4"
            onClick={() => void redirectFrom("/api/billing/portal")}
          >
            {t("settings.billing.manage", { defaultValue: "Manage subscription" })}
          </button>
          .{" "}
          {t("settings.billing.cancelNote", { defaultValue: "Cancelling takes effect at the end of the current billing period — your data stays intact." })}
        </p>
      )}
    </div>
  );
}
