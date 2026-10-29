"use client";

/**
 * PropertyPro - Leasing reports
 *
 * The contract registers behind one selector: active, expiring soon,
 * approaching expiry, renewed, expired, cancelled — each narrowed by owner,
 * compound, building, unit, tenant, contract and date. Export re-runs the same
 * endpoint with the filters that were applied.
 *
 * The filters are applied explicitly and live in the address (see
 * useReportFilters): a reload keeps them, and so does a shared link.
 */

import Link from "next/link";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Ban,
  Building2,
  CalendarClock,
  RefreshCw,
  CalendarX,
  FileText,
  Loader2,
  TrendingUp,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import {
  ReportFilterBar,
  type ReportFilterField,
} from "@/components/reports/report-filter-bar";
import {
  filterParams,
  replaceQuery,
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { useReportFilterOptions } from "@/components/reports/use-report-filter-options";
import type { LeaseReport, LeaseReportRow, LeaseReportType } from "@/types/lease-report";

const REPORTS: Array<{
  type: LeaseReportType;
  labelKey: string;
  fallback: string;
  icon: typeof FileText;
  /** What the date filter is applied to, for this register. */
  dateKey: string;
  dateFallback: string;
}> = [
  {
    type: "active",
    labelKey: "leases.reports.type.active",
    fallback: "Active contracts",
    icon: FileText,
    dateKey: "leases.reports.dateOn.started",
    dateFallback: "Started",
  },
  {
    // Two registers, as the review lists them: the next thirty days, and the
    // sixty after that. See lease-reports.service for the windows.
    type: "expiring-soon",
    labelKey: "leases.reports.type.expiringSoon",
    fallback: "Contracts expiring soon",
    icon: CalendarClock,
    dateKey: "leases.reports.dateOn.ends",
    dateFallback: "Ends",
  },
  {
    type: "expiring",
    labelKey: "leases.reports.type.expiring",
    fallback: "Contracts approaching expiry",
    icon: CalendarClock,
    dateKey: "leases.reports.dateOn.ends",
    dateFallback: "Ends",
  },
  {
    type: "renewed",
    labelKey: "leases.reports.type.renewed",
    fallback: "Renewed contracts",
    icon: RefreshCw,
    dateKey: "leases.reports.dateOn.renewed",
    dateFallback: "Renewed",
  },
  {
    type: "expired",
    labelKey: "leases.reports.type.expired",
    fallback: "Expired contracts",
    icon: CalendarX,
    dateKey: "leases.reports.dateOn.ended",
    dateFallback: "Ended",
  },
  {
    type: "terminated",
    labelKey: "leases.reports.type.terminated",
    fallback: "Cancelled contracts",
    icon: Ban,
    dateKey: "leases.reports.dateOn.cancelled",
    dateFallback: "Cancelled",
  },
];

/**
 * Every filter this page has and the value it opens on: none of them. An empty
 * period is the register's own — the two expiry registers have windows of
 * their own, the rest cover all time. Reset returns to exactly these.
 */
const FILTERS = {
  defaults: (): FilterValues => ({
    startDate: "",
    endDate: "",
    ownerId: "",
    compoundId: "",
    propertyId: "",
    unitId: "",
    tenantId: "",
    leaseId: "",
  }),
};

const FILTER_KEYS = [
  "startDate",
  "endDate",
  "ownerId",
  "compoundId",
  "propertyId",
  "unitId",
  "tenantId",
  "leaseId",
] as const;

const OPTION_LISTS = [
  "owners",
  "compounds",
  "buildings",
  "units",
  "tenants",
  "contracts",
] as const;

/**
 * Each report in the menu is this page with a different `?type=`. The type is
 * read from the address on every render, so moving from one report to another
 * — from the menu, or from the selector below — changes what is shown at once.
 * A menu link carries no filters, so they start afresh for each one; the
 * selector keeps the filters and changes only the register.
 */
export default function LeaseReportsPage() {
  // useSearchParams needs a boundary of its own under the dashboard layout.
  return (
    <Suspense fallback={null}>
      <LeaseReports />
    </Suspense>
  );
}

function LeaseReports() {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const search = useSearchParams();

  const typeParam = search.get("type");
  const reportType: LeaseReportType = REPORTS.some(
    (entry) => entry.type === typeParam,
  )
    ? (typeParam as LeaseReportType)
    : "active";
  const activeReport = REPORTS.find((entry) => entry.type === reportType)!;

  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(FILTERS);
  const {
    options,
    loading: optionsLoading,
    failed: optionsFailed,
  } = useReportFilterOptions(OPTION_LISTS);

  /**
   * What the register was last RUN with: the applied filters and the type.
   * The report, the export and the address follow this; the controls only edit
   * a draft until Apply.
   */
  const params = useMemo(
    () => filterParams(applied, FILTER_KEYS, { type: reportType }),
    [applied, reportType],
  );
  const query = params.toString();

  const [result, setResult] = useState<{
    key: string;
    report: LeaseReport | null;
    error: string | null;
  } | null>(null);
  const loading = result?.key !== query;
  const report = result?.report ?? null;
  const error = result?.key === query ? result.error : null;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let next: { report: LeaseReport | null; error: string | null };
      try {
        const response = await fetch(`/api/leases/reports?${query}`);
        const payload = await response.json();
        next = payload?.success
          ? { report: payload.data as LeaseReport, error: null }
          : {
              report: null,
              error:
                payload?.error ??
                t("leases.reports.loadError", {
                  defaultValue: "Could not generate the report",
                }),
            };
      } catch (loadError) {
        console.error("Failed to load lease report:", loadError);
        next = {
          report: null,
          error: t("leases.reports.loadError", {
            defaultValue: "Could not generate the report",
          }),
        };
      }
      if (!cancelled) setResult({ key: query, ...next });
    })();
    return () => {
      cancelled = true;
    };
    // `t` changes with the language; the register does not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  /**
   * The date the filter applies to depends on the register — when it ends, was
   * renewed, was cancelled or began — so the label says which.
   */
  const periodField: ReportFilterField = {
    kind: "period",
    startKey: "startDate",
    endKey: "endDate",
    startLabel: t("leases.reports.dateFrom", {
      defaultValue: "{what} from",
      values: {
        what: t(activeReport.dateKey, { defaultValue: activeReport.dateFallback }),
      },
    }),
    endLabel: t("payments.reports.to", { defaultValue: "To" }),
  };
  const fields: ReportFilterField[] = [
    { kind: "entity", entity: "owner" },
    { kind: "entity", entity: "compound" },
    { kind: "entity", entity: "building" },
    { kind: "entity", entity: "unit" },
    { kind: "entity", entity: "tenant" },
    { kind: "entity", entity: "contract" },
    periodField,
  ];

  const summary = report?.summary;
  const rows = report?.rows ?? [];

  const columns: DataTableColumn<LeaseReportRow>[] = useMemo(() => {
    const base: DataTableColumn<LeaseReportRow>[] = [
      {
        id: "contract",
        header: t("leases.reports.columns.contract", {
          defaultValue: "Contract",
        }),
        cell: (row) => (
          <Link
            href={`/dashboard/leases/${row.leaseId}`}
            className="group inline-flex flex-col text-foreground"
          >
            <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
              {row.contractNumber ?? row.tenantName ?? "—"}
            </span>
            <span className="text-xs text-muted-foreground">
              {[row.propertyName, row.unitNumber].filter(Boolean).join(" · ")}
            </span>
          </Link>
        ),
        width: "min-w-[200px]",
      },
      {
        id: "tenant",
        header: t("leases.reports.columns.tenant", { defaultValue: "Tenant" }),
        cell: (row) => <span className="text-sm">{row.tenantName || "—"}</span>,
        visibility: "md",
        width: "min-w-[150px]",
      },
      {
        id: "term",
        header: t("leases.reports.columns.term", { defaultValue: "Term" }),
        cell: (row) => (
          <span className="text-sm">
            {formatDate(row.startDate)}
            <span className="text-muted-foreground"> – </span>
            {formatDate(row.endDate)}
          </span>
        ),
        width: "min-w-[190px]",
      },
      {
        id: "rent",
        header: t("leases.reports.columns.rent", { defaultValue: "Rent" }),
        cell: (row) => (
          <div className="text-end text-sm">
            <span className="font-medium">
              {formatCurrency(row.rentAmount)}
            </span>
            <span className="block text-xs text-muted-foreground">
              {t(`leases.contract.frequency.${row.frequency}`, {
                defaultValue: row.frequencyLabel,
              })}
            </span>
          </div>
        ),
        align: "right",
        width: "min-w-[140px]",
      },
    ];

    if (reportType === "renewed") {
      // The contract that took over, and when the renewal was made. A count
      // of days from the old end date went negative for every contract
      // renewed before its term was out, so the register shows dates.
      base.push(
        {
          id: "renewal",
          header: t("leases.reports.columns.newContract", {
            defaultValue: "New contract",
          }),
          cell: (row) =>
            row.renewal ? (
              <Link
                href={`/dashboard/leases/${row.renewal.leaseId}`}
                className="group inline-flex flex-col text-foreground"
              >
                <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
                  {row.renewal.contractNumber ??
                    t("leases.reports.viewContract", {
                      defaultValue: "View contract",
                    })}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatDate(row.renewal.startDate)}
                  {" – "}
                  {formatDate(row.renewal.endDate)}
                </span>
              </Link>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            ),
          width: "min-w-[190px]",
        },
        {
          id: "renewedOn",
          header: t("leases.reports.columns.renewedOn", {
            defaultValue: "Renewed on",
          }),
          cell: (row) => (
            <span className="text-sm">
              {row.renewal ? formatDate(row.renewal.renewedOn) : "—"}
            </span>
          ),
          visibility: "md",
          width: "min-w-[120px]",
        },
      );
      return base;
    }

    if (reportType === "terminated") {
      base.push({
        id: "terminated",
        header: t("leases.reports.columns.terminated", {
          defaultValue: "Terminated",
        }),
        cell: (row) => (
          <div className="text-sm">
            <span className="block">
              {row.terminatedDate ? formatDate(row.terminatedDate) : "—"}
            </span>
            {row.terminationReason && (
              <span
                className="block max-w-48 truncate text-xs text-muted-foreground"
                title={row.terminationReason}
              >
                {row.terminationReason}
              </span>
            )}
          </div>
        ),
        width: "min-w-[180px]",
      });
      return base;
    }

    // Running registers count down to the end; the others count from it.
    const running =
      reportType === "active" ||
      reportType === "expiring" ||
      reportType === "expiring-soon";
    base.push({
      id: "days",
      header: running
        ? t("leases.reports.columns.remaining", {
            defaultValue: "Days left",
          })
        : t("leases.reports.columns.since", {
            defaultValue: "Days since end",
          }),
      cell: (row) => {
        const days = running ? row.daysRemaining : -row.daysRemaining;
        const urgent = running && days <= 60;
        return (
          <div className="flex flex-col items-center gap-1">
            <Badge
              variant="outline"
              className={`text-xs font-normal ${
                urgent ? "border-warning/20 bg-warning/10 text-warning" : ""
              }`}
            >
              {days}
            </Badge>
            {/* The nightly sweep flips lapsed contracts to EXPIRED; until it
                runs the row would otherwise look like a live contract. */}
            {row.awaitingStatusSweep && (
              <span className="text-[10px] text-muted-foreground">
                {t("leases.reports.awaitingSweep", {
                  defaultValue: "pending update",
                })}
              </span>
            )}
          </div>
        );
      },
      align: "center",
      width: "min-w-[120px]",
    });

    return base;
  }, [reportType, t, formatCurrency, formatDate]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.leases.reports", { defaultValue: "Contract reports" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("leases.reports.subtitle", {
              defaultValue:
                "Active, expiring, renewed, expired and cancelled contracts, by owner, building and date",
            })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/leases/reports"
          params={params}
          disabled={loading || rows.length === 0}
        />
      </div>

      <Card className="gap-2">
        <CardHeader>
          <ReportFilterBar
            values={draft}
            onChange={setField}
            onApply={apply}
            onReset={reset}
            pending={pending}
            canReset={canReset}
            fields={fields}
            options={options}
            optionsLoading={optionsLoading}
            optionsFailed={optionsFailed}
            leading={
              <div className="w-full min-w-[220px] flex-1 space-y-1.5 sm:w-auto">
                <Label htmlFor="lease-report-type">
                  {t("payments.reports.reportLabel", { defaultValue: "Report" })}
                </Label>
                <Select
                  value={reportType}
                  onValueChange={(value) =>
                    replaceQuery({ type: value === "active" ? null : value })
                  }
                >
                  <SelectTrigger
                    id="lease-report-type"
                    className="h-10 bg-white dark:bg-gray-800"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORTS.map((entry) => (
                      <SelectItem key={entry.type} value={entry.type}>
                        {t(entry.labelKey, { defaultValue: entry.fallback })}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            }
          />
        </CardHeader>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("leases.reports.stats.contracts", {
            defaultValue: "Contracts",
          })}
          value={String(summary?.contractCount ?? 0)}
          icon={FileText}
          iconColor="primary"
          description={t("leases.reports.stats.withNumber", {
            defaultValue: "{count} with a contract number",
            values: { count: summary?.withContractNumber ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("leases.reports.stats.tenants", { defaultValue: "Tenants" })}
          value={String(summary?.tenantCount ?? 0)}
          icon={Users}
          iconColor="info"
          description={t("leases.reports.stats.properties", {
            defaultValue: "across {count} properties",
            values: { count: summary?.propertyCount ?? 0 },
          })}
        />
        <AnalyticsCard
          title={t("leases.reports.stats.annual", {
            defaultValue: "Annualised value",
          })}
          value={formatCurrency(summary?.totalAnnualValue ?? 0)}
          icon={TrendingUp}
          iconColor="success"
          description={t("leases.reports.stats.perInstallment", {
            defaultValue: "{amount} per installment",
            values: {
              amount: formatCurrency(summary?.totalRentPerInstallment ?? 0),
            },
          })}
        />
        {reportType === "active" ? (
          <AnalyticsCard
            title={t("leases.reports.stats.endingSoon", {
              defaultValue: "Ending within 60 days",
            })}
            value={String(summary?.endingSoon ?? 0)}
            icon={CalendarClock}
            iconColor="warning"
          />
        ) : (
          <AnalyticsCard
            title={t("leases.reports.stats.buildings", {
              defaultValue: "Buildings",
            })}
            value={String(summary?.propertyCount ?? 0)}
            icon={Building2}
            iconColor="warning"
          />
        )}
      </AnalyticsCardGrid>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <activeReport.icon className="h-4 w-4" />
            {t(activeReport.labelKey, { defaultValue: activeReport.fallback })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={rows}
              loading={false}
              getRowKey={(row) => row.leaseId}
              emptyState={{
                icon: <FileText className="h-10 w-10 text-muted-foreground" />,
                title: t("leases.reports.empty.title", {
                  defaultValue: "No contracts here",
                }),
                description: t("leases.reports.empty.description", {
                  defaultValue: "Nothing matches this register right now",
                }),
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
