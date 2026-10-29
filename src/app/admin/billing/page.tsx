"use client";

import Link from "next/link";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect, useCallback, useMemo } from "react";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { OverLimitReport } from "@/components/platform/over-limit-report";
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Clock,
  AlertTriangle,
  Building2,
} from "lucide-react";
import { APP_CURRENCY } from "@/lib/regional/region";

interface OrgBillingRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  subscriptionStatus: string | null;
  monthlyValue: number;
  currentPeriodEnd: string | null;
  trialEndsAt: string | null;
  cancelAtPeriodEnd: boolean;
  hasStripeCustomer: boolean;
}

interface BillingMetrics {
  currency: string;
  mrr: number;
  arr: number;
  atRiskMrr: number;
  counts: {
    total: number;
    paying: number;
    trialing: number;
    pastDue: number;
    canceled: number;
    free: number;
    suspended: number;
  };
  planDistribution: Array<{
    plan: string;
    name: string;
    count: number;
    mrr: number;
  }>;
  organizations: OrgBillingRow[];
}

const DEFAULT_FILTERS = {
  search: "",
  plan: "all",
  subscription: "all",
  sort: "mrr-desc",
  page: 1,
  pageSize: 12,
};


const subVariant = (s: string | null) => {
  switch (s) {
    case "active":
      return "default";
    case "trialing":
      return "secondary";
    case "past_due":
    case "unpaid":
      return "destructive";
    default:
      return "outline";
  }
};

export default function PlatformBillingPage() {
  const { t, formatDate } = useLocalizationContext();
  const [metrics, setMetrics] = useState<BillingMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);

  const fmtMoney = useCallback(
    (amount: number) =>
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: metrics?.currency || APP_CURRENCY,
        maximumFractionDigits: 0,
      }).format(amount),
    [metrics?.currency],
  );

  useEffect(() => {
    let active = true;
    fetch("/api/admin/billing")
      .then((res) => res.json().then((result) => ({ res, result })))
      .then(({ res, result }) => {
        if (!active) return;
        if (!res.ok || !result.success) {
          setError(result.error || "Failed to load billing metrics");
          return;
        }
        setMetrics(result.data as BillingMetrics);
        setError("");
      })
      .catch(() => {
        if (active) setError(t("platform.billing.loadError", { defaultValue: "Failed to load billing metrics" }));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  /** Any filter change invalidates the page number. */
  const setFilter = useCallback(
    (patch: Partial<typeof DEFAULT_FILTERS>) =>
      setFilters((current) => ({ ...current, page: 1, ...patch })),
    [],
  );

  // The metrics endpoint returns every organization in one payload — the
  // aggregates on this page are computed from the whole set — so the table
  // filters here rather than round-tripping for a page at a time.
  const allRows = useMemo(
    () => metrics?.organizations ?? [],
    [metrics?.organizations],
  );

  const planOptions = useMemo(
    () => Array.from(new Set(allRows.map((o) => o.plan).filter(Boolean))).sort(),
    [allRows],
  );

  const filteredRows = useMemo(() => {
    const term = filters.search.trim().toLowerCase();

    const rows = allRows.filter((o) => {
      const matchesTerm =
        !term ||
        o.name.toLowerCase().includes(term) ||
        o.slug.toLowerCase().includes(term) ||
        o.plan.toLowerCase().includes(term);
      const matchesPlan = filters.plan === "all" || o.plan === filters.plan;
      const matchesSubscription =
        filters.subscription === "all" ||
        (o.subscriptionStatus || "none") === filters.subscription;

      return matchesTerm && matchesPlan && matchesSubscription;
    });

    const renewsAt = (o: OrgBillingRow) => {
      const date = o.currentPeriodEnd || o.trialEndsAt;
      return date ? new Date(date).getTime() : Number.POSITIVE_INFINITY;
    };

    const sorters: Record<string, (a: OrgBillingRow, b: OrgBillingRow) => number> = {
      "mrr-desc": (a, b) => b.monthlyValue - a.monthlyValue,
      "mrr-asc": (a, b) => a.monthlyValue - b.monthlyValue,
      "name-asc": (a, b) => a.name.localeCompare(b.name),
      "name-desc": (a, b) => b.name.localeCompare(a.name),
      "renews-asc": (a, b) => renewsAt(a) - renewsAt(b),
    };

    return [...rows].sort(sorters[filters.sort] ?? sorters["mrr-desc"]);
  }, [allRows, filters.plan, filters.search, filters.sort, filters.subscription]);

  const pageRows = useMemo(() => {
    const start = (filters.page - 1) * filters.pageSize;
    return filteredRows.slice(start, start + filters.pageSize);
  }, [filteredRows, filters.page, filters.pageSize]);

  const filtersActive =
    filters.search.trim().length > 0 ||
    filters.plan !== "all" ||
    filters.subscription !== "all" ||
    filters.sort !== DEFAULT_FILTERS.sort;

  // Labels are translated, so the list is built inside the component
  // rather than at module scope where `t` does not exist.
  const subscriptionOptions = useMemo(
    () => [
      { value: "all", label: t("platform.billing.filter.all", { defaultValue: "All subscriptions" }) },
      { value: "active", label: t("platform.billing.filter.active", { defaultValue: "Active" }) },
      { value: "trialing", label: t("platform.billing.filter.trialing", { defaultValue: t("platform.billing.stats.trialing", { defaultValue: "Trialing" }) }) },
      { value: "past_due", label: t("platform.billing.filter.pastDue", { defaultValue: "Past due" }) },
      { value: "unpaid", label: t("platform.billing.filter.unpaid", { defaultValue: "Unpaid" }) },
      { value: "canceled", label: t("platform.billing.filter.canceled", { defaultValue: "Canceled" }) },
      { value: "none", label: t("platform.billing.filter.none", { defaultValue: "No subscription" }) },
    ],
    [t],
  );

  const columns: DataTableColumn<OrgBillingRow>[] = useMemo(
    () => [
      {
        id: "name",
        header: t("platform.billing.col.organization", { defaultValue: "Organization" }),
        cell: (o) => (
          <Link href={`/admin/organizations/${o.id}`} className="block hover:underline">
            <div className="font-medium text-foreground">{o.name}</div>
            <div className="text-xs text-muted-foreground">/{o.slug}</div>
          </Link>
        ),
      },
      {
        id: "plan",
        header: t("platform.billing.col.plan", { defaultValue: "Plan" }),
        cell: (o) => <span className="capitalize">{o.plan}</span>,
      },
      {
        id: "subscriptionStatus",
        header: t("platform.billing.col.subscription", { defaultValue: "Subscription" }),
        cell: (o) => (
          <Badge variant={subVariant(o.subscriptionStatus)} className="capitalize">
            {(o.subscriptionStatus || "none").replace("_", " ")}
          </Badge>
        ),
      },
      {
        id: "monthlyValue",
        header: t("platform.billing.col.mrr", { defaultValue: t("platform.billing.stats.mrr", { defaultValue: "MRR" }) }),
        align: "right",
        cell: (o) =>
          o.monthlyValue > 0 ? (
            fmtMoney(o.monthlyValue)
          ) : (
            <span className="text-muted-foreground">—</span>
          ),
      },
      {
        id: "renews",
        header: t("platform.billing.col.renews", { defaultValue: "Renews / trial ends" }),
        align: "right",
        visibility: "md",
        cell: (o) => {
          const d = o.currentPeriodEnd || o.trialEndsAt;
          if (!d) return <span className="text-muted-foreground">—</span>;
          return (
            <span className="text-sm text-muted-foreground">
              {formatDate(d, { format: "medium" })}
              {o.cancelAtPeriodEnd && (
                <Badge variant="destructive" className="ms-2">
                  cancels
                </Badge>
              )}
            </span>
          );
        },
      },
    ],
    [fmtMoney, formatDate],
  );

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("platform.billing.title", { defaultValue: "Billing" })}</h1>
          <p className="text-sm text-muted-foreground">
            {t("platform.billing.subtitle", { defaultValue: "Subscription revenue across all organizations" })}
          </p>
        </div>
        {/* The subscription book with MRR, ARR and the at-risk figure in the
            summary — what an accountant asks for at quarter end. */}
        <ReportExportButton
          endpoint="/api/admin/billing"
          params={new URLSearchParams()}
          disabled={loading}
        />
      </div>

      <OverLimitReport />

      <AnalyticsCardGrid className="lg:grid-cols-3 xl:grid-cols-5">
        <AnalyticsCard
          title={t("platform.billing.col.mrr", { defaultValue: "MRR" })}
          value={loading || !metrics ? "—" : fmtMoney(metrics.mrr)}
          description={t("platform.billing.stats.mrrHint", { defaultValue: "Monthly recurring revenue" })}
          icon={DollarSign}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("platform.billing.stats.arr", { defaultValue: "ARR" })}
          value={loading || !metrics ? "—" : fmtMoney(metrics.arr)}
          description={t("platform.billing.stats.arrHint", { defaultValue: "Annualized run-rate" })}
          icon={TrendingUp}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("platform.billing.stats.paying", { defaultValue: "Paying" })}
          value={loading || !metrics ? "—" : metrics.counts.paying}
          description={t("platform.billing.stats.payingHint", { defaultValue: "Active subscriptions" })}
          icon={CreditCard}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("platform.billing.filter.trialing", { defaultValue: "Trialing" })}
          value={loading || !metrics ? "—" : metrics.counts.trialing}
          description={t("platform.billing.stats.trialHint", { defaultValue: "On free trial" })}
          icon={Clock}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("platform.billing.stats.atRisk", { defaultValue: "At risk" })}
          value={loading || !metrics ? "—" : fmtMoney(metrics.atRiskMrr)}
          description={`${metrics?.counts.pastDue ?? 0} past-due orgs`}
          icon={AlertTriangle}
          iconColor="error"
        />
      </AnalyticsCardGrid>

      {/* Plan distribution */}
      <Card>
        <CardHeader>
          <CardTitle>{t("platform.billing.planDistribution", { defaultValue: "Plan distribution" })}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {(metrics?.planDistribution ?? []).map((p) => (
              <div
                key={p.plan}
                className="rounded-lg border border-border/60 p-4"
              >
                <div className="text-sm font-medium capitalize">{p.name}</div>
                <div className="mt-1 text-2xl font-bold">{p.count}</div>
                <div className="text-xs text-muted-foreground">
                  {fmtMoney(p.mrr)} MRR
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Per-organization billing */}
      <DataTableCard<OrgBillingRow>
        icon={Building2}
        title={t("platform.billing.card.title", { defaultValue: "Organizations" })}
        description={t("platform.billing.card.description", { defaultValue: "Subscription state and recurring value per tenant." })}
        headerActions={
          <Badge variant="secondary" className="w-fit tabular-nums">
            {loading
              ? "Loading…"
              : `${filteredRows.length} of ${allRows.length} organizations`}
          </Badge>
        }
        search={{
          value: filters.search,
          onSearch: (value) => setFilter({ search: value }),
          placeholder: t("platform.billing.searchPlaceholder", { defaultValue: "Search name, slug, or plan…" }),
          ariaLabel: t("platform.billing.searchLabel", { defaultValue: "Search organizations" }),
        }}
        filters={[
          {
            id: "plan",
            value: filters.plan,
            onChange: (value) => setFilter({ plan: value }),
            ariaLabel: t("platform.billing.filter.plan", { defaultValue: "Filter by plan" }),
            options: [
              { value: "all", label: t("platform.organizations.filter.allPlans", { defaultValue: t("platform.billing.filter.allPlans", { defaultValue: "All plans" }) }) },
              ...planOptions.map((plan) => ({
                value: plan,
                label: <span className="capitalize">{plan}</span>,
              })),
            ],
          },
          {
            id: "subscription",
            value: filters.subscription,
            onChange: (value) => setFilter({ subscription: value }),
            ariaLabel: t("platform.billing.filter.subscriptionStatus", { defaultValue: "Filter by subscription status" }),
            width: "w-[180px]",
            options: subscriptionOptions,
          },
          {
            id: "sort",
            value: filters.sort,
            onChange: (value) => setFilter({ sort: value }),
            ariaLabel: t("platform.organizations.filter.sort", { defaultValue: t("platform.billing.filter.sort", { defaultValue: "Sort organizations" }) }),
            width: "w-[170px]",
            options: [
              { value: "mrr-desc", label: t("platform.billing.sort.mrrDesc", { defaultValue: "MRR high to low" }) },
              { value: "mrr-asc", label: t("platform.billing.sort.mrrAsc", { defaultValue: "MRR low to high" }) },
              { value: "renews-asc", label: t("platform.billing.sort.renews", { defaultValue: "Renews soonest" }) },
              { value: "name-asc", label: t("platform.users.sort.nameAsc", { defaultValue: t("platform.billing.sort.nameAsc", { defaultValue: "Name A–Z" }) }) },
              { value: "name-desc", label: t("platform.users.sort.nameDesc", { defaultValue: t("platform.billing.sort.nameDesc", { defaultValue: "Name Z–A" }) }) },
            ],
          },
        ]}
        filtersActive={filtersActive}
        onResetFilters={() => setFilters(DEFAULT_FILTERS)}
        columns={columns}
        data={pageRows}
        loading={loading}
        loadingConfig={{ rows: 6 }}
        getRowKey={(o) => o.id}
        error={error ? { message: error, onRetry: retry } : null}
        emptyState={{
          icon: <Building2 className="h-8 w-8 text-muted-foreground" />,
          title: filtersActive
            ? "No organizations match these filters"
            : "No organizations",
          description: filtersActive
            ? "Try adjusting your search or clearing the filters."
            : "No tenants exist on the platform yet.",
        }}
        pagination={{
          currentPage: filters.page,
          pageSize: filters.pageSize,
          totalItems: filteredRows.length,
          onPageChange: (page) =>
            setFilters((current) => ({ ...current, page })),
          onPageSizeChange: (pageSize) => setFilter({ pageSize }),
        }}
      />
    </ResponsiveLayout>
  );
}
