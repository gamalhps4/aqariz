"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ReportExportButton } from "@/components/reports/export-button";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { keepSorted, parseSortValue } from "@/lib/server-sort";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Loader2,
  Building2,
  Users,
  Home,
  AlertCircle,
  RefreshCw,
  CircleCheck,
  Clock,
  Ban,
  RotateCcw,
  ArrowRight,
} from "lucide-react";

interface Org {
  id: string;
  name: string;
  slug: string;
  status: "active" | "suspended" | "trial";
  plan: string;
  userCount: number;
  propertyCount: number;
  createdAt: string;
}

interface Totals {
  orgs: number;
  active: number;
  trial: number;
  suspended: number;
  users: number;
  properties: number;
}

const EMPTY_TOTALS: Totals = {
  orgs: 0,
  active: 0,
  trial: 0,
  suspended: 0,
  users: 0,
  properties: 0,
};

const DEFAULT_FILTERS = {
  search: "",
  status: "all",
  plan: "all",
  sort: "createdAt-desc",
  page: 1,
  pageSize: 12,
};

const statusVariant = (s: Org["status"]) =>
  s === "suspended"
    ? "destructive"
    : s === "trial"
      ? "secondary"
      : "default";

const statusIcon = {
  active: CircleCheck,
  trial: Clock,
  suspended: Ban,
};

export default function PlatformOrganizationsPage() {
  const { t, formatDate } = useLocalizationContext();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [totals, setTotals] = useState<Totals>(EMPTY_TOTALS);
  const [planFacets, setPlanFacets] = useState<
    { value: string; count: number }[]
  >([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  // The summary cards describe the whole platform, so they must not blink back
  // to "—" every time a filter re-runs the table query.
  const [initialLoad, setInitialLoad] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [reloadKey, setReloadKey] = useState(0);

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sort: filters.sort,
    });
    if (filters.search) params.set("search", filters.search);
    if (filters.status !== "all") params.set("status", filters.status);
    if (filters.plan !== "all") params.set("plan", filters.plan);
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/organizations?${query}`)
      .then((res) => res.json().then((result) => ({ res, result })))
      .then(({ res, result }) => {
        if (!active) return;
        if (!res.ok || !result.success) {
          setLoadError(result.error || "Failed to load organizations");
          return;
        }
        setOrgs(result.data.organizations as Org[]);
        setTotal(result.data.pagination.total);
        setTotals(result.data.totals as Totals);
        setPlanFacets(result.data.facets?.plans ?? []);
        setLoadError("");
      })
      .catch(() => {
        if (active) setLoadError("Failed to load organizations");
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
        setInitialLoad(false);
      });
    return () => {
      active = false;
    };
  }, [query, reloadKey]);

  /** Re-run the current query without blanking the table. */
  const refresh = useCallback(() => {
    setRefreshing(true);
    setReloadKey((key) => key + 1);
  }, []);

  const retry = useCallback(() => {
    setLoading(true);
    setReloadKey((key) => key + 1);
  }, []);

  /** Any filter change invalidates the page number. */
  const setFilter = useCallback((patch: Partial<typeof DEFAULT_FILTERS>) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const setPage = useCallback((page: number) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page }));
  }, []);

  const setStatus = async (org: Org, next: "active" | "suspended") => {
    setBusyId(org.id);
    setActionError("");
    try {
      const res = await fetch(`/api/admin/organizations/${org.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      const result = await res.json();
      if (res.ok && result.success) {
        // The status filter and the summary cards are both server-computed,
        // so a local patch would leave one of them lying.
        refresh();
      } else {
        setActionError(result.error || "Update failed");
      }
    } catch {
      setActionError("Update failed");
    } finally {
      setBusyId(null);
    }
  };

  const filtersActive =
    filters.search.trim().length > 0 ||
    filters.status !== "all" ||
    filters.plan !== "all" ||
    filters.sort !== DEFAULT_FILTERS.sort;

  const resetFilters = () => {
    setLoading(true);
    setFilters(DEFAULT_FILTERS);
  };

  const columns: DataTableColumn<Org>[] = useMemo(
    () => [
      {
        id: "name",
        header: t("platform.organizations.col.organization", { defaultValue: "Organization" }),
        sortKey: "name",
        cell: (org) => (
          <div>
            <div className="font-medium text-foreground">{org.name}</div>
            <div className="text-xs text-muted-foreground">/{org.slug}</div>
          </div>
        ),
      },
      {
        id: "status",
        header: t("platform.organizations.col.status", { defaultValue: "Status" }),
        cell: (org) => {
          const StatusIcon = statusIcon[org.status];

          return (
            <Badge
              variant={statusVariant(org.status)}
              className="gap-1 capitalize"
            >
              <StatusIcon className="h-3 w-3" />
              {org.status}
            </Badge>
          );
        },
      },
      {
        id: "plan",
        header: t("platform.organizations.col.plan", { defaultValue: "Plan" }),
        visibility: "sm",
        cell: (org) => <span className="capitalize">{org.plan}</span>,
      },
      {
        id: "userCount",
        header: t("platform.organizations.col.users", { defaultValue: "Users" }),
        align: "right",
        visibility: "md",
        cell: (org) => org.userCount,
      },
      {
        id: "propertyCount",
        header: t("platform.organizations.col.properties", { defaultValue: "Properties" }),
        align: "right",
        visibility: "md",
        cell: (org) => org.propertyCount,
      },
      {
        id: "createdAt",
        header: t("platform.organizations.col.created", { defaultValue: "Created" }),
        sortKey: "createdAt",
        align: "right",
        visibility: "lg",
        cell: (org) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(org.createdAt, { format: "medium" })}
          </span>
        ),
      },
      {
        id: "actions",
        header: t("platform.organizations.col.actions", { defaultValue: "Actions" }),
        align: "right",
        cell: (org) => (
          <div className="flex justify-end gap-2">
            <Button asChild size="sm" variant="ghost" className="gap-1.5">
              <Link href={`/admin/organizations/${org.id}`}>
                {t("platform.common.view", { defaultValue: "View" })}
                <ArrowRight className="h-3.5 w-3.5 rtl:-scale-x-100" />
              </Link>
            </Button>
            {org.status === "suspended" ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === org.id}
                onClick={() => setStatus(org, "active")}
                className="min-w-28 gap-2"
              >
                {busyId === org.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t("platform.organizations.action.reactivate", { defaultValue: "Reactivate" })}
                  </>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === org.id}
                onClick={() => setStatus(org, "suspended")}
                className="min-w-28 gap-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                {busyId === org.id ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Ban className="h-3.5 w-3.5" />
                    {t("platform.organizations.action.suspend", { defaultValue: "Suspend" })}
                  </>
                )}
              </Button>
            )}
          </div>
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busyId, formatDate],
  );

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">{t("platform.billing.card.title", { defaultValue: "Organizations" })}</h1>
          <p className="text-muted-foreground">
            Search tenant accounts, inspect usage, and control organization
            access.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Exports the filtered set, not the page on screen. */}
          <ReportExportButton
            endpoint="/api/admin/organizations"
            params={new URLSearchParams(query)}
            disabled={loading}
          />
        <Button
          variant="outline"
          size="sm"
          onClick={refresh}
          disabled={refreshing || loading}
          className="gap-2 w-min"
        >
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {t("platform.common.refresh", { defaultValue: "Refresh" })}
        </Button>
        </div>
      </div>

      {actionError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{actionError}</AlertDescription>
        </Alert>
      )}

      {/* Summary stats */}
      <AnalyticsCardGrid className="lg:grid-cols-3 xl:grid-cols-6">
        <AnalyticsCard
          title={t("platform.organizations.title", { defaultValue: "Organizations" })}
          value={initialLoad ? "—" : totals.orgs}
          description={t("platform.organizations.stats.allTenants", { defaultValue: "All tenants on the platform" })}
          icon={Building2}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("platform.common.active", { defaultValue: "Active" })}
          value={initialLoad ? "—" : totals.active}
          description={t("platform.organizations.stats.activeHint", { defaultValue: "Currently active organizations" })}
          icon={CircleCheck}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("platform.organizations.stats.trial", { defaultValue: "Trial" })}
          value={initialLoad ? "—" : totals.trial}
          description={t("platform.organizations.stats.trialHint", { defaultValue: "Organizations on trial" })}
          icon={Clock}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("platform.organizations.stats.suspended", { defaultValue: "Suspended" })}
          value={initialLoad ? "—" : totals.suspended}
          description={t("platform.organizations.stats.suspendedHint", { defaultValue: "Blocked from signing in" })}
          icon={Ban}
          iconColor="error"
        />
        <AnalyticsCard
          title={t("platform.organizations.stats.totalUsers", { defaultValue: "Total Users" })}
          value={initialLoad ? "—" : totals.users}
          description={t("platform.organizations.stats.acrossAll", { defaultValue: "Across all organizations" })}
          icon={Users}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("platform.organizations.stats.totalProperties", { defaultValue: "Total Properties" })}
          value={initialLoad ? "—" : totals.properties}
          description={t("platform.organizations.stats.acrossAll", { defaultValue: "Across all organizations" })}
          icon={Home}
          iconColor="success"
        />
      </AnalyticsCardGrid>

      {/* Organizations table */}
      <DataTableCard<Org>
        icon={Building2}
        title={t("platform.billing.card.title", { defaultValue: "Organizations" })}
        description={t("platform.organizations.subtitle", { defaultValue: "Review platform tenants and manage organization access." })}
        headerActions={
          <Badge variant="secondary" className="w-fit tabular-nums">
            {loading ? "Loading…" : `${total} of ${totals.orgs} organizations`}
          </Badge>
        }
        search={{
          value: filters.search,
          onSearch: (value) => setFilter({ search: value }),
          placeholder: t("platform.organizations.searchPlaceholder", { defaultValue: "Search name, slug, or plan…" }),
          ariaLabel: t("platform.organizations.searchLabel", { defaultValue: "Search organizations" }),
          isLoading: refreshing,
        }}
        filters={[
          {
            id: "status",
            value: filters.status,
            onChange: (value) => setFilter({ status: value }),
            ariaLabel: t("platform.organizations.filter.status", { defaultValue: "Filter by status" }),
            placeholder: t("platform.organizations.filter.allStatuses", { defaultValue: "All statuses" }),
            options: [
              { value: "all", label: t("platform.users.filter.allStatuses", { defaultValue: "All statuses" }) },
              { value: "active", label: t("platform.organizations.stats.active", { defaultValue: "Active" }) },
              { value: "trial", label: t("platform.organizations.stats.trial", { defaultValue: "Trial" }) },
              { value: "suspended", label: t("platform.organizations.stats.suspended", { defaultValue: "Suspended" }) },
            ],
          },
          {
            id: "plan",
            value: filters.plan,
            onChange: (value) => setFilter({ plan: value }),
            ariaLabel: t("platform.organizations.filter.plan", { defaultValue: "Filter by plan" }),
            placeholder: t("platform.organizations.filter.allPlans", { defaultValue: "All plans" }),
            options: [
              { value: "all", label: t("platform.organizations.filter.allPlans", { defaultValue: "All plans" }) },
              ...planFacets.map((facet) => ({
                value: facet.value,
                label: (
                  <span className="capitalize">
                    {facet.value} ({facet.count})
                  </span>
                ),
              })),
            ],
          },
          {
            id: "sort",
            value: filters.sort,
            onChange: (value) => setFilter({ sort: value }),
            ariaLabel: t("platform.organizations.filter.sort", { defaultValue: "Sort organizations" }),
            width: "w-[160px]",
            options: [
              { value: "createdAt-desc", label: t("platform.common.newestFirst", { defaultValue: "Newest first" }) },
              { value: "createdAt-asc", label: t("platform.common.oldestFirst", { defaultValue: "Oldest first" }) },
              { value: "name-asc", label: t("platform.organizations.sort.nameAsc", { defaultValue: "Name A–Z" }) },
              { value: "name-desc", label: t("platform.organizations.sort.nameDesc", { defaultValue: "Name Z–A" }) },
              { value: "users-desc", label: t("platform.organizations.sort.mostUsers", { defaultValue: "Most users" }) },
              { value: "properties-desc", label: t("platform.organizations.sort.mostProperties", { defaultValue: "Most properties" }) },
            ],
          },
        ]}
        filtersActive={filtersActive}
        onResetFilters={resetFilters}
        columns={columns}
        data={orgs}
        loading={loading}
        loadingConfig={{ rows: 6 }}
        getRowKey={(org) => org.id}
        // The headers and the sort menu are one order ("name-asc"…), which
        // the API applies across every page. The user and property counts
        // only sort most-first there, so their headers stay plain and the
        // menu keeps those two. The list always has an order, so a click on
        // the sorted column turns it round.
        sort={{
          ...parseSortValue(filters.sort),
          onSortChange: (key, direction) => {
            const next = keepSorted(parseSortValue(filters.sort), { key, direction });
            setFilter({ sort: `${next.key}-${next.direction}` });
          },
        }}
        error={
          loadError
            ? {
                message: loadError,
                icon: <AlertCircle className="h-8 w-8 text-red-500" />,
                onRetry: retry,
              }
            : null
        }
        emptyState={{
          icon: <Building2 className="h-8 w-8 text-muted-foreground" />,
          title: filtersActive
            ? t("platform.organizations.empty.filtered", { defaultValue: "No organizations match these filters" })
            : t("platform.organizations.empty.none", { defaultValue: "No organizations yet" }),
          description: filtersActive
            ? t("platform.organizations.empty.filteredHint", { defaultValue: "Try adjusting your search or clearing the filters." })
            : t("platform.organizations.empty.noneHint", { defaultValue: "Organizations will appear here once they sign up." }),
          action: filtersActive ? (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              {t("platform.common.clearFilters", { defaultValue: "Clear filters" })}
            </Button>
          ) : undefined,
        }}
        pagination={{
          currentPage: filters.page,
          pageSize: filters.pageSize,
          totalItems: total,
          onPageChange: setPage,
          onPageSizeChange: (pageSize) => setFilter({ pageSize }),
          disabled: loading || refreshing,
        }}
      />
    </ResponsiveLayout>
  );
}
