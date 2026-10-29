"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  Check,
  CircleDollarSign,
  Layers3,
  Pencil,
  Plus,
  Star,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { ConfirmationDialog } from "@/components/ui/confirmation-dialog";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import {
  PLAN_LIMIT_CATALOG,
  formatPlanLimitValue,
} from "@/lib/billing/plan-constants";
import {
  TOGGLEABLE_LEAF_KEYS,
  enabledToggleableLeaves,
  summarizeModules,
  toggleableLeavesUnder,
} from "@/lib/billing/modules";
import { NAV_SECTIONS } from "@/lib/navigation/menu-config";
import { PlanFormSheet, type AdminPlan } from "./plan-form-sheet";
import { APP_CURRENCY } from "@/lib/regional/region";
import { ModuleTree } from "./module-tree";

interface PlanData {
  currency: string;
  plans: AdminPlan[];
  trial: { plan: string; days: number };
  /** Modules switched off for every package. */
  platformModules?: { disabled: string[]; available: boolean };
}

export default function PlatformPlansPage() {
  const { t, isRTL } = useLocalizationContext();
  const [data, setData] = useState<PlanData | null>(null);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AdminPlan | null>(null);
  /** The platform switches as edited, until saved; null = as loaded. */
  const [platformDraft, setPlatformDraft] = useState<Set<string> | null>(null);
  const [savingPlatform, setSavingPlatform] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/plans");
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || "Unable to load plans");
      setData(payload.data);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : t("platform.plans.loadError", { defaultValue: "Unable to load plans" }));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // The currency plans are charged in (BILLING_CURRENCY, riyal), or the one
  // a Stripe price actually bills in when that differs. `toLocaleString`
  // rather than `new Intl.NumberFormat`, which the app patches to relabel
  // "USD" as the active currency (utils/ensure-intl-currency-patch.ts) — a
  // $29 price would read "SAR 29". Same rule as formatPlanPrice.
  const money = (amount: number, currency = data?.currency || APP_CURRENCY) =>
    amount.toLocaleString("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    });

  const plans = data?.plans ?? [];
  const platformOff = new Set(data?.platformModules?.disabled ?? []);
  const platformValue = platformDraft ?? platformOff;
  const platformDirty =
    platformDraft !== null &&
    (platformDraft.size !== platformOff.size ||
      [...platformDraft].some((key) => !platformOff.has(key)));

  /** Essential sections this plan withholds — worth naming on the card, since
   * a plan without them looks fine until a customer signs up and finds an
   * empty app. */
  const missingEssential = (plan: AdminPlan): string[] => {
    const opened = new Set(plan.modules);
    return NAV_SECTIONS.filter(
      (section) =>
        section.essential &&
        section.key &&
        !toggleableLeavesUnder(section.key).some((leaf) => opened.has(leaf)),
    ).map((section) =>
      t(section.title ?? "", { defaultValue: section.label ?? "" }),
    );
  };

  async function savePlatformModules() {
    if (!platformDraft) return;
    setSavingPlatform(true);
    try {
      const response = await fetch("/api/admin/plans/platform-modules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disabled: [...platformDraft] }),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Save failed");
      }
      toast.success(t("platform.modules.saved", { defaultValue: "Platform modules saved" }));
      setPlatformDraft(null);
      void load();
    } catch (saveError) {
      toast.error(
        saveError instanceof Error
          ? saveError.message
          : t("platform.modules.saveFailed", { defaultValue: "Could not save the platform modules" }),
      );
    } finally {
      setSavingPlatform(false);
    }
  }

  async function patchPlan(key: string, body: Record<string, unknown>) {
    const response = await fetch(`/api/admin/plans/${key}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || "Update failed");
  }

  async function quickToggle(plan: AdminPlan, field: "isActive" | "isPublic", value: boolean) {
    try {
      await patchPlan(plan.key, { [field]: value });
      toast.success(t("platform.plans.updated", { defaultValue: "Plan updated" }));
      void load();
    } catch (toggleError) {
      toast.error(toggleError instanceof Error ? toggleError.message : t("platform.plans.updateFailed", { defaultValue: "Update failed" }));
    }
  }

  async function move(plan: AdminPlan, direction: "up" | "down") {
    const sorted = [...plans].sort((a, b) => a.sortOrder - b.sortOrder);
    const index = sorted.findIndex((p) => p.key === plan.key);
    const neighbor = sorted[index + (direction === "up" ? -1 : 1)];
    if (!neighbor) return;
    try {
      await Promise.all([
        patchPlan(plan.key, { sortOrder: neighbor.sortOrder }),
        patchPlan(neighbor.key, { sortOrder: plan.sortOrder }),
      ]);
      void load();
    } catch (moveError) {
      toast.error(moveError instanceof Error ? moveError.message : t("platform.plans.reorderFailed", { defaultValue: "Reorder failed" }));
    }
  }

  async function deletePlan(plan: AdminPlan) {
    const response = await fetch(`/api/admin/plans/${plan.key}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok || !result.success) {
      const message = result.error || "Delete failed";
      toast.error(message);
      throw new Error(message);
    }
    toast.success(t("platform.plans.deleted", { defaultValue: "Plan deleted" }));
    void load();
  }

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(plan: AdminPlan) {
    setEditing(plan);
    setFormOpen(true);
  }

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.plans.title", { defaultValue: "Plans &amp; entitlements" })}</h1>
          <p className="text-muted-foreground">{t("platform.plans.subtitle", { defaultValue: "Manage pricing, Stripe readiness, limits, and feature access." })}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="me-1.5 h-4 w-4" /> {t("platform.plans.newPlan", { defaultValue: "New plan" })}
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {data && (
        <Alert>
          <Layers3 className="h-4 w-4" />
          <AlertDescription>
            {t("platform.plans.trialNotice", {
              defaultValue:
                "New organizations receive a {days}-day {plan} trial. Edits publish to the public pricing page and apply immediately; a module switched off platform-wide stays off in every package.",
              values: { days: data.trial.days, plan: data.trial.plan },
            })}
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan, index) => (
          <Card key={plan.key} className="flex flex-col">
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle>{plan.name}</CardTitle>
                    {plan.popular && (
                      <Badge variant="secondary" className="gap-1">
                        <Star className="h-3 w-3" /> {t("platform.plans.popular", { defaultValue: "Popular" })}
                      </Badge>
                    )}
                  </div>
                  <CardDescription className="mt-1">{plan.description || "—"}</CardDescription>
                  <code className="mt-1 block text-[11px] text-muted-foreground">{plan.key}</code>
                </div>
                <Badge
                  variant={
                    plan.priceMismatch
                      ? "destructive"
                      : plan.stripeConfigured
                        ? "default"
                        : "destructive"
                  }
                >
                  {plan.priceMismatch
                    ? t("platform.plans.priceMismatch", { defaultValue: "Price mismatch" })
                    : plan.stripeConfigured
                      ? t("platform.plans.stripeReady", { defaultValue: "Ready" })
                      : t("platform.plans.stripeMissing", { defaultValue: "Stripe missing" })}
                </Badge>
              </div>
              <p className="pt-2 text-3xl font-bold">
                {plan.isCustom ? t("platform.plans.custom", { defaultValue: "Custom" }) : money(plan.monthlyPrice)}
                {!plan.isCustom && (
                  <span className="text-sm font-normal text-muted-foreground"> / {plan.priceSuffix}</span>
                )}
              </p>
              {/* Named explicitly rather than shown as a generic warning: an
                  operator needs to know which number customers are actually
                  billed before deciding which one is wrong. */}
              {plan.priceMismatch && (
                <p className="rounded-md bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive">
                  Stripe charges{" "}
                  {money(plan.stripeAmount ?? 0, plan.stripeCurrency ?? undefined)} — customers see{" "}
                  {money(plan.monthlyPrice)} here. Save the plan to create a
                  matching Stripe price.
                </p>
              )}
              <div className="flex flex-wrap gap-1.5 pt-1">
                {!plan.isPublic && <Badge variant="outline">{t("platform.plans.hidden", { defaultValue: "Hidden" })}</Badge>}
                {!plan.isActive && <Badge variant="outline">{t("platform.plans.inactive", { defaultValue: "Inactive" })}</Badge>}
                {plan.isSystem && <Badge variant="outline">{t("platform.plans.system", { defaultValue: "System" })}</Badge>}
              </div>
            </CardHeader>

            <CardContent className="flex flex-1 flex-col gap-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-muted/50 p-3">
                  <Users className="mb-2 h-4 w-4 text-muted-foreground" />
                  <p className="text-xl font-semibold">{plan.organizations ?? 0}</p>
                  <p className="text-xs text-muted-foreground">organizations</p>
                </div>
                <div className="rounded-lg bg-muted/50 p-3">
                  <CircleDollarSign className="mb-2 h-4 w-4 text-muted-foreground" />
                  <p className="text-xl font-semibold">{plan.activeSubscriptions ?? 0}</p>
                  <p className="text-xs text-muted-foreground">active subs</p>
                </div>
              </div>

              {/* Every limit, not just two. The card used to show properties
                  and members while units, storage and the rest were editable
                  and enforced but invisible here. */}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                {PLAN_LIMIT_CATALOG.map(({ key, label, period }) => (
                  <div key={key} className="flex justify-between gap-2">
                    <dt className="truncate text-muted-foreground">
                      {label}
                      {period === "month" && "/mo"}
                    </dt>
                    <dd className="shrink-0 font-medium">
                      {formatPlanLimitValue(key, plan.limits[key] ?? null)}
                    </dd>
                  </div>
                ))}
              </dl>

              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">{t("platform.plans.modules", { defaultValue: "Modules" })}</span>
                  <span className="font-medium tabular-nums">
                    {t("platform.planForm.modules.count", {
                      defaultValue: "{enabled} of {total}",
                      values: {
                        enabled: enabledToggleableLeaves(new Set(plan.modules)).length,
                        total: TOGGLEABLE_LEAF_KEYS.length,
                      },
                    })}
                  </span>
                </div>
                {enabledToggleableLeaves(new Set(plan.modules)).length === 0 ? (
                  <p className="text-xs italic text-muted-foreground">
                    {t("platform.plans.noModules", { defaultValue: "No modules — an organization on this plan can open nothing." })}
                  </p>
                ) : (
                  // By section: a section with only some of its items reads
                  // "3 of 7" so a partial section is not mistaken for all.
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
                )}
                {missingEssential(plan).length > 0 && (
                  <p className="flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                    <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" />
                    {t("platform.plans.missingEssential", {
                      defaultValue: "Missing: {modules}",
                      values: { modules: missingEssential(plan).join(isRTL ? "، " : ", ") },
                    })}
                  </p>
                )}
              </div>

              {plan.stripePriceId && (
                <p className="break-all font-mono text-[11px] text-muted-foreground">{plan.stripePriceId}</p>
              )}

              <div className="mt-auto space-y-3 border-t pt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("platform.plans.active", { defaultValue: "Active" })}</span>
                  <Switch
                    checked={plan.isActive}
                    disabled={plan.isSystem}
                    onCheckedChange={(v) => quickToggle(plan, "isActive", v)}
                  />
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{t("platform.plans.public", { defaultValue: "Public" })}</span>
                  <Switch checked={plan.isPublic} onCheckedChange={(v) => quickToggle(plan, "isPublic", v)} />
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => openEdit(plan)}>
                    <Pencil className="me-1.5 h-3.5 w-3.5" /> {t("platform.common.edit", { defaultValue: "Edit" })}
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={index === 0}
                    onClick={() => move(plan, "up")}
                    aria-label={t("platform.plans.moveUp", { defaultValue: "Move up" })}
                  >
                    <ArrowUp className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={index === plans.length - 1}
                    onClick={() => move(plan, "down")}
                    aria-label={t("platform.plans.moveDown", { defaultValue: "Move down" })}
                  >
                    <ArrowDown className="h-4 w-4" />
                  </Button>
                  <ConfirmationDialog
                    title={`Delete ${plan.name}?`}
                    description={t("platform.plans.deleteWarning", { defaultValue: "This permanently removes the plan. Organizations currently on it will block deletion." })}
                    confirmText={t("platform.common.delete", { defaultValue: "Delete" })}
                    variant="destructive"
                    onConfirm={() => deletePlan(plan)}
                  >
                    <Button variant="outline" size="icon" disabled={plan.isSystem} aria-label={t("platform.plans.deletePlan", { defaultValue: "Delete plan" })}>
                      <Trash2 className="h-4 w-4 text-red-600" />
                    </Button>
                  </ConfirmationDialog>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Platform-wide switches: off here is off in every package. */}
      {data && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <CardTitle>{t("platform.modules.title", { defaultValue: "Platform-wide modules" })}</CardTitle>
                <CardDescription className="mt-1">
                  {t("platform.modules.description", {
                    defaultValue:
                      "Switch a module off here and it is off in every package at once, whatever each package includes — gone from the menus, its pages show that it is unavailable and its API answers 402. Switch it back on to restore it.",
                  })}
                </CardDescription>
              </div>
              <Button
                onClick={() => void savePlatformModules()}
                disabled={!platformDirty || savingPlatform || !data.platformModules?.available}
              >
                {t("platform.modules.save", { defaultValue: "Save switches" })}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.platformModules && !data.platformModules.available && (
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  {t("platform.modules.unavailable", {
                    defaultValue:
                      "Apply migration 20261003150000_platform_module_switches to use these switches. Until then every module is on.",
                  })}
                </AlertDescription>
              </Alert>
            )}
            {platformValue.size > 0 && (
              <p className="text-xs text-muted-foreground">
                {t("platform.modules.offCount", {
                  defaultValue: "Switched off: {count}",
                  values: { count: platformValue.size },
                })}
              </p>
            )}
            <ModuleTree
              mode="platform"
              value={platformValue}
              onChange={setPlatformDraft}
              disabled={!data.platformModules?.available || savingPlatform}
            />
          </CardContent>
        </Card>
      )}

      <PlanFormSheet
        open={formOpen}
        onOpenChange={setFormOpen}
        plan={editing}
        onSaved={load}
        platformOff={platformOff}
      />
    </ResponsiveLayout>
  );
}
