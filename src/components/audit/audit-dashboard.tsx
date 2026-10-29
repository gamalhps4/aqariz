"use client";

/**
 * PropertyPro - Activity log (the organization's own)
 *
 * Who did what, when, and to which record — with the value before and after
 * for sensitive changes. It was a hand-built list of the newest fifty entries,
 * English sentences, no way to ask "what did this employee do" or "every
 * payment deleted this month", and "System" for anyone it could not join to a
 * user row. It is now the same table every other list uses, paged on the
 * server, filtered by employee, action, module, record type and date, with
 * each sentence put together in the reader's language and contracts named by
 * their number.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, Loader2, Shield, TrendingUp, Users } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { keepSorted } from "@/lib/server-sort";
import { GlobalSearch } from "@/components/ui/global-search";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ReportExportButton } from "@/components/reports/export-button";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  ActivityDateRange,
  ActivityDetailSheet,
  ActivityEmployee,
  ActivityRecord,
  ActivityTime,
  useActivityText,
  type ActivityRow,
} from "@/components/audit/activity-parts";
import {
  AUDIT_FILTER_ACTIONS,
  AUDIT_MODULES,
  AUDIT_RECORD_TYPES,
} from "@/lib/audit/vocabulary";
import { defaultAuditStartDay, isoDayInZone } from "@/lib/audit/time";

type View = "activity" | "security" | "summary";

interface Person {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

interface Filters {
  userId: string;
  category: string;
  action: string;
  resourceType: string;
  search: string;
  startDate: string;
  endDate: string;
  /** The time header's order, which the API (and the export) applies. */
  sort: "asc" | "desc";
  page: number;
  pageSize: number;
}

interface AuditStats {
  summary: { totalLogs: number; securityEvents: number };
  breakdown: { categories: Array<{ _id: string; count: number }> };
  trends: { daily: Array<{ _id: string; count: number }> };
  topUsers: Array<{ _id: string; count: number; name: string; email: string }>;
}

function defaultFilters(): Filters {
  return {
    userId: "all",
    category: "all",
    action: "all",
    resourceType: "all",
    search: "",
    // The last 30 days, today included, in Riyadh time.
    startDate: defaultAuditStartDay(),
    endDate: isoDayInZone(new Date()),
    sort: "desc",
    page: 1,
    pageSize: 20,
  };
}

function toQuery(view: View, filters: Filters, forExport = false): URLSearchParams {
  const params = new URLSearchParams();
  const { page, pageSize, ...rest } = filters;
  for (const [key, value] of Object.entries(rest)) {
    if (value && value !== "all") params.set(key, String(value));
  }
  if (view === "security") params.set("view", "security");
  if (!forExport) {
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
  }
  return params;
}

export default function AuditDashboard() {
  const { t } = useLocalizationContext();
  const text = useActivityText();
  const [view, setView] = useState<View>("activity");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  // The summary, with the date range it was loaded for.
  const [stats, setStats] = useState<{ key: string; data: AuditStats | null } | null>(null);

  const listView: View = view === "summary" ? "activity" : view;
  const query = useMemo(
    () => toQuery(listView, filters).toString(),
    [listView, filters],
  );

  useEffect(() => {
    let active = true;
    fetch("/api/audit?facet=employees")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active) setPeople(payload?.data?.employees ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (view === "summary") return;
    let active = true;
    fetch(`/api/audit?${query}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.success) throw new Error(payload.error);
        setRows(payload.data.logs ?? []);
        setTotal(payload.data.pagination?.total ?? 0);
      })
      .catch(() => {
        if (active) {
          toast.error(
            t("admin.audit.toasts.loadFailed", { defaultValue: "Could not load the activity log" }),
          );
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, t, view]);

  // The summary costs several grouped counts, so it loads only when opened.
  const statsKey = `${filters.startDate}|${filters.endDate}`;
  const statsLoading = view === "summary" && stats?.key !== statsKey;
  useEffect(() => {
    if (view !== "summary") return;
    let active = true;
    const params = new URLSearchParams();
    if (filters.startDate) params.set("startDate", filters.startDate);
    if (filters.endDate) params.set("endDate", `${filters.endDate}T23:59:59`);
    fetch(`/api/audit/stats?${params}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active) setStats({ key: statsKey, data: payload?.data ?? null });
      })
      .catch(() => {
        if (active) setStats({ key: statsKey, data: null });
      });
    return () => {
      active = false;
    };
  }, [view, filters.startDate, filters.endDate, statsKey]);
  const summary = stats?.data ?? null;

  const setFilter = useCallback((patch: Partial<Filters>) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const defaults = defaultFilters();
  const filtersActive =
    filters.search.trim() !== "" ||
    filters.userId !== "all" ||
    filters.category !== "all" ||
    filters.action !== "all" ||
    filters.resourceType !== "all" ||
    filters.startDate !== defaults.startDate ||
    filters.endDate !== defaults.endDate;

  const peopleOptions = useMemo(
    () => [
      {
        value: "all",
        label: t("admin.audit.filters.allEmployees", { defaultValue: "All employees" }),
      },
      ...people.map((person) => ({
        value: person.id,
        label: person.name || person.email || person.id,
        subtitle: [
          person.email,
          text.role({
            id: person.id,
            name: person.name,
            email: person.email,
            role: person.role,
            roleLabel: null,
            roleLabelAr: null,
          }),
        ]
          .filter(Boolean)
          .join(" · "),
      })),
    ],
    [people, t, text],
  );

  const columns: DataTableColumn<ActivityRow>[] = useMemo(
    () => [
      {
        id: "time",
        header: t("admin.audit.col.time", { defaultValue: "Date & time (Riyadh)" }),
        sortKey: "time",
        cell: (row) => <ActivityTime value={row.timestamp} />,
      },
      {
        id: "employee",
        header: t("admin.audit.col.employee", { defaultValue: "Employee" }),
        cell: (row) => <ActivityEmployee row={row} />,
      },
      {
        id: "action",
        header: t("admin.audit.col.action", { defaultValue: "Action" }),
        cell: (row) => (
          <div className="min-w-0">
            <p className="text-sm">{text.message(row)}</p>
            <p className="text-xs text-muted-foreground">{text.module(row.category)}</p>
          </div>
        ),
      },
      {
        id: "record",
        header: t("admin.audit.col.record", { defaultValue: "Record" }),
        visibility: "md",
        cell: (row) => <ActivityRecord row={row} />,
      },
      {
        id: "ip",
        header: t("admin.audit.col.ip", { defaultValue: "IP address" }),
        visibility: "xl",
        cell: (row) => (
          <span dir="ltr" className="text-xs text-muted-foreground">
            {row.ipAddress || "—"}
          </span>
        ),
      },
    ],
    [t, text],
  );

  const table = (
    <DataTableCard<ActivityRow>
      icon={view === "security" ? Shield : Activity}
      title={
        view === "security"
          ? t("admin.audit.stats.security", { defaultValue: "Security events" })
          : t("admin.audit.list.title", { defaultValue: "Activity" })
      }
      description={
        view === "security"
          ? t("admin.audit.security.description", {
              defaultValue:
                "Failed sign-ins, refused access, support viewing the account, and anything recorded as important",
            })
          : t("admin.audit.list.description", {
              defaultValue: "Newest first. Open an entry to see what it changed.",
            })
      }
      headerActions={
        <Badge variant="secondary" className="w-fit tabular-nums">
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            t("admin.audit.count", { defaultValue: "{count} entries", values: { count: total } })
          )}
        </Badge>
      }
      filters={[
        {
          id: "category",
          value: filters.category,
          onChange: (value) => setFilter({ category: value }),
          ariaLabel: t("admin.audit.filters.category", { defaultValue: "Area" }),
          width: "w-[170px]",
          options: [
            { value: "all", label: t("admin.audit.filters.allCategories", { defaultValue: "All areas" }) },
            ...AUDIT_MODULES.map((module) => ({ value: module, label: text.module(module) })),
          ],
        },
        {
          id: "action",
          value: filters.action,
          onChange: (value) => setFilter({ action: value }),
          ariaLabel: t("admin.audit.filters.action", { defaultValue: "Action" }),
          width: "w-[170px]",
          options: [
            { value: "all", label: t("admin.audit.filters.allActions", { defaultValue: "All actions" }) },
            ...AUDIT_FILTER_ACTIONS.map((action) => ({ value: action, label: text.action(action) })),
          ],
        },
        {
          id: "resourceType",
          value: filters.resourceType,
          onChange: (value) => setFilter({ resourceType: value }),
          ariaLabel: t("admin.audit.filters.recordType", { defaultValue: "Record type" }),
          width: "w-[160px]",
          options: [
            { value: "all", label: t("admin.audit.filters.allRecordTypes", { defaultValue: "All records" }) },
            ...AUDIT_RECORD_TYPES.map((type) => ({ value: type, label: text.type(type) })),
          ],
        },
      ]}
      filterExtras={
        <>
          {/* In the filter row: beside four filters and a date range the
              card's own search box is squeezed to nothing. */}
          <GlobalSearch
            initialValue={filters.search}
            onSearch={(value) => setFilter({ search: value })}
            placeholder={t("admin.audit.filters.searchPlaceholder", {
              defaultValue: "Name, email, record or contract number…",
            })}
            ariaLabel={t("admin.audit.filters.search", { defaultValue: "Search" })}
            debounceDelay={300}
            className="w-full sm:w-[260px]"
          />
          <SearchableSelect
            value={filters.userId}
            onValueChange={(value) => setFilter({ userId: value || "all" })}
            options={peopleOptions}
            placeholder={t("admin.audit.filters.employee", { defaultValue: "Employee" })}
            triggerClassName="h-10 w-[200px]"
          />
          <ActivityDateRange
            startDate={filters.startDate}
            endDate={filters.endDate}
            onChange={(range) => setFilter(range)}
          />
        </>
      }
      filtersActive={filtersActive}
      onResetFilters={() => {
        setLoading(true);
        setFilters(defaultFilters());
      }}
      resetLabel={t("reports.resetFilters", { defaultValue: "Reset filters" })}
      columns={columns}
      data={rows}
      loading={loading}
      loadingConfig={{ rows: 8 }}
      getRowKey={(row) => row.id}
      // The API orders by time only, newest first unless asked: the time
      // header turns that round across every page, the others stay plain.
      sort={{
        key: "time",
        direction: filters.sort,
        onSortChange: (key, direction) =>
          setFilter({
            sort: keepSorted({ key: "time", direction: filters.sort }, { key, direction }).direction,
          }),
      }}
      onRowClick={(row) => setSelected(row)}
      getRowClassName={() => "cursor-pointer"}
      emptyState={{
        icon: <Activity className="h-8 w-8 text-muted-foreground" />,
        title: t("admin.audit.empty", { defaultValue: "No activity matches these filters" }),
        description: t("admin.audit.emptyHint", {
          defaultValue: "Try widening the date range or clearing a filter.",
        }),
      }}
      pagination={{
        currentPage: filters.page,
        pageSize: filters.pageSize,
        totalItems: total,
        onPageChange: (page) => {
          setLoading(true);
          setFilters((current) => ({ ...current, page }));
        },
        onPageSizeChange: (pageSize) => setFilter({ pageSize }),
        pageSizeOptions: [10, 20, 50, 100],
      }}
    />
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            {t("admin.audit.title", { defaultValue: "Activity log" })}
          </h2>
          <p className="text-muted-foreground">
            {t("admin.audit.subtitle", {
              defaultValue:
                "Who did what, when, and to which record — with the value before and after for sensitive changes",
            })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/audit"
          params={toQuery(listView, filters, true)}
          disabled={loading}
        />
      </div>

      <Tabs
        value={view}
        onValueChange={(value) => {
          if (value !== "summary") setLoading(true);
          setFilters((current) => ({ ...current, page: 1 }));
          setView(value as View);
        }}
        className="space-y-4"
      >
        <TabsList>
          <TabsTrigger value="activity">
            {t("admin.audit.tabs.logs", { defaultValue: "Activity" })}
          </TabsTrigger>
          <TabsTrigger value="security">
            {t("admin.audit.stats.security", { defaultValue: "Security events" })}
          </TabsTrigger>
          <TabsTrigger value="summary">
            {t("admin.audit.tabs.analytics", { defaultValue: "Summary" })}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="activity">{view === "activity" && table}</TabsContent>
        <TabsContent value="security">{view === "security" && table}</TabsContent>

        <TabsContent value="summary" className="space-y-4">
          {statsLoading || !summary ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                {[
                  { icon: Activity, color: "text-blue-600", label: t("admin.audit.stats.total", { defaultValue: "Events" }), value: summary.summary?.totalLogs ?? 0 },
                  { icon: Shield, color: "text-red-600", label: t("admin.audit.stats.security", { defaultValue: "Security events" }), value: summary.summary?.securityEvents ?? 0 },
                  { icon: Users, color: "text-green-600", label: t("admin.audit.stats.activeUsers", { defaultValue: "Active users" }), value: summary.topUsers?.length ?? 0 },
                  {
                    icon: TrendingUp,
                    color: "text-purple-600",
                    label: t("admin.audit.stats.dailyAverage", { defaultValue: "Daily average" }),
                    value: Math.round((summary.summary?.totalLogs ?? 0) / Math.max(summary.trends?.daily?.length ?? 1, 1)),
                  },
                ].map((card) => (
                  <Card key={card.label}>
                    <CardContent className="flex items-center gap-2 p-6">
                      <card.icon className={`h-5 w-5 ${card.color}`} />
                      <div>
                        <p className="text-sm font-medium text-muted-foreground">{card.label}</p>
                        <p className="text-2xl font-bold">{card.value}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>{t("admin.audit.byCategory", { defaultValue: "Activity by area" })}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(summary.breakdown?.categories ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("admin.audit.noActivity", { defaultValue: "No activity recorded in this period." })}
                      </p>
                    ) : (
                      summary.breakdown.categories.map((category) => (
                        <div key={category._id} className="flex items-center justify-between">
                          <span>{text.module(category._id)}</span>
                          <Badge variant="secondary">{category.count}</Badge>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>{t("admin.audit.topUsers", { defaultValue: "Most active users" })}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {(summary.topUsers ?? []).length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        {t("admin.audit.noUserActivity", { defaultValue: "No user activity recorded in this period." })}
                      </p>
                    ) : (
                      summary.topUsers.slice(0, 5).map((person) => (
                        <div key={person._id} className="flex items-center justify-between">
                          <div>
                            <p className="font-medium">{person.name}</p>
                            <p className="text-sm text-muted-foreground"><span dir="ltr">{person.email}</span></p>
                          </div>
                          <Badge variant="secondary">{person.count}</Badge>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>
      </Tabs>

      <ActivityDetailSheet row={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
