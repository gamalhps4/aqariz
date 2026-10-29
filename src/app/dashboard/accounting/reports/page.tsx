"use client";

/**
 * PropertyPro - Financial reports
 *
 * Income and expenses, the rent roll and collections, behind one filter bar:
 * owner, compound, building, unit, tenant, contract, status and period, each
 * offered on the reports it describes. The controls edit a draft; Apply runs
 * the report and writes the filters to the address, Reset returns them — the
 * period included — to where the page opened. The export carries what was
 * applied, not what the controls show.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  BarChart3,
  Building2,
  DollarSign,
  FileText,
  TrendingDown,
  TrendingUp,
  RefreshCw,
  AlertTriangle,
  Clock,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { FeatureGate } from "@/components/billing/feature-gate";
import { monthLabel } from "@/lib/report-filters/months";
import {
  isPeriodPreset,
  presetRange,
  yearToDate,
} from "@/lib/report-filters/period";

// ============================================================================
// Types
// ============================================================================

interface IncomeExpenseReport {
  summary: {
    totalIncome: number;
    totalExpenses: number;
    netIncome: number;
    profitMargin: number;
    // Where the money received went: income is what is left after these.
    grossReceived?: number;
    depositsHeld?: number;
    vatCollected?: number;
    rentCollectedForOwners?: number;
  };
  incomeByCategory: Array<{ _id: string; amount: number; count: number }>;
  expenseByCategory: Array<{ _id: string; amount: number; count: number }>;
  incomeByProperty: Array<{ _id: string; propertyName: string; amount: number; count: number }>;
  expenseByProperty: Array<{ _id: string; propertyName: string; amount: number; count: number }>;
  monthlyTrend: Array<{
    month: string;
    monthNumber: number;
    year: number;
    income: number;
    expenses: number;
    net: number;
  }>;
  period: { startDate: string; endDate: string };
}

interface RentRollReport {
  rentRoll: Array<{
    _id: string;
    propertyName: string;
    unitId?: string;
    unitNumber?: string;
    tenantName: string;
    tenantEmail: string;
    startDate: string;
    endDate: string;
    rentAmount: number;
    securityDeposit: number;
    status: string;
  }>;
  totals: {
    totalUnits: number;
    totalMonthlyRent: number;
    totalDeposits: number;
    annualizedRent: number;
  };
}

interface CollectionsReport {
  summary: {
    totalDue: number;
    collected: number;
    pending: number;
    overdue: number;
    totalCount: number;
    paidCount: number;
    collectionRate: number;
  };
  collectionsByProperty: Array<{
    _id: string;
    propertyName: string;
    totalDue: number;
    collected: number;
    overdueAmount: number;
    collectionRate: number;
    totalCount: number;
    collectedCount: number;
  }>;
  overdueAging: Array<{ range: string; count: number; amount: number }>;
  period: { startDate: string; endDate: string };
}

const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#f97316", "#ec4899", "#14b8a6", "#6366f1", "#84cc16", "#a855f7"];

function formatCategoryLabel(category?: string | null): string {
  return (category || "other")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ============================================================================
// The filters
// ============================================================================

type TabId = "income-expense" | "rent-roll" | "collections";
const TABS: readonly TabId[] = ["income-expense", "rent-roll", "collections"];

function isTab(value: string | null): value is TabId {
  return TABS.includes(value as TabId);
}

/**
 * Every filter this page has, and the values it opens on: the year so far, and
 * nothing narrowed. Reset returns to exactly these.
 */
const FILTERS = {
  defaults: (): FilterValues => ({
    ...yearToDate(),
    ownerId: "",
    compoundId: "",
    propertyId: "",
    unitId: "",
    tenantId: "",
    leaseId: "",
    status: "",
  }),
  // The dashboard's net income card links here with `?range=this-month`.
  legacy: (params: URLSearchParams) => {
    const asked = params.get("range");
    return isPeriodPreset(asked) ? presetRange(asked) : null;
  },
  legacyKeys: ["range"],
};

/** The filters each report reads — the others are not sent, nor shown. */
const PERIOD = ["startDate", "endDate"];
const REPORT_FILTERS: Record<TabId, readonly string[]> = {
  "income-expense": [...PERIOD, "ownerId", "compoundId", "propertyId"],
  "rent-roll": [
    "ownerId",
    "compoundId",
    "propertyId",
    "unitId",
    "tenantId",
    "leaseId",
  ],
  collections: [
    ...PERIOD,
    "ownerId",
    "compoundId",
    "propertyId",
    "unitId",
    "tenantId",
    "leaseId",
    "status",
  ],
};

const PERIOD_FIELD: ReportFilterField = {
  kind: "period",
  startKey: "startDate",
  endKey: "endDate",
  presets: true,
};

/** The pickers a report offers, in the order the review lists them. */
const ENTITY_FIELDS: ReportFilterField[] = [
  { kind: "entity", entity: "owner" },
  { kind: "entity", entity: "compound" },
  { kind: "entity", entity: "building" },
];
const CONTRACT_FIELDS: ReportFilterField[] = [
  { kind: "entity", entity: "unit" },
  { kind: "entity", entity: "tenant" },
  { kind: "entity", entity: "contract" },
];

// The collections report reads these on installments: paid in full, part
// paid, awaiting payment, late. A failed or refunded payment is never an
// installment's state, so those are not offered.
const COLLECTION_STATUSES = ["paid", "partial", "pending", "overdue"] as const;

// ============================================================================
// Main Page
// ============================================================================

export default function ReportsPage() {
  const { t } = useLocalizationContext();

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("reports.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("reports.description")}
        </p>
      </div>

      {/* The financial report API is gated on `advanced_analytics`; without
          this the tabs render, fire, and fail with a raw 402. */}
      <FeatureGate
        feature="advanced_analytics"
        description={t("reports.gate.financial", { defaultValue: "Income and expense summaries, the rent roll and collection reports come with the higher plans. Your figures are still being recorded — upgrade to see them here." })}
      >
        {/* useSearchParams needs a boundary of its own under the dashboard
            layout. */}
        <Suspense fallback={null}>
          <FinancialReports />
        </Suspense>
      </FeatureGate>
    </div>
  );
}

type Loaded =
  | { tab: "income-expense"; data: IncomeExpenseReport }
  | { tab: "rent-roll"; data: RentRollReport }
  | { tab: "collections"; data: CollectionsReport };

function FinancialReports() {
  const { t } = useLocalizationContext();
  const search = useSearchParams();

  // Which report is open lives in the address too, so a reload or a shared
  // link opens the same one.
  const tabParam = search.get("tab");
  const activeTab: TabId = isTab(tabParam) ? tabParam : "income-expense";

  const { draft, applied, setField, apply, reset, pending, canReset } =
    useReportFilters(FILTERS);
  const {
    options,
    loading: optionsLoading,
    failed: optionsFailed,
  } = useReportFilterOptions([
    "owners",
    "compounds",
    "buildings",
    "units",
    "tenants",
    "contracts",
  ]);

  /**
   * What the open report was last run with — the applied filters, and only the
   * ones this report reads. The figures, the export and the address all
   * follow this, never the controls.
   */
  const params = useMemo(
    () => filterParams(applied, REPORT_FILTERS[activeTab], { type: activeTab }),
    [applied, activeTab],
  );
  const query = params.toString();

  const [reloads, setReloads] = useState(0);
  const requestKey = `${query}#${reloads}`;
  const [result, setResult] = useState<{
    key: string;
    loaded: Loaded | null;
    error: string | null;
  } | null>(null);
  const isLoading = result?.key !== requestKey;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/reports/financial?${query}`);
        const json = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(
            json?.error ??
              t("errors.ui.loadFailed", {
                defaultValue: "Could not load this. Try again.",
              }),
          );
        }
        if (cancelled) return;
        const data = json?.data ?? json ?? null;
        setResult({
          key: requestKey,
          loaded: data ? ({ tab: activeTab, data } as Loaded) : null,
          error: null,
        });
      } catch (err) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          loaded: null,
          error:
            err instanceof Error
              ? err.message
              : t("errors.ui.loadFailed", {
                  defaultValue: "Could not load this. Try again.",
                }),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
    // `t` changes with the language; the figures do not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  // The report on screen is the open tab's, or none until it arrives — never
  // another tab's figures under this tab's title.
  const shown = result?.loaded?.tab === activeTab ? result.loaded : null;
  const error = result?.key === requestKey ? result.error : null;

  const handleTabChange = (tab: string) => {
    replaceQuery({ tab: tab === "income-expense" ? null : tab });
  };

  const fields: ReportFilterField[] =
    activeTab === "rent-roll"
      ? [...ENTITY_FIELDS, ...CONTRACT_FIELDS]
      : activeTab === "collections"
        ? [
            PERIOD_FIELD,
            ...ENTITY_FIELDS,
            ...CONTRACT_FIELDS,
            {
              kind: "status",
              key: "status",
              options: COLLECTION_STATUSES.map((status) => ({
                value: status,
                label: t(`payments.filters.${status}`, {
                  defaultValue: status,
                }),
              })),
            },
          ]
        : [PERIOD_FIELD, ...ENTITY_FIELDS];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end gap-3">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setReloads((count) => count + 1)}
          disabled={isLoading}
        >
          <RefreshCw className={`h-4 w-4 me-2 ${isLoading ? "animate-spin" : ""}`} />
          {t("reports.actions.refresh")}
        </Button>
        {/*
          The export re-runs the same endpoint with a real format, so the file
          and the screen come from one query and cannot disagree — and it
          carries the filters the screen was run with.
        */}
        <ReportExportButton
          endpoint="/api/reports/financial"
          params={params}
          disabled={isLoading}
        />
      </div>

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
      />

      {error && (
        <Card className="border-destructive">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-4 w-4" />
              <span className="text-sm">{error}</span>
            </div>
          </CardContent>
        </Card>
      )}

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="income-expense" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            <span className="hidden sm:inline">{t("reports.tabs.incomeExpense")}</span>
          </TabsTrigger>
          <TabsTrigger value="rent-roll" className="gap-2">
            <Building2 className="h-4 w-4" />
            <span className="hidden sm:inline">{t("reports.tabs.rentRoll")}</span>
          </TabsTrigger>
          <TabsTrigger value="collections" className="gap-2">
            <DollarSign className="h-4 w-4" />
            <span className="hidden sm:inline">{t("reports.tabs.collections")}</span>
          </TabsTrigger>
        </TabsList>

        {/* Income & Expense Tab */}
        <TabsContent value="income-expense" className="space-y-6 mt-6">
          {shown?.tab === "income-expense" && <IncomeExpenseTab data={shown.data} />}
          {isLoading && !shown && <ReportSkeleton />}
        </TabsContent>

        {/* Rent Roll Tab */}
        <TabsContent value="rent-roll" className="space-y-6 mt-6">
          {shown?.tab === "rent-roll" && <RentRollTab data={shown.data} />}
          {isLoading && !shown && <ReportSkeleton />}
        </TabsContent>

        {/* Collections Tab */}
        <TabsContent value="collections" className="space-y-6 mt-6">
          {shown?.tab === "collections" && <CollectionsTab data={shown.data} />}
          {isLoading && !shown && <ReportSkeleton />}
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================================
// Income & Expense Tab
// ============================================================================

function IncomeExpenseTab({ data }: { data: IncomeExpenseReport }) {
  const { t, formatCurrency, language } = useLocalizationContext();
  const summary = data?.summary ?? {
    totalIncome: 0,
    totalExpenses: 0,
    netIncome: 0,
    profitMargin: 0,
  };
  const monthlyTrend = Array.isArray(data?.monthlyTrend) ? data.monthlyTrend : [];
  // The months are named here, in the reader's language, from their number —
  // not read off the response, which cannot know which language is on screen.
  // The year goes on them only when the period reaches over a new year, or
  // two Januaries would sit side by side unlabelled.
  const spansYears =
    monthlyTrend.length > 1 &&
    monthlyTrend[0].year !== monthlyTrend[monthlyTrend.length - 1].year;
  const trend = monthlyTrend.map((entry) => ({
    ...entry,
    label: monthLabel(entry.monthNumber, entry.year, language, {
      withYear: spansYears,
    }),
  }));
  const incomeByCategory = Array.isArray(data?.incomeByCategory)
    ? data.incomeByCategory
    : [];
  const expenseByCategory = Array.isArray(data?.expenseByCategory)
    ? data.expenseByCategory
    : [];
  const incomeByProperty = Array.isArray(data?.incomeByProperty)
    ? data.incomeByProperty
    : [];

  return (
    <>
      {/* Summary KPIs */}
      <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
        <AnalyticsCard
          title={t("reports.incomeExpense.totalIncome")}
          value={formatCurrency(summary.totalIncome)}
          icon={TrendingUp}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("reports.incomeExpense.totalExpenses")}
          value={formatCurrency(summary.totalExpenses)}
          icon={TrendingDown}
          iconColor="error"
        />
        <AnalyticsCard
          title={t("reports.incomeExpense.netIncome")}
          value={formatCurrency(summary.netIncome)}
          icon={DollarSign}
          iconColor={summary.netIncome >= 0 ? "success" : "error"}
        />
        <AnalyticsCard
          title={t("reports.incomeExpense.profitMargin")}
          value={`${summary.profitMargin}%`}
          icon={BarChart3}
          iconColor="info"
        />
      </AnalyticsCardGrid>

      {/* The office's income is not all the money received: deposits are
          held, VAT is the state's, owners' rent is theirs. */}
      {summary.grossReceived !== undefined && (
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 pt-6 text-sm md:grid-cols-4">
            {(
              [
                ["reports.incomeExpense.grossReceived", "Total received", summary.grossReceived],
                ["reports.incomeExpense.depositsHeld", "Deposits held", summary.depositsHeld],
                ["reports.incomeExpense.vatCollected", "VAT collected", summary.vatCollected],
                [
                  "reports.incomeExpense.rentForOwners",
                  "Rent collected for owners",
                  summary.rentCollectedForOwners,
                ],
              ] as Array<[string, string, number | undefined]>
            ).map(([key, english, amount]) => (
              <div key={key}>
                <p className="text-muted-foreground">{t(key, { defaultValue: english })}</p>
                <p className="mt-1 text-base font-semibold tabular-nums">
                  {formatCurrency(amount ?? 0)}
                </p>
              </div>
            ))}
            <p className="col-span-2 text-xs text-muted-foreground md:col-span-4">
              {t("reports.incomeExpense.incomeNote", {
                defaultValue:
                  "Income is the office's own: received less deposits held, VAT, and rent collected for owners (the office's commission is still inside it until the ledger books it).",
              })}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Monthly Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("reports.incomeExpense.monthlyTrend")}</CardTitle>
          <CardDescription>{t("reports.incomeExpense.monthlyTrendDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {monthlyTrend.length > 0 ? (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    return (
                      <div className="bg-white p-3 border rounded-lg shadow-lg">
                        <p className="text-sm font-medium mb-2">{label}</p>
                        {payload.map((entry, i) => (
                          <div key={i} className="flex items-center gap-2 text-sm">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
                            <span className="text-muted-foreground">{entry.name}:</span>
                            <span className="font-semibold">{formatCurrency(entry.value as number)}</span>
                          </div>
                        ))}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="income" name={t("reports.incomeExpense.income")} fill="#10b981" radius={[4, 4, 0, 0]} />
                <Bar dataKey="expenses" name={t("reports.incomeExpense.expenses")} fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">{t("reports.noData")}</p>
          )}
        </CardContent>
      </Card>

      {/* Income & Expense by Category */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reports.incomeExpense.incomeByCategory")}</CardTitle>
          </CardHeader>
          <CardContent>
            {incomeByCategory.length > 0 ? (
              <div className="space-y-3">
                {incomeByCategory.map((item, i) => (
                  <div key={item?._id || `${item?.amount ?? 0}-${i}`} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-sm">
                        {t(`transactions.categories.${item?._id || "other"}`, {
                          defaultValue: formatCategoryLabel(item?._id || "other"),
                        })}
                      </span>
                    </div>
                    <div className="text-end">
                      <span className="text-sm font-medium">{formatCurrency(item?.amount ?? 0)}</span>
                      <span className="text-xs text-muted-foreground ms-2">({item?.count ?? 0})</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">{t("reports.noData")}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reports.incomeExpense.expenseByCategory")}</CardTitle>
          </CardHeader>
          <CardContent>
            {expenseByCategory.length > 0 ? (
              <div className="space-y-3">
                {expenseByCategory.map((item, i) => (
                  <div key={item?._id || `${item?.amount ?? 0}-${i}`} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded-full" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                      <span className="text-sm">
                        {t(`expenses.categories.${item?._id || "other"}`, {
                          defaultValue: formatCategoryLabel(item?._id || "other"),
                        })}
                      </span>
                    </div>
                    <div className="text-end">
                      <span className="text-sm font-medium">{formatCurrency(item?.amount ?? 0)}</span>
                      <span className="text-xs text-muted-foreground ms-2">({item?.count ?? 0})</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">{t("reports.noData")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Income by Property Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("reports.incomeExpense.incomeByProperty")}</CardTitle>
        </CardHeader>
        <CardContent>
          {incomeByProperty.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-start py-2 font-medium">{t("reports.table.property")}</th>
                    <th className="text-end py-2 font-medium">{t("reports.table.income")}</th>
                    <th className="text-end py-2 font-medium">{t("reports.table.transactions")}</th>
                  </tr>
                </thead>
                <tbody>
                  {incomeByProperty.map((item) => (
                    <tr key={item?._id || item?.propertyName || "property"} className="border-b last:border-0">
                      <td className="py-2">{item?.propertyName || "Unknown Property"}</td>
                      <td className="py-2 text-end font-medium text-success">{formatCurrency(item?.amount ?? 0)}</td>
                      <td className="py-2 text-end text-muted-foreground">{item?.count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">{t("reports.noData")}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ============================================================================
// Rent Roll Tab
// ============================================================================

function RentRollTab({ data }: { data: RentRollReport }) {
  const { t, formatCurrency, formatDate } = useLocalizationContext();
  const rentRoll = Array.isArray(data?.rentRoll) ? data.rentRoll : [];
  const totals = data?.totals ?? {
    totalUnits: 0,
    totalMonthlyRent: 0,
    totalDeposits: 0,
    annualizedRent: 0,
  };

  const columns: DataTableColumn<(typeof rentRoll)[0]>[] = [
    {
      id: "propertyName",
      header: t("reports.table.property"),
      cell: (row) => (
        <div>
          <span className="font-medium">{row?.propertyName || "—"}</span>
          {row?.unitNumber && (
            <p className="text-xs text-muted-foreground">
              {t("reports.table.unit", { defaultValue: "Unit" })} {row.unitNumber}
            </p>
          )}
        </div>
      ),
    },
    {
      id: "tenantName",
      header: t("reports.table.tenant"),
      cell: (row) => (
        <div>
          <p className="font-medium">{row.tenantName?.trim() || "—"}</p>
          <p className="text-xs text-muted-foreground">{row.tenantEmail || ""}</p>
        </div>
      ),
    },
    {
      id: "leasePeriod",
      header: t("reports.table.leasePeriod"),
      cell: (row) => (
        <span className="text-sm">
          {row.startDate ? formatDate(new Date(row.startDate), { format: "short" }) : "—"}
          {" — "}
          {row.endDate ? formatDate(new Date(row.endDate), { format: "short" }) : "—"}
        </span>
      ),
    },
    {
      id: "rentAmount",
      header: t("reports.table.monthlyRent"),
      cell: (row) => (
        <span className="font-medium">{formatCurrency(row.rentAmount || 0)}</span>
      ),
      align: "right",
    },
    {
      id: "securityDeposit",
      header: t("reports.table.deposit"),
      cell: (row) => (
        <span>{formatCurrency(row.securityDeposit || 0)}</span>
      ),
      align: "right",
    },
  ];

  return (
    <>
      {/* Summary KPIs */}
      <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
        <AnalyticsCard
          title={t("reports.rentRoll.totalUnits")}
          value={totals.totalUnits}
          icon={Building2}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("reports.rentRoll.monthlyRent")}
          value={formatCurrency(totals.totalMonthlyRent)}
          icon={DollarSign}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("reports.rentRoll.annualRent")}
          value={formatCurrency(totals.annualizedRent)}
          icon={TrendingUp}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("reports.rentRoll.totalDeposits")}
          value={formatCurrency(totals.totalDeposits)}
          icon={FileText}
          iconColor="warning"
        />
      </AnalyticsCardGrid>

      {/* Rent Roll Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("reports.rentRoll.activeLeases")}</CardTitle>
          <CardDescription>{t("reports.rentRoll.activeLeasesDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          {rentRoll.length > 0 ? (
            <DataTable data={rentRoll} columns={columns} getRowKey={(row) => row._id} />
          ) : (
            <p className="text-sm text-muted-foreground text-center py-8">{t("reports.noData")}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ============================================================================
// Collections Tab
// ============================================================================

function CollectionsTab({ data }: { data: CollectionsReport }) {
  const { t, formatCurrency } = useLocalizationContext();
  const summary = data?.summary ?? {
    totalDue: 0,
    collected: 0,
    pending: 0,
    overdue: 0,
    totalCount: 0,
    paidCount: 0,
    collectionRate: 0,
  };
  const collectionsByProperty = Array.isArray(data?.collectionsByProperty)
    ? data.collectionsByProperty
    : [];
  const overdueAging = Array.isArray(data?.overdueAging) ? data.overdueAging : [];

  return (
    <>
      {/* Summary KPIs */}
      <AnalyticsCardGrid className="md:grid-cols-4 lg:grid-cols-4">
        <AnalyticsCard
          title={t("reports.collections.totalDue")}
          value={formatCurrency(summary.totalDue)}
          icon={DollarSign}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("reports.collections.collected")}
          value={formatCurrency(summary.collected)}
          description={`${summary.paidCount} / ${summary.totalCount} ${t("reports.collections.installmentsPaid")}`}
          icon={TrendingUp}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("reports.collections.collectionRate")}
          value={`${summary.collectionRate}%`}
          icon={BarChart3}
          iconColor="info"
        />
        <AnalyticsCard
          title={t("reports.collections.overdue")}
          value={formatCurrency(summary.overdue)}
          icon={AlertTriangle}
          iconColor="error"
        />
      </AnalyticsCardGrid>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Overdue Aging */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reports.collections.overdueAging")}</CardTitle>
            <CardDescription>{t("reports.collections.overdueAgingDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {overdueAging.length > 0 ? (
              <div className="space-y-3">
                {overdueAging.map((bucket) => {
                  const maxAmount = Math.max(
                    ...overdueAging.map((b) => b?.amount ?? 0),
                  );
                  const widthPercent =
                    maxAmount > 0 ? ((bucket?.amount ?? 0) / maxAmount) * 100 : 0;
                  return (
                    <div key={bucket?.range || "bucket"}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-2">
                          <Clock className="h-3 w-3 text-muted-foreground" />
                          {bucket?.range || "Unknown"}
                        </span>
                        <span className="font-medium">{formatCurrency(bucket?.amount ?? 0)} ({bucket?.count ?? 0})</span>
                      </div>
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full bg-error rounded-full transition-all"
                          style={{ width: `${widthPercent}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <TrendingUp className="h-8 w-8 text-success mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">{t("reports.collections.noOverdue")}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Collections by Property Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("reports.collections.byProperty")}</CardTitle>
            <CardDescription>{t("reports.collections.byPropertyDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {collectionsByProperty.length > 0 ? (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={collectionsByProperty} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                  <YAxis
                    dataKey="propertyName"
                    type="category"
                    tick={{ fontSize: 11 }}
                    width={120}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-white p-3 border rounded-lg shadow-lg text-sm">
                          <p className="font-medium mb-1">
                            {d?.propertyName || "Unknown Property"}
                          </p>
                          <p>{t("reports.collections.collected")}: {formatCurrency(d?.collected ?? 0)}</p>
                          <p>{t("reports.collections.totalDue")}: {formatCurrency(d?.totalDue ?? 0)}</p>
                          <p>{t("reports.collections.collectionRate")}: {d?.collectionRate ?? 0}%</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="collectionRate" name={t("reports.collections.collectionRate")} radius={[0, 4, 4, 0]}>
                    {collectionsByProperty.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={
                          (entry?.collectionRate ?? 0) >= 80
                            ? "#10b981"
                            : (entry?.collectionRate ?? 0) >= 50
                              ? "#f59e0b"
                              : "#ef4444"
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">{t("reports.noData")}</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Collections Detail Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("reports.collections.detailTable")}</CardTitle>
        </CardHeader>
        <CardContent>
          {collectionsByProperty.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-start py-2 font-medium">{t("reports.table.property")}</th>
                    <th className="text-end py-2 font-medium">{t("reports.collections.totalDue")}</th>
                    <th className="text-end py-2 font-medium">{t("reports.collections.collected")}</th>
                    <th className="text-end py-2 font-medium">{t("reports.collections.overdue")}</th>
                    <th className="text-end py-2 font-medium">{t("reports.collections.collectionRate")}</th>
                  </tr>
                </thead>
                <tbody>
                  {collectionsByProperty.map((item) => (
                    <tr key={item?._id || item?.propertyName || "property"} className="border-b last:border-0">
                      <td className="py-2 font-medium">{item?.propertyName || "Unknown Property"}</td>
                      <td className="py-2 text-end">{formatCurrency(item?.totalDue ?? 0)}</td>
                      <td className="py-2 text-end text-success">{formatCurrency(item?.collected ?? 0)}</td>
                      <td className="py-2 text-end text-error">{formatCurrency(item?.overdueAmount ?? 0)}</td>
                      <td className="py-2 text-end">
                        <Badge variant={(item?.collectionRate ?? 0) >= 80 ? "default" : (item?.collectionRate ?? 0) >= 50 ? "secondary" : "destructive"}>
                          {item?.collectionRate ?? 0}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">{t("reports.noData")}</p>
          )}
        </CardContent>
      </Card>
    </>
  );
}

// ============================================================================
// Skeleton loader
// ============================================================================

function ReportSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="pt-6">
              <div className="h-4 w-24 bg-muted rounded animate-pulse mb-2" />
              <div className="h-8 w-32 bg-muted rounded animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="pt-6">
          <div className="h-64 bg-muted rounded animate-pulse" />
        </CardContent>
      </Card>
    </div>
  );
}
