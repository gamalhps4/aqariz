"use client";

/**
 * PropertyPro - Property page tabs
 *
 * The five views a property page owes: Contracts, Agreements, Payments,
 * Expenses and Reports.
 *
 * All five read the portfolio-wide endpoints filtered to this property rather
 * than growing property-specific ones, so a building's page and the reports
 * that aggregate it are literally the same query. Each tab loads only when it
 * is opened — a property page should not fire five requests to show one.
 */

import Link from "next/link";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarClock,
  ExternalLink,
  FileText,
  Handshake,
  Info,
  Loader2,
  Percent,
  Receipt,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
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
  useReportFilters,
  type FilterValues,
} from "@/components/reports/use-report-filters";
import { StatementSummary } from "@/components/statements/StatementSections";
import { yearToDate } from "@/lib/report-filters/period";
import type { Agreement } from "@/types/agreement";
import type { StatementAgreementRef } from "@/types/entity-statement";
import { paymentMethodLabel } from "@/lib/payments/methods";
import { paymentTypeLabel } from "@/lib/payments/type-labels";

/** Shared fetch-on-mount for a tab's list. */
function useTabData<T>(url: string, pick: (payload: any) => T) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (isStale: () => boolean = () => false) => {
      setLoading(true);
      try {
        const response = await fetch(url);
        const payload = await response.json();
        // A reply for an address that has since changed — a new period — is
        // not the one on screen: it must not land after the newer one.
        if (isStale()) return;
        if (payload?.success) {
          setData(pick(payload));
          setError(null);
        } else {
          setError(payload?.error ?? "Could not load");
        }
      } catch (loadError) {
        console.error("Tab load failed:", loadError);
        if (!isStale()) setError("Could not load");
      } finally {
        if (!isStale()) setLoading(false);
      }
    },
    // `pick` is defined inline by each caller; re-running on identity changes
    // would refetch on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url],
  );

  useEffect(() => {
    let stale = false;
    load(() => stale);
    return () => {
      stale = true;
    };
  }, [load]);

  return { data, loading, error, reload: () => load() };
}

function TabError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}

// ============================================================================
// Contracts
// ============================================================================

interface LeaseRow {
  _id: string;
  contractNumber?: string | null;
  status: string;
  startDate: string;
  endDate: string;
  terms?: { rentAmount?: number };
  rentAmount?: number;
  tenantId?: { firstName?: string; lastName?: string } | string;
  unit?: { unitNumber?: string };
}

export function PropertyContractsTab({ propertyId }: { propertyId: string }) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const { data, loading, error } = useTabData<LeaseRow[]>(
    `/api/leases?propertyId=${propertyId}&limit=100`,
    (payload) => payload.data?.leases ?? payload.data ?? [],
  );

  const columns: DataTableColumn<LeaseRow>[] = [
    {
      id: "contract",
      header: t("properties.tabs.contracts.contract", {
        defaultValue: "Contract",
      }),
      cell: (row) => (
        <Link
          href={`/dashboard/leases/${row._id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.contractNumber ??
              t("properties.tabs.contracts.unnumbered", {
                defaultValue: "(no number)",
              })}
          </span>
          <span className="text-xs text-muted-foreground">
            {typeof row.tenantId === "object" && row.tenantId
              ? `${row.tenantId.firstName ?? ""} ${row.tenantId.lastName ?? ""}`.trim()
              : ""}
            {row.unit?.unitNumber ? ` · ${row.unit.unitNumber}` : ""}
          </span>
        </Link>
      ),
      width: "min-w-[190px]",
    },
    {
      id: "term",
      header: t("properties.tabs.contracts.term", { defaultValue: "Term" }),
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
      header: t("properties.tabs.contracts.rent", { defaultValue: "Rent" }),
      cell: (row) => (
        <span className="text-sm font-medium">
          {formatCurrency(row.rentAmount ?? row.terms?.rentAmount ?? 0)}
        </span>
      ),
      align: "right",
      width: "min-w-[120px]",
    },
    {
      id: "status",
      header: t("properties.tabs.contracts.status", {
        defaultValue: "Status",
      }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal capitalize">
          {t(`leases.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
  ];

  return (
    <div className="space-y-4">
      {error && <TabError message={error} />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              {t("properties.details.tabs.contracts", {
                defaultValue: "Contracts",
              })}
            </span>
            <Badge variant="outline">{data?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data ?? []}
            loading={loading}
            getRowKey={(row) => row._id}
            emptyState={{
              icon: <FileText className="h-10 w-10 text-muted-foreground" />,
              title: t("properties.tabs.contracts.empty", {
                defaultValue: "No contracts on this property",
              }),
              description: t("properties.tabs.contracts.emptyHint", {
                defaultValue: "Create a lease to start billing a tenant",
              }),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Agreements
// ============================================================================

export function PropertyAgreementsTab({ propertyId }: { propertyId: string }) {
  const { t, formatDate } = useLocalizationContext();
  const { data, loading, error } = useTabData<Agreement[]>(
    `/api/agreements?propertyId=${propertyId}&status=all&limit=50`,
    (payload) => payload.data ?? [],
  );

  const columns: DataTableColumn<Agreement>[] = [
    {
      id: "agreement",
      header: t("agreements.table.agreement", { defaultValue: "Agreement" }),
      cell: (row) => (
        <Link
          href={`/dashboard/agreements/${row.id}`}
          className="group inline-flex flex-col text-foreground"
        >
          <span className="text-sm font-medium transition-colors group-hover:text-blue-600 dark:group-hover:text-blue-400">
            {row.agreementNumber ??
              t("agreements.table.unnumbered", { defaultValue: "(no number)" })}
          </span>
          <span className="text-xs text-muted-foreground">
            {formatDate(row.startDate)}
            {row.endDate ? ` – ${formatDate(row.endDate)}` : ""}
          </span>
        </Link>
      ),
      width: "min-w-[180px]",
    },
    {
      id: "scope",
      header: t("agreements.table.covers", { defaultValue: "Covers" }),
      cell: (row) => (
        <span className="text-sm">
          {row.scopeType === "property"
            ? (row.property?.name ?? "—")
            : row.scopeType === "compound"
              ? (row.compound?.name ?? "—")
              : t("agreements.scope.portfolio", {
                  defaultValue: "Whole portfolio",
                })}
        </span>
      ),
      width: "min-w-[160px]",
    },
    {
      id: "fee",
      header: t("agreements.table.fee", { defaultValue: "Fee" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal">
          {row.feeLabel}
        </Badge>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "status",
      header: t("agreements.table.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal capitalize">
          {t(`agreements.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
  ];

  return (
    <div className="space-y-4">
      {error && <TabError message={error} />}

      {/* A blanket or compound agreement covers this building without naming
          it, so the list would otherwise look wrong. */}
      <p className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0" />
        {t("properties.tabs.agreements.hint", {
          defaultValue:
            "Includes agreements that reach this property through its compound or its owner's whole portfolio, not only ones naming it directly.",
        })}
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Handshake className="h-4 w-4" />
              {t("properties.details.tabs.agreements", {
                defaultValue: "Agreements",
              })}
            </span>
            <Button size="sm" variant="outline" asChild>
              <Link href="/dashboard/agreements/new">
                {t("agreements.actions.add", {
                  defaultValue: "Create agreement",
                })}
              </Link>
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data ?? []}
            loading={loading}
            getRowKey={(row) => row.id}
            emptyState={{
              icon: <Handshake className="h-10 w-10 text-muted-foreground" />,
              title: t("properties.tabs.agreements.empty", {
                defaultValue: "No agreement covers this property",
              }),
              description: t("properties.tabs.agreements.emptyHint", {
                defaultValue:
                  "The office earns no commission here. That is normal for a building its owner manages themselves.",
              }),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Payments
// ============================================================================

interface PaymentRow {
  _id: string;
  paidDate?: string | null;
  dueDate: string;
  amount: number;
  amountPaid?: number;
  status: string;
  paymentMethod?: string | null;
  type: string;
  tenantId?: { firstName?: string; lastName?: string } | string;
}

export function PropertyPaymentsTab({ propertyId }: { propertyId: string }) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const { data, loading, error } = useTabData<PaymentRow[]>(
    `/api/payments?propertyId=${propertyId}&limit=100`,
    (payload) => payload.data?.payments ?? payload.data ?? [],
  );

  const columns: DataTableColumn<PaymentRow>[] = [
    {
      id: "date",
      header: t("properties.tabs.payments.date", { defaultValue: "Date" }),
      cell: (row) => (
        <span className="text-sm">
          {formatDate(row.paidDate ?? row.dueDate)}
        </span>
      ),
      width: "min-w-[130px]",
    },
    {
      id: "tenant",
      header: t("properties.tabs.payments.tenant", { defaultValue: "Tenant" }),
      cell: (row) => (
        <span className="text-sm">
          {typeof row.tenantId === "object" && row.tenantId
            ? `${row.tenantId.firstName ?? ""} ${row.tenantId.lastName ?? ""}`.trim()
            : "—"}
        </span>
      ),
      visibility: "md",
      width: "min-w-[150px]",
    },
    {
      id: "method",
      header: t("properties.tabs.payments.method", { defaultValue: "Method" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal capitalize">
          {row.paymentMethod
            ? paymentMethodLabel(row.paymentMethod, t)
            : paymentTypeLabel(row.type, t)}
        </Badge>
      ),
      visibility: "lg",
      width: "min-w-[140px]",
    },
    {
      id: "amount",
      header: t("properties.tabs.payments.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span className="text-sm font-medium">
          {formatCurrency(row.amountPaid || row.amount)}
        </span>
      ),
      align: "right",
      width: "min-w-[120px]",
    },
    {
      id: "status",
      header: t("properties.tabs.payments.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal">
          {t(`exports.value.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      width: "min-w-[110px]",
    },
  ];

  return (
    <div className="space-y-4">
      {error && <TabError message={error} />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <Receipt className="h-4 w-4" />
              {t("properties.details.tabs.payments", {
                defaultValue: "Payments",
              })}
            </span>
            <Badge variant="outline">{data?.length ?? 0}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data ?? []}
            loading={loading}
            getRowKey={(row) => row._id}
            emptyState={{
              icon: <Receipt className="h-10 w-10 text-muted-foreground" />,
              title: t("properties.tabs.payments.empty", {
                defaultValue: "No payments yet",
              }),
              description: t("properties.tabs.payments.emptyHint", {
                defaultValue: "Payments against this property appear here",
              }),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Expenses
// ============================================================================

interface ExpenseRow {
  _id: string;
  expenseNumber?: string | null;
  date: string;
  category: string;
  description: string;
  amount: number;
  status: string;
}

export function PropertyExpensesTab({ propertyId }: { propertyId: string }) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const { data, loading, error } = useTabData<ExpenseRow[]>(
    `/api/accounting/expenses?propertyId=${propertyId}&limit=100`,
    (payload) => payload.data?.expenses ?? payload.data ?? [],
  );

  const total = (data ?? []).reduce((sum, row) => sum + row.amount, 0);

  const columns: DataTableColumn<ExpenseRow>[] = [
    {
      id: "date",
      header: t("properties.tabs.expenses.date", { defaultValue: "Date" }),
      cell: (row) => <span className="text-sm">{formatDate(row.date)}</span>,
      width: "min-w-[130px]",
    },
    {
      id: "description",
      header: t("properties.tabs.expenses.description", {
        defaultValue: "Description",
      }),
      cell: (row) => (
        <div className="text-sm">
          <span className="block">{row.description}</span>
          <span className="block text-xs text-muted-foreground">
            {t(`expenses.categories.${row.category}`, {
              defaultValue: row.category,
            })}
          </span>
        </div>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "amount",
      header: t("properties.tabs.expenses.amount", { defaultValue: "Amount" }),
      cell: (row) => (
        <span className="text-sm font-medium text-error">
          {formatCurrency(row.amount)}
        </span>
      ),
      align: "right",
      width: "min-w-[120px]",
    },
    {
      id: "status",
      header: t("properties.tabs.expenses.status", { defaultValue: "Status" }),
      cell: (row) => (
        <Badge variant="outline" className="text-xs font-normal">
          {t(`expenses.status.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
      visibility: "md",
      width: "min-w-[110px]",
    },
  ];

  return (
    <div className="space-y-4">
      {error && <TabError message={error} />}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between text-base">
            <span className="flex items-center gap-2">
              <TrendingDown className="h-4 w-4" />
              {t("properties.details.tabs.expenses", {
                defaultValue: "Expenses",
              })}
            </span>
            <span className="text-sm font-semibold text-error">
              {formatCurrency(total)}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            data={data ?? []}
            loading={loading}
            getRowKey={(row) => row._id}
            emptyState={{
              icon: (
                <TrendingDown className="h-10 w-10 text-muted-foreground" />
              ),
              title: t("properties.tabs.expenses.empty", {
                defaultValue: "No expenses recorded",
              }),
              description: t("properties.tabs.expenses.emptyHint", {
                defaultValue: "Costs booked against this property appear here",
              }),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// Reports
// ============================================================================

interface PropertyInsights {
  propertyName: string;
  currency: string;
  occupancy: {
    totalUnits: number;
    occupied: number;
    available: number;
    maintenance: number;
    rate: number;
  };
  leasing: {
    activeContracts: number;
    expiringWithin60Days: number;
    contractedRent: number;
    annualisedRent: number;
  };
  money: {
    rentBilled: number;
    rentCollected: number;
    outstanding: number;
    overdue: number;
    collectionRate: number;
    expenses: number;
    commission: number;
    commissionTax: number;
    investmentRent: number;
    collectedByOwner: number;
    collectedByOperator: number;
    /** collected − expenses − commission − VAT + investment rent. */
    ownerShare: number;
    dueToOwner: number;
    dueToOperator: number;
  };
  commissionPercentage: number | null;
  agreements: StatementAgreementRef[];
  expensesByCategory: Array<{ category: string; amount: number }>;
  monthly: Array<{ month: string; collected: number; expenses: number }>;
}

/**
 * The building's report is read over a period, which opens on the year so far.
 * Reset returns to exactly this.
 */
const INSIGHT_FILTERS = {
  defaults: (): FilterValues => ({ ...yearToDate() }),
};

const INSIGHT_FIELDS: ReportFilterField[] = [
  { kind: "period", startKey: "startDate", endKey: "endDate", presets: true },
];

const INSIGHT_KEYS = ["startDate", "endDate"] as const;

export function PropertyReportsTab({ propertyId }: { propertyId: string }) {
  // The period lives in the address, and useSearchParams needs a boundary of
  // its own.
  return (
    <Suspense fallback={null}>
      <PropertyReportsView propertyId={propertyId} />
    </Suspense>
  );
}

function PropertyReportsView({ propertyId }: { propertyId: string }) {
  const { t, formatCurrency } = useLocalizationContext();

  // What the report was last run with is `applied`; the controls edit `draft`
  // until Apply, so changing both dates fetches once, for the pair asked for.
  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(INSIGHT_FILTERS);
  const params = useMemo(
    () => filterParams(applied, INSIGHT_KEYS),
    [applied],
  );

  const { data, loading, error } = useTabData<PropertyInsights>(
    `/api/properties/${propertyId}/insights?${params}`,
    (payload) => payload.data,
  );

  const money = data?.money;

  return (
    <div className="space-y-4">
      {error && <TabError message={error} />}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <ReportFilterBar
            values={draft}
            onChange={setField}
            onApply={apply}
            onReset={reset}
            pending={pending}
            canReset={canReset}
            fields={INSIGHT_FIELDS}
          />
        </div>
        <ReportExportButton
          endpoint={`/api/properties/${propertyId}/insights`}
          params={params}
          disabled={loading}
        />
      </div>

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      ) : (
        <>
          <AnalyticsCardGrid className="lg:grid-cols-4">
            <AnalyticsCard
              title={t("properties.tabs.reports.collected", {
                defaultValue: "Rent collected",
              })}
              value={formatCurrency(money?.rentCollected ?? 0)}
              icon={TrendingUp}
              iconColor="success"
              description={t("properties.tabs.reports.ofBilled", {
                defaultValue: "of {amount} billed",
                values: { amount: formatCurrency(money?.rentBilled ?? 0) },
              })}
            />
            <AnalyticsCard
              title={t("properties.tabs.reports.outstanding", {
                defaultValue: "Outstanding",
              })}
              value={formatCurrency(money?.outstanding ?? 0)}
              icon={AlertTriangle}
              iconColor="warning"
              description={t("properties.tabs.reports.overdueOf", {
                defaultValue: "{amount} overdue",
                values: { amount: formatCurrency(money?.overdue ?? 0) },
              })}
            />
            <AnalyticsCard
              title={t("properties.tabs.reports.expenses", {
                defaultValue: "Expenses",
              })}
              value={formatCurrency(money?.expenses ?? 0)}
              icon={TrendingDown}
              iconColor="error"
            />
            {/* What the owner is entitled to — after the commission and the
                VAT on it — and, once the money the owner received directly
                is counted, who still owes whom. */}
            <AnalyticsCard
              title={t("properties.tabs.reports.net", {
                defaultValue: "Net to owner",
              })}
              value={formatCurrency(money?.ownerShare ?? 0)}
              icon={Wallet}
              iconColor={(money?.dueToOperator ?? 0) > 0 ? "warning" : "primary"}
              description={
                (money?.dueToOperator ?? 0) > 0
                  ? t("properties.tabs.reports.dueToOffice", {
                      defaultValue: "The owner owes the office {amount}",
                      values: { amount: formatCurrency(money?.dueToOperator ?? 0) },
                    })
                  : t("properties.tabs.reports.dueToOwner", {
                      defaultValue: "Still due to the owner: {amount}",
                      values: { amount: formatCurrency(money?.dueToOwner ?? 0) },
                    })
              }
            />
          </AnalyticsCardGrid>

          {/* The building statement's settlement: the commission and the VAT
              on it, who received the money, and who owes whom. */}
          {money && (
            <div className="space-y-2">
              {(data?.agreements.length ?? 0) === 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("properties.tabs.reports.noAgreement", {
                    defaultValue: "No management agreement",
                  })}
                </p>
              )}
              <StatementSummary
                figures={{
                  collected: money.rentCollected,
                  commission: money.commission,
                  commissionTax: money.commissionTax,
                  expenses: money.expenses,
                  investmentRent: money.investmentRent,
                  collectedByOwner: money.collectedByOwner,
                  collectedByOperator: money.collectedByOperator,
                  dueToOwner: money.dueToOwner,
                  dueToOperator: money.dueToOperator,
                }}
                commissionPercentage={data?.commissionPercentage ?? null}
              />
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Building2 className="h-4 w-4" />
                  {t("properties.tabs.reports.occupancy", {
                    defaultValue: "Occupancy & leasing",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      {t("properties.tabs.reports.occupancyRate", {
                        defaultValue: "Occupancy",
                      })}
                    </span>
                    <span className="font-medium">
                      {data?.occupancy.rate ?? 0}%
                    </span>
                  </div>
                  <Progress
                    value={Math.min(data?.occupancy.rate ?? 0, 100)}
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("properties.tabs.reports.unitSplit", {
                      defaultValue:
                        "{occupied} occupied · {available} available · {maintenance} in maintenance",
                      values: {
                        occupied: data?.occupancy.occupied ?? 0,
                        available: data?.occupancy.available ?? 0,
                        maintenance: data?.occupancy.maintenance ?? 0,
                      },
                    })}
                  </p>
                </div>

                <div className="flex items-center justify-between border-t pt-3">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    {t("properties.tabs.reports.activeContracts", {
                      defaultValue: "Active contracts",
                    })}
                  </span>
                  <span>{data?.leasing.activeContracts ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <CalendarClock className="h-3.5 w-3.5" />
                    {t("properties.tabs.reports.expiringSoon", {
                      defaultValue: "Ending within 60 days",
                    })}
                  </span>
                  <span>{data?.leasing.expiringWithin60Days ?? 0}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">
                    {t("properties.tabs.reports.annualised", {
                      defaultValue: "Annualised rent",
                    })}
                  </span>
                  <span className="font-medium">
                    {formatCurrency(data?.leasing.annualisedRent ?? 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <Percent className="h-3.5 w-3.5" />
                    {t("properties.tabs.reports.collectionRate", {
                      defaultValue: "Collection rate",
                    })}
                  </span>
                  <span className="font-medium">
                    {money?.collectionRate ?? 0}%
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <TrendingDown className="h-4 w-4" />
                  {t("properties.tabs.reports.expenseBreakdown", {
                    defaultValue: "Expenses by category",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data?.expensesByCategory.length ? (
                  data.expensesByCategory.map((entry) => (
                    <div
                      key={entry.category}
                      className="flex items-center justify-between border-b pb-2 last:border-0 last:pb-0"
                    >
                      <span className="capitalize">
                        {t(`expenses.categories.${entry.category}`, {
                          defaultValue: entry.category.replace(/_/g, " "),
                        })}
                      </span>
                      <span className="font-medium">
                        {formatCurrency(entry.amount)}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="py-6 text-center text-muted-foreground">
                    {t("properties.tabs.reports.noExpenses", {
                      defaultValue: "No expenses in this period",
                    })}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {(data?.monthly.length ?? 0) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {t("properties.tabs.reports.monthly", {
                    defaultValue: "Month by month",
                  })}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                {data?.monthly.map((row) => (
                  <div
                    key={row.month}
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-2 last:border-0 last:pb-0"
                  >
                    <span className="font-medium">{row.month}</span>
                    <span className="flex gap-4 text-xs">
                      <span className="text-success">
                        +{formatCurrency(row.collected)}
                      </span>
                      <span className="text-error">
                        −{formatCurrency(row.expenses)}
                      </span>
                      <span className="font-semibold">
                        {formatCurrency(row.collected - row.expenses)}
                      </span>
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Every agreement that charged the building in the period — a
              renewal inside it is a second one. */}
          {data?.agreements.map((agreement) => (
            <p
              key={agreement.id}
              className="flex items-center gap-2 text-sm text-muted-foreground"
            >
              <ExternalLink className="h-4 w-4" />
              <Link
                href={`/dashboard/agreements/${agreement.id}`}
                className="hover:text-blue-600 dark:hover:text-blue-400"
              >
                {t("properties.tabs.reports.openAgreement", {
                  defaultValue:
                    "Commission is charged under agreement {number}",
                  values: {
                    number:
                      agreement.number ??
                      t("agreements.table.unnumbered", {
                        defaultValue: "(no number)",
                      }),
                  },
                })}
              </Link>
            </p>
          ))}
        </>
      )}
    </div>
  );
}
