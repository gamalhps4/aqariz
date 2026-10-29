"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, Languages, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  MAX_ANNUAL_DISCOUNT_PERCENT,
  annualSavings,
  computeAnnualPrice,
} from "@/lib/billing/annual-price";
import {
  PLAN_LIMIT_CATALOG,
  PLAN_LIMITS_ALLOWING_ZERO,
  unlimitedPlanLimits,
  type BillingPlanDefinition,
  type PlanLimitKey,
} from "@/lib/billing/plan-constants";
import { normalizePlanTranslations } from "@/lib/billing/plan-i18n";
import {
  allModuleChecks,
  effectiveModuleLeaves,
  encodeModuleSelection,
  toggleableLeavesUnder,
} from "@/lib/billing/modules";
import { NAV_SECTIONS } from "@/lib/navigation/menu-config";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ModuleTree } from "./module-tree";

export interface AdminPlan extends BillingPlanDefinition {
  /** What Stripe will actually charge, read live. Null when no price is set
   * or Stripe is unreachable. */
  stripeAmount?: number | null;
  /** The ISO code Stripe bills that amount in. */
  stripeCurrency?: string | null;
  /** True when the amount above disagrees with `monthlyPrice`. */
  priceMismatch?: boolean;
  organizations?: number;
  activeSubscriptions?: number;
  stripeConfigured?: boolean;
}

interface PlanFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: AdminPlan | null;
  onSaved: () => void;
  /** Modules switched off platform-wide, flagged in the tree. */
  platformOff?: ReadonlySet<string>;
}

interface FormState {
  name: string;
  key: string;
  description: string;
  monthlyPrice: number;
  isCustom: boolean;
  priceSuffix: string;
  stripePriceId: string;
  stripePriceIdYearly: string;
  annualEnabled: boolean;
  yearlyDiscountPercent: number;
  yearlyPriceOverride: boolean;
  /** Only sent when `yearlyPriceOverride` is on; otherwise the server calculates. */
  yearlyPrice: number | null;
  limits: Record<PlanLimitKey, number | null>;
  /** The ticked nodes of the module tree (sections, groups, items). */
  moduleChecks: string[];
  highlights: string[];
  featuresHeader: string;
  ctaLabel: string;
  ctaHref: string;
  popular: boolean;
  isPublic: boolean;
  isActive: boolean;
  sortOrder: number;
  /** The card's Arabic for /ar and /ar/pricing; empty fields fall back to
   * the English. `highlights` lines up with the English list by position. */
  arabic: ArabicCardText;
}

interface ArabicCardText {
  name: string;
  description: string;
  priceSuffix: string;
  featuresHeader: string;
  ctaLabel: string;
  highlights: string[];
}

const EMPTY_ARABIC: ArabicCardText = {
  name: "",
  description: "",
  priceSuffix: "",
  featuresHeader: "",
  ctaLabel: "",
  highlights: [],
};

const EMPTY: FormState = {
  name: "",
  key: "",
  description: "",
  monthlyPrice: 0,
  isCustom: false,
  priceSuffix: "per month",
  stripePriceId: "",
  stripePriceIdYearly: "",
  annualEnabled: false,
  yearlyDiscountPercent: 20,
  yearlyPriceOverride: false,
  yearlyPrice: null,
  limits: unlimitedPlanLimits(),
  moduleChecks: [],
  highlights: [],
  featuresHeader: "",
  // NOT translated: this is the default CTA text stored on the plan and
  // rendered on the *public* pricing page, so it must not carry whatever
  // language the operator happened to have selected.
  ctaLabel: "Get started",
  ctaHref: "/auth/signup",
  popular: false,
  isPublic: true,
  isActive: true,
  sortOrder: 0,
  arabic: EMPTY_ARABIC,
};

/** Whether any Arabic was entered — marked on the folded group. */
function hasArabicText(arabic: ArabicCardText): boolean {
  return (
    [arabic.name, arabic.description, arabic.priceSuffix, arabic.featuresHeader, arabic.ctaLabel]
      .some((value) => value.trim() !== "") ||
    arabic.highlights.some((value) => value.trim() !== "")
  );
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function fromPlan(plan: AdminPlan): FormState {
  return {
    name: plan.name,
    key: plan.key,
    description: plan.description,
    monthlyPrice: plan.monthlyPrice,
    isCustom: plan.isCustom,
    priceSuffix: plan.priceSuffix,
    stripePriceId: plan.stripePriceId ?? "",
    stripePriceIdYearly: plan.stripePriceIdYearly ?? "",
    annualEnabled: plan.annualEnabled,
    yearlyDiscountPercent: plan.yearlyDiscountPercent,
    yearlyPriceOverride: plan.yearlyPriceOverride,
    yearlyPrice: plan.yearlyPrice ?? null,
    // Spread over the full key set so a plan row saved before a limit existed
    // reads as unlimited rather than undefined.
    limits: { ...unlimitedPlanLimits(), ...plan.limits },
    // What the package opens, as the server reads it (old keys translated,
    // whole sections expanded): every node that is on starts ticked.
    moduleChecks: [...plan.modules],
    highlights: [...plan.highlights],
    featuresHeader: plan.featuresHeader ?? "",
    ctaLabel: plan.ctaLabel,
    ctaHref: plan.ctaHref,
    popular: plan.popular,
    isPublic: plan.isPublic,
    isActive: plan.isActive,
    sortOrder: plan.sortOrder,
    arabic: (() => {
      const ar = plan.translations?.ar ?? {};
      return {
        name: ar.name ?? "",
        description: ar.description ?? "",
        priceSuffix: ar.priceSuffix ?? "",
        featuresHeader: ar.featuresHeader ?? "",
        ctaLabel: ar.ctaLabel ?? "",
        highlights: plan.highlights.map((_, index) => ar.highlights?.[index] ?? ""),
      };
    })(),
  };
}

export function PlanFormSheet({
  open,
  onOpenChange,
  plan,
  onSaved,
  platformOff,
}: PlanFormSheetProps) {
  const { t, isRTL } = useLocalizationContext();
  const isEdit = Boolean(plan);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [keyTouched, setKeyTouched] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(plan ? fromPlan(plan) : EMPTY);
      setKeyTouched(false);
    }
  }, [open, plan]);

  const set = <K extends keyof FormState>(field: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Previewed with the same function the API uses to store the price, so the
  // number on screen is the number that will be charged.
  const calculatedAnnual = computeAnnualPrice(
    form.monthlyPrice,
    form.yearlyDiscountPercent,
  );
  const effectiveAnnual = form.yearlyPriceOverride
    ? (form.yearlyPrice ?? calculatedAnnual)
    : calculatedAnnual;
  const effectiveSavings = annualSavings(form.monthlyPrice, effectiveAnnual);

  const moduleChecks = new Set(form.moduleChecks);
  const openedLeaves = effectiveModuleLeaves(moduleChecks);
  const setModuleChecks = (next: Set<string>) =>
    setForm((prev) => ({ ...prev, moduleChecks: [...next] }));

  // Named rather than counted: an operator deciding whether a gap is deliberate
  // needs to see which section is missing, not that "2 sections" are.
  const missingEssentialSections = NAV_SECTIONS.filter(
    (section) =>
      section.essential &&
      section.key &&
      !toggleableLeavesUnder(section.key).some((leaf) =>
        openedLeaves.includes(leaf),
      ),
  ).map((section) =>
    t(section.title ?? "", { defaultValue: section.label ?? section.key ?? "" }),
  );

  const setLimit = (resource: PlanLimitKey, value: number | null) =>
    setForm((prev) => ({ ...prev, limits: { ...prev.limits, [resource]: value } }));

  const updateHighlight = (index: number, value: string) =>
    setForm((prev) => {
      const highlights = [...prev.highlights];
      highlights[index] = value;
      return { ...prev, highlights };
    });

  // The Arabic bullets line up with the English ones by position, so a
  // removed English bullet takes its Arabic with it.
  const removeHighlight = (index: number) =>
    setForm((prev) => ({
      ...prev,
      highlights: prev.highlights.filter((_, i) => i !== index),
      arabic: {
        ...prev.arabic,
        highlights: prev.arabic.highlights.filter((_, i) => i !== index),
      },
    }));

  const setArabic = <K extends keyof ArabicCardText>(
    field: K,
    value: ArabicCardText[K],
  ) => setForm((prev) => ({ ...prev, arabic: { ...prev.arabic, [field]: value } }));

  const updateArabicHighlight = (index: number, value: string) =>
    setForm((prev) => {
      const highlights = prev.highlights.map(
        (_, i) => (i === index ? value : (prev.arabic.highlights[i] ?? "")),
      );
      return { ...prev, arabic: { ...prev.arabic, highlights } };
    });

  async function handleSubmit() {
    if (!form.name.trim()) return toast.error(t("platform.planForm.nameRequired", { defaultValue: "Name is required" }));
    if (!isEdit && !form.key.trim()) return toast.error(t("platform.planForm.keyRequired", { defaultValue: "Key is required" }));

    // Blank English bullets are dropped; their Arabic goes with them so the
    // two lists stay aligned by position.
    const keptHighlights = form.highlights
      .map((highlight, index) => ({ highlight: highlight.trim(), index }))
      .filter(({ highlight }) => Boolean(highlight));

    const payload = {
      ...(isEdit ? {} : { key: form.key.trim() }),
      name: form.name.trim(),
      description: form.description.trim(),
      monthlyPrice: form.isCustom ? 0 : Number(form.monthlyPrice) || 0,
      isCustom: form.isCustom,
      priceSuffix: form.priceSuffix.trim() || "per month",
      stripePriceId: form.stripePriceId.trim() || null,
      stripePriceIdYearly: form.stripePriceIdYearly.trim() || null,
      annualEnabled: form.annualEnabled,
      yearlyDiscountPercent: Number(form.yearlyDiscountPercent) || 0,
      yearlyPriceOverride: form.yearlyPriceOverride,
      // Only meaningful under an override — otherwise the server derives the
      // annual price and ignores whatever is sent here.
      yearlyPrice: form.yearlyPriceOverride ? form.yearlyPrice : null,
      limits: form.limits,
      // The shortest list for the ticked items: a section ticked whole is
      // stored as the section, so it also takes in items added later. The
      // key records a module this package starts with being left out.
      features: encodeModuleSelection(openedLeaves, form.key.trim()),
      highlights: keptHighlights.map(({ highlight }) => highlight),
      featuresHeader: form.featuresHeader.trim() || null,
      ctaLabel: form.ctaLabel.trim() || "Get started",
      ctaHref: form.ctaHref.trim() || "/auth/signup",
      popular: form.popular,
      isPublic: form.isPublic,
      isActive: form.isActive,
      sortOrder: Number(form.sortOrder) || 0,
      // Null when nothing was translated: the cards fall back to the English.
      translations: normalizePlanTranslations({
        ar: {
          ...form.arabic,
          highlights: keptHighlights.map(
            ({ index }) => form.arabic.highlights[index] ?? "",
          ),
        },
      }),
    };

    setSaving(true);
    try {
      const url = isEdit ? `/api/admin/plans/${plan!.key}` : "/api/admin/plans";
      const response = await fetch(url, {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok || !result.success) {
        throw new Error(result.error || "Failed to save plan");
      }
      toast.success(isEdit ? t("platform.planForm.updated", { defaultValue: "Plan updated" }) : t("platform.planForm.created", { defaultValue: "Plan created" }));
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t("platform.planForm.saveFailed", { defaultValue: "Failed to save plan" }));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{isEdit ? `Edit ${plan?.name}` : t("platform.planForm.newPlan", { defaultValue: "New plan" })}</SheetTitle>
          <SheetDescription>
            {t("platform.planForm.subtitle", { defaultValue: "Configure pricing, limits, entitlements, and how this plan appears on the public pricing page." })}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 py-2">
          {/* Identity */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="plan-name">{t("platform.planForm.name", { defaultValue: "Name" })}</Label>
              <Input
                id="plan-name"
                value={form.name}
                onChange={(e) => {
                  set("name", e.target.value);
                  if (!isEdit && !keyTouched) set("key", slugify(e.target.value));
                }}
                placeholder="Professional"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-key">{t("platform.planForm.key", { defaultValue: "Key (slug)" })}</Label>
              <Input
                id="plan-key"
                value={form.key}
                disabled={isEdit}
                onChange={(e) => {
                  setKeyTouched(true);
                  set("key", slugify(e.target.value));
                }}
                placeholder="professional"
              />
              <p className="text-xs text-muted-foreground">
                {isEdit
                  ? t("platform.planForm.keyPermanent", { defaultValue: "The key is permanent — it links organizations, Stripe, and entitlements." })
                  : t("platform.planForm.keyHint", { defaultValue: "Lowercase letters, numbers, and hyphens. Cannot be changed later." })}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plan-description">{t("platform.planForm.description", { defaultValue: "Description" })}</Label>
              <Textarea
                id="plan-description"
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder={t("platform.planForm.descriptionPlaceholder", { defaultValue: "For growing portfolios and operations teams." })}
                rows={2}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between">
              <div>
                <Label>{t("platform.planForm.contactSales", { defaultValue: "Contact-sales plan" })}</Label>
                <p className="text-xs text-muted-foreground">{t("platform.planForm.contactSalesHint", { defaultValue: "No fixed price; shows “Custom” + a contact CTA." })}</p>
              </div>
              <Switch checked={form.isCustom} onCheckedChange={(v) => set("isCustom", v)} />
            </div>
            {!form.isCustom && (
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="plan-price">{t("platform.planForm.monthlyPrice", { defaultValue: "Monthly price" })}</Label>
                  <Input
                    id="plan-price"
                    type="number"
                    min={0}
                    value={form.monthlyPrice}
                    onChange={(e) => set("monthlyPrice", Number(e.target.value))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-suffix">{t("platform.planForm.priceSuffix", { defaultValue: "Price suffix" })}</Label>
                  <Input
                    id="plan-suffix"
                    value={form.priceSuffix}
                    onChange={(e) => set("priceSuffix", e.target.value)}
                    placeholder="per month"
                  />
                </div>
              </div>
            )}
            {!form.isCustom && form.monthlyPrice > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="plan-stripe">{t("platform.planForm.stripePriceId", { defaultValue: "Stripe Price ID" })}</Label>
                <Input
                  id="plan-stripe"
                  value={form.stripePriceId}
                  onChange={(e) => set("stripePriceId", e.target.value)}
                  placeholder="price_1Tk..."
                  className="font-mono text-xs"
                />
                <p className="text-xs text-muted-foreground">
                  {t("platform.planForm.stripePriceHint", { defaultValue: "Required for paid checkout. Paste the recurring price ID from Stripe." })}
                </p>
              </div>
            )}
            {!form.isCustom && form.monthlyPrice > 0 && (
              <div className="space-y-3 rounded-lg border p-3.5">
                <div className="flex items-center justify-between gap-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="plan-annual-enabled">{t("platform.planForm.annualBilling", { defaultValue: "Annual billing" })}</Label>
                    <p className="text-xs text-muted-foreground">
                      Offer this plan on a yearly term. The price is worked out
                      from the monthly price below.
                    </p>
                  </div>
                  <Switch
                    id="plan-annual-enabled"
                    checked={form.annualEnabled}
                    onCheckedChange={(checked) => set("annualEnabled", checked)}
                  />
                </div>

                {form.annualEnabled && (
                  <div className="space-y-3 border-t pt-3">
                    <div className="grid gap-3 sm:grid-cols-2 sm:items-end">
                      <div className="space-y-1.5">
                        <Label htmlFor="plan-yearly-discount">
                          {t("platform.planForm.annualDiscount", { defaultValue: "Annual discount" })}
                        </Label>
                        <div className="relative">
                          <Input
                            id="plan-yearly-discount"
                            type="number"
                            min={0}
                            max={MAX_ANNUAL_DISCOUNT_PERCENT}
                            step={1}
                            value={form.yearlyDiscountPercent}
                            onChange={(e) =>
                              set(
                                "yearlyDiscountPercent",
                                e.target.value === ""
                                  ? 0
                                  : Number(e.target.value),
                              )
                            }
                            disabled={form.yearlyPriceOverride}
                            className="pe-8"
                          />
                          <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-sm text-muted-foreground">
                            %
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Off twelve months. 0% bills a straight 12x, max{" "}
                          {MAX_ANNUAL_DISCOUNT_PERCENT}%.
                        </p>
                      </div>

                      {/* The figure the customer will actually be charged,
                          computed with the same function the server stores. */}
                      <div className="space-y-1.5">
                        <Label>{t("platform.planForm.annualPrice", { defaultValue: "Annual price" })}</Label>
                        {form.yearlyPriceOverride ? (
                          <Input
                            id="plan-yearly-price"
                            type="number"
                            min={0}
                            step="0.01"
                            value={form.yearlyPrice ?? ""}
                            onChange={(e) =>
                              set(
                                "yearlyPrice",
                                e.target.value === ""
                                  ? null
                                  : Number(e.target.value),
                              )
                            }
                            placeholder={String(calculatedAnnual)}
                          />
                        ) : (
                          <div className="flex h-9 items-center rounded-md border border-dashed bg-muted/40 px-3 text-sm font-semibold tabular-nums">
                            ${calculatedAnnual.toFixed(2)}
                            <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                              per year
                            </span>
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {form.monthlyPrice.toFixed(2)} x 12 ={" "}
                          {(form.monthlyPrice * 12).toFixed(2)}
                          {effectiveSavings > 0 && (
                            <>
                              {" "}
                              &middot;{" "}
                              <span className="font-medium text-emerald-600">
                                saves ${effectiveSavings.toFixed(2)}
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label htmlFor="plan-yearly-override">
                          {t("platform.planForm.setPriceManually", { defaultValue: "Set the price manually" })}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          Type an exact annual amount instead of using the
                          discount. The discount is kept for when you switch
                          back.
                        </p>
                      </div>
                      <Switch
                        id="plan-yearly-override"
                        checked={form.yearlyPriceOverride}
                        onCheckedChange={(checked) =>
                          setForm((prev) => ({
                            ...prev,
                            yearlyPriceOverride: checked,
                            // Seed the box with the calculated figure so the
                            // admin edits a real number rather than a blank.
                            yearlyPrice: checked
                              ? (prev.yearlyPrice ??
                                computeAnnualPrice(
                                  prev.monthlyPrice,
                                  prev.yearlyDiscountPercent,
                                ))
                              : prev.yearlyPrice,
                          }))
                        }
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="plan-stripe-yearly">
                        {t("platform.planForm.annualStripePriceId", { defaultValue: "Annual Stripe Price ID" })}
                      </Label>
                      <Input
                        id="plan-stripe-yearly"
                        value={form.stripePriceIdYearly}
                        onChange={(e) =>
                          set("stripePriceIdYearly", e.target.value)
                        }
                        placeholder={t("platform.planForm.annualStripePlaceholder", { defaultValue: "Created automatically — leave blank" })}
                        className="font-mono text-xs"
                      />
                      <p className="text-xs text-muted-foreground">
                        Leave blank and a Stripe price for the amount above is
                        created on save. Paste one only to reuse an existing
                        price; it is refused if it charges a different amount.
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Limits */}
          <div className="space-y-3 border-t pt-5">
            <div>
              <Label>{t("platform.planForm.limits", { defaultValue: "Limits" })}</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                What this plan allows before a create is refused. Every one is
                enforced server-side; leave a row unlimited to remove the cap.
              </p>
            </div>
            {PLAN_LIMIT_CATALOG.map(
              ({ key: resource, label, unit, period, description }) => {
                const unlimited = form.limits[resource] === null;
                return (
                  <div
                    key={resource}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1.5"
                  >
                    <span className="w-28 shrink-0 text-sm text-muted-foreground">
                      {label}
                      {unit === "megabytes" && (
                        <span className="block text-xs">(MB)</span>
                      )}
                      {period === "month" && (
                        <span className="block text-xs">(per month)</span>
                      )}
                    </span>
                    <Input
                      type="number"
                      min={PLAN_LIMITS_ALLOWING_ZERO.has(resource) ? 0 : 1}
                      disabled={unlimited}
                      value={unlimited ? "" : (form.limits[resource] ?? "")}
                      onChange={(e) =>
                        setLimit(resource, Number(e.target.value) || 0)
                      }
                      className="max-w-[120px]"
                      placeholder={t("platform.common.unlimited", { defaultValue: "Unlimited" })}
                    />
                    <label className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Switch
                        checked={unlimited}
                        onCheckedChange={(v) => setLimit(resource, v ? null : 1)}
                      />
                      {t("platform.common.unlimited", { defaultValue: "Unlimited" })}
                    </label>
                    <p className="w-full ps-28 text-xs text-muted-foreground">
                      {description}
                    </p>
                  </div>
                );
              },
            )}
          </div>

          {/* Modules: the menu's own tree */}
          <div className="space-y-4 border-t pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Label>{t("platform.planForm.modulesIncluded", { defaultValue: "Modules included" })}</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("platform.planForm.modules.description", {
                    defaultValue:
                      "Exactly what an organization on this package can open. Switching a section off switches off everything in it; a section ticked whole also takes in items added to it later. A module left out disappears from the menu, ⌘K, the dashboard and the badges, its pages show an upgrade card and its API answers 402 — the data is kept and comes back on upgrade.",
                  })}
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setModuleChecks(allModuleChecks(true))}
                >
                  {t("platform.planForm.selectAll", { defaultValue: "Select all" })}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                  onClick={() => setModuleChecks(allModuleChecks(false))}
                >
                  {t("platform.planForm.clearAll", { defaultValue: "Clear all" })}
                </Button>
              </div>
            </div>

            {missingEssentialSections.length > 0 && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                <p className="text-amber-900 dark:text-amber-200">
                  {t("platform.planForm.modules.essentialWarning", {
                    defaultValue:
                      "This package leaves out {modules}. The product is close to unusable without those, so only ship it that way on purpose.",
                    values: {
                      modules: missingEssentialSections.join(isRTL ? "، " : ", "),
                    },
                  })}
                </p>
              </div>
            )}

            <ModuleTree
              mode="plan"
              value={moduleChecks}
              onChange={setModuleChecks}
              platformOff={platformOff}
            />
          </div>

          {/* Public marketing */}
          <div className="space-y-3 border-t pt-5">
            <Label>{t("platform.planForm.pricingCard", { defaultValue: "Public pricing card" })}</Label>
            <div className="space-y-1.5">
              <Label htmlFor="plan-header" className="text-xs font-normal text-muted-foreground">
                {t("platform.planForm.featuresHeader", { defaultValue: "Features header (optional)" })}
              </Label>
              <Input
                id="plan-header"
                value={form.featuresHeader}
                onChange={(e) => set("featuresHeader", e.target.value)}
                placeholder={t("platform.planForm.featuresHeaderPlaceholder", { defaultValue: "Everything in Starter +" })}
              />
            </div>
            <div className="space-y-2">
              <Label className="text-xs font-normal text-muted-foreground">{t("platform.planForm.highlights", { defaultValue: "Highlights (bullets)" })}</Label>
              {form.highlights.map((highlight, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={highlight}
                    onChange={(e) => updateHighlight(index, e.target.value)}
                    placeholder={t("platform.planForm.highlightPlaceholder", { defaultValue: "Up to 100 properties" })}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeHighlight(index)}
                    aria-label={t("platform.planForm.removeHighlight", { defaultValue: "Remove highlight" })}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => set("highlights", [...form.highlights, ""])}
              >
                <Plus className="me-1.5 h-3.5 w-3.5" /> {t("platform.planForm.addHighlight", { defaultValue: "Add highlight" })}
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-cta" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.ctaLabel", { defaultValue: "CTA label" })}</Label>
                <Input
                  id="plan-cta"
                  value={form.ctaLabel}
                  onChange={(e) => set("ctaLabel", e.target.value)}
                  placeholder={t("platform.planForm.ctaLabelPlaceholder", { defaultValue: "Start free trial" })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-href" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.ctaLink", { defaultValue: "CTA link" })}</Label>
                <Input
                  id="plan-href"
                  value={form.ctaHref}
                  onChange={(e) => set("ctaHref", e.target.value)}
                  placeholder="/auth/signup"
                />
              </div>
            </div>

            {/* The same card in Arabic, folded away: most edits are to the
                English. Each field's placeholder is the English it
                translates; prices, links and flags are shared. */}
            <details className="group rounded-lg border">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                <Languages className="h-4 w-4 text-muted-foreground" aria-hidden />
                <span className="flex-1">
                  {t("platform.planForm.arabic", { defaultValue: "Arabic card (/ar)" })}
                </span>
                {hasArabicText(form.arabic) && (
                  <span className="size-2 rounded-full bg-emerald-500" aria-hidden />
                )}
                <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="space-y-3 border-t px-3.5 pb-3.5 pt-3">
                <p className="text-xs text-muted-foreground">
                  {t("platform.planForm.arabicHint", {
                    defaultValue:
                      "Shown on the Arabic pages. Leave a field empty to use the English, or the built-in Arabic for the default wording.",
                  })}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-ar-name" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.name", { defaultValue: "Name" })}</Label>
                    <Input id="plan-ar-name" dir="rtl" lang="ar" value={form.arabic.name} placeholder={form.name} onChange={(e) => setArabic("name", e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="plan-ar-suffix" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.priceSuffix", { defaultValue: "Price suffix" })}</Label>
                    <Input id="plan-ar-suffix" dir="rtl" lang="ar" value={form.arabic.priceSuffix} placeholder={form.priceSuffix} onChange={(e) => setArabic("priceSuffix", e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-ar-description" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.description", { defaultValue: "Description" })}</Label>
                  <Textarea id="plan-ar-description" dir="rtl" lang="ar" rows={2} value={form.arabic.description} placeholder={form.description} onChange={(e) => setArabic("description", e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="plan-ar-header" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.featuresHeader", { defaultValue: "Features header (optional)" })}</Label>
                  <Input id="plan-ar-header" dir="rtl" lang="ar" value={form.arabic.featuresHeader} placeholder={form.featuresHeader} onChange={(e) => setArabic("featuresHeader", e.target.value)} />
                </div>
                {form.highlights.length > 0 && (
                  <div className="space-y-2">
                    <Label className="text-xs font-normal text-muted-foreground">{t("platform.planForm.highlights", { defaultValue: "Highlights (bullets)" })}</Label>
                    {form.highlights.map((highlight, index) => (
                      <Input
                        key={index}
                        dir="rtl"
                        lang="ar"
                        aria-label={`${t("platform.planForm.highlights", { defaultValue: "Highlights (bullets)" })} ${index + 1}`}
                        value={form.arabic.highlights[index] ?? ""}
                        placeholder={highlight}
                        onChange={(e) => updateArabicHighlight(index, e.target.value)}
                      />
                    ))}
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="plan-ar-cta" className="text-xs font-normal text-muted-foreground">{t("platform.planForm.ctaLabel", { defaultValue: "CTA label" })}</Label>
                  <Input id="plan-ar-cta" dir="rtl" lang="ar" value={form.arabic.ctaLabel} placeholder={form.ctaLabel} onChange={(e) => setArabic("ctaLabel", e.target.value)} />
                </div>
              </div>
            </details>
          </div>

          {/* Flags */}
          <div className="space-y-3 border-t pt-5">
            {[
              ["popular", "Most popular", "Highlights this card on the pricing page."],
              ["isPublic", "Show on public pricing", "Visible on the marketing homepage."],
              ["isActive", "Active", "Selectable for new subscriptions."],
            ].map(([field, label, hint]) => (
              <div key={field} className="flex items-center justify-between">
                <div>
                  <Label>{label}</Label>
                  <p className="text-xs text-muted-foreground">{hint}</p>
                </div>
                <Switch
                  checked={form[field as "popular" | "isPublic" | "isActive"]}
                  onCheckedChange={(v) => set(field as "popular" | "isPublic" | "isActive", v)}
                />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <span className="w-24 text-sm text-muted-foreground">{t("platform.planForm.sortOrder", { defaultValue: "Sort order" })}</span>
              <Input
                type="number"
                value={form.sortOrder}
                onChange={(e) => set("sortOrder", Number(e.target.value))}
                className="max-w-[120px]"
              />
            </div>
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            {t("platform.common.cancel", { defaultValue: "Cancel" })}
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {isEdit ? "Save changes" : t("platform.planForm.createPlan", { defaultValue: "Create plan" })}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
