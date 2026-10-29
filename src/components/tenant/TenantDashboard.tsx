/**
 * PropertyPro - Tenant Dashboard Component
 * Minimal tenant overview with key stats and recent activity
 */

"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useSession } from "@/lib/auth-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import LeaseSelector from "./LeaseSelector";
import {
  Home,
  DollarSign,
  Calendar,
  Bell,
  RefreshCw,
  AlertTriangle,
  Building2,
  MapPin,
  Settings,
} from "lucide-react";

interface TenantDashboardData {
  tenant: {
    _id: string;
    userId: any;
  };
  currentLease: any;
  allLeases: any[];
  hasMultipleLeases: boolean;
  recentPayments: any[];
  upcomingPayments: any[];
  maintenanceRequests: any[];
  notifications: any[];
  summary: {
    totalLeases: number;
    activeLeases: number;
    upcomingLeases: number;
    expiredLeases: number;
    totalPayments: number;
    paidPayments: number;
    overduePayments: number;
    openMaintenanceRequests: number;
    unreadNotifications: number;
  };
}

interface TenantDashboardProps {
  className?: string;
}

interface ActivityItem {
  id: string;
  title: string;
  description: string;
  date: string;
  type: "notification" | "maintenance";
}
import { formatCurrency } from "@/lib/utils/formatting";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useModuleAccess } from "@/components/layout/module-access";

export default function TenantDashboard({ className }: TenantDashboardProps) {
  const { data: session } = useSession();
  const { t, formatDate: formatLocalizedDate } = useLocalizationContext();
  const [dashboardData, setDashboardData] =
    useState<TenantDashboardData | null>(null);
  const [selectedLeaseId, setSelectedLeaseId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  // The tenant's portal follows the office's package: a module it leaves out
  // has no card here, as it has no entry in the menu.
  const { canOpen } = useModuleAccess();
  const showLeases = canOpen("/dashboard/leases/my-leases");
  const showPayments = canOpen("/dashboard/payments/pay-rent");
  const showMaintenance = canOpen("/dashboard/maintenance/my-requests");

  useEffect(() => {
    if (session?.user) {
      fetchDashboardData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  useEffect(() => {
    if (dashboardData && !selectedLeaseId) {
      if (dashboardData.currentLease) {
        setSelectedLeaseId(dashboardData.currentLease?._id ?? "");
      } else if (dashboardData.allLeases?.length) {
        setSelectedLeaseId(dashboardData.allLeases?.[0]?._id ?? "");
      }
    }
  }, [dashboardData, selectedLeaseId]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/tenant/dashboard");
      const data = await response.json();

      if (data?.success) {
        setDashboardData(data?.data);
      } else {
        toast.error(t("dashboard.tenant.failedToLoad"));
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
      toast.error(t("dashboard.tenant.failedToLoad"));
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchDashboardData();
    setRefreshing(false);
    toast.success(t("dashboard.tenant.dashboardRefreshed"));
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatDate = (date: string | Date | undefined | null) => {
    if (!date) return "—";
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return "—";
    }
    return formatLocalizedDate(parsed, { format: "medium" });
  };

  const translateMaintenanceStatus = (status?: string) => {
    if (!status) return "";
    const s = status.toString().toLowerCase();
    const key = s === "in_progress" ? "inProgress" : s;
    return t(`maintenance.status.${key}`, {
      defaultValue: status.toString().replace(/_/g, " "),
    });
  };

  const translatePaymentStatus = (status?: string) => {
    const s = (status || "").toLowerCase();
    switch (s) {
      case "paid":
        return t("payments.payRent.status.paid");
      case "pending":
        return t("payments.payRent.status.pending");
      case "overdue":
        return t("payments.payRent.status.overdue");
      case "failed":
        return t("payments.payRent.status.failed");
      default:
        return t("payments.detail.overview.notSpecified");
    }
  };

  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t("dashboard.greeting.morning")
    : hour < 18
      ? t("dashboard.greeting.afternoon")
      : t("dashboard.greeting.evening");

  const formatAddress = (address: any) => {
    if (!address) return null;
    if (typeof address === "string") return address;
    if (typeof address === "object") {
      const { street, city, state, zipCode } = address;
      return [street, city, state, zipCode].filter(Boolean).join(", ");
    }
    return null;
  };

  const getStatusBadge = (status?: string) => {
    const normalized = status?.toLowerCase?.() ?? "active";

    const statusConfig: Record<
      string,
      {
        variant: "default" | "secondary" | "outline" | "destructive";
        color: string;
        labelKey: string;
      }
    > = {
      active: {
        variant: "default",
        color: "bg-green-500",
        labelKey: "dashboard.tenant.status.active",
      },
      expired: {
        variant: "secondary",
        color: "bg-gray-500",
        labelKey: "dashboard.tenant.status.expired",
      },
      upcoming: {
        variant: "outline",
        color: "bg-blue-500",
        labelKey: "dashboard.tenant.status.upcoming",
      },
      terminated: {
        variant: "destructive",
        color: "bg-red-500",
        labelKey: "dashboard.tenant.status.terminated",
      },
    };

    const config = statusConfig[normalized] ?? statusConfig.active;

    return (
      <Badge variant={config.variant} className="flex items-center gap-1">
        <span className={`inline-block h-2 w-2 rounded-full ${config.color}`} />
        {t(config.labelKey)}
      </Badge>
    );
  };

  const getSelectedLease = () => {
    if (!dashboardData || !selectedLeaseId) return null;
    return (
      dashboardData.allLeases?.find((lease) => lease._id === selectedLeaseId) ||
      dashboardData.currentLease
    );
  };

  const selectedLease = getSelectedLease();

  const activityItems: ActivityItem[] = useMemo(() => {
    if (!dashboardData) return [];

    const fallbackDate = new Date().toISOString();

    const notifications = (dashboardData.notifications ?? []).map(
      (notification, index) => ({
        id: notification?._id ?? `notification-${index}`,
        title:
          notification?.title ||
          t("dashboard.tenant.activityType.notification"),
        description: notification?.message || "",
        date:
          notification?.createdAt ??
          notification?.updatedAt ??
          fallbackDate,
        type: "notification" as const,
      })
    );

    const maintenance = (
      showMaintenance ? dashboardData.maintenanceRequests ?? [] : []
    ).map(
      (request, index) => ({
        id: request?._id ?? `maintenance-${index}`,
        title: request?.title || t("dashboard.tenant.activityType.maintenance"),
        description: request?.status
          ? `${t(
              "maintenance.table.headers.status"
            )}: ${translateMaintenanceStatus(request.status)}`
          : "",
        date:
          request?.updatedAt ?? request?.createdAt ?? fallbackDate,
        type: "maintenance" as const,
      })
    );

    return [...notifications, ...maintenance]
      .filter((item) => !!item.date)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 6);
  }, [dashboardData, showMaintenance]);

  if (loading) {
    return <TenantDashboardSkeleton />;
  }

  if (!dashboardData) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-2">
            {t("dashboard.tenant.unableToLoad")}
          </h3>
          <p className="text-muted-foreground mb-4">
            {t("dashboard.tenant.loadError")}
          </p>
          <Button onClick={fetchDashboardData}>
            <RefreshCw className="h-4 w-4 me-2" />
            {t("dashboard.tenant.tryAgain")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className ?? ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            {session?.user?.firstName
              ? `${greeting}, ${session.user.firstName}!`
              : `${greeting}!`}
          </h1>
          <p className="text-muted-foreground">
            {t("dashboard.tenant.welcome")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {showLeases && dashboardData?.hasMultipleLeases && (
            <LeaseSelector
              leases={dashboardData?.allLeases ?? []}
              selectedLeaseId={selectedLeaseId}
              onLeaseChange={setSelectedLeaseId}
              variant="compact"
              className="w-72"
            />
          )}

          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw
              className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            {t("dashboard.actions.refresh")}
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <AnalyticsCardGrid className="md:grid-cols-2 lg:grid-cols-4">
        {showLeases && (
          <AnalyticsCard
            title={t("dashboard.tenant.activeLeases")}
            value={dashboardData.summary?.activeLeases ?? 0}
            description={t("dashboard.tenant.totalLeases", {
              values: { count: dashboardData.summary?.totalLeases ?? 0 },
            })}
            icon={Home}
            iconColor="primary"
          />
        )}
        {showPayments && (
          <AnalyticsCard
            title={t("dashboard.tenant.outstandingPayments")}
            value={dashboardData.summary?.overduePayments ?? 0}
            description={t("dashboard.tenant.totalPayments", {
              values: { count: dashboardData.summary?.totalPayments ?? 0 },
            })}
            icon={DollarSign}
            iconColor="warning"
          />
        )}
        {showMaintenance && (
          <AnalyticsCard
            title={t("dashboard.tenant.maintenanceRequests")}
            value={dashboardData.summary?.openMaintenanceRequests ?? 0}
            description={t("dashboard.tenant.openRequests")}
            icon={Settings}
            iconColor="info"
          />
        )}
        <AnalyticsCard
          title={t("dashboard.tenant.notifications")}
          value={dashboardData.summary?.unreadNotifications ?? 0}
          description={t("dashboard.tenant.unreadMessages")}
          icon={Bell}
          iconColor="error"
        />
      </AnalyticsCardGrid>

      {/* Lease Snapshot & Latest Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {showLeases && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                {t("dashboard.tenant.leaseSnapshot")}
              </CardTitle>
              <CardDescription>
                {t("dashboard.tenant.leaseSnapshotDescription")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedLease ? (
                <div className="space-y-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground">
                        {t("dashboard.tenant.property")}
                      </p>
                      <p className="text-lg font-semibold">
                        {selectedLease.propertyId?.name ||
                          t("dashboard.tenant.property")}
                      </p>
                      {formatAddress(selectedLease.propertyId?.address) && (
                        <p className="flex items-center gap-1 text-sm text-muted-foreground">
                          <MapPin className="h-4 w-4" />
                          {formatAddress(selectedLease.propertyId?.address)}
                        </p>
                      )}
                    </div>
                    {getStatusBadge(selectedLease.status)}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        {t("dashboard.tenant.leasePeriod")}
                      </p>
                      <p className="font-medium">
                        {formatDate(selectedLease.startDate)} –{" "}
                        {formatDate(selectedLease.endDate)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        {t("dashboard.tenant.monthlyRent")}
                      </p>
                      <p className="font-medium">
                        {formatCurrency(selectedLease.terms?.rentAmount ?? 0)}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        {t("dashboard.tenant.leaseType")}
                      </p>
                      <p className="font-medium">
                        {selectedLease.propertyId?.type || "—"}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-muted-foreground">
                        {t("dashboard.tenant.leaseId")}
                      </p>
                      <p className="font-medium truncate">{selectedLease._id}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-muted-foreground">
                  {t("dashboard.tenant.noLeaseMessage")}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              {t("dashboard.tenant.latestActivity")}
            </CardTitle>
            <CardDescription>
              {t("dashboard.tenant.latestActivityDescription")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activityItems.length === 0 ? (
              <p className="text-muted-foreground text-center py-4">
                {t("dashboard.tenant.allCaughtUp")}
              </p>
            ) : (
              <div className="space-y-3">
                {activityItems.map((item) => (
                  <div
                    key={item.id}
                    className="border rounded-lg p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <p className="font-medium">{item.title}</p>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(item.date)}
                      </span>
                    </div>
                    {item.description && (
                      <p className="text-sm text-muted-foreground">
                        {item.description}
                      </p>
                    )}
                    <Badge
                      variant="outline"
                      className="w-fit text-xs capitalize"
                    >
                      {t(`dashboard.tenant.activityType.${item.type}`)}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Payment Activity */}
      {showPayments && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                {t("dashboard.tenant.recentPayments")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(dashboardData?.recentPayments?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  {t("dashboard.tenant.noRecentPayments")}
                </p>
              ) : (
                <div className="space-y-3">
                  {dashboardData?.recentPayments?.slice(0, 3)?.map((payment) => (
                    <div
                      key={payment?._id}
                      className="flex items-center justify-between p-3 border rounded-lg"
                    >
                      <div>
                        <p className="font-medium">
                          {formatCurrency(payment?.amount ?? 0)}
                        </p>
                        <p className="text-sm text-muted-foreground">
                          {t("dashboard.tenant.paidOn", {
                            values: {
                              date: formatDate(
                                payment?.paidDate ??
                                  payment?.dueDate ??
                                  new Date()
                              ),
                            },
                          })}
                        </p>
                      </div>
                      <Badge
                        variant={
                          (payment?.status || "").toLowerCase() === "paid"
                            ? "default"
                            : "outline"
                        }
                      >
                        {translatePaymentStatus(payment?.status)}
                      </Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                {t("dashboard.tenant.upcomingPayments")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {(dashboardData?.upcomingPayments?.length ?? 0) === 0 ? (
                <p className="text-muted-foreground text-center py-4">
                  {t("dashboard.tenant.noUpcomingPayments")}
                </p>
              ) : (
                <div className="space-y-3">
                  {dashboardData?.upcomingPayments
                    ?.slice(0, 3)
                    ?.map((payment) => (
                      <div
                        key={payment?._id}
                        className="flex items-center justify-between p-3 border rounded-lg"
                      >
                        <div>
                          <p className="font-medium">
                            {formatCurrency(payment?.amount ?? 0)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {t("dashboard.tenant.dueOn", {
                              values: {
                                date: formatDate(payment?.dueDate ?? new Date()),
                              },
                            })}
                          </p>
                        </div>
                        <Badge variant="outline">
                          {translatePaymentStatus(payment?.status)}
                        </Badge>
                      </div>
                    ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// Loading skeleton component aligned with minimal layout
function TenantDashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Skeleton className="h-8 w-64 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-4" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-8 w-16 mb-1" />
              <Skeleton className="h-3 w-20" />
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <Card key={`snapshot-${i}`}>
            <CardHeader>
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-60" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(2)].map((_, i) => (
          <Card key={`payments-${i}`}>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
