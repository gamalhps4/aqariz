"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/auth-client";
import { useCallback, useEffect, useState } from "react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { usePropertyCategories } from "@/hooks/use-property-categories";
import { formatChartLabelFor } from "@/lib/i18n/translate";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { DashboardSkeleton } from "@/components/ui/skeleton-layouts";
import { ResponsiveLayout } from "@/components/layout/responsive-layout";
import { OwnerPortfolio } from "@/components/owner/OwnerPortfolio";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  DashboardActivity,
  DashboardAlert,
  DashboardOverviewResponse,
  DashboardPropertyTypeSlice,
  DashboardRevenueTrendRange,
  DashboardTask,
} from "@/types/dashboard";
import {
  Building2,
  Home,
  Users,
  DollarSign,
  Wrench,
  AlertTriangle,
  Calendar,
  CreditCard,
  FileText,
  Activity,
  Target,
  PieChart,
  LineChart,
  Download,
  BarChart3,
  ChevronRight,
  UserCheck,
  ClipboardList,
  TrendingUp,
  TrendingDown,
  Wallet,
} from "lucide-react";
import {
  PieChart as RechartsPieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
} from "recharts";
import { useAuthorization } from "@/hooks/useAuthorization";
import { FeatureGate } from "@/components/billing/feature-gate";
import {
  ModuleUpgradeCard,
  useModuleAccess,
} from "@/components/layout/module-access";
import { businessToday } from "@/lib/dates/business-day";

const getActivityIcon = (type: string) => {
  switch (type) {
    case "payment":
      return DollarSign;
    case "maintenance":
      return Wrench;
    case "lease":
      return FileText;
    case "event":
      return Calendar;
    case "application":
      return UserCheck;
    default:
      return Activity;
  }
};

const getActivityColor = (type: string, status?: string) => {
  if (status === "paid") return "text-success";
  if (status === "pending") return "text-warning";
  if (status === "sent") return "text-info";
  if (status === "overdue") return "text-error";

  switch (type) {
    case "payment":
      return "text-success";
    case "maintenance":
      return "text-warning";
    case "lease":
      return "text-primary";
    case "event":
      return "text-info";
    case "application":
      return "text-info";
    default:
      return "text-muted-foreground";
  }
};

const getPriorityColor = (priority: string) => {
  switch (priority) {
    case "high":
      return "text-error";
    case "urgent":
      return "text-error";
    case "medium":
      return "text-warning";
    case "low":
      return "text-success";
    default:
      return "text-muted-foreground";
  }
};

const getAlertStyles = (type: string) => {
  switch (type) {
    case "payment":
      return {
        rail: "before:bg-warning",
        bg: "bg-warning/[0.07] hover:bg-warning/[0.11]",
        iconColor: "text-warning",
        textColor: "text-foreground",
      };
    case "maintenance":
      return {
        rail: "before:bg-error",
        bg: "bg-error/[0.07] hover:bg-error/[0.11]",
        iconColor: "text-error",
        textColor: "text-foreground",
      };
    case "lease":
      return {
        rail: "before:bg-info",
        bg: "bg-info/[0.07] hover:bg-info/[0.11]",
        iconColor: "text-info",
        textColor: "text-foreground",
      };
    default:
      return {
        rail: "before:bg-primary",
        bg: "bg-primary/[0.06] hover:bg-primary/[0.1]",
        iconColor: "text-primary",
        textColor: "text-foreground",
      };
  }
};

const REVENUE_TREND_OPTIONS: Array<{
  value: DashboardRevenueTrendRange;
  label: string;
}> = [
  { value: "7d", label: "7 Days" },
  { value: "30d", label: "30 Days" },
  { value: "12m", label: "12 Months" },
  { value: "lastYear", label: "Last Year" },
];

/**
 * A card is shown only when the screen it opens is in the package and open
 * to the reader: a card that leads to an upgrade card is a number about a
 * module the office has not bought.
 */
function GatedAnalyticsCard(props: React.ComponentProps<typeof AnalyticsCard>) {
  const { canOpen } = useModuleAccess();
  if (props.href && !canOpen(props.href)) return null;
  return <AnalyticsCard {...props} />;
}

/** The report each alert opens — its count is that report's rows. */
const ALERT_TARGETS: Record<string, string> = {
  payment: "/dashboard/payments/reports?type=overdue",
  maintenance: "/dashboard/maintenance/emergency",
  lease: "/dashboard/leases/reports?type=expiring-soon",
  tenant: "/dashboard/tenants/applications",
};

/** The screen an activity line belongs to, when it carries no link. */
const ACTIVITY_PAGES: Record<string, string> = {
  payment: "/dashboard/payments",
  maintenance: "/dashboard/maintenance",
  lease: "/dashboard/leases",
  event: "/dashboard/calendar",
  application: "/dashboard/tenants/applications",
};

/** Where an upcoming task opens (see handleTaskClick). */
function taskTarget(task: DashboardTask): string {
  if (task.id.startsWith("lease-")) {
    return `/dashboard/leases/${task.id.replace("lease-", "")}`;
  }
  if (task.id.startsWith("maintenance-")) {
    return `/dashboard/maintenance/${task.id.replace("maintenance-", "")}`;
  }
  if (task.type === "lease_renewal") {
    return "/dashboard/leases/reports?type=expiring-soon";
  }
  if (task.type === "maintenance") return "/dashboard/maintenance";
  return "/dashboard/calendar";
}

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const { isTenant, isOwner, isCompanyStaff } = useAuthorization();
  // What the package opens: cards, alerts, actions and feed lines for a
  // module it leaves out are not drawn.
  const {
    canOpen,
    planIncludes,
    isPlatformOff,
    feedLoaded: modulesLoaded,
  } = useModuleAccess();
  const [dashboardData, setDashboardData] =
    useState<DashboardOverviewResponse | null>(null);
  const [selectedTrendRange, setSelectedTrendRange] =
    useState<DashboardRevenueTrendRange>("30d");
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const user = session?.user;
  const isDashboardAuthorized = isCompanyStaff;

  const loadDashboardData = useCallback(
    async ({ isRefresh = false }: { isRefresh?: boolean } = {}) => {
      if (!isDashboardAuthorized) {
        setError(null);
        setDashboardData(null);
        if (isRefresh) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
        return;
      }

      if (isRefresh) {
        setIsRefreshing(true);
      } else {
        setIsLoading(true);
      }

      setError(null);

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

        const response = await fetch("/api/dashboard/overview", {
          signal: controller.signal,
          cache: "no-store",
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
          const errorText = await response.text().catch(() => "Unknown error");
          throw new Error(
            `Dashboard load failed: ${response.status} ${errorText}`,
          );
        }

        const payload = await response.json();
        const data = (payload?.data ?? payload) as DashboardOverviewResponse;

        if (!data?.overview) {
          throw new Error("Invalid dashboard response format");
        }

        setDashboardData(data);
      } catch (err) {
        // Ignore errors from aborted requests
        if (err instanceof Error && err.name === "AbortError") {
          return;
        }

        setError(
          err instanceof Error
            ? err.message
            : t("dashboard.errors.overview", { defaultValue: "Could not load the dashboard" }),
        );
      } finally {
        if (isRefresh) {
          setIsRefreshing(false);
        } else {
          setIsLoading(false);
        }
      }
    },
    [isDashboardAuthorized],
  );

  useEffect(() => {
    if (status !== "authenticated") {
      return;
    }

    if (!isDashboardAuthorized) {
      setIsLoading(false);
      return;
    }

    loadDashboardData();
  }, [status, isDashboardAuthorized, loadDashboardData]);

  const { t, formatCurrency, formatPercentage, formatDate, language } =
    useLocalizationContext();
  // Category names in the reader's language, the organization's own included.
  const { labelFor: propertyTypeLabel } = usePropertyCategories("property", {
    activeOnly: false,
  });

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return t("dashboard.greeting.morning");
    if (hour < 17) return t("dashboard.greeting.afternoon");
    return t("dashboard.greeting.evening");
  };

  // The feed's lines arrive as parts; worded here so they follow the language.
  const activityText = (activity: DashboardActivity) => {
    const parts = activity.parts;
    if (!parts) return activity.description;
    const stored = (value: string) =>
      t(`exports.value.${value}`, { defaultValue: value.replace(/_/g, " ") });
    const place =
      parts.place ??
      t("dashboard.recentActivity.portfolio", { defaultValue: "Portfolio" });
    switch (activity.type) {
      case "payment":
        return t("dashboard.recentActivity.paid", {
          defaultValue: "{party} paid {kind} for {place}",
          values: { party: parts.party ?? "", kind: stored(parts.kind ?? "rent"), place },
        });
      case "maintenance":
        return t("dashboard.recentActivity.maintenanceAt", {
          defaultValue: "{title} at {place}",
          values: {
            title:
              parts.title ??
              t("dashboard.recentActivity.maintenanceRequest", {
                defaultValue: "Maintenance request",
              }),
            place,
          },
        });
      case "lease":
        return parts.kind
          ? t("dashboard.recentActivity.leaseStatus", {
              defaultValue: "{party} lease {kind} at {place}",
              values: { party: parts.party ?? "", kind: stored(parts.kind), place },
            })
          : activity.description;
      default:
        return activity.description;
    }
  };

  // Task lines arrive as parts too: a renewal names the tenant and building,
  // a maintenance follow-up the request and building, an event its title.
  const taskText = (task: DashboardTask) => {
    const parts = task.parts;
    if (!parts) return task.title;
    const place =
      parts.place ??
      t("dashboard.recentActivity.portfolio", { defaultValue: "Portfolio" });
    switch (task.type) {
      case "lease_renewal":
        return t("dashboard.tasks.leaseRenewal", {
          defaultValue: "Lease renewal — {party} ({place})",
          values: {
            party:
              parts.party ??
              t("dashboard.tasks.unknownTenant", {
                defaultValue: "Unknown tenant",
              }),
            place,
          },
        });
      case "maintenance":
        return t("dashboard.tasks.maintenance", {
          defaultValue: "{title} ({place})",
          values: {
            title:
              parts.title ??
              t("dashboard.tasks.maintenanceFollowUp", {
                defaultValue: "Maintenance follow-up",
              }),
            place,
          },
        });
      default:
        return (
          parts.title ?? t("dashboard.tasks.event", { defaultValue: "Event" })
        );
    }
  };

  // A building type by its category's name in the reader's language.
  const propertyTypeName = (slice: DashboardPropertyTypeSlice) => {
    if (!slice.type) return slice.name;
    const named = propertyTypeLabel(slice.type);
    if (named && named !== slice.type) return named;
    return t(`properties.type.${slice.type}`, { defaultValue: slice.name });
  };

  const formatTimeAgo = (input?: Date | string | null) => {
    if (!input) {
      return t("dashboard.time.justNow");
    }

    const date = typeof input === "string" ? new Date(input) : input;
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      return t("dashboard.time.justNow");
    }

    const now = new Date();
    const diffInMinutes = Math.floor(
      (now.getTime() - date.getTime()) / (1000 * 60),
    );

    if (diffInMinutes < 60) {
      return t("dashboard.time.minutesAgo", {
        values: { count: diffInMinutes },
      });
    }

    if (diffInMinutes < 1440) {
      return t("dashboard.time.hoursAgo", {
        values: { count: Math.floor(diffInMinutes / 60) },
      });
    }

    return t("dashboard.time.daysAgo", {
      values: { count: Math.floor(diffInMinutes / 1440) },
    });
  };

  const getPriorityLabel = (priority: string) => {
    if (!priority) return "";
    return t(`dashboard.priority.${priority}`, {
      defaultValue: priority,
    });
  };

  const handleExport = useCallback(async () => {
    try {
      setIsRefreshing(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for export

      const response = await fetch("/api/dashboard/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          format: "json",
          includeDetails: false,
          dateRange: {
            start: new Date(new Date().getFullYear(), 0, 1).toISOString(),
            end: new Date().toISOString(),
          },
        }),
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorText = await response.text().catch(() => "Unknown error");
        throw new Error(`Export failed: ${response.status} ${errorText}`);
      }

      const result = await response.json();

      if (!result.data) {
        throw new Error("Invalid export data received");
      }

      const blob = new Blob([JSON.stringify(result.data, null, 2)], {
        type: "application/json",
      });

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `dashboard-export-${businessToday()}.json`;

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      // Ignore errors from aborted requests
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      setError(
        error instanceof Error
          ? error.message
          : t("dashboard.errors.export", { defaultValue: "The export failed" }),
      );
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  // Navigation handlers for alert cards. Each opens the report whose rows
  // make up its count: overdue installments, contracts ending in 30 days.
  const handleAlertClick = useCallback(
    (alertType: string) => {
      const target = ALERT_TARGETS[alertType];
      if (target) router.push(target);
    },
    [router],
  );

  // Navigation handler for upcoming tasks
  const handleTaskClick = useCallback(
    (task: DashboardTask) => router.push(taskTarget(task)),
    [router],
  );

  if (isOwner) {
    // An owner's dashboard *is* their portfolio — the staff overview below
    // would be a wall of numbers about buildings that are not theirs, and the
    // API would refuse most of it anyway.
    // The owner portal follows the package like the staff menus do: while
    // it is being read nothing is fetched, and left out it is an upgrade card.
    return (
      <ResponsiveLayout>
        {!modulesLoaded ? (
          <DashboardSkeleton />
        ) : planIncludes("home.portfolio") ? (
          <OwnerPortfolio />
        ) : (
          <ModuleUpgradeCard
            moduleKey="home.portfolio"
            platformOff={isPlatformOff("home.portfolio")}
          />
        )}
      </ResponsiveLayout>
    );
  }

  if (isTenant) {
    // Import the TenantDashboard component dynamically to avoid SSR issues
    const TenantDashboard = dynamic(
      () => import("@/components/tenant/TenantDashboard"),
      {
        ssr: false,
        loading: () => (
          <ResponsiveLayout>
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <div className="h-8 w-64 bg-gray-200 rounded animate-pulse mb-2" />
                  <div className="h-4 w-48 bg-gray-200 rounded animate-pulse" />
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {[...Array(4)].map((_, i) => (
                  <Card key={i}>
                    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                      <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
                      <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
                    </CardHeader>
                    <CardContent>
                      <div className="h-8 w-16 bg-gray-200 rounded animate-pulse mb-1" />
                      <div className="h-3 w-20 bg-gray-200 rounded animate-pulse" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </ResponsiveLayout>
        ),
      },
    );

    return (
      <ResponsiveLayout>
        <TenantDashboard />
      </ResponsiveLayout>
    );
  }

  if (!dashboardData && isLoading) {
    return (
      <ResponsiveLayout>
        <DashboardSkeleton />
      </ResponsiveLayout>
    );
  }

  if (!dashboardData && error) {
    return (
      <ResponsiveLayout className="space-y-6" padding="none">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("dashboard.error.unavailable.title")}</AlertTitle>
          <AlertDescription>
            {t("dashboard.error.unavailable.description", {
              values: { error },
            })}
          </AlertDescription>
        </Alert>
        <Button onClick={() => loadDashboardData()} className="w-min">
          {t("dashboard.actions.retry")}
        </Button>
      </ResponsiveLayout>
    );
  }

  const overview = dashboardData?.overview;
  const maintenance = overview?.maintenanceRequests;
  const payments = overview?.payments;
  const trendByRange = dashboardData?.trends?.revenueByRange;
  const monthlyRevenueTrend =
    trendByRange?.["12m"] && trendByRange["12m"].length > 0
      ? trendByRange["12m"]
      : dashboardData?.trends?.revenue ?? [];
  const selectedRevenueTrend = trendByRange?.[selectedTrendRange] ?? [];
  // Axis labels in the reader's language, from each point's own period —
  // the API's labels are English ("Sep 6", "Oct").
  const chartRevenueTrend = (
    selectedRevenueTrend.length > 0 ? selectedRevenueTrend : monthlyRevenueTrend
  ).map((point) =>
    point.periodStart
      ? {
          ...point,
          month: formatChartLabelFor(
            language,
            point.periodStart,
            point.granularity === "day" ? "day" : "month",
          ),
        }
      : point,
  );
  const propertyDistribution = dashboardData?.propertyTypes ?? [];
  const alerts = dashboardData?.alerts ?? [];
  const recentActivities = (dashboardData?.recentActivities ?? []).filter(
    (activity) =>
      canOpen(activity.href ?? ACTIVITY_PAGES[activity.type] ?? "/dashboard"),
  );
  const upcomingTasks = (dashboardData?.upcomingTasks ?? []).filter((task) =>
    canOpen(taskTarget(task)),
  );

  // As the occupancy report counts them: a unit out of service is neither
  // occupied nor vacant, and is left out of both rates.
  const vacantUnits = overview?.vacantUnits ?? 0;
  const lettableUnits = (overview?.occupiedUnits ?? 0) + vacantUnits;
  const vacancyRate = lettableUnits ? (vacantUnits / lettableUnits) * 100 : 0;

  // Each money card opens its report on the days its figure covers.
  const windows = overview?.windows;
  const reportLink = (path: string, params: Record<string, string | undefined>) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value) query.set(key, value);
    }
    return `${path}?${query}`;
  };
  const paymentsReport = (type: string, startDate?: string, endDate?: string) =>
    reportLink("/dashboard/payments/reports", { type, startDate, endDate });
  // The charts read what Accounting and Collections report, so they follow
  // those modules like the cards that open them.
  const showMoney =
    canOpen("/dashboard/accounting/reports") ||
    canOpen(paymentsReport("collections"));
  const showPaymentStatus =
    canOpen("/dashboard/payments") || canOpen("/dashboard/payments/collection");
  const showPropertyMix = canOpen("/dashboard/properties");
  const occupancyReport = "/dashboard/properties/reports?type=occupancy";

  const latestTrendPoint =
    monthlyRevenueTrend.length > 0
      ? monthlyRevenueTrend[monthlyRevenueTrend.length - 1]
      : null;
  const previousTrendPoint =
    monthlyRevenueTrend.length > 1
      ? monthlyRevenueTrend[monthlyRevenueTrend.length - 2]
      : null;
  const currentRevenueValue =
    latestTrendPoint?.totalRevenue ?? overview?.monthlyRevenue ?? 0;
  const chartRevenueValue = chartRevenueTrend.reduce(
    (sum, point) => sum + (point.totalRevenue || 0),
    0,
  );
  const chartExpenseValue = chartRevenueTrend.reduce(
    (sum, point) => sum + (point.totalExpenses || 0),
    0,
  );
  const revenueTrendDescriptionByRange: Record<
    DashboardRevenueTrendRange,
    string
  > = {
    "7d": t("dashboard.charts.revenueExpenses.description7d", {
      defaultValue: "Daily financial performance (last 7 days)",
    }),
    "30d": t("dashboard.charts.revenueExpenses.description30d", {
      defaultValue: "Daily financial performance (last 30 days)",
    }),
    "12m": t("dashboard.charts.revenueExpenses.description"),
    lastYear: t("dashboard.charts.revenueExpenses.descriptionYear", {
      defaultValue: "Monthly financial performance ({year})",
      values: { year: new Date().getFullYear() - 1 },
    }),
  };
  const revenueTrendDescription =
    revenueTrendDescriptionByRange[selectedTrendRange];
  // The net income card's own figure: this month's revenue less its expenses.
  const netIncome = overview?.monthlyNetIncome ?? 0;
  const outstandingAmount = (payments?.pending ?? 0) + (payments?.overdue ?? 0);
  const previousRevenue = previousTrendPoint?.totalRevenue ?? 0;
  const revenueChangePercent =
    previousRevenue > 0
      ? ((currentRevenueValue - previousRevenue) / previousRevenue) * 100
      : 0;

  const urgentActivityCount = recentActivities.filter(
    (activity) =>
      activity.priority === "high" || activity.priority === "urgent",
  ).length;

  const getAlertTitleText = (alert: DashboardAlert) => {
    switch (alert.id) {
      case "overdue-payments":
        return t("dashboard.alerts.overduePayments.title", {
          defaultValue: alert.title,
        });
      case "urgent-maintenance":
        return t("dashboard.alerts.urgentMaintenance.title", {
          defaultValue: alert.title,
        });
      case "expiring-leases":
        return t("dashboard.alerts.expiringLeases.title", {
          defaultValue: alert.title,
        });
      case "pending-applications":
        return t("dashboard.alerts.pendingApplications.title", {
          defaultValue: alert.title,
        });
      default:
        return alert.title;
    }
  };

  const getAlertMessageText = (alert: DashboardAlert) => {
    const count = alert.count;
    switch (alert.id) {
      case "overdue-payments":
        return t(
          count > 0
            ? "dashboard.alerts.overduePayments.message.withCount"
            : "dashboard.alerts.overduePayments.message.zero",
          {
            defaultValue: alert.message,
            values: { count },
          },
        );
      case "urgent-maintenance":
        return t(
          count > 0
            ? "dashboard.alerts.urgentMaintenance.message.withCount"
            : "dashboard.alerts.urgentMaintenance.message.zero",
          {
            defaultValue: alert.message,
            values: { count },
          },
        );
      case "expiring-leases":
        return t(
          count > 0
            ? "dashboard.alerts.expiringLeases.message.withCount"
            : "dashboard.alerts.expiringLeases.message.zero",
          {
            defaultValue: alert.message,
            values: { count },
          },
        );
      case "pending-applications":
        return t("dashboard.alerts.pendingApplications.message.withCount", {
          defaultValue: alert.message,
          values: { count },
        });
      default:
        return alert.message;
    }
  };

  // Manager/Admin Dashboard
  return (
    <ResponsiveLayout
      className="space-y-6 [&_[data-slot=card]]:border-0"
      padding="none"
    >
      {/* Header Section */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {getGreeting()}, {user?.firstName}!
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("dashboard.header.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
          {canOpen("/dashboard/properties/new") && (
          <Button asChild variant="outline" className="gap-2">
            <Link href="/dashboard/properties/new">
              <Building2 className="h-4 w-4" />
              {t("dashboard.actions.addProperty")}
            </Link>
          </Button>
          )}
          {/* Gated so Free-plan users see why export is unavailable instead of
              a 402 toast. */}
          <FeatureGate feature="data_export" mode="disable">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isRefreshing}
              className="gap-2"
            >
              <Download className="h-4 w-4" />
              {t("reports.actions.export", { defaultValue: "Export" })}
            </Button>
          </FeatureGate>
          {canOpen("/dashboard/accounting/reports") && (
          <Button asChild className="gap-2">
            <Link href="/dashboard/accounting/reports">
              <BarChart3 className="h-4 w-4" />
              {t("dashboard.actions.reports")}
            </Link>
          </Button>
          )}
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{t("dashboard.error.staleData.title")}</AlertTitle>
          <AlertDescription>
            {t("dashboard.error.staleData.description", { values: { error } })}
          </AlertDescription>
        </Alert>
      )}

      {/* Alerts Section - Always show the main 3 alerts */}
      <div className="grid gap-3 md:grid-cols-3">
        {alerts
          .filter((alert) => canOpen(ALERT_TARGETS[alert.type] ?? "/dashboard"))
          .slice(0, 3)
          .map((alert) => {
          const styles = getAlertStyles(alert.type);
          return (
            <button
              type="button"
              key={alert.id}
              className={`relative w-full overflow-hidden rounded-xl px-4 py-3 text-start transition-colors before:absolute before:inset-y-0 before:start-0 before:w-1 before:content-[''] ${styles.rail} ${styles.bg} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              onClick={() => handleAlertClick(alert.type)}
              aria-label={`${getAlertTitleText(alert)}: ${getAlertMessageText(
                alert,
              )}`}
            >
              <div className="flex items-start gap-3">
                <AlertTriangle
                  className={`mt-0.5 h-4 w-4 shrink-0 ${styles.iconColor}`}
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className={`text-sm font-semibold ${styles.textColor}`}>
                      {getAlertTitleText(alert)}
                    </h3>
                    <span
                      className={`ms-auto text-base font-bold ${styles.iconColor}`}
                    >
                      {alert.count}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {getAlertMessageText(alert)}
                  </p>
                </div>
                <ChevronRight
                  className={`mt-0.5 h-4 w-4 shrink-0 rtl:rotate-180 ${styles.iconColor}`}
                />
              </div>
            </button>
          );
        })}
      </div>

      {/* Main KPI Cards — the review's indicators, in its order, then the
          rest. Each opens the report behind it, on the days its figure
          covers, so a number that looks wrong is one click from the rows
          that make it up. */}
      <AnalyticsCardGrid className="auto-rows-fr grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        <GatedAnalyticsCard
          title={t("dashboard.cards.totalProperties.title")}
          value={overview?.totalProperties ?? 0}
          description={t("dashboard.cards.totalProperties.description")}
          icon={Building2}
          iconColor="primary"
          href="/dashboard/properties"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.compounds.title", {
            defaultValue: "Compounds",
          })}
          value={overview?.totalCompounds ?? 0}
          description={t("dashboard.cards.compounds.description", {
            defaultValue: "{units} units in total",
            values: { units: overview?.totalUnits ?? 0 },
          })}
          icon={Building2}
          iconColor="primary"
          href="/dashboard/compounds"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.buildings.title", {
            defaultValue: "Buildings",
          })}
          value={overview?.totalBuildings ?? overview?.totalProperties ?? 0}
          description={t("dashboard.cards.buildings.description", {
            defaultValue: "Units: {units}",
            values: { units: overview?.totalUnits ?? 0 },
          })}
          icon={Building2}
          iconColor="info"
          href="/dashboard/properties"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.units.title", { defaultValue: "Units" })}
          value={overview?.totalUnits ?? 0}
          description={t("dashboard.cards.units.description", {
            defaultValue: "Out of service: {count}",
            values: { count: overview?.maintenanceUnits ?? 0 },
          })}
          icon={Home}
          iconColor="primary"
          href={occupancyReport}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.vacantUnits.title")}
          value={vacantUnits}
          description={t("dashboard.cards.vacantUnits.description", {
            values: { rate: formatPercentage(vacancyRate) },
          })}
          icon={Home}
          iconColor="error"
          href={`${occupancyReport}&occupancy=vacant`}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.occupiedUnits.title", {
            defaultValue: "Occupied units",
          })}
          value={overview?.occupiedUnits ?? 0}
          description={t("dashboard.cards.occupiedUnits.description", {
            defaultValue: "Occupancy {rate}",
            values: { rate: formatPercentage(overview?.occupancyRate ?? 0) },
          })}
          icon={Home}
          iconColor="success"
          href={`${occupancyReport}&occupancy=leased`}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.occupancyRate.title")}
          value={formatPercentage(overview?.occupancyRate ?? 0)}
          description={t("dashboard.cards.occupancyRate.description", {
            values: {
              occupied: overview?.occupiedUnits ?? 0,
              total: lettableUnits,
            },
          })}
          icon={Home}
          iconColor="success"
          href={occupancyReport}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.activeLeases.title", {
            defaultValue: "Active contracts",
          })}
          value={overview?.activeLeases ?? 0}
          description={t("dashboard.cards.activeLeases.description", {
            defaultValue: "{expiring} nearing expiry",
            values: { expiring: overview?.expiringLeases ?? 0 },
          })}
          icon={FileText}
          iconColor="info"
          href="/dashboard/leases/reports?type=active"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.nearingExpiry.title", {
            defaultValue: "Contracts nearing expiry",
          })}
          value={overview?.expiringLeases ?? 0}
          description={t("dashboard.cards.nearingExpiry.description", {
            defaultValue: "Ending in the next 30 days",
          })}
          icon={FileText}
          iconColor="warning"
          href="/dashboard/leases/reports?type=expiring-soon"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.overdueAmount.title", {
            defaultValue: "Overdue",
          })}
          value={formatCurrency(overview?.payments?.overdue ?? 0)}
          description={t("dashboard.cards.overdueAmount.installments", {
            defaultValue: "Installments: {count}",
            values: { count: overview?.payments?.overdueCount ?? 0 },
          })}
          icon={AlertTriangle}
          iconColor={
            (overview?.payments?.overdue ?? 0) > 0 ? "error" : "info"
          }
          href={paymentsReport("overdue", undefined, windows?.today)}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.duePayments.title", {
            defaultValue: "Due",
          })}
          value={formatCurrency(overview?.payments?.pending ?? 0)}
          description={t("dashboard.cards.duePayments.window", {
            defaultValue: "Installments: {count}, due by {date}",
            values: {
              count: overview?.payments?.pendingCount ?? 0,
              date: windows?.monthEnd ? formatDate(windows.monthEnd) : "—",
            },
          })}
          icon={Wallet}
          iconColor="warning"
          href={paymentsReport("outstanding", windows?.today, windows?.monthEnd)}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.monthlyRevenue.title")}
          value={formatCurrency(overview?.monthlyRevenue ?? 0)}
          description={t("dashboard.cards.monthlyRevenue.description")}
          icon={DollarSign}
          iconColor="success"
          href={paymentsReport("collections", windows?.monthStart, windows?.today)}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.expenses.title", {
            defaultValue: "Expenses",
          })}
          value={formatCurrency(overview?.monthlyExpenses ?? 0)}
          description={t("dashboard.cards.expenses.description", {
            defaultValue: "This month",
          })}
          icon={TrendingDown}
          iconColor="error"
          href={paymentsReport(
            "expenses-by-building",
            windows?.monthStart,
            windows?.today,
          )}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.netIncome.title", {
            defaultValue: "Net income",
          })}
          value={formatCurrency(overview?.monthlyNetIncome ?? 0)}
          description={t("dashboard.cards.netIncome.description", {
            defaultValue: "Revenue less expenses, this month",
          })}
          icon={Wallet}
          iconColor={
            (overview?.monthlyNetIncome ?? 0) >= 0 ? "success" : "error"
          }
          href="/dashboard/accounting/reports?range=this-month"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.collectionRate.title")}
          value={formatPercentage(overview?.collectionRate ?? 0)}
          description={t("dashboard.cards.collectionRate.description")}
          icon={Target}
          iconColor="info"
          href={reportLink("/dashboard/payments/collection", {
            startDate: windows?.monthStart,
            endDate: windows?.monthEnd,
          })}
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.activeTenants.title")}
          value={overview?.activeTenants ?? 0}
          description={t("dashboard.cards.activeTenants.description", {
            values: { count: overview?.pendingApplications ?? 0 },
          })}
          icon={Users}
          iconColor="primary"
          href="/dashboard/tenants"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.maintenanceRequests.title")}
          value={maintenance?.open ?? 0}
          description={t("dashboard.cards.maintenanceRequests.description", {
            values: { count: maintenance?.urgent ?? 0 },
          })}
          icon={Wrench}
          iconColor="warning"
          href="/dashboard/properties/reports?type=maintenance"
        />
        <GatedAnalyticsCard
          title={t("dashboard.cards.averageRent.title")}
          value={formatCurrency(overview?.averageRent ?? 0)}
          description={t("dashboard.cards.averageRent.description")}
          icon={DollarSign}
          iconColor="success"
          href="/dashboard/leases/reports?type=active"
        />
        <GatedAnalyticsCard
          title={t("dashboard.recentActivity.title")}
          value={recentActivities.length}
          description={t("dashboard.cards.recentEvents.description", {
            values: { count: urgentActivityCount },
          })}
          icon={Activity}
          iconColor="info"
        />
      </AnalyticsCardGrid>

      {/* Main Content Grid */}
      <div className="grid min-w-0 gap-6 lg:grid-cols-3">
        {/* Left Column - Charts and Analytics */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* Revenue & Expenses Trends */}
          {showMoney && (
          <Card className="min-w-0">
            <CardHeader>
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <LineChart className="h-5 w-5 text-primary" />
                    {t("dashboard.charts.revenueExpenses.title")}
                  </CardTitle>
                  <CardDescription className="text-muted-foreground">
                    {revenueTrendDescription}
                  </CardDescription>
                </div>
                <div className="w-full sm:w-auto">
                  <div className="grid w-full grid-cols-2 gap-1 rounded-md border border-border bg-muted/30 p-1 sm:inline-flex sm:w-auto">
                    {REVENUE_TREND_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelectedTrendRange(option.value)}
                        className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                          selectedTrendRange === option.value
                            ? "bg-primary/10 text-primary shadow-sm ring-1 ring-primary/15"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                        aria-pressed={selectedTrendRange === option.value}
                      >
                        {t(`dashboard.trendRange.${option.value}`, {
                          defaultValue: option.label,
                        })}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="min-w-0">
              {/* Legend */}
              <div className="mb-6 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#10b981]"></div>
                  <span className="text-sm text-muted-foreground">
                    {t("dashboard.charts.revenueExpenses.legend.revenue")}
                  </span>
                  <span className="text-lg font-semibold">
                    {formatCurrency(chartRevenueValue)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[#f59e0b]"></div>
                  <span className="text-sm text-muted-foreground">
                    {t("dashboard.charts.revenueExpenses.legend.expenses")}
                  </span>
                  <span className="text-lg font-semibold">
                    {formatCurrency(chartExpenseValue)}
                  </span>
                </div>
              </div>

              <ResponsiveContainer width="100%" height={300}>
                <AreaChart data={chartRevenueTrend}>
                  <defs>
                    <linearGradient
                      id="incomeGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop
                        offset="95%"
                        stopColor="#10b981"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                    <linearGradient
                      id="expenseGradient"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                      <stop
                        offset="95%"
                        stopColor="#f59e0b"
                        stopOpacity={0.05}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="var(--border)"
                    strokeOpacity={0.65}
                  />
                  <XAxis
                    dataKey="month"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    minTickGap={selectedTrendRange === "30d" ? 20 : 10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 12, fill: "#64748b" }}
                    tickFormatter={(value) => `${value / 1000}k`}
                  />
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (active && payload && payload.length) {
                        return (
                          <div className="rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg">
                            <p className="text-sm font-medium mb-2">{label}</p>
                            {payload.map((entry, index) => (
                              <div
                                key={index}
                                className="flex items-center gap-2 text-sm"
                              >
                                <div
                                  className="w-2 h-2 rounded-full"
                                  style={{ backgroundColor: entry.color }}
                                ></div>
                                <span className="text-muted-foreground">
                                  {entry.name}:
                                </span>
                                <span className="font-semibold">
                                  {formatCurrency(entry.value as number)}
                                </span>
                              </div>
                            ))}
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalRevenue"
                    stroke="#10b981"
                    strokeWidth={2}
                    fill="url(#incomeGradient)"
                    name={t("dashboard.charts.revenueExpenses.legend.revenue")}
                    dot={false}
                  />
                  <Area
                    type="monotone"
                    dataKey="totalExpenses"
                    stroke="#f59e0b"
                    strokeWidth={2}
                    fill="url(#expenseGradient)"
                    name={t("dashboard.charts.revenueExpenses.legend.expenses")}
                    dot={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          )}

          {/* Financial Summary */}
          {showMoney && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                {t("dashboard.financialSummary.title")}
              </CardTitle>
              <CardDescription>
                {t("dashboard.financialSummary.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 divide-y divide-border sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                {/* Net Income */}
                <div className="min-w-0 px-4 py-5 text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("dashboard.financialSummary.netIncome")}
                  </div>
                  <div
                    className={`text-xl font-bold ${
                      netIncome >= 0 ? "text-success" : "text-error"
                    }`}
                  >
                    {formatCurrency(netIncome)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("dashboard.financialSummary.thisMonth")}
                  </div>
                </div>

                {/* Outstanding */}
                <div className="min-w-0 px-4 py-5 text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("dashboard.financialSummary.outstanding")}
                  </div>
                  <div className="text-xl font-bold text-warning">
                    {formatCurrency(outstandingAmount)}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("dashboard.financialSummary.pendingAndOverdue", {
                      values: {
                        pending: payments?.pendingCount ?? 0,
                        overdue: payments?.overdueCount ?? 0,
                      },
                    })}
                  </div>
                </div>

                {/* Month-over-Month */}
                <div className="min-w-0 px-4 py-5 text-center">
                  <div className="text-xs text-muted-foreground mb-1">
                    {t("dashboard.financialSummary.monthOverMonth")}
                  </div>
                  <div
                    className={`text-xl font-bold flex items-center justify-center gap-1 ${
                      revenueChangePercent >= 0 ? "text-success" : "text-error"
                    }`}
                  >
                    {revenueChangePercent >= 0 ? (
                      <TrendingUp className="h-4 w-4" />
                    ) : (
                      <TrendingDown className="h-4 w-4" />
                    )}
                    {formatPercentage(Math.abs(revenueChangePercent))}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {t("dashboard.financialSummary.vsLastMonth")}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          )}

          {/* Property Type Distribution and Payment Status */}
          <div className="grid items-start gap-6 md:grid-cols-2">
            {/* Property Distribution */}
            {showPropertyMix && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <PieChart className="h-5 w-5 text-primary" />
                  {t("dashboard.charts.propertyDistribution.title")}
                </CardTitle>
                <CardDescription className="text-muted-foreground">
                  {t("dashboard.charts.propertyDistribution.description")}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="relative">
                  <ResponsiveContainer width="100%" height={250}>
                    <RechartsPieChart>
                      <Pie
                        data={propertyDistribution as any}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={90}
                        paddingAngle={2}
                        dataKey="value"
                        stroke="none"
                      >
                        {propertyDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (active && payload && payload.length) {
                            const data = payload[0].payload;
                            const percentage = overview?.totalProperties
                              ? Math.round(
                                  (data.value / overview.totalProperties) * 100,
                                )
                              : 0;
                            return (
                              <div className="rounded border border-border bg-popover p-2 text-popover-foreground shadow-lg">
                                <p className="text-sm font-medium">
                                  {propertyTypeName(data)}: {data.value} ({percentage}%)
                                </p>
                              </div>
                            );
                          }
                          return null;
                        }}
                      />
                    </RechartsPieChart>
                  </ResponsiveContainer>

                  {/* Center Total */}
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-xs text-muted-foreground">
                        {t("dashboard.charts.propertyDistribution.total")}
                      </div>
                      <div className="text-2xl font-bold">
                        {overview?.totalProperties ?? 0}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Legend */}
                <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 mt-4">
                  {propertyDistribution.map((entry, index) => (
                    <div key={index} className="flex items-center gap-1.5">
                      <div
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: entry.color }}
                      ></div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {propertyTypeName(entry)}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
            )}

            {/* Payment Status */}
            {showPaymentStatus && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-success" />
                  {t("dashboard.paymentStatus.title")}
                </CardTitle>
                <CardDescription>
                  {t("dashboard.paymentStatus.description")}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t("dashboard.paymentStatus.collected")}
                    </span>
                    <span className="text-sm font-bold text-success">
                      {formatCurrency(payments?.collected ?? 0)}
                    </span>
                  </div>
                  {/* Of this month's installments, the share collected —
                      the collection rate card's figure. */}
                  <Progress
                    value={Math.min(overview?.collectionRate ?? 0, 100)}
                    className="h-2"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="text-center p-3 bg-warning/10 rounded-lg">
                    <div className="text-lg font-bold text-warning">
                      {formatCurrency(payments?.pending ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("dashboard.paymentStatus.pending")}
                    </div>
                  </div>
                  <div className="text-center p-3 bg-error/10 rounded-lg">
                    <div className="text-lg font-bold text-error">
                      {formatCurrency(payments?.overdue ?? 0)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t("dashboard.paymentStatus.overdue")}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            )}
          </div>
        </div>

        {/* Right Column - Activities and Tasks */}
        <div className="min-w-0 space-y-6">
          {/* Recent Activities */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  {t("dashboard.recentActivity.title")}
                </CardTitle>
              </div>
              <CardDescription>
                {t("dashboard.recentActivity.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="-mx-2 divide-y divide-border/70">
                {recentActivities.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {t("dashboard.recentActivity.empty")}
                  </p>
                )}
                {recentActivities.slice(0, 4).map((activity) => {
                  const IconComponent = getActivityIcon(activity.type);
                  const activityContent = (
                    <>
                      <div
                        className={`p-2 rounded-lg bg-muted ${getActivityColor(
                          activity.type,
                          activity.status,
                        )}`}
                      >
                        <IconComponent className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">
                          {activityText(activity)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-xs text-muted-foreground">
                            {formatTimeAgo(activity.timestamp)}
                          </span>
                          {activity.amount && (
                            <Badge variant="outline" className="text-xs">
                              {formatCurrency(activity.amount)}
                            </Badge>
                          )}
                          {activity.priority && (
                            <Badge
                              variant="outline"
                              className={`text-xs ${getPriorityColor(
                                activity.priority,
                              )}`}
                            >
                              {getPriorityLabel(activity.priority)}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {activity.href && (
                        <ChevronRight className="mt-2 h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                      )}
                    </>
                  );

                  return activity.href ? (
                    <Link
                      key={activity.id}
                      href={activity.href}
                      className="flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {activityContent}
                    </Link>
                  ) : (
                    <div
                      key={activity.id}
                      className="flex items-start gap-3 px-2 py-3"
                    >
                      {activityContent}
                    </div>
                  );
                })}
              </div>
              {recentActivities.length > 4 && (
                <div className="mt-3 border-t border-border/70 pt-3">
                  <Link
                    href="/dashboard/notifications"
                    className="inline-flex items-center gap-1 text-sm font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("dashboard.recentActivity.viewAll")}
                    <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Upcoming Tasks */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <ClipboardList className="h-5 w-5 text-warning" />
                  {t("dashboard.tasks.title")}
                </CardTitle>
              </div>
              <CardDescription>
                {t("dashboard.tasks.description")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="-mx-2 divide-y divide-border/70">
                {upcomingTasks.length === 0 && (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    {t("dashboard.tasks.empty")}
                  </p>
                )}
                {upcomingTasks.slice(0, 4).map((task) => {
                  const dueDate = new Date(task.dueDate);
                  const dueDateLabel = Number.isNaN(dueDate.getTime())
                    ? t("dashboard.tasks.datePending")
                    : formatDate(dueDate, { format: "medium" });

                  return (
                    <button
                      type="button"
                      key={task.id}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-3 text-start transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => handleTaskClick(task)}
                      aria-label={`${taskText(task)}, ${dueDateLabel}`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium leading-tight">
                          {taskText(task)}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <Calendar className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">
                            {dueDateLabel}
                          </span>
                          <Badge
                            variant="outline"
                            className={`text-xs ${getPriorityColor(
                              task.priority,
                            )}`}
                          >
                            {getPriorityLabel(task.priority)}
                          </Badge>
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground rtl:rotate-180" />
                    </button>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </ResponsiveLayout>
  );
}
