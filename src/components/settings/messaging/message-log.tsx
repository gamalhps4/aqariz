"use client";

/**
 * PropertyPro - The office's SMS and WhatsApp message log
 *
 * Every message sent, delivered or not, and every one that was stopped —
 * opted out, no number, over the monthly limit, no WhatsApp template — with
 * the reason, so an office can see why a tenant was not reached. Reads
 * GET /api/settings/messaging/logs.
 */

import { useCallback, useEffect, useState } from "react";
import { History, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTableCard } from "@/components/ui/data-table-card";
import type { DataTableColumn } from "@/components/ui/data-table";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { formatDisplayDateTime } from "@/lib/utils/formatting";
import {
  MESSAGE_STATUSES,
  MESSAGING_CHANNELS,
  MESSAGING_EVENTS,
} from "@/lib/messaging/registry";

interface LogRow {
  id: string;
  channel: string;
  provider: string;
  gatewaySource: string;
  event: string | null;
  purpose: string;
  status: string;
  blockReason: string | null;
  recipientName: string | null;
  toNumber: string | null;
  body: string;
  templateName: string | null;
  error: string | null;
  createdAt: string;
}

const STATUS_TONE: Record<string, string> = {
  sent: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
  delivered:
    "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  read: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
  failed: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  undelivered: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  blocked: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
};

const ALL = "all";

export function MessageLog() {
  const { t } = useLocalizationContext();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const [channel, setChannel] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [event, setEvent] = useState(ALL);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [available, setAvailable] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(pageSize),
      });
      if (search) params.set("search", search);
      if (channel !== ALL) params.set("channel", channel);
      if (status !== ALL) params.set("status", status);
      if (event !== ALL) params.set("event", event);
      const response = await fetch(`/api/settings/messaging/logs?${params}`, {
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok || !json.success) {
        throw new Error(json.error || "load failed");
      }
      setRows(json.data.rows ?? []);
      setAvailable(json.data.available !== false);
      setTotal(json.pagination?.total ?? 0);
      setError(null);
    } catch {
      setError(
        t("settings.messaging.log.loadFailed", {
          defaultValue: "Could not load the message log",
        }),
      );
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, channel, status, event, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const statusText = (row: LogRow) =>
    t(`settings.messaging.status.${row.status}`, { defaultValue: row.status });

  const eventText = (row: LogRow) =>
    row.event
      ? t(`settings.messaging.event.${row.event}`, { defaultValue: row.event })
      : t(`settings.messaging.purpose.${row.purpose}`, { defaultValue: row.purpose });

  const columns: DataTableColumn<LogRow>[] = [
    {
      id: "date",
      header: t("settings.messaging.log.col.date", { defaultValue: "Date" }),
      cell: (row) => (
        <span className="whitespace-nowrap text-sm">
          {formatDisplayDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      id: "recipient",
      header: t("settings.messaging.log.col.recipient", {
        defaultValue: "Recipient",
      }),
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{row.recipientName || "—"}</p>
          <p className="text-xs text-muted-foreground" dir="ltr">
            {row.toNumber || "—"}
          </p>
        </div>
      ),
    },
    {
      id: "channel",
      header: t("settings.messaging.log.col.channel", { defaultValue: "Channel" }),
      visibility: "md",
      cell: (row) =>
        t(`settings.messaging.channel.${row.channel}`, { defaultValue: row.channel }),
    },
    {
      id: "event",
      header: t("settings.messaging.log.col.event", { defaultValue: "Event" }),
      visibility: "lg",
      cell: (row) => <span className="text-sm">{eventText(row)}</span>,
    },
    {
      id: "status",
      header: t("settings.messaging.log.col.status", { defaultValue: "Status" }),
      cell: (row) => (
        <div className="space-y-1">
          <Badge variant="outline" className={`border-0 ${STATUS_TONE[row.status] ?? ""}`}>
            {statusText(row)}
          </Badge>
          {row.blockReason ? (
            <p className="text-xs text-muted-foreground">
              {t(`settings.messaging.reason.${row.blockReason}`, {
                defaultValue: row.blockReason,
              })}
            </p>
          ) : row.error ? (
            <p className="line-clamp-2 max-w-48 text-xs text-muted-foreground" dir="ltr">
              {row.error}
            </p>
          ) : null}
        </div>
      ),
    },
    {
      id: "gateway",
      header: t("settings.messaging.log.col.gateway", { defaultValue: "Gateway" }),
      visibility: "lg",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.gatewaySource === "office"
            ? t("settings.messaging.source.office", { defaultValue: "Own account" })
            : row.gatewaySource === "none"
              ? "—"
              : t("settings.messaging.source.platform", { defaultValue: "Platform" })}
        </span>
      ),
    },
    {
      id: "message",
      header: t("settings.messaging.log.col.message", { defaultValue: "Message" }),
      visibility: "xl",
      cell: (row) => (
        <p className="line-clamp-2 max-w-xs text-xs text-muted-foreground">
          {row.templateName ? `[${row.templateName}] ` : ""}
          {row.body}
        </p>
      ),
    },
  ];

  const filtersActive =
    Boolean(search) || channel !== ALL || status !== ALL || event !== ALL;

  return (
    <DataTableCard<LogRow>
      icon={History}
      title={t("settings.messaging.log.title", { defaultValue: "Message log" })}
      description={
        available
          ? t("settings.messaging.log.description", {
              defaultValue:
                "Every SMS and WhatsApp message, and why any did not go out.",
            })
          : t("settings.messaging.log.notReady", {
              defaultValue:
                "The message log becomes available once the database update is applied.",
            })
      }
      headerActions={
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`me-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {t("settings.messaging.log.refresh", { defaultValue: "Refresh" })}
        </Button>
      }
      search={{
        value: search,
        onSearch: (value) => {
          setSearch(value);
          setPage(1);
        },
        placeholder: t("settings.messaging.log.search", {
          defaultValue: "Search name, number or text",
        }),
        isLoading: loading,
      }}
      filters={[
        {
          id: "channel",
          value: channel,
          onChange: (value) => {
            setChannel(value);
            setPage(1);
          },
          options: [
            {
              value: ALL,
              label: t("settings.messaging.log.allChannels", {
                defaultValue: "All channels",
              }),
            },
            ...MESSAGING_CHANNELS.map((value) => ({
              value,
              label: t(`settings.messaging.channel.${value}`, { defaultValue: value }),
            })),
          ],
        },
        {
          id: "status",
          value: status,
          onChange: (value) => {
            setStatus(value);
            setPage(1);
          },
          options: [
            {
              value: ALL,
              label: t("settings.messaging.log.allStatuses", {
                defaultValue: "All statuses",
              }),
            },
            ...MESSAGE_STATUSES.map((value) => ({
              value,
              label: t(`settings.messaging.status.${value}`, { defaultValue: value }),
            })),
          ],
        },
        {
          id: "event",
          value: event,
          width: "w-[200px]",
          onChange: (value) => {
            setEvent(value);
            setPage(1);
          },
          options: [
            {
              value: ALL,
              label: t("settings.messaging.log.allEvents", {
                defaultValue: "All events",
              }),
            },
            ...MESSAGING_EVENTS.map((value) => ({
              value,
              label: t(`settings.messaging.event.${value}`, { defaultValue: value }),
            })),
          ],
        },
      ]}
      filtersActive={filtersActive}
      onResetFilters={() => {
        setSearch("");
        setChannel(ALL);
        setStatus(ALL);
        setEvent(ALL);
        setPage(1);
      }}
      resetLabel={t("settings.messaging.log.clear", { defaultValue: "Clear" })}
      columns={columns}
      data={rows}
      loading={loading}
      error={error ? { message: error, onRetry: () => void load() } : null}
      emptyState={{
        title: t("settings.messaging.log.empty", { defaultValue: "No messages yet" }),
      }}
      getRowKey={(row) => row.id}
      pagination={{
        currentPage: page,
        pageSize,
        totalItems: total,
        onPageChange: setPage,
        onPageSizeChange: (size) => {
          setPageSize(size);
          setPage(1);
        },
      }}
    />
  );
}
