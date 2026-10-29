"use client";

/**
 * PropertyPro SaaS - Activity log (super-admin console)
 *
 * The client asked for a complete activity log in the Super Admin panel:
 * every activity of every customer, searchable and filterable, naming the
 * employee who acted and the date and time of each action. Two tabs:
 *
 *   Customer activity — what each organization's staff, tenants and owners
 *                       did (their own activity logs, read across all of
 *                       them);
 *   Console actions   — what was done here: operator sign-ins, control
 *                       changes, exports, "view as".
 *
 * Times are Saudi time with seconds. The organization and employee filters
 * can be preset from a link (the organization page and the users list link
 * here), and the export carries organization and employee names in the
 * reader's language.
 */

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity, AlertCircle, Loader2 } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { keepSorted } from "@/lib/server-sort";
import { GlobalSearch } from "@/components/ui/global-search";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
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
  PLATFORM_AUDIT_ACTIONS,
  PLATFORM_TARGET_TYPES,
} from "@/lib/audit/vocabulary";
import { defaultAuditStartDay, isoDayInZone } from "@/lib/audit/time";

type Tab = "customer" | "console";

interface Person {
  id: string;
  name: string;
  email: string | null;
  role: string;
}

interface OrganizationOption {
  id: string;
  name: string;
  slug: string;
}

interface Filters {
  organizationId: string;
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

function defaultFilters(preset: Partial<Filters> = {}): Filters {
  return {
    organizationId: "all",
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
    ...preset,
  };
}

/** The filters as the API's query. */
function toQuery(tab: Tab, filters: Filters, forExport = false): URLSearchParams {
  const params = new URLSearchParams();
  params.set("tab", tab);
  const { page, pageSize, userId, resourceType, ...rest } = filters;
  for (const [key, value] of Object.entries(rest)) {
    if (value && value !== "all") params.set(key, String(value));
  }
  if (userId !== "all") params.set(tab === "console" ? "actorId" : "userId", userId);
  if (resourceType !== "all") {
    params.set(tab === "console" ? "targetType" : "resourceType", resourceType);
  }
  if (tab === "console") params.delete("category");
  if (!forExport) {
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
  }
  return params;
}

function ActivityConsole() {
  const searchParams = useSearchParams();
  const { t } = useLocalizationContext();
  const text = useActivityText();

  const [tab, setTab] = useState<Tab>(
    searchParams.get("tab") === "console" ? "console" : "customer",
  );
  const [filters, setFilters] = useState<Filters>(() =>
    defaultFilters({
      organizationId: searchParams.get("organizationId") || "all",
      userId: searchParams.get("userId") || searchParams.get("actorId") || "all",
    }),
  );
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<ActivityRow | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationOption[]>([]);
  const [people, setPeople] = useState<Person[]>([]);

  const query = useMemo(() => toQuery(tab, filters).toString(), [tab, filters]);

  // The organization list is cached on the server and changes rarely.
  useEffect(() => {
    let active = true;
    fetch("/api/admin/activity?facet=organizations")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active && Array.isArray(payload?.data?.organizations)) {
          setOrganizations(payload.data.organizations);
        }
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  // The people to filter by: one organization's (customer tab), or the
  // operators (console tab).
  useEffect(() => {
    let active = true;
    const facet =
      tab === "console"
        ? "facet=operators"
        : filters.organizationId !== "all"
          ? `facet=employees&organizationId=${encodeURIComponent(filters.organizationId)}`
          : null;
    if (!facet) return;
    fetch(`/api/admin/activity?${facet}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (active) setPeople(payload?.data?.employees ?? []);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [tab, filters.organizationId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/activity?${query}`)
      .then((response) => response.json().then((payload) => ({ response, payload })))
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.success) {
          throw new Error(
            payload.error ||
              t("platform.activity.loadError", { defaultValue: "Unable to load activity" }),
          );
        }
        setRows(payload.data.events);
        setTotal(payload.data.pagination.total);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("platform.activity.loadError", { defaultValue: "Unable to load activity" }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, t]);

  /** Any filter change goes back to the first page. */
  const setFilter = useCallback((patch: Partial<Filters>) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const switchTab = (value: string) => {
    const next: Tab = value === "console" ? "console" : "customer";
    if (next === tab) return;
    setLoading(true);
    setSelected(null);
    setTab(next);
    // Employees and operators are different people; record types and
    // actions are different vocabularies.
    setFilters((current) => ({
      ...current,
      page: 1,
      userId: "all",
      action: "all",
      resourceType: "all",
      category: "all",
    }));
  };

  const defaults = defaultFilters();
  const filtersActive =
    filters.search.trim() !== "" ||
    filters.organizationId !== "all" ||
    filters.userId !== "all" ||
    filters.category !== "all" ||
    filters.action !== "all" ||
    filters.resourceType !== "all" ||
    filters.startDate !== defaults.startDate ||
    filters.endDate !== defaults.endDate;

  const organizationOptions = useMemo(
    () => [
      {
        value: "all",
        label: t("platform.activity.filter.allOrganizations", {
          defaultValue: "All organizations",
        }),
      },
      ...organizations.map((organization) => ({
        value: organization.id,
        label: organization.name,
        subtitle: `/${organization.slug}`,
      })),
    ],
    [organizations, t],
  );

  const peopleOptions = useMemo(
    () => [
      {
        value: "all",
        label:
          tab === "console"
            ? t("platform.activity.filter.allOperators", { defaultValue: "All operators" })
            : t("platform.activity.filter.allEmployees", { defaultValue: "All employees" }),
      },
      // Only the chosen organization's people (or the operators); a list
      // left from another organization is not offered.
      ...(tab === "console" || filters.organizationId !== "all" ? people : []).map((person) => ({
        value: person.id,
        label: person.name || person.email || person.id,
        subtitle: [person.email, text.role({
          id: person.id,
          name: person.name,
          email: person.email,
          role: person.role,
          roleLabel: null,
          roleLabelAr: null,
        })]
          .filter(Boolean)
          .join(" · "),
      })),
    ],
    [people, t, tab, text, filters.organizationId],
  );

  const columns: DataTableColumn<ActivityRow>[] = useMemo(
    () => [
      {
        id: "time",
        header: t("platform.activity.col.time", { defaultValue: "Date & time (Riyadh)" }),
        sortKey: "time",
        cell: (row) => <ActivityTime value={row.timestamp} />,
      },
      {
        id: "organization",
        header: t("platform.activity.col.organization", { defaultValue: "Organization" }),
        visibility: "md",
        cell: (row) => (
          <span className="text-sm">
            {row.organizationName ??
              (row.organizationId ? row.organizationId : (
                <span className="text-muted-foreground">
                  {t("platform.activity.platformWide", { defaultValue: "Platform" })}
                </span>
              ))}
          </span>
        ),
      },
      {
        id: "employee",
        header:
          tab === "console"
            ? t("platform.activity.col.operator", { defaultValue: "Operator" })
            : t("platform.activity.col.employee", { defaultValue: "Employee" }),
        cell: (row) => <ActivityEmployee row={row} />,
      },
      {
        id: "action",
        header: t("platform.activity.col.action", { defaultValue: "Action" }),
        cell: (row) => (
          <div className="min-w-0">
            <p className="text-sm">{text.message(row)}</p>
            {row.source === "organization" && (
              <p className="text-xs text-muted-foreground">{text.module(row.category)}</p>
            )}
          </div>
        ),
      },
      {
        id: "record",
        header:
          tab === "console"
            ? t("platform.activity.col.target", { defaultValue: "Target" })
            : t("platform.activity.col.record", { defaultValue: "Record" }),
        visibility: "lg",
        cell: (row) =>
          row.source === "platform" ? (
            <div className="min-w-0">
              <Badge variant="outline" className="mb-0.5 font-normal">
                {t(`platform.activity.targetType.${row.resourceType}`, {
                  defaultValue: text.type(row.resourceType),
                })}
              </Badge>
              <p className="truncate text-sm">{row.resourceName}</p>
            </div>
          ) : (
            <ActivityRecord row={row} />
          ),
      },
      {
        id: "ip",
        header: t("platform.activity.col.ip", { defaultValue: "IP address" }),
        visibility: "xl",
        cell: (row) => (
          <span dir="ltr" className="text-xs text-muted-foreground">
            {row.ipAddress || "—"}
          </span>
        ),
      },
    ],
    [t, tab, text],
  );

  const tableFilters =
    tab === "customer"
      ? [
          {
            id: "category",
            value: filters.category,
            onChange: (value: string) => setFilter({ category: value }),
            ariaLabel: t("platform.activity.filter.module", { defaultValue: "Module" }),
            width: "w-[170px]",
            options: [
              { value: "all", label: t("platform.activity.filter.allModules", { defaultValue: "All modules" }) },
              ...AUDIT_MODULES.map((module) => ({ value: module, label: text.module(module) })),
            ],
          },
          {
            id: "action",
            value: filters.action,
            onChange: (value: string) => setFilter({ action: value }),
            ariaLabel: t("platform.activity.filter.action", { defaultValue: "Filter by action" }),
            width: "w-[170px]",
            options: [
              { value: "all", label: t("platform.activity.filter.allActions", { defaultValue: "All actions" }) },
              ...AUDIT_FILTER_ACTIONS.map((action) => ({ value: action, label: text.action(action) })),
            ],
          },
          {
            id: "resourceType",
            value: filters.resourceType,
            onChange: (value: string) => setFilter({ resourceType: value }),
            ariaLabel: t("platform.activity.filter.recordType", { defaultValue: "Record type" }),
            width: "w-[160px]",
            options: [
              { value: "all", label: t("platform.activity.filter.allTypes", { defaultValue: "All types" }) },
              ...AUDIT_RECORD_TYPES.map((type) => ({ value: type, label: text.type(type) })),
            ],
          },
        ]
      : [
          {
            id: "action",
            value: filters.action,
            onChange: (value: string) => setFilter({ action: value }),
            ariaLabel: t("platform.activity.filter.action", { defaultValue: "Filter by action" }),
            width: "w-[190px]",
            options: [
              { value: "all", label: t("platform.activity.filter.allActions", { defaultValue: "All actions" }) },
              ...PLATFORM_AUDIT_ACTIONS.map((action) => ({
                value: action,
                label: t(`platform.activity.action.${action}`, { defaultValue: action }),
              })),
            ],
          },
          {
            id: "resourceType",
            value: filters.resourceType,
            onChange: (value: string) => setFilter({ resourceType: value }),
            ariaLabel: t("platform.activity.filter.targetType", { defaultValue: "Filter by target type" }),
            width: "w-[160px]",
            options: [
              { value: "all", label: t("platform.activity.filter.allTypes", { defaultValue: "All types" }) },
              ...PLATFORM_TARGET_TYPES.map((type) => ({
                value: type,
                label: t(`platform.activity.targetType.${type}`, { defaultValue: type }),
              })),
            ],
          },
        ];

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("platform.activity.title", { defaultValue: "Activity log" })}
          </h1>
          <p className="text-muted-foreground">
            {t("platform.activity.subtitle", {
              defaultValue:
                "Everything customers did in their organizations, and every action taken in this console.",
            })}
          </p>
        </div>
        {/* The whole filtered set, not the page on screen — with organization
            and employee names, in the reader's language. */}
        <ReportExportButton
          endpoint="/api/admin/activity"
          params={toQuery(tab, filters, true)}
          disabled={loading}
        />
      </div>

      <Tabs value={tab} onValueChange={switchTab}>
        <TabsList>
          <TabsTrigger value="customer">
            {t("platform.activity.tab.customer", { defaultValue: "Customer activity" })}
          </TabsTrigger>
          <TabsTrigger value="console">
            {t("platform.activity.tab.console", { defaultValue: "Console actions" })}
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTableCard<ActivityRow>
        icon={Activity}
        title={
          tab === "customer"
            ? t("platform.activity.card.customerTitle", { defaultValue: "Customer activity" })
            : t("platform.activity.card.title", { defaultValue: "Control audit trail" })
        }
        description={
          tab === "customer"
            ? t("platform.activity.card.customerDescription", {
                defaultValue:
                  "Every action by every organization's staff, tenants and owners. Open an entry to see what it changed.",
              })
            : t("platform.activity.card.description", {
                defaultValue: "Every change made from this console, and every operator sign-in.",
              })
        }
        headerActions={
          <Badge variant="secondary" className="w-fit tabular-nums">
            {loading ? (
              <span className="inline-flex items-center gap-1">
                <Loader2 className="h-3 w-3 animate-spin" />
                {t("platform.common.loading", { defaultValue: "Loading…" })}
              </span>
            ) : (
              t("platform.activity.count", {
                defaultValue: "{count} entries",
                values: { count: total },
              })
            )}
          </Badge>
        }
        filters={tableFilters}
        filterExtras={
          <>
            {/* In the filter row rather than beside it: beside five filters
                and a date range, the card's own search box is squeezed to
                nothing. */}
            <GlobalSearch
              initialValue={filters.search}
              onSearch={(value) => setFilter({ search: value })}
              placeholder={t("platform.activity.searchPlaceholder", {
                defaultValue: "Search names, emails, records…",
              })}
              ariaLabel={t("platform.activity.searchLabel", { defaultValue: "Search activity" })}
              debounceDelay={300}
              className="w-full sm:w-[260px]"
            />
            <SearchableSelect
              value={filters.organizationId}
              onValueChange={(value) =>
                setFilter({ organizationId: value || "all", userId: tab === "customer" ? "all" : filters.userId })
              }
              options={organizationOptions}
              placeholder={t("platform.activity.filter.organization", { defaultValue: "Organization" })}
              triggerClassName="h-10 w-[200px]"
            />
            {(tab === "console" || filters.organizationId !== "all") && (
              <SearchableSelect
                value={filters.userId}
                onValueChange={(value) => setFilter({ userId: value || "all" })}
                options={peopleOptions}
                placeholder={
                  tab === "console"
                    ? t("platform.activity.filter.operator", { defaultValue: "Operator" })
                    : t("platform.activity.filter.employee", { defaultValue: "Employee" })
                }
                triggerClassName="h-10 w-[200px]"
              />
            )}
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
        resetLabel={t("platform.activity.reset", { defaultValue: "Clear filters" })}
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
          title: filtersActive
            ? t("platform.activity.empty.filtered", { defaultValue: "No entries match these filters" })
            : t("platform.activity.empty.none", { defaultValue: "No activity in the last 30 days" }),
          description: filtersActive
            ? t("platform.activity.empty.filteredHint", {
                defaultValue: "Try widening the date range or clearing a filter.",
              })
            : t("platform.activity.empty.noneHint", {
                defaultValue: "Actions will be recorded here as they happen.",
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

      <ActivityDetailSheet
        row={selected}
        onClose={() => setSelected(null)}
        showOrganization
      />
    </ResponsiveLayout>
  );
}

export default function PlatformActivityPage() {
  // useSearchParams reads the link's preset filters; it needs a boundary.
  return (
    <Suspense fallback={null}>
      <ActivityConsole />
    </Suspense>
  );
}
