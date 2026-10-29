"use client";

/**
 * Payment gateways (Platform Console).
 *
 * Which gateways offices may take payments through: each one switched on or
 * off for the whole platform, the packages that include it, and how it is
 * doing — offices connected, the last webhook received, the last 30 days'
 * online payments. Offices connect their own merchant accounts in Settings →
 * Online payments; no credential lives here.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, CreditCard, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface GatewayHealth {
  officesConnected: number;
  lastWebhookAt: string | null;
  webhooks30d: number;
  received30d: Array<{ currency: string; count: number; amount: number }> | null;
  failed30d: number | null;
}

interface AdminGateway {
  id: string;
  name: string;
  region: "saudi" | "global";
  methods: string[];
  currencies: string[] | null;
  moduleKey: string;
  platformEnabled: boolean;
  plans: string[];
  health: GatewayHealth;
}

interface GatewaysData {
  gateways: AdminGateway[];
  plans: Array<{ key: string; name: string }>;
  switchesAvailable: boolean;
  referenceColumns: boolean;
}

interface Draft {
  platformEnabled: boolean;
  plans: string[];
}

const METHOD_FALLBACK: Record<string, string> = {
  mada: "mada",
  card: "Visa / Mastercard",
  applepay: "Apple Pay",
  stcpay: "STC Pay",
  paypal: "PayPal",
};

export default function PaymentGatewaysPage() {
  const { t, formatDate, formatTime, formatCurrency, formatNumber } = useLocalizationContext();
  const [data, setData] = useState<GatewaysData | null>(null);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/payment-gateways", { cache: "no-store" });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error || "load");
      const next: GatewaysData = json.data ?? json;
      setData(next);
      setDrafts(
        Object.fromEntries(
          next.gateways.map((gateway) => [
            gateway.id,
            { platformEnabled: gateway.platformEnabled, plans: gateway.plans },
          ]),
        ),
      );
      setError("");
    } catch {
      setError(
        t("platform.paymentGateways.loadFailed", {
          defaultValue: "Could not load the payment gateways.",
        }),
      );
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const groups = useMemo(() => {
    const gateways = data?.gateways ?? [];
    return [
      {
        key: "saudi",
        title: t("platform.paymentGateways.saudi", { defaultValue: "Saudi gateways" }),
        items: gateways.filter((gateway) => gateway.region === "saudi"),
      },
      {
        key: "global",
        title: t("platform.paymentGateways.global", { defaultValue: "International gateways" }),
        items: gateways.filter((gateway) => gateway.region === "global"),
      },
    ].filter((group) => group.items.length > 0);
  }, [data, t]);

  const changed = (gateway: AdminGateway) => {
    const draft = drafts[gateway.id];
    if (!draft) return false;
    return (
      draft.platformEnabled !== gateway.platformEnabled ||
      [...draft.plans].sort().join(",") !== [...gateway.plans].sort().join(",")
    );
  };

  const save = async (gateway: AdminGateway) => {
    const draft = drafts[gateway.id];
    if (!draft) return;
    setSaving(gateway.id);
    try {
      const response = await fetch("/api/admin/payment-gateways", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gateway: gateway.id,
          platformEnabled: draft.platformEnabled,
          plans: draft.plans,
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) throw new Error(json?.error);
      toast.success(
        t("platform.paymentGateways.saved", {
          defaultValue: "{name} saved",
          values: { name: gateway.name },
        }),
      );
      await load();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error && saveError.message
          ? saveError.message
          : t("platform.paymentGateways.saveFailed", { defaultValue: "Could not save the gateway." }),
      );
    } finally {
      setSaving(null);
    }
  };

  const setDraft = (id: string, patch: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));

  const currencyText = (gateway: AdminGateway) =>
    gateway.currencies === null
      ? t("platform.paymentGateways.anyCurrency", { defaultValue: "Any currency the office bills in" })
      : gateway.currencies.join(" · ");

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          {t("platform.paymentGateways.title", { defaultValue: "Payment gateways" })}
        </h1>
        <p className="text-muted-foreground">
          {t("platform.paymentGateways.subtitle", {
            defaultValue:
              "Choose which gateways offices can take payments through, and which packages include each. Every office connects its own merchant account, and the money goes straight to it.",
          })}
        </p>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {data && !data.referenceColumns && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("platform.paymentGateways.migrationPending", {
              defaultValue:
                "Online payments are paused until the database update 20261004140000_payment_gateway_reference is applied.",
            })}
          </AlertDescription>
        </Alert>
      )}
      {data && !data.switchesAvailable && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {t("platform.paymentGateways.switchesPending", {
              defaultValue:
                "Switching a gateway off for the whole platform needs the database update 20261003150000_platform_module_switches.",
            })}
          </AlertDescription>
        </Alert>
      )}

      {!data && !error && (
        <div className="space-y-4">
          {[0, 1].map((index) => (
            <Skeleton key={index} className="h-56 w-full" />
          ))}
        </div>
      )}

      {groups.map((group) => (
        <section key={group.key} className="space-y-3">
          <h2 className="text-lg font-semibold">{group.title}</h2>
          <div className="grid gap-4 xl:grid-cols-2">
            {group.items.map((gateway) => {
              const draft = drafts[gateway.id] ?? {
                platformEnabled: gateway.platformEnabled,
                plans: gateway.plans,
              };
              const health = gateway.health;
              return (
                <Card key={gateway.id}>
                  <CardHeader className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <CardTitle className="flex items-center gap-2">
                        <CreditCard className="h-5 w-5 text-muted-foreground" />
                        {gateway.name}
                      </CardTitle>
                      <Badge variant={gateway.platformEnabled ? "default" : "secondary"}>
                        {gateway.platformEnabled
                          ? t("platform.paymentGateways.on", { defaultValue: "Offered" })
                          : t("platform.paymentGateways.off", { defaultValue: "Switched off" })}
                      </Badge>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {gateway.methods.map((method) => (
                        <Badge key={method} variant="outline" className="font-normal">
                          {t(`payments.online.method.${method}`, {
                            defaultValue: METHOD_FALLBACK[method] ?? method,
                          })}
                        </Badge>
                      ))}
                    </div>
                    <CardDescription dir="ltr" className="text-start">
                      {currencyText(gateway)}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
                      <div className="space-y-0.5">
                        <Label htmlFor={`platform-${gateway.id}`}>
                          {t("platform.paymentGateways.platformSwitch", {
                            defaultValue: "Offer on the platform",
                          })}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {t("platform.paymentGateways.platformSwitchHint", {
                            defaultValue:
                              "Off: no office can start a payment through it, whatever its package. Payments already made are still recorded and can be refunded.",
                          })}
                        </p>
                      </div>
                      <Switch
                        id={`platform-${gateway.id}`}
                        checked={draft.platformEnabled}
                        disabled={!data?.switchesAvailable}
                        onCheckedChange={(on) => setDraft(gateway.id, { platformEnabled: on })}
                      />
                    </div>

                    <div className="space-y-2">
                      <p className="text-sm font-medium">
                        {t("platform.paymentGateways.packages", {
                          defaultValue: "Packages that include it",
                        })}
                      </p>
                      {data && data.plans.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          {t("platform.paymentGateways.noPlans", {
                            defaultValue: "No packages are set up yet: every office can use it.",
                          })}
                        </p>
                      ) : (
                        <div className="flex flex-wrap gap-x-5 gap-y-2">
                          {data?.plans.map((plan) => {
                            const id = `plan-${gateway.id}-${plan.key}`;
                            return (
                              <div key={plan.key} className="flex items-center gap-2">
                                <Checkbox
                                  id={id}
                                  checked={draft.plans.includes(plan.key)}
                                  onCheckedChange={(on) =>
                                    setDraft(gateway.id, {
                                      plans: on
                                        ? [...new Set([...draft.plans, plan.key])]
                                        : draft.plans.filter((key) => key !== plan.key),
                                    })
                                  }
                                />
                                <Label htmlFor={id} className="font-normal">
                                  {plan.name}
                                </Label>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    <dl className="grid grid-cols-2 gap-3 rounded-lg bg-muted/40 p-3 text-sm sm:grid-cols-4">
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("platform.paymentGateways.health.offices", { defaultValue: "Offices connected" })}
                        </dt>
                        <dd className="font-semibold">{formatNumber(health.officesConnected)}</dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("platform.paymentGateways.health.lastWebhook", { defaultValue: "Last webhook" })}
                        </dt>
                        <dd className="font-semibold">
                          {health.lastWebhookAt
                            ? `${formatDate(health.lastWebhookAt)} ${formatTime(health.lastWebhookAt)}`
                            : t("platform.paymentGateways.health.never", { defaultValue: "None yet" })}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("platform.paymentGateways.health.received", { defaultValue: "Paid, last 30 days" })}
                        </dt>
                        <dd className="font-semibold">
                          {health.received30d === null
                            ? "—"
                            : health.received30d.length === 0
                              ? formatNumber(0)
                              : health.received30d.map((row) => (
                                  <span key={row.currency} className="block">
                                    {formatNumber(row.count)} · {formatCurrency(row.amount, row.currency)}
                                  </span>
                                ))}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {t("platform.paymentGateways.health.failed", { defaultValue: "Failed, last 30 days" })}
                        </dt>
                        <dd className="font-semibold">
                          {health.failed30d === null ? "—" : formatNumber(health.failed30d)}
                        </dd>
                      </div>
                    </dl>

                    <div className="flex justify-end">
                      <Button
                        onClick={() => save(gateway)}
                        disabled={!changed(gateway) || saving !== null}
                      >
                        {saving === gateway.id && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                        {t("platform.paymentGateways.save", { defaultValue: "Save" })}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ))}
    </ResponsiveLayout>
  );
}
