"use client";

/**
 * Webhook event ledger.
 *
 * Answers the question that used to require database access: did the gateway
 * actually deliver that event, and when did we process it? The ledger is
 * purged on a 30-day cycle, which the page says out loud so an empty result
 * for an old event isn't mistaken for a missed delivery.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ReportExportButton } from "@/components/reports/export-button";
import { AlertCircle, Webhook } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { type DataTableColumn } from "@/components/ui/data-table";
import { DataTableCard } from "@/components/ui/data-table-card";
import { keepSorted, parseSortValue } from "@/lib/server-sort";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface WebhookEvent {
  id: string;
  gateway: string;
  eventId: string;
  eventType: string | null;
  processedAt: string;
}

interface Facet {
  value: string;
  count: number;
}

const GATEWAY_LABEL: Record<string, string> = {
  stripe: "Stripe (rent)",
  stripe_billing: "Stripe (subscriptions)",
  paypal: "PayPal",
  moyasar: "Moyasar",
  paytabs: "PayTabs",
  tap: "Tap Payments",
  // Retired gateways — kept so historical ledger rows still render a name.
  paystack: "Paystack (retired)",
  razorpay: "Razorpay (retired)",
};

const DEFAULT_FILTERS = {
  search: "",
  gateway: "all",
  eventType: "all",
  sort: "processedAt-desc",
  page: 1,
  pageSize: 20,
};

export default function WebhookEventsPage() {
  const { t, formatDate } = useLocalizationContext();
  const [events, setEvents] = useState<WebhookEvent[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<{
    gateways: Facet[];
    eventTypes: Facet[];
  }>({ gateways: [], eventTypes: [] });
  const [retentionDays, setRetentionDays] = useState(30);
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const query = useMemo(() => {
    const params = new URLSearchParams({
      page: String(filters.page),
      pageSize: String(filters.pageSize),
      sort: filters.sort,
    });
    if (filters.gateway !== "all") params.set("gateway", filters.gateway);
    if (filters.eventType !== "all") params.set("eventType", filters.eventType);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    return params.toString();
  }, [filters]);

  useEffect(() => {
    let active = true;
    fetch(`/api/admin/webhooks?${query}`)
      .then((response) =>
        response.json().then((payload) => ({ response, payload })),
      )
      .then(({ response, payload }) => {
        if (!active) return;
        if (!response.ok || !payload.success) {
          throw new Error(payload.error || "Unable to load webhook events");
        }
        setEvents(payload.data.events);
        setTotal(payload.data.pagination.total);
        setFacets(payload.data.facets);
        setRetentionDays(payload.data.retentionDays ?? 30);
        setError("");
      })
      .catch((loadError) => {
        if (!active) return;
        setError(
          loadError instanceof Error
            ? loadError.message
            : t("platform.webhooks.loadError", { defaultValue: "Unable to load webhook events" }),
        );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query]);

  /** Any filter change invalidates the page number. */
  const setFilter = useCallback((patch: Partial<typeof DEFAULT_FILTERS>) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page: 1, ...patch }));
  }, []);

  const setPage = useCallback((page: number) => {
    setLoading(true);
    setFilters((current) => ({ ...current, page }));
  }, []);

  const filtersActive =
    filters.search.trim().length > 0 ||
    filters.gateway !== "all" ||
    filters.eventType !== "all" ||
    filters.sort !== DEFAULT_FILTERS.sort;

  const columns: DataTableColumn<WebhookEvent>[] = useMemo(
    () => [
      {
        id: "event",
        header: t("platform.webhooks.col.event", { defaultValue: "Event" }),
        cell: (event) => (
          <div>
            <p className="font-medium">{event.eventType || "—"}</p>
            <p className="font-mono text-xs text-muted-foreground">
              {event.eventId}
            </p>
          </div>
        ),
      },
      {
        id: "gateway",
        header: t("platform.webhooks.col.gateway", { defaultValue: "Gateway" }),
        visibility: "md",
        cell: (event) => (
          <Badge variant="outline">
            {GATEWAY_LABEL[event.gateway] ?? event.gateway}
          </Badge>
        ),
      },
      {
        id: "processedAt",
        sortKey: "processedAt",
        header: t("platform.webhooks.col.processed", { defaultValue: "Processed" }),
        align: "right",
        cell: (event) => (
          <span className="text-sm text-muted-foreground">
            {formatDate(event.processedAt, { format: "medium" })}
          </span>
        ),
      },
    ],
    [formatDate, t],
  );

  return (
    <ResponsiveLayout className="space-y-6" padding="none">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {t("platform.webhooks.title", { defaultValue: "Webhook events" })}
          </h1>
          <p className="text-muted-foreground">
            {t("platform.webhooks.subtitle", {
              defaultValue:
                "Gateway deliveries we have accepted and processed. Rows older than {days} days are purged by the cleanup job, so an absent event from further back does not mean it was missed.",
              values: { days: retentionDays },
            })}
          </p>
        </div>
        {/* Exports the filtered set, not the page on screen. */}
        <ReportExportButton
          endpoint="/api/admin/webhooks"
          params={new URLSearchParams(query)}
          disabled={loading}
        />
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <DataTableCard<WebhookEvent>
        icon={Webhook}
        title={t("platform.webhooks.card.title", { defaultValue: "Delivered events" })}
        description={t("platform.webhooks.card.description", {
          defaultValue: "Everything processed in the last {days} days.",
          values: { days: retentionDays },
        })}
        headerActions={
          <Badge variant="secondary" className="w-fit tabular-nums">
            {loading
              ? t("platform.common.loading", { defaultValue: "Loading…" })
              : t("platform.webhooks.count", {
                  defaultValue: "{count} events",
                  values: { count: total },
                })}
          </Badge>
        }
        search={{
          value: filters.search,
          onSearch: (value) => setFilter({ search: value }),
          placeholder: t("platform.webhooks.searchPlaceholder", { defaultValue: "Search event ID — evt_1A2b3C…" }),
          ariaLabel: t("platform.webhooks.searchLabel", { defaultValue: "Search webhook events" }),
        }}
        filters={[
          {
            id: "gateway",
            value: filters.gateway,
            onChange: (value) => setFilter({ gateway: value }),
            ariaLabel: t("platform.webhooks.filter.gateway", { defaultValue: "Filter by gateway" }),
            width: "w-[190px]",
            options: [
              { value: "all", label: t("platform.webhooks.filter.allGateways", { defaultValue: "All gateways" }) },
              ...facets.gateways.map((facet) => ({
                value: facet.value,
                label: `${GATEWAY_LABEL[facet.value] ?? facet.value} (${facet.count})`,
              })),
            ],
          },
          {
            id: "eventType",
            value: filters.eventType,
            onChange: (value) => setFilter({ eventType: value }),
            ariaLabel: t("platform.webhooks.filter.eventType", { defaultValue: "Filter by event type" }),
            width: "w-[190px]",
            options: [
              { value: "all", label: t("platform.webhooks.filter.allTypes", { defaultValue: "All types" }) },
              ...facets.eventTypes.map((facet) => ({
                value: facet.value,
                label: `${facet.value} (${facet.count})`,
              })),
            ],
          },
          {
            id: "sort",
            value: filters.sort,
            onChange: (value) => setFilter({ sort: value }),
            ariaLabel: t("platform.webhooks.filter.sort", { defaultValue: "Sort events" }),
            options: [
              { value: "processedAt-desc", label: t("platform.common.newestFirst", { defaultValue: "Newest first" }) },
              { value: "processedAt-asc", label: t("platform.common.oldestFirst", { defaultValue: "Oldest first" }) },
            ],
          },
        ]}
        filtersActive={filtersActive}
        onResetFilters={() => {
          setLoading(true);
          setFilters(DEFAULT_FILTERS);
        }}
        columns={columns}
        data={events}
        loading={loading}
        loadingConfig={{ rows: 6 }}
        getRowKey={(event) => event.id}
        // The time header and the sort menu are one order, applied by the
        // API across every page; it orders by time only, so the event and
        // gateway headers stay plain. A click turns the order round.
        sort={{
          ...parseSortValue(filters.sort),
          onSortChange: (key, direction) => {
            const next = keepSorted(parseSortValue(filters.sort), { key, direction });
            setFilter({ sort: `${next.key}-${next.direction}` });
          },
        }}
        emptyState={{
          icon: <Webhook className="h-8 w-8 text-muted-foreground" />,
          title: t("platform.webhooks.empty.title", { defaultValue: "No webhook events" }),
          description: t("platform.webhooks.empty.description", {
            defaultValue:
              "Nothing matching these filters has been processed in the retention window.",
          }),
        }}
        pagination={{
          currentPage: filters.page,
          pageSize: filters.pageSize,
          totalItems: total,
          onPageChange: setPage,
          onPageSizeChange: (pageSize) => setFilter({ pageSize }),
        }}
      />
    </ResponsiveLayout>
  );
}
