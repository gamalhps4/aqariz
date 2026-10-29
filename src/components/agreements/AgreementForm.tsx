"use client";

/**
 * PropertyPro - Management agreement form
 *
 * Two decisions drive everything else on this form:
 *
 *  - WHAT IT COVERS: one property, one compound, or the owner's whole
 *    portfolio. The scopes are mutually exclusive and a more specific
 *    agreement overrides a broader one, which the form states plainly —
 *    otherwise an operator cannot tell what a second agreement will do.
 *  - HOW THE FEE WORKS: a percentage of rent, or a flat amount per cycle.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Percent, Save, Wallet, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  AGREEMENT_FEE_FREQUENCIES,
  FREQUENCY_LABELS,
} from "@/lib/lease-installments";
import type {
  AgreementDetail,
  AgreementFeeType,
  AgreementKind,
  AgreementStatus,
  CommissionBasis,
} from "@/types/agreement";

const PORTFOLIO = "__portfolio__";

interface OwnerOption {
  userId: string;
  name: string;
  companyName: string | null;
  propertyCount: number;
}

interface PropertyOption {
  id: string;
  name: string;
  ownerId: string;
  compoundId: string | null;
}

interface CompoundOption {
  id: string;
  name: string;
}

interface AgreementFormProps {
  agreement?: AgreementDetail;
  /** The kind a new agreement starts as — from the list it was opened on. */
  defaultKind?: AgreementKind;
}

export function AgreementForm({ agreement, defaultKind }: AgreementFormProps) {
  const router = useRouter();
  const { t } = useLocalizationContext();

  const [owners, setOwners] = useState<OwnerOption[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [compounds, setCompounds] = useState<CompoundOption[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const initialScope: string = agreement?.propertyId
    ? `property:${agreement.propertyId}`
    : agreement?.compoundId
      ? `compound:${agreement.compoundId}`
      : PORTFOLIO;

  const [form, setForm] = useState({
    kind: ((agreement?.kind as AgreementKind | undefined) ??
      defaultKind ??
      "management") as AgreementKind,
    agreementNumber: agreement?.agreementNumber ?? "",
    ownerId: agreement?.ownerId ?? "",
    scope: initialScope,
    feeType: (agreement?.feeType ??
      (defaultKind === "investment" ? "fixed" : "percentage")) as AgreementFeeType,
    feePercentage: String(agreement?.feePercentage ?? 5),
    feeAmount: String(agreement?.feeAmount ?? 0),
    feeFrequency:
      agreement?.feeFrequency ??
      (defaultKind === "investment" ? "annual" : "monthly"),
    commissionBasis: agreement?.commissionBasis ?? "collected",
    currency: agreement?.currency ?? "SAR",
    startDate: agreement?.startDate?.slice(0, 10) ?? "",
    endDate: agreement?.endDate?.slice(0, 10) ?? "",
    status: agreement?.status ?? "active",
    notes: agreement?.notes ?? "",
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const load = useCallback(async () => {
    const [ownerRes, propertyRes, compoundRes] = await Promise.all([
      fetch("/api/owners").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/properties?limit=200")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/compounds?limit=200")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (ownerRes?.success) {
      setOwners(
        (ownerRes.data ?? []).map((o: Record<string, unknown>) => ({
          userId: o.userId as string,
          name: o.name as string,
          companyName: (o.companyName as string | null) ?? null,
          propertyCount: (o.propertyCount as number) ?? 0,
        })),
      );
    }
    if (propertyRes?.success) {
      setProperties(
        (propertyRes.data ?? []).map((p: Record<string, any>) => ({
          id: p.id,
          name: p.name,
          ownerId: p.ownerId?.id ?? p.ownerId,
          compoundId: p.compoundId ?? null,
        })),
      );
    }
    if (compoundRes?.success) {
      setCompounds(
        (compoundRes.data ?? []).map((c: Record<string, any>) => ({
          id: c.id,
          name: c.name,
        })),
      );
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Only this owner's properties can be named — an agreement pointing at a
  // building they do not own would never resolve, and the API refuses it.
  const ownerProperties = useMemo(
    () => properties.filter((property) => property.ownerId === form.ownerId),
    [properties, form.ownerId],
  );

  const ownerCompounds = useMemo(() => {
    const ids = new Set(
      ownerProperties
        .map((property) => property.compoundId)
        .filter((id): id is string => Boolean(id)),
    );
    return compounds.filter((compound) => ids.has(compound.id));
  }, [compounds, ownerProperties]);

  const submit = async () => {
    setError(null);

    if (!form.ownerId) {
      setError(
        t("agreements.form.ownerRequired", { defaultValue: "Choose an owner" }),
      );
      return;
    }
    if (!form.startDate) {
      setError(
        t("agreements.form.startRequired", {
          defaultValue: "A start date is required",
        }),
      );
      return;
    }

    const [scopeKind, scopeId] = form.scope.split(":");

    const isInvestment = form.kind === "investment";
    // An investment agreement's rent is always a fixed amount per cycle.
    const feeType: AgreementFeeType = isInvestment ? "fixed" : form.feeType;
    const payload = {
      ...(agreement ? {} : { kind: form.kind }),
      agreementNumber: form.agreementNumber.trim() || null,
      ownerId: form.ownerId,
      propertyId: scopeKind === "property" ? scopeId : null,
      compoundId: scopeKind === "compound" ? scopeId : null,
      feeType,
      feePercentage:
        feeType === "percentage" ? Number(form.feePercentage) : undefined,
      feeAmount: feeType === "fixed" ? Number(form.feeAmount) : undefined,
      feeFrequency: form.feeFrequency,
      commissionBasis: form.commissionBasis,
      currency: form.currency,
      startDate: form.startDate,
      endDate: form.endDate || null,
      status: form.status,
      notes: form.notes.trim() || null,
    };

    setSubmitting(true);
    try {
      const response = await fetch(
        agreement ? `/api/agreements/${agreement.id}` : "/api/agreements",
        {
          method: agreement ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      const result = await response.json();
      if (!response.ok || !result?.success) {
        setError(
          result?.error ??
            t("agreements.form.saveFailed", {
              defaultValue: "Could not save the agreement",
            }),
        );
        return;
      }
      const id = agreement?.id ?? result.data?.id;
      router.push(id ? `/dashboard/agreements/${id}` : "/dashboard/agreements");
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* What kind of agreement — fixed once it is created, like the owner. */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("agreements.form.kind", { defaultValue: "Agreement type" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2">
          {(
            [
              {
                value: "management" as const,
                icon: Percent,
                label: t("agreements.kind.management", { defaultValue: "Management agreement" }),
                body: t("agreements.kind.managementBody", { defaultValue: "The office manages the buildings and keeps a commission on the rent." }),
              },
              {
                value: "investment" as const,
                icon: Wallet,
                label: t("agreements.kind.investment", { defaultValue: "Investment agreement" }),
                body: t("agreements.kind.investmentBody", { defaultValue: "The office rents the buildings from the owner for a fixed amount and keeps the rent it collects." }),
              },
            ]
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              disabled={Boolean(agreement)}
              onClick={() => {
                set("kind", option.value);
                if (option.value === "investment") set("feeType", "fixed");
              }}
              className={`flex items-start gap-3 rounded-lg border p-3 text-start transition-colors disabled:cursor-not-allowed disabled:opacity-70 ${
                form.kind === option.value
                  ? "border-primary bg-primary/5"
                  : "hover:bg-muted/50"
              }`}
            >
              <option.icon className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                <span className="block text-sm font-medium">{option.label}</span>
                <span className="block text-xs text-muted-foreground">
                  {option.body}
                </span>
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("agreements.form.parties", {
              defaultValue: "Owner & coverage",
            })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>
              {t("agreements.form.owner", { defaultValue: "Owner" })} *
            </Label>
            <Select
              value={form.ownerId}
              onValueChange={(value) => {
                set("ownerId", value);
                // Scope belongs to the previous owner; reset it rather than
                // silently carrying an id they do not own.
                set("scope", PORTFOLIO);
              }}
              disabled={Boolean(agreement)}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t("agreements.form.ownerPlaceholder", {
                    defaultValue: "Choose an owner",
                  })}
                />
              </SelectTrigger>
              <SelectContent>
                {owners.map((owner) => (
                  <SelectItem key={owner.userId} value={owner.userId}>
                    {owner.companyName ?? owner.name}
                    {owner.propertyCount > 0 && ` · ${owner.propertyCount}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {agreement && (
              <p className="text-xs text-muted-foreground">
                {t("agreements.form.ownerLocked", {
                  defaultValue:
                    "The owner cannot be changed — create a new agreement instead.",
                })}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="agreementNumber">
              {t("agreements.form.number", {
                defaultValue: "Agreement number",
              })}
            </Label>
            <Input
              id="agreementNumber"
              value={form.agreementNumber}
              onChange={(event) => set("agreementNumber", event.target.value)}
              placeholder="AGR-0001"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label>
              {t("agreements.form.covers", { defaultValue: "Covers" })}
            </Label>
            <Select
              value={form.scope}
              onValueChange={(value) => set("scope", value)}
              disabled={!form.ownerId}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PORTFOLIO}>
                  {t("agreements.form.scope.portfolio", {
                    defaultValue: "Every property this owner holds",
                  })}
                </SelectItem>
                {ownerCompounds.map((compound) => (
                  <SelectItem key={compound.id} value={`compound:${compound.id}`}>
                    {t("agreements.form.scope.compound", {
                      defaultValue: "Compound: {name}",
                      values: { name: compound.name },
                    })}
                  </SelectItem>
                ))}
                {ownerProperties.map((property) => (
                  <SelectItem key={property.id} value={`property:${property.id}`}>
                    {t("agreements.form.scope.property", {
                      defaultValue: "Property: {name}",
                      values: { name: property.name },
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("agreements.form.scopeHint", {
                defaultValue:
                  "A more specific agreement wins: a property agreement overrides a compound one, which overrides a portfolio-wide one. You can leave the broader agreement in place.",
              })}
            </p>
          </div>
        </CardContent>
      </Card>

      {form.kind === "investment" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("agreements.investment.rent", { defaultValue: "Rent paid to the owner" })}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="investmentAmount">
                  {t("agreements.form.amount", { defaultValue: "Amount" })}
                </Label>
                <Input
                  id="investmentAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.feeAmount}
                  onChange={(event) => set("feeAmount", event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>
                  {t("agreements.investment.every", { defaultValue: "Paid" })}
                </Label>
                <Select
                  value={form.feeFrequency}
                  onValueChange={(value) => set("feeFrequency", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AGREEMENT_FEE_FREQUENCIES.map((frequency) => (
                      <SelectItem key={frequency} value={frequency}>
                        {t(`leases.contract.frequency.${frequency}`, {
                          defaultValue: FREQUENCY_LABELS[frequency],
                        })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {t("agreements.investment.hint", { defaultValue: "The owner is owed this amount whatever the buildings earn. The tenants' rent and the running costs are the office's, and no management commission applies while the agreement is in force." })}
            </p>
          </CardContent>
        </Card>
      ) : (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("agreements.form.fee", { defaultValue: "Management fee" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                {
                  value: "percentage" as const,
                  icon: Percent,
                  labelKey: "agreements.feeType.percentage",
                  fallback: "Percentage of rent",
                  bodyKey: "agreements.feeType.percentageBody",
                  bodyFallback: "The office keeps a share of what comes in",
                },
                {
                  value: "fixed" as const,
                  icon: Wallet,
                  labelKey: "agreements.feeType.fixed",
                  fallback: "Fixed fee",
                  bodyKey: "agreements.feeType.fixedBody",
                  bodyFallback: "A flat amount each cycle, whatever the rent",
                },
              ]
            ).map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => set("feeType", option.value)}
                className={`flex items-start gap-3 rounded-lg border p-3 text-start transition-colors ${
                  form.feeType === option.value
                    ? "border-primary bg-primary/5"
                    : "hover:bg-muted/50"
                }`}
              >
                <option.icon className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  <span className="block text-sm font-medium">
                    {t(option.labelKey, { defaultValue: option.fallback })}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(option.bodyKey, { defaultValue: option.bodyFallback })}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {form.feeType === "percentage" ? (
              <div className="space-y-2">
                <Label htmlFor="feePercentage">
                  {t("agreements.form.percentage", {
                    defaultValue: "Rate (%)",
                  })}
                </Label>
                <Input
                  id="feePercentage"
                  type="number"
                  min="0"
                  max="100"
                  step="0.001"
                  value={form.feePercentage}
                  onChange={(event) => set("feePercentage", event.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="feeAmount">
                    {t("agreements.form.amount", { defaultValue: "Amount" })}
                  </Label>
                  <Input
                    id="feeAmount"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.feeAmount}
                    onChange={(event) => set("feeAmount", event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>
                    {t("agreements.form.frequency", {
                      defaultValue: "Charged",
                    })}
                  </Label>
                  <Select
                    value={form.feeFrequency}
                    onValueChange={(value) => set("feeFrequency", value)}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {AGREEMENT_FEE_FREQUENCIES.map((frequency) => (
                        <SelectItem key={frequency} value={frequency}>
                          {t(`leases.contract.frequency.${frequency}`, {
                            defaultValue: FREQUENCY_LABELS[frequency],
                          })}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label>
                {t("agreements.form.basis", { defaultValue: "Charged on" })}
              </Label>
              <Select
                value={form.commissionBasis}
                onValueChange={(value) => set("commissionBasis", value as CommissionBasis)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="collected">
                    {t("agreements.basis.collected", {
                      defaultValue: "Rent collected",
                    })}
                  </SelectItem>
                  <SelectItem value="billed">
                    {t("agreements.basis.billed", {
                      defaultValue: "Rent billed",
                    })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {form.commissionBasis === "collected"
              ? t("agreements.basis.collectedHint", {
                  defaultValue:
                    "The office earns as money actually arrives — nothing is charged on rent that was invoiced but never paid.",
                })
              : t("agreements.basis.billedHint", {
                  defaultValue:
                    "The office earns on what was invoiced, whether or not the tenant has paid.",
                })}
          </p>
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("agreements.form.term", { defaultValue: "Term" })}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="startDate">
              {t("agreements.form.startDate", { defaultValue: "Start date" })} *
            </Label>
            <Input
              id="startDate"
              type="date"
              value={form.startDate}
              onChange={(event) => set("startDate", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="endDate">
              {t("agreements.form.endDate", {
                defaultValue: "End date (optional)",
              })}
            </Label>
            <Input
              id="endDate"
              type="date"
              value={form.endDate}
              onChange={(event) => set("endDate", event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label>
              {t("agreements.form.status", { defaultValue: "Status" })}
            </Label>
            <Select
              value={form.status}
              onValueChange={(value) => set("status", value as AgreementStatus)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["draft", "active", "expired", "terminated"] as const).map(
                  (status) => (
                    <SelectItem key={status} value={status}>
                      {t(`agreements.status.${status}`, {
                        defaultValue: status,
                      })}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            {form.status === "draft" && (
              <p className="text-xs text-muted-foreground">
                {t("agreements.form.draftHint", {
                  defaultValue: "A draft earns no commission until activated.",
                })}
              </p>
            )}
            {/* Saving it closed records the day it closed (the server
                decides — lib/agreement-closing.ts). */}
            {(form.status === "expired" || form.status === "terminated") && (
              <p className="text-xs text-muted-foreground">
                {t("agreements.form.closedHint", {
                  defaultValue:
                    "It stops earning on the day it is closed, or on its end date if that came first.",
                })}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 pt-6">
          <Label htmlFor="notes">
            {t("agreements.form.notes", { defaultValue: "Notes" })}
          </Label>
          <Textarea
            id="notes"
            rows={3}
            value={form.notes}
            onChange={(event) => set("notes", event.target.value)}
          />
        </CardContent>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={submitting}
        >
          <X className="h-4 w-4" />
          {t("common.cancel", { defaultValue: "Cancel" })}
        </Button>
        <Button onClick={submit} disabled={submitting}>
          {submitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          {agreement
            ? t("common.saveChanges", { defaultValue: "Save changes" })
            : t("agreements.actions.add", { defaultValue: "Create agreement" })}
        </Button>
      </div>
    </div>
  );
}
