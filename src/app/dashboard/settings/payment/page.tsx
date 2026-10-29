"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { toast } from "sonner";
import {
  Loader2,
  Eye,
  EyeOff,
  Database,
  Copy,
  CheckCircle2,
  AlertTriangle,
  Plug,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuthorization } from "@/hooks/useAuthorization";
import { PaymentSettingsSkeleton } from "@/components/settings/payment-skeleton";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  PAYMENT_GATEWAYS,
  type GatewayId,
} from "@/lib/payments/gateway-registry";

type GatewayFormState = {
  enabled: boolean;
  [field: string]: string | boolean;
};

interface ActiveInfo {
  /** Always "database": these credentials are this organization's own. */
  source: "database";
  configured: boolean;
}

const buildEmptyForm = (): Record<string, GatewayFormState> => {
  const out: Record<string, GatewayFormState> = {};
  for (const def of PAYMENT_GATEWAYS) {
    const g: GatewayFormState = { enabled: false };
    for (const field of def.fields) {
      // Default select fields to their first option so a required choice is set.
      g[field.key] =
        field.type === "select" ? (field.options?.[0]?.value ?? "") : "";
    }
    out[def.id] = g;
  }
  return out;
};

export default function PaymentSettingsPage() {
  const router = useRouter();
  const { t } = useLocalizationContext();
  /** Gateway copy from the registry, in the reader's language. */
  const gatewayText = (path: string, english?: string) =>
    english ? t(`settings.payment.${path}`, { defaultValue: english }) : english;
  const { status } = useSession();
  const { canManageSystemSettings, isLoading: authzLoading } =
    useAuthorization();

  const [form, setForm] =
    useState<Record<string, GatewayFormState>>(buildEmptyForm());
  const [secretSet, setSecretSet] = useState<
    Record<string, Record<string, boolean>>
  >({});
  const [active, setActive] = useState<Record<string, ActiveInfo>>({});
  const [webhookUrls, setWebhookUrls] = useState<Record<string, string>>({});
  // The gateways the platform and the office's package allow — the only ones
  // shown (lib/payments/gateway-availability.ts).
  const [allowed, setAllowed] = useState<string[]>([]);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const copyWebhookUrl = async (gatewayId: string) => {
    const url = webhookUrls[gatewayId];
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedUrl(gatewayId);
      setTimeout(() => setCopiedUrl(null), 2000);
    } catch {
      toast.error(t("settings.payment.copyFailed", { defaultValue: "Could not copy the address. Select it and copy it by hand." }));
    }
  };
  const [defaultProvider, setDefaultProvider] = useState("stripe");

  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);

  // For whoever holds "System settings", the permission the API behind this
  // screen asks for. Waits for the permissions to arrive: a permission
  // group's come from the server, and turning it away before they do would
  // turn it away every time.
  useEffect(() => {
    if (
      status === "authenticated" &&
      !authzLoading &&
      !canManageSystemSettings
    ) {
      router.replace("/dashboard/settings/profile");
    }
  }, [status, authzLoading, canManageSystemSettings, router]);

  const setGatewayField = (id: string, key: string, value: string | boolean) =>
    setForm((prev) => ({
      ...prev,
      [id]: { ...prev[id], [key]: value },
    }));

  const loadSettings = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/settings/payment", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || t("settings.payment.loadFailed", { defaultValue: "Could not load the payment settings" }));
      }
      const data = json.data ?? json;

      const nextForm = buildEmptyForm();
      const nextSecretSet: Record<string, Record<string, boolean>> = {};
      for (const def of PAYMENT_GATEWAYS) {
        const g = data.gateways?.[def.id] ?? {};
        nextForm[def.id].enabled = !!g.enabled;
        for (const field of def.fields) {
          // Keep buildEmptyForm defaults (e.g. select first option) when the
          // server has no saved value; only override when one is present.
          if (field.type !== "secret" && g[field.key]) {
            nextForm[def.id][field.key] = g[field.key];
          }
        }
        nextSecretSet[def.id] = g.secretSet || {};
      }

      setForm(nextForm);
      setSecretSet(nextSecretSet);
      setActive(data.active || {});
      setWebhookUrls(data.webhookUrls || {});
      setAllowed(Array.isArray(data.allowed) ? data.allowed : []);
      setDefaultProvider(data.defaultProvider || "stripe");
    } catch (error: any) {
      toast.error(error?.message || t("settings.payment.loadFailed", { defaultValue: "Could not load the payment settings" }));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (status === "authenticated" && canManageSystemSettings) loadSettings();
  }, [status, canManageSystemSettings, loadSettings]);

  const handleSave = async () => {
    try {
      setSaving(true);
      const res = await fetch("/api/settings/payment", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // Only the gateways shown: the rest are not this office's to change.
        body: JSON.stringify({
          defaultProvider,
          gateways: Object.fromEntries(
            Object.entries(form).filter(([id]) => allowed.includes(id)),
          ),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || t("settings.common.saveFailed", { defaultValue: "Could not save the settings" }));
      }
      toast.success(t("settings.payment.saved", { defaultValue: "Payment settings saved" }));
      await loadSettings();
    } catch (error: any) {
      toast.error(error?.message || t("settings.common.saveFailed", { defaultValue: "Could not save the settings" }));
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (id: GatewayId) => {
    try {
      setTesting(id);
      const res = await fetch("/api/settings/payment/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, ...form[id] }),
      });
      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || t("settings.payment.testFailed", { defaultValue: "The connection test failed" }));
      }
      toast.success(t("settings.payment.testOk", { defaultValue: "Connected successfully" }));
    } catch (error: any) {
      toast.error(error?.message || t("settings.payment.testFailed", { defaultValue: "The connection test failed" }));
    } finally {
      setTesting(null);
    }
  };

  // The header needs no data, so it is painted immediately and kept identical
  // across both states — only the body below it swaps from skeleton to form.
  const header = (
    <div className="space-y-1">
      <h1 className="text-2xl font-semibold tracking-tight">
        {t("settings.payment.title", { defaultValue: "Online payments" })}
      </h1>
      <p className="text-sm text-muted-foreground">
        {t("settings.payment.subtitle", { defaultValue: "The accounts tenants pay you through online. Settings saved here replace the server defaults." })}
      </p>
    </div>
  );

  // Session resolution, the admin redirect and the settings fetch all show the
  // same shape-matched skeleton, so a slow load never blanks the page or jumps
  // as one gate clears into the next.
  if (
    status === "loading" ||
    (status === "authenticated" && !canManageSystemSettings) ||
    loading
  ) {
    return (
      <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
        {header}
        <PaymentSettingsSkeleton />
      </div>
    );
  }

  const shown = PAYMENT_GATEWAYS.filter((g) => allowed.includes(g.id));
  const enabledImplemented = shown.filter(
    (g) => g.implemented && form[g.id]?.enabled,
  );

  return (
    <div className="container mx-auto max-w-5xl space-y-6 p-4 sm:p-6">
      {header}

      {/* Default gateway */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("settings.payment.default", { defaultValue: "Default payment service" })}
          </CardTitle>
          <CardDescription>
            {t("settings.payment.defaultHint", { defaultValue: "The service tenants pay through. Only services switched on below can be chosen." })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={defaultProvider} onValueChange={setDefaultProvider}>
            <SelectTrigger className="sm:w-72">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {shown.filter((g) => g.implemented).map((g) => {
                const isEnabled = !!form[g.id]?.enabled;
                return (
                  <SelectItem key={g.id} value={g.id} disabled={!isEnabled}>
                    {g.name}
                    {!isEnabled
                      ? ` (${t("settings.payment.notEnabled", { defaultValue: "not switched on" })})`
                      : ""}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {enabledImplemented.length === 0 && (
            <p className="mt-2 text-xs text-amber-600">
              {t("settings.payment.noneEnabled", { defaultValue: "No payment service is switched on yet — switch one on below to accept payments." })}
            </p>
          )}
        </CardContent>
      </Card>

      {shown.length === 0 && (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {t("settings.payment.noneAllowed", { defaultValue: "Your package does not include online payments. Contact the platform to add them." })}
          </CardContent>
        </Card>
      )}

      {/* One card per gateway the package allows */}
      {shown.map((def) => {
        const gatewayActive = active[def.id];
        const gatewayForm = form[def.id];
        return (
          <Card key={def.id} className={!def.implemented ? "opacity-90" : ""}>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2">
                  {def.name}
                  {!def.implemented && (
                    <Badge variant="secondary">
                      {t("settings.payment.comingSoon", { defaultValue: "Coming soon" })}
                    </Badge>
                  )}
                  {def.implemented && gatewayActive?.configured && (
                    <Badge variant="default" className="gap-1">
                      <Database className="h-3 w-3" />
                      {t("settings.payment.yourAccount", { defaultValue: "Your account" })}
                    </Badge>
                  )}
                </CardTitle>
                {def.implemented &&
                  (gatewayActive?.configured ? (
                    <span className="flex items-center gap-1 text-sm text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" /> {t("settings.common.ready", { defaultValue: "Ready" })}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-sm text-amber-600">
                      <AlertTriangle className="h-4 w-4" /> {t("settings.common.notConfigured", { defaultValue: "Not set up" })}
                    </span>
                  ))}
              </div>
              <CardDescription>
                {gatewayText(`gateway.${def.id}.description`, def.description)}
              </CardDescription>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {def.methods.map((method) => (
                  <Badge key={method} variant="outline" className="font-normal">
                    {t(`payments.online.method.${method}`, { defaultValue: method })}
                  </Badge>
                ))}
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Enable toggle */}
              <div className="flex items-start justify-between gap-4 rounded-lg p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_6px_18px_rgba(15,23,42,0.025)] dark:shadow-none">
                <div className="space-y-0.5">
                  <Label className="text-base">
                    {t("settings.payment.useThese", { defaultValue: "Use my account" })}
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {def.implemented
                      ? t("settings.payment.useTheseHint", { defaultValue: "When on, payments go through the account below instead of the server defaults." })
                      : t("settings.payment.notYet", { defaultValue: "Available once this service is supported." })}
                  </p>
                </div>
                <Switch
                  checked={!!gatewayForm?.enabled}
                  disabled={!def.implemented}
                  onCheckedChange={(v) => setGatewayField(def.id, "enabled", v)}
                />
              </div>

              {/* Credential fields */}
              <div className="grid gap-4 sm:grid-cols-2">
                {def.fields.map((field) => {
                  const isSecret = field.type === "secret";
                  const isSelect = field.type === "select";
                  const fieldId = `${def.id}-${field.key}`;
                  const stored = secretSet[def.id]?.[field.key];
                  return (
                    <div key={field.key} className="space-y-2">
                      <Label htmlFor={fieldId}>
                        {gatewayText(`field.${def.id}.${field.key}`, field.label)}
                        {field.required && (
                          <span className="ms-1 text-destructive">*</span>
                        )}
                      </Label>
                      {isSelect ? (
                        <Select
                          value={
                            (gatewayForm?.[field.key] as string) ||
                            field.options?.[0]?.value ||
                            ""
                          }
                          onValueChange={(v) =>
                            setGatewayField(def.id, field.key, v)
                          }
                        >
                          <SelectTrigger id={fieldId}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {field.options?.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                {gatewayText(`option.${opt.value}`, opt.label)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="relative">
                          <Input
                            id={fieldId}
                            dir="ltr"
                            type={
                              isSecret && !showSecret[fieldId]
                                ? "password"
                                : "text"
                            }
                            autoComplete="off"
                            placeholder={
                              isSecret && stored
                                ? t("settings.common.unchanged", { defaultValue: "•••••••• (unchanged)" })
                                : field.placeholder
                            }
                            value={(gatewayForm?.[field.key] as string) || ""}
                            onChange={(e) =>
                              setGatewayField(def.id, field.key, e.target.value)
                            }
                            className={isSecret ? "pe-10" : undefined}
                          />
                          {isSecret && (
                            <button
                              type="button"
                              onClick={() =>
                                setShowSecret((s) => ({
                                  ...s,
                                  [fieldId]: !s[fieldId],
                                }))
                              }
                              className="absolute end-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              tabIndex={-1}
                            >
                              {showSecret[fieldId] ? (
                                <EyeOff className="h-4 w-4" />
                              ) : (
                                <Eye className="h-4 w-4" />
                              )}
                            </button>
                          )}
                        </div>
                      )}
                      {field.helpText && (
                        <p className="text-xs text-muted-foreground">
                          {gatewayText(`help.${def.id}.${field.key}`, field.helpText)}
                        </p>
                      )}
                      {isSecret && stored && (
                        <p className="text-xs text-muted-foreground">
                          {t("settings.common.keepSecret", { defaultValue: "Leave blank to keep the saved value." })}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {def.implemented && (
                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    onClick={() => handleTest(def.id)}
                    disabled={testing === def.id}
                  >
                    {testing === def.id ? (
                      <>
                        <Loader2 className="me-2 h-4 w-4 animate-spin" />{" "}
                        {t("settings.payment.testing", { defaultValue: "Testing…" })}
                      </>
                    ) : (
                      <>
                        <Plug className="me-2 h-4 w-4" />{" "}
                        {t("settings.payment.test", { defaultValue: "Test the connection" })}
                      </>
                    )}
                  </Button>
                </div>
              )}

              {def.implemented && webhookUrls[def.id] && (
                <div className="space-y-2 rounded-md border bg-muted/40 p-3">
                  <p className="text-sm font-medium">
                    {t("settings.payment.webhook", { defaultValue: "Your {name} webhook address", values: { name: def.name } })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t("settings.payment.webhookHint", { defaultValue: "Add this address in your {name} dashboard so tenants' payments are confirmed automatically. It is unique to your office.", values: { name: def.name } })}
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1.5 text-xs">
                      {webhookUrls[def.id]}
                    </code>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => copyWebhookUrl(def.id)}
                    >
                      {copiedUrl === def.id ? (
                        <>
                          <CheckCircle2 className="me-1.5 h-3.5 w-3.5" />{" "}
                          {t("settings.payment.copied", { defaultValue: "Copied" })}
                        </>
                      ) : (
                        <>
                          <Copy className="me-1.5 h-3.5 w-3.5" />{" "}
                          {t("settings.payment.copy", { defaultValue: "Copy" })}
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* Save */}
      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="me-2 h-4 w-4 animate-spin" /> {t("settings.common.saving", { defaultValue: "Saving…" })}
            </>
          ) : (
            t("settings.common.save", { defaultValue: "Save settings" })
          )}
        </Button>
      </div>
    </div>
  );
}
