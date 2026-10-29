"use client";

import { useEffect, useState, useCallback } from "react";
import {
  TrendingUp,
  DollarSign,
  Wallet,
  CheckCircle,
  AlertCircle,
  Percent,
  Building2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DataTable, DataTableColumn } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { latinDigits } from "@/lib/services/localization.service";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

interface RevenueSummary {
  totalRevenue: number;
  totalCollected: number;
  totalOutstanding: number;
  monthToDate: number;
  yearToDate: number;
  collectionRate: number;
  count: number;
}

interface RevenueByCategory {
  category: string;
  amount: number;
  count: number;
  percentage: number;
}

interface RevenueByProperty {
  propertyId: string;
  propertyName: string;
  revenue: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
}

interface MonthlyRevenue {
  year: number;
  month: number;
  revenue: number;
  collected: number;
  count: number;
}

const PIE_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#ec4899",
  "#06b6d4",
  "#f97316",
];


export default function RevenuesPage() {
  const { t, formatCurrency, currentLocale } = useLocalizationContext();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<RevenueSummary | null>(null);
  const [byCategory, setByCategory] = useState<RevenueByCategory[]>([]);
  const [byProperty, setByProperty] = useState<RevenueByProperty[]>([]);
  const [monthlyTrends, setMonthlyTrends] = useState<MonthlyRevenue[]>([]);

  const fetchRevenues = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/accounting/revenues?months=12");
      const data = await res.json();

      if (data?.success) {
        setSummary(data?.data?.summary || null);
        setByCategory(data?.data?.byCategory || []);
        setByProperty(data?.data?.byProperty || []);
        setMonthlyTrends(data?.data?.monthlyTrends || []);
      }
    } catch (error) {
      console.error("Failed to fetch revenue data:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRevenues();
  }, [fetchRevenues]);

  // Month and category in the reader's language — the chart's axis and
  // legend were the only English left on the page.
  const monthLabel = (month?: number, year?: number) =>
    new Date(year ?? new Date().getFullYear(), (month ?? 1) - 1, 1).toLocaleDateString(
      latinDigits(currentLocale),
      { month: "short", year: "numeric" },
    );
  const chartData = monthlyTrends.map((m) => ({
    name: monthLabel(m?.month, m?.year),
    revenue: m?.revenue ?? 0,
    collected: m?.collected ?? 0,
  }));

  const pieData = byCategory.map((c) => ({
    name: t(`transactions.categories.${c?.category || "other"}`, {
      defaultValue: (c?.category || "other").replace(/_/g, " "),
    }),
    value: c?.amount ?? 0,
    count: c?.count ?? 0,
  }));

  const propertyColumns: DataTableColumn<RevenueByProperty>[] = [
    {
      id: "property",
      header: t("revenues.table.property", { defaultValue: "Property" }),
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium text-sm">
            {row?.propertyName || "Unknown Property"}
          </span>
        </div>
      ),
      width: "min-w-[200px]",
    },
    {
      id: "revenue",
      header: t("revenues.table.totalRevenue", {
        defaultValue: "Total Revenue",
      }),
      cell: (row) => (
        <span className="font-semibold text-sm">
          {formatCurrency(row.revenue)}
        </span>
      ),
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "collected",
      header: t("revenues.table.collected", { defaultValue: "Collected" }),
      cell: (row) => (
        <span className="text-sm text-success font-medium">
          {formatCurrency(row.collected)}
        </span>
      ),
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "outstanding",
      header: t("revenues.table.outstanding", { defaultValue: "Outstanding" }),
      cell: (row) => (
        <span className="text-sm text-warning font-medium">
          {formatCurrency(row.outstanding)}
        </span>
      ),
      align: "right",
      width: "min-w-[130px]",
    },
    {
      id: "collectionRate",
      header: t("revenues.table.rate", { defaultValue: "Collection Rate" }),
      cell: (row) => (
        <Badge
          variant="outline"
          className={`text-xs ${
            (row?.collectionRate ?? 0) >= 90
              ? "bg-success/10 text-success border-success/20"
              : (row?.collectionRate ?? 0) >= 70
                ? "bg-warning/10 text-warning border-warning/20"
                : "bg-error/10 text-error border-error/20"
          }`}
        >
          {row?.collectionRate ?? 0}%
        </Badge>
      ),
      align: "center",
      width: "min-w-[130px]",
    },
  ];

  if (loading) {
    return (
      <div className="space-y-4">
        <div>
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Skeleton className="h-80" />
          <Skeleton className="h-80" />
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("nav.accounting.revenues", { defaultValue: "Revenues" })}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("revenues.subtitle", {
            defaultValue: "Track income from rent, deposits, and other sources",
          })}
        </p>
      </div>

      {/* Summary Cards */}
      <AnalyticsCardGrid className="lg:grid-cols-4">
        <AnalyticsCard
          title={t("revenues.stats.totalRevenue", {
            defaultValue: "Total Revenue",
          })}
          value={formatCurrency(summary?.totalRevenue || 0)}
          icon={DollarSign}
          iconColor="primary"
        />
        <AnalyticsCard
          title={t("revenues.stats.collected", { defaultValue: "Collected" })}
          value={formatCurrency(summary?.totalCollected || 0)}
          icon={CheckCircle}
          iconColor="success"
        />
        <AnalyticsCard
          title={t("revenues.stats.outstanding", {
            defaultValue: "Outstanding",
          })}
          value={formatCurrency(summary?.totalOutstanding || 0)}
          icon={AlertCircle}
          iconColor="warning"
        />
        <AnalyticsCard
          title={t("revenues.stats.collectionRate", {
            defaultValue: "Collection Rate",
          })}
          value={`${summary?.collectionRate || 0}%`}
          icon={Percent}
          iconColor="info"
          description={t("revenues.stats.ytd", {
            defaultValue: "YTD: {amount}",
            values: { amount: formatCurrency(summary?.yearToDate || 0) },
          })}
        />
      </AnalyticsCardGrid>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Monthly Trends Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg border border-blue-100 dark:border-blue-800">
                <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {t("revenues.charts.monthlyTrends", {
                    defaultValue: "Monthly Revenue Trends",
                  })}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("revenues.charts.last12Months", {
                    defaultValue: "Last 12 months",
                  })}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    tickFormatter={(v) =>
                      v >= 1000
                        ? `${formatCurrency(v / 1000, undefined, {
                            maximumFractionDigits: 0,
                            minimumFractionDigits: 0,
                          })}k`
                        : formatCurrency(v, undefined, {
                            maximumFractionDigits: 0,
                            minimumFractionDigits: 0,
                          })
                    }
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(value as number)}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--popover)",
                      color: "var(--popover-foreground)",
                    }}
                  />
                  <Bar
                    dataKey="collected"
                    name={t("revenues.charts.collected", {
                      defaultValue: "Collected",
                    })}
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                  />
                  <Bar
                    dataKey="revenue"
                    name={t("revenues.charts.total", {
                      defaultValue: "Total",
                    })}
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    opacity={0.4}
                  />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                {t("revenues.charts.noData", {
                  defaultValue: "No revenue data available",
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Revenue by Category Pie Chart */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-50 dark:bg-purple-900/30 rounded-lg border border-purple-100 dark:border-purple-800">
                <Wallet className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <CardTitle className="text-base">
                  {t("revenues.charts.byCategory", {
                    defaultValue: "Revenue by Category",
                  })}
                </CardTitle>
                <CardDescription className="text-xs">
                  {t("revenues.charts.breakdown", {
                    defaultValue: "Income source breakdown",
                  })}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {pieData.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={3}
                    dataKey="value"
                  >
                    {pieData.map((_, index) => (
                      <Cell
                        key={`cell-${index}`}
                        fill={PIE_COLORS[index % PIE_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCurrency(value as number)}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "1px solid var(--border)",
                      backgroundColor: "var(--popover)",
                      color: "var(--popover-foreground)",
                    }}
                  />
                  <Legend
                    formatter={(value: string) => (
                      <span className="text-xs capitalize">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
                {t("revenues.charts.noData", {
                  defaultValue: "No revenue data available",
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Revenue by Property Table */}
      <Card className="gap-2">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-green-50 dark:bg-green-900/30 rounded-lg border border-green-100 dark:border-green-800">
              <Building2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div>
              <CardTitle className="text-base">
                {t("revenues.table.title", {
                  defaultValue: "Revenue by Property",
                })}
              </CardTitle>
              <CardDescription className="text-xs">
                {t("revenues.table.subtitle", {
                  defaultValue:
                    "Income breakdown and collection rates per property",
                })}
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={propertyColumns}
            data={byProperty}
            loading={false}
            getRowKey={(row) => row.propertyId}
            emptyState={{
              icon: (
                <Building2 className="h-12 w-12 text-muted-foreground" />
              ),
              title: t("revenues.table.empty", {
                defaultValue: "No property revenue data",
              }),
              description: t("revenues.table.emptyDescription", {
                defaultValue:
                  "Revenue data will appear here once payments are recorded",
              }),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
