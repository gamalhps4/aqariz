"use client";

/**
 * PropertyPro - Payment analytics
 *
 * Money received over a period — by the day it arrived, refunds taken off —
 * what fell due in it, and what is owed now, for the whole portfolio or one
 * owner's, one building's, one kind of payment. Every figure comes from
 * GET /api/payments/reports/analytics, worked out over every payment in the
 * period; the page used to add up the first twelve rows of the payments
 * list and call the billed amounts revenue.
 *
 * The filters apply together, on Apply; Reset goes back to the last 30 days
 * and everything.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, Filter } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PaymentBreakdowns,
  PaymentStatistics,
} from "@/components/payments/payment-statistics";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import { PaymentType } from "@/types";
import { CHARGE_TYPES, paymentTypeLabel } from "@/lib/payments/type-labels";
import type { PaymentAnalytics } from "@/types/payment-report";

const ALL = "__all__";
const PRESETS = ["7", "30", "90", "180", "365"] as const;
const DEFAULT_PRESET = "30";
const CUSTOM = "custom";

/** The register's states; the stored lifecycle values the analytics read. */
const STATUSES = [
  { value: "paid", key: "payments.status.paid", fallback: "Paid" },
  { value: "partial", key: "payments.status.partial", fallback: "Partly paid" },
  { value: "refunded", key: "payments.status.refunded", fallback: "Refunded" },
] as const;

function isoDay(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The last `days` days, today included. */
function presetPeriod(days: number): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - (days - 1));
  return { startDate: isoDay(start), endDate: isoDay(end) };
}

interface Filters {
  preset: string;
  startDate: string;
  endDate: string;
  ownerId: string;
  propertyId: string;
  status: string;
  paymentType: string;
}

function defaultFilters(): Filters {
  return {
    preset: DEFAULT_PRESET,
    ...presetPeriod(Number(DEFAULT_PRESET)),
    ownerId: ALL,
    propertyId: ALL,
    status: ALL,
    paymentType: ALL,
  };
}

interface Option {
  id: string;
  label: string;
}

export default function PaymentAnalyticsPage() {
  const { t } = useLocalizationContext();
  const [draft, setDraft] = useState<Filters>(defaultFilters);
  const [applied, setApplied] = useState<Filters>(() => draft);
  const [analytics, setAnalytics] = useState<PaymentAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [owners, setOwners] = useState<Option[]>([]);
  const [buildings, setBuildings] = useState<Option[]>([]);

  const pending = JSON.stringify(draft) !== JSON.stringify(applied);

  /** What the figures were asked for, as the endpoint reads it. */
  const query = useMemo(() => {
    const params = new URLSearchParams({
      startDate: applied.startDate,
      endDate: applied.endDate,
    });
    if (applied.ownerId !== ALL) params.set("ownerId", applied.ownerId);
    if (applied.propertyId !== ALL) params.set("propertyId", applied.propertyId);
    if (applied.status !== ALL) params.set("status", applied.status);
    if (applied.paymentType !== ALL) params.set("paymentType", applied.paymentType);
    return params;
  }, [applied]);

  // The download is the payment report for the same period and filters —
  // every payment and refund behind the figures, with the same breakdowns.
  const exportParams = useMemo(() => {
    const params = new URLSearchParams(query);
    params.set("type", "collections");
    return params;
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/filter-options")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        setOwners(payload.data?.owners ?? []);
        setBuildings(payload.data?.properties ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/payments/reports/analytics?${query}`);
      const payload = await response.json().catch(() => null);
      if (response.ok && payload?.success) {
        setAnalytics(payload.data as PaymentAnalytics);
        setError(null);
      } else {
        setAnalytics(null);
        setError(
          payload?.error ??
            t("payments.analytics.loadFailed", {
              defaultValue: "Could not load the payments",
            }),
        );
      }
    } catch {
      setError(
        t("payments.analytics.loadFailed", {
          defaultValue: "Could not load the payments",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  useEffect(() => {
    load();
  }, [load]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setDraft((previous) => ({ ...previous, [key]: value }));

  const choosePreset = (preset: string) => {
    if (preset === CUSTOM) {
      set("preset", CUSTOM);
      return;
    }
    setDraft((previous) => ({ ...previous, preset, ...presetPeriod(Number(preset)) }));
  };

  const reset = () => {
    const fresh = defaultFilters();
    setDraft(fresh);
    setApplied(fresh);
  };

  const presetLabel = (preset: string) =>
    t(`payments.analytics.range.${preset}`, {
      defaultValue:
        {
          "7": "Last 7 days",
          "30": "Last 30 days",
          "90": "Last 3 months",
          "180": "Last 6 months",
          "365": "Last year",
        }[preset] ?? preset,
    });

  // Until the first figures arrive, a skeleton with no words in it: the page
  // is drawn on the server in English and redrawn in the reader's language,
  // and words present in both passes would not match.
  if (loading && !analytics && !error) {
    return (
      <div className="space-y-6" role="status">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-56 w-full rounded-xl" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <Link href="/dashboard/payments">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="me-2 h-4 w-4 rtl:rotate-180" />
              {t("payments.analytics.back", { defaultValue: "Back to payments" })}
            </Button>
          </Link>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <BarChart3 className="h-8 w-8" />
            {t("payments.analytics.title", { defaultValue: "Payment analytics" })}
          </h1>
          <p className="text-muted-foreground">
            {t("payments.analytics.subtitleReceived", {
              defaultValue:
                "Money received in a period, refunds taken off, against what fell due",
            })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/payments/reports"
          params={exportParams}
          disabled={loading}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Filter className="h-5 w-5" />
            {t("payments.analytics.filters", { defaultValue: "Filters" })}
          </CardTitle>
          <CardDescription>
            {t("payments.analytics.filtersHintApply", {
              defaultValue:
                "Choose the period, owner, building, status and payment type, then apply",
            })}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label>{t("payments.analytics.period", { defaultValue: "Period" })}</Label>
              <Select value={draft.preset} onValueChange={choosePreset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {presetLabel(preset)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM}>
                    {t("payments.analytics.range.custom", { defaultValue: "Choose dates" })}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-from">
                {t("payments.reports.from", { defaultValue: "From" })}
              </Label>
              <Input
                id="analytics-from"
                type="date"
                value={draft.startDate}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    preset: CUSTOM,
                    startDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="analytics-to">
                {t("payments.reports.to", { defaultValue: "To" })}
              </Label>
              <Input
                id="analytics-to"
                type="date"
                value={draft.endDate}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    preset: CUSTOM,
                    endDate: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>{t("payments.reports.owner", { defaultValue: "Owner" })}</Label>
              <Select value={draft.ownerId} onValueChange={(value) => set("ownerId", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("payments.reports.allOwners", { defaultValue: "All owners" })}
                  </SelectItem>
                  {owners.map((owner) => (
                    <SelectItem key={owner.id} value={owner.id}>
                      {owner.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("payments.reports.building", { defaultValue: "Building" })}</Label>
              <Select
                value={draft.propertyId}
                onValueChange={(value) => set("propertyId", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("payments.reports.allBuildings", { defaultValue: "All buildings" })}
                  </SelectItem>
                  {buildings.map((building) => (
                    <SelectItem key={building.id} value={building.id}>
                      {building.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("payments.table.status", { defaultValue: "Status" })}</Label>
              <Select value={draft.status} onValueChange={(value) => set("status", value)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("payments.analytics.allStatuses", { defaultValue: "All statuses" })}
                  </SelectItem>
                  {STATUSES.map((status) => (
                    <SelectItem key={status.value} value={status.value}>
                      {t(status.key, { defaultValue: status.fallback })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>{t("payments.table.type", { defaultValue: "Type" })}</Label>
              <Select
                value={draft.paymentType}
                onValueChange={(value) => set("paymentType", value)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>
                    {t("payments.analytics.allTypes", { defaultValue: "All types" })}
                  </SelectItem>
                  {[...CHARGE_TYPES, PaymentType.LATE_FEE].map((type) => (
                    <SelectItem key={type} value={type}>
                      {paymentTypeLabel(type, t)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!pending} onClick={() => setApplied(draft)}>
              {t("reports.applyFilters", { defaultValue: "Apply filters" })}
            </Button>
            <Button variant="ghost" size="sm" onClick={reset}>
              {t("reports.resetFilters", { defaultValue: "Reset filters" })}
            </Button>
            {pending && (
              <span className="text-xs text-muted-foreground">
                {t("reports.pendingHint", {
                  defaultValue: "Filters changed — the figures below are from the last run.",
                })}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {analytics ? (
        <div className={loading ? "space-y-6 opacity-60" : "space-y-6"}>
          <PaymentStatistics analytics={analytics} />
          <PaymentBreakdowns analytics={analytics} />
        </div>
      ) : null}
    </div>
  );
}
