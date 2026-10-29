"use client";

/**
 * PropertyPro - Collection
 *
 * Collected versus outstanding, grouped by contract or by tenant, worst
 * arrears first. This is the chase list: it exists to be worked down.
 *
 * Each contract or tenant opens up to the payments behind its "collected",
 * each with its own date — the client asked for every payment to appear
 * separately, with the payment date clearly shown.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  FileText,
  HandCoins,
  Loader2,
  Percent,
  User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isolateLtr,
  RemoteOptionSelect,
  searchFilterOptions,
  type RemoteOption,
} from "@/components/payments/RemoteOptionSelect";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { ReportExportButton } from "@/components/reports/export-button";
import type {
  CollectionPaymentLine,
  CollectionRecord,
  CollectionReport,
  CollectionScope,
} from "@/types/collection";

const ANY = "__any__";

interface Option {
  id: string;
  label: string;
}

/** A date from the address ("2026-10-31"), or "" when it is not one. */
function isoParam(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : "";
}

/**
 * The payments behind one contract's (or tenant's) "collected", a line each,
 * with the installment each one paid.
 */
function PaymentLines({ payments }: { payments: CollectionPaymentLine[] }) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const cell = "py-1 pe-4 align-top";

  if (payments.length === 0) {
    return (
      <p className="ms-2 border-s-2 border-primary/20 ps-3 text-xs text-muted-foreground">
        {t("collection.payments.none", {
          defaultValue: "No payment has been recorded yet.",
        })}
      </p>
    );
  }

  return (
    <div className="ms-2 overflow-x-auto border-s-2 border-primary/20 ps-3">
      <table className="text-xs">
        <thead>
          <tr className="text-muted-foreground">
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.table.number", { defaultValue: "Payment No." })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.paymentDate", {
                defaultValue: "Payment date",
              })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.installment", {
                defaultValue: "Installment",
              })}
            </th>
            <th className={cn(cell, "text-end font-normal")}>
              {t("payments.reports.columns.amount", { defaultValue: "Amount" })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.method", { defaultValue: "Method" })}
            </th>
            <th className={cn(cell, "text-start font-normal")}>
              {t("payments.reports.columns.reference", {
                defaultValue: "Reference",
              })}
            </th>
          </tr>
        </thead>
        <tbody>
          {payments.map((payment) => (
            <tr
              key={`${payment.paymentId}:${payment.invoiceId}`}
              className="border-t border-gray-100 dark:border-gray-700"
            >
              <td className={cn(cell, "whitespace-nowrap font-mono")}>
                <bdi dir="ltr">{payment.paymentNumber ?? "—"}</bdi>
              </td>
              <td className={cn(cell, "font-medium")}>
                {formatDate(payment.paidDate)}
              </td>
              <td className={cell}>
                <span className="font-mono">{payment.invoiceNumber}</span>
                <span className="block text-muted-foreground">
                  {t("payments.reports.dueOn", {
                    defaultValue: "Due {date}",
                    values: { date: formatDate(payment.installmentDueDate) },
                  })}
                </span>
              </td>
              <td className={cn(cell, "text-end")}>
                {formatCurrency(payment.amount)}
              </td>
              <td className={cell}>
                {!payment.method || payment.method === "unspecified"
                  ? "—"
                  : paymentMethodLabel(payment.method, t)}
              </td>
              <td className={cell}>
                {payment.reference ? (
                  <span className="font-mono" dir="ltr">
                    {payment.reference}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CollectionPage() {
  const { t, formatCurrency, formatDate, isRTL } = useLocalizationContext();
  const search = useSearchParams();

  const [scope, setScope] = useState<CollectionScope>("by-contract");
  const [propertyId, setPropertyId] = useState(ANY);
  const [ownerId, setOwnerId] = useState(ANY);
  const [compoundId, setCompoundId] = useState(ANY);
  const [tenantId, setTenantId] = useState(ANY);
  // The window is on the installments' due dates. A link can carry one: the
  // dashboard's collection rate opens this page on the month it measured.
  const [startDate, setStartDate] = useState(() =>
    isoParam(search.get("startDate")),
  );
  const [endDate, setEndDate] = useState(() => isoParam(search.get("endDate")));
  const [arrearsOnly, setArrearsOnly] = useState(false);

  const [properties, setProperties] = useState<Option[]>([]);
  const [owners, setOwners] = useState<Option[]>([]);
  const [compounds, setCompounds] = useState<Option[]>([]);
  const [report, setReport] = useState<CollectionReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** Rows opened up to show their payments. */
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  /**
   * The filters the list was last RUN with. Only Apply writes here, so
   * choosing an owner, a building and two dates fetches once, for the
   * combination asked for — as on the reports pages.
   */
  const [applied, setApplied] = useState(() => ({
    propertyId: ANY,
    ownerId: ANY,
    compoundId: ANY,
    tenantId: ANY,
    startDate,
    endDate,
  }));
  const pending =
    applied.propertyId !== propertyId ||
    applied.ownerId !== ownerId ||
    applied.compoundId !== compoundId ||
    applied.tenantId !== tenantId ||
    applied.startDate !== startDate ||
    applied.endDate !== endDate;
  const narrowed =
    applied.propertyId !== ANY ||
    applied.ownerId !== ANY ||
    applied.compoundId !== ANY ||
    applied.tenantId !== ANY ||
    applied.startDate !== "" ||
    applied.endDate !== "";

  const query = useMemo(() => {
    const params = new URLSearchParams({ scope });
    if (applied.propertyId !== ANY) params.set("propertyId", applied.propertyId);
    if (applied.ownerId !== ANY) params.set("ownerId", applied.ownerId);
    if (applied.compoundId !== ANY) params.set("compoundId", applied.compoundId);
    if (applied.tenantId !== ANY) params.set("tenantId", applied.tenantId);
    if (applied.startDate) params.set("startDate", applied.startDate);
    if (applied.endDate) params.set("endDate", applied.endDate);
    if (arrearsOnly) params.set("arrearsOnly", "true");
    return params;
  }, [scope, applied, arrearsOnly]);

  // Every dropdown from one scoped request: only what the reader can see.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/payments/filter-options")
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (cancelled || !payload?.success) return;
        const options = (list: unknown): Option[] =>
          Array.isArray(list)
            ? list.map((row: { id: string; label: string }) => ({
                id: row.id,
                label: row.label,
              }))
            : [];
        setProperties(options(payload.data?.properties));
        setOwners(options(payload.data?.owners));
        setCompounds(options(payload.data?.compounds));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/payments/collection?${query}`);
      const payload = await response.json();
      if (payload?.success) {
        setReport(payload.data as CollectionReport);
        setError(null);
      } else {
        setReport(null);
        setError(payload?.error ?? t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }));
      }
    } catch (loadError) {
      console.error("Failed to load collection:", loadError);
      setError(t("errors.ui.loadFailed", { defaultValue: "Could not load this. Try again." }));
    } finally {
      setLoading(false);
    }
  }, [query, t]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = report?.summary;
  const records = useMemo(() => report?.records ?? [], [report]);

  const toggle = useCallback((id: string) => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const allOpen =
    records.length > 0 && records.every((record) => expanded.has(record.id));

  const loadTenants = useCallback(
    async (search: string, chosen: string[]): Promise<RemoteOption[]> =>
      (
        await searchFilterOptions<{ id: string; label: string; hint?: string }>(
          "tenants",
          search,
          chosen,
        )
      ).map((tenant) => ({
        value: tenant.id,
        label: tenant.label,
        subtitle: isolateLtr(tenant.hint),
      })),
    [],
  );

  const columns: DataTableColumn<CollectionRecord>[] = useMemo(
    () => [
      {
        id: "subject",
        header:
          scope === "by-contract"
            ? t("collection.columns.contract", { defaultValue: "Contract" })
            : t("collection.columns.tenant", { defaultValue: "Tenant" }),
        cell: (row) => {
          const open = expanded.has(row.id);
          const body = (
            <>
              <span className="block text-sm font-medium">{row.label}</span>
              {row.sublabel && (
                <span className="block text-xs text-muted-foreground">
                  {row.sublabel}
                </span>
              )}
            </>
          );
          return (
            <div className="flex items-start gap-2">
              {/* Opens the row up into the payments behind "collected". */}
              <button
                type="button"
                onClick={() => toggle(row.id)}
                aria-expanded={open}
                title={
                  open
                    ? t("collection.payments.hide", {
                        defaultValue: "Hide payments",
                      })
                    : t("collection.payments.show", {
                        defaultValue: "Show payments",
                      })
                }
                className="mt-0.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ChevronDown
                  aria-hidden
                  className={cn(
                    "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                    !open && "ltr:-rotate-90 rtl:rotate-90",
                  )}
                />
              </button>
              {/* Contract rows link through so the clerk can act on the chase. */}
              {row.leaseId ? (
                <Link
                  href={`/dashboard/leases/${row.leaseId}`}
                  className="group inline-flex flex-col text-foreground transition-colors hover:text-blue-600 dark:hover:text-blue-400"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex flex-col">{body}</div>
              )}
            </div>
          );
        },
        width: "min-w-[230px]",
      },
      {
        // The client asked for the mobile number, the building and the unit
        // on the collection list, each in its own column — for a contract
        // its own, for a tenant every building and unit they rent in.
        id: "mobile",
        header: t("payments.reports.columns.mobile", { defaultValue: "Mobile" }),
        cell: (row) =>
          row.tenantPhone ? (
            <span className="whitespace-nowrap text-sm" dir="ltr">
              <bdi>{row.tenantPhone}</bdi>
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        width: "min-w-[120px]",
      },
      {
        id: "building",
        header: t("payments.reports.columns.building", { defaultValue: "Building" }),
        cell: (row) => (
          <span className="text-sm">
            {row.buildings?.join(isRTL ? "، " : ", ") || "—"}
          </span>
        ),
        visibility: "md",
        width: "min-w-[130px]",
      },
      {
        id: "unit",
        header: t("payments.reports.columns.unit", { defaultValue: "Unit" }),
        cell: (row) =>
          row.units?.length ? (
            <bdi className="text-sm">{row.units.join(", ")}</bdi>
          ) : (
            <span className="text-xs text-muted-foreground">—</span>
          ),
        visibility: "md",
        width: "min-w-[80px]",
      },
      {
        id: "billed",
        header: t("collection.columns.billed", { defaultValue: "Billed" }),
        cell: (row) => (
          <div className="text-end text-sm">
            <span>{formatCurrency(row.billed)}</span>
            <span className="block text-xs text-muted-foreground">
              {t("collection.columns.invoiceCount", {
                defaultValue: "{count} invoices",
                values: { count: row.invoiceCount },
              })}
            </span>
          </div>
        ),
        align: "right",
        visibility: "md",
        width: "min-w-[130px]",
      },
      {
        id: "collected",
        header: t("collection.columns.collected", {
          defaultValue: "Collected",
        }),
        cell: (row) => {
          const last = row.payments[row.payments.length - 1];
          return (
            <div className="text-end text-sm">
              <span className="font-medium text-success">
                {formatCurrency(row.collected)}
              </span>
              {last && (
                <span className="block text-xs text-muted-foreground">
                  {t("payments.reports.lastPaidOn", {
                    defaultValue: "Last paid {date}",
                    values: { date: formatDate(last.paidDate) },
                  })}
                </span>
              )}
              {/* The collection rate, under what it measures. */}
              <div className="mt-1 flex items-center gap-2">
                <Progress
                  value={Math.min(row.collectionRate, 100)}
                  className="h-1.5 flex-1"
                  aria-label={t("collection.columns.rate", { defaultValue: "Collected %" })}
                />
                <span className="text-xs font-medium">{row.collectionRate}%</span>
              </div>
            </div>
          );
        },
        align: "right",
        width: "min-w-[150px]",
      },
      {
        id: "outstanding",
        header: t("collection.columns.outstanding", {
          defaultValue: "Outstanding",
        }),
        // What is still owed, the part of it that is late, and since when —
        // the oldest unpaid due date is what a chase list is sorted by.
        cell: (row) => (
          <div className="text-end text-sm">
            <span className={row.outstanding > 0 ? "font-semibold" : ""}>
              {formatCurrency(row.outstanding)}
            </span>
            {row.overdue > 0 && (
              <span className="block text-xs text-error">
                {t("collection.columns.overdueOf", {
                  defaultValue: "{amount} overdue",
                  values: { amount: formatCurrency(row.overdue) },
                })}
              </span>
            )}
            {row.oldestDueDate ? (
              <span className="block text-xs text-muted-foreground">
                {t("collection.columns.oldestSince", {
                  defaultValue: "Oldest unpaid {date}",
                  values: { date: formatDate(row.oldestDueDate) },
                })}
              </span>
            ) : (
              <Badge
                variant="outline"
                className="mt-1 border-success/20 bg-success/10 text-xs font-normal text-success"
              >
                {t("collection.settled", { defaultValue: "Settled" })}
              </Badge>
            )}
          </div>
        ),
        align: "right",
        width: "min-w-[150px]",
      },
    ],
    [scope, t, formatCurrency, formatDate, isRTL, expanded, toggle],
  );

  const renderRowDetail = useCallback(
    (row: CollectionRecord) =>
      expanded.has(row.id) ? <PaymentLines payments={row.payments ?? []} /> : null,
    [expanded],
  );

  const resetFilters = () => {
    setPropertyId(ANY);
    setOwnerId(ANY);
    setCompoundId(ANY);
    setTenantId(ANY);
    setStartDate("");
    setEndDate("");
    setApplied({
      propertyId: ANY,
      ownerId: ANY,
      compoundId: ANY,
      tenantId: ANY,
      startDate: "",
      endDate: "",
    });
  };

  const optionSelect = (
    label: string,
    allLabel: string,
    value: string,
    onChange: (value: string) => void,
    options: Option[],
  ) => (
    <div className="min-w-[180px] space-y-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY}>{allLabel}</SelectItem>
          {options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("nav.collections.followUp", { defaultValue: "Collection follow-up" })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("collection.subtitle", {
              defaultValue:
                "What has been collected against what was billed, by contract and by tenant",
            })}
          </p>
        </div>
        <ReportExportButton
          endpoint="/api/payments/collection"
          params={query}
          disabled={loading || records.length === 0}
        />
      </div>

      <Card className="gap-2">
        <CardHeader>
          <div className="flex flex-col gap-4 rounded-lg border border-gray-200/60 bg-gray-50/50 p-4 dark:border-gray-700/60 dark:bg-gray-800/50">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[160px] space-y-1.5">
                <Label>
                  {t("collection.groupBy", { defaultValue: "Group by" })}
                </Label>
                <Select
                  value={scope}
                  onValueChange={(value) => setScope(value as CollectionScope)}
                >
                  <SelectTrigger className="h-10 bg-white dark:bg-gray-800">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="by-contract">
                      {t("collection.scope.contract", {
                        defaultValue: "Contract",
                      })}
                    </SelectItem>
                    <SelectItem value="by-tenant">
                      {t("collection.scope.tenant", { defaultValue: "Tenant" })}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {optionSelect(
                t("payments.reports.owner", { defaultValue: "Owner" }),
                t("payments.reports.allOwners", { defaultValue: "All owners" }),
                ownerId,
                setOwnerId,
                owners,
              )}
              {optionSelect(
                t("collection.filters.compound", { defaultValue: "Compound" }),
                t("collection.filters.allCompounds", {
                  defaultValue: "All compounds",
                }),
                compoundId,
                setCompoundId,
                compounds,
              )}
              {optionSelect(
                t("payments.reports.building", { defaultValue: "Building" }),
                t("payments.reports.allBuildings", {
                  defaultValue: "All buildings",
                }),
                propertyId,
                setPropertyId,
                properties,
              )}

              <div className="min-w-[200px] space-y-1.5">
                <Label>
                  {t("payments.reports.tenant", { defaultValue: "Tenant" })}
                </Label>
                {/* Searched on the server, so every tenant can be found —
                    not only those of the 300 most recent contracts. */}
                <RemoteOptionSelect
                  value={tenantId}
                  onValueChange={(value) => setTenantId(value || ANY)}
                  load={loadTenants}
                  leading={[
                    {
                      value: ANY,
                      label: t("payments.reports.allTenants", {
                        defaultValue: "All tenants",
                      }),
                    },
                  ]}
                  placeholder={t("payments.reports.allTenants", {
                    defaultValue: "All tenants",
                  })}
                  searchPlaceholder={t("payments.reports.searchTenantMobile", {
                    defaultValue: "Name or mobile",
                  })}
                  emptyMessage={t("payments.reports.noTenant", {
                    defaultValue: "No tenant matches",
                  })}
                  loadingMessage={t("common.loading", { defaultValue: "Loading…" })}
                  triggerClassName="h-10 bg-white dark:bg-gray-800"
                />
              </div>

              {/* On the installments' due dates: what fell due in the window,
                  and how much of it has come in. */}
              <div className="space-y-1.5">
                <Label htmlFor="collection-from">
                  {t("collection.filters.dueFrom", { defaultValue: "Due from" })}
                </Label>
                <Input
                  id="collection-from"
                  type="date"
                  className="h-10 bg-white dark:bg-gray-800"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="collection-to">
                  {t("payments.reports.to", { defaultValue: "To" })}
                </Label>
                <Input
                  id="collection-to"
                  type="date"
                  className="h-10 bg-white dark:bg-gray-800"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </div>

              <label className="flex h-10 cursor-pointer items-center gap-2 text-sm">
                <Checkbox
                  checked={arrearsOnly}
                  onCheckedChange={(checked) => setArrearsOnly(checked === true)}
                />
                {t("collection.arrearsOnly", {
                  defaultValue: "Only those in arrears",
                })}
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button
                size="sm"
                className="h-10"
                disabled={!pending}
                onClick={() =>
                  setApplied({
                    propertyId,
                    ownerId,
                    compoundId,
                    tenantId,
                    startDate,
                    endDate,
                  })
                }
              >
                {t("reports.applyFilters", { defaultValue: "Apply filters" })}
              </Button>
              {(narrowed || pending) && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-10"
                  onClick={resetFilters}
                >
                  {t("reports.resetFilters", { defaultValue: "Reset filters" })}
                </Button>
              )}
            </div>
          </div>
          {pending && (
            <p className="px-4 pb-2 text-xs text-muted-foreground">
              {t("reports.pendingHint", {
                defaultValue:
                  "Filters changed — the figures below are from the last run.",
              })}
            </p>
          )}
        </CardHeader>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("collection.stats.collected", { defaultValue: "Collected" })}
          value={formatCurrency(summary?.totalCollected ?? 0)}
          icon={HandCoins}
          iconColor="success"
          description={t("collection.stats.ofBilled", {
            defaultValue: "of {amount} billed",
            values: { amount: formatCurrency(summary?.totalBilled ?? 0) },
          })}
        />
        <AnalyticsCard
          title={t("collection.stats.rate", {
            defaultValue: "Collection rate",
          })}
          value={`${summary?.collectionRate ?? 0}%`}
          icon={Percent}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("collection.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(summary?.totalOutstanding ?? 0)}
          icon={AlertTriangle}
          iconColor="warning"
          description={t("collection.stats.overdueOf", {
            defaultValue: "{amount} overdue",
            values: { amount: formatCurrency(summary?.totalOverdue ?? 0) },
          })}
        />
        <AnalyticsCard
          title={
            scope === "by-contract"
              ? t("collection.stats.contracts", { defaultValue: "Contracts" })
              : t("collection.stats.tenants", { defaultValue: "Tenants" })
          }
          value={String(summary?.recordCount ?? 0)}
          icon={scope === "by-contract" ? FileText : User}
          iconColor="primary"
          description={t("collection.stats.split", {
            defaultValue: "{settled} settled · {arrears} in arrears",
            values: {
              settled: summary?.fullyCollected ?? 0,
              arrears: summary?.withArrears ?? 0,
            },
          })}
        />
      </AnalyticsCardGrid>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4" />
              {scope === "by-contract"
                ? t("collection.title.contract", {
                    defaultValue: "Collection by contract",
                  })
                : t("collection.title.tenant", {
                    defaultValue: "Collection by tenant",
                  })}
            </CardTitle>
            <Button
              variant="outline"
              size="sm"
              disabled={records.length === 0}
              onClick={() =>
                setExpanded(
                  allOpen ? new Set() : new Set(records.map((row) => row.id)),
                )
              }
            >
              {allOpen
                ? t("collection.payments.hideAll", {
                    defaultValue: "Hide all payments",
                  })
                : t("collection.payments.showAll", {
                    defaultValue: "Show all payments",
                  })}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <DataTable
              columns={columns}
              data={records}
              loading={false}
              getRowKey={(row) => row.id}
              renderRowDetail={renderRowDetail}
              emptyState={{
                icon: (
                  <HandCoins className="h-10 w-10 text-muted-foreground" />
                ),
                title: t("collection.empty.title", {
                  defaultValue: "Nothing to collect",
                }),
                description: arrearsOnly
                  ? t("collection.empty.noArrears", {
                      defaultValue: "Every contract is fully settled",
                    })
                  : t("collection.empty.description", {
                      defaultValue: "Nothing has been billed yet",
                    }),
              }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
