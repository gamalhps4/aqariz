"use client";

import React, { useState } from "react";
import {
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveLayout,
  MobileFirstCard,
  TouchOptimizedButton,
  SwipeableCard,
} from "@/components/layout/responsive-layout";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Building2,
  Users,
  CreditCard,
  Wrench,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Bell,
  ArrowRight,
  Eye,
} from "lucide-react";
import { useIsMobile, useIsTablet } from "@/hooks/use-media-query";

interface DashboardStats {
  totalProperties: number;
  totalTenants: number;
  monthlyRevenue: number;
  pendingIssues: number;
  occupancyRate: number;
  overduePayments: number;
}

interface QuickAction {
  titleKey: string;
  descriptionKey: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  color: string;
  count?: number;
}

interface RecentActivity {
  id: string;
  type: "payment" | "maintenance" | "lease" | "tenant";
  title: string;
  description: string;
  timeUnit: "minutes" | "hours" | "days";
  timeCount: number;
  status: "success" | "warning" | "error" | "info";
  amount?: number;
}

const mockStats: DashboardStats = {
  totalProperties: 24,
  totalTenants: 89,
  monthlyRevenue: 125000,
  pendingIssues: 7,
  occupancyRate: 94.2,
  overduePayments: 3,
};

const quickActions: QuickAction[] = [
  {
    titleKey: "dashboard.mobile.quickActions.addProperty.title",
    descriptionKey: "dashboard.mobile.quickActions.addProperty.description",
    icon: Building2,
    href: "/dashboard/properties/new",
    color: "bg-blue-500",
  },
  {
    titleKey: "dashboard.mobile.quickActions.addTenant.title",
    descriptionKey: "dashboard.mobile.quickActions.addTenant.description",
    icon: Users,
    href: "/dashboard/tenants/new",
    color: "bg-green-500",
  },
  {
    titleKey: "dashboard.mobile.quickActions.collectPayment.title",
    descriptionKey: "dashboard.mobile.quickActions.collectPayment.description",
    icon: CreditCard,
    href: "/dashboard/payments/collect",
    color: "bg-purple-500",
  },
  {
    titleKey: "dashboard.mobile.quickActions.maintenance.title",
    descriptionKey: "dashboard.mobile.quickActions.maintenance.description",
    icon: Wrench,
    href: "/dashboard/maintenance/new",
    color: "bg-orange-500",
    count: 7,
  },
];

const recentActivities: RecentActivity[] = [
  {
    id: "1",
    type: "payment",
    title: "Rent Payment Received",
    description: "John Doe - Apt 101",
    timeUnit: "hours",
    timeCount: 2,
    status: "success",
    amount: 1500,
  },
  {
    id: "2",
    type: "maintenance",
    title: "Maintenance Request",
    description: "Leaky faucet - Apt 205",
    timeUnit: "hours",
    timeCount: 4,
    status: "warning",
  },
  {
    id: "3",
    type: "lease",
    title: "Lease Renewal",
    description: "Sarah Smith - Apt 301",
    timeUnit: "days",
    timeCount: 1,
    status: "info",
  },
  {
    id: "4",
    type: "payment",
    title: "Overdue Payment",
    description: "Mike Johnson - Apt 102",
    timeUnit: "days",
    timeCount: 2,
    status: "error",
    amount: 1200,
  },
];

interface MobileDashboardProps {
  userRole: string;
  userName: string;
}

export function MobileDashboard({ userRole, userName }: MobileDashboardProps) {
  const isMobile = useIsMobile();
  const isTablet = useIsTablet();
  const [selectedFilter, setSelectedFilter] = useState("all");
  const { t, formatCurrency } = useLocalizationContext();

  const hour = new Date().getHours();
  const greeting = hour < 12
    ? t("dashboard.greeting.morning")
    : hour < 18
      ? t("dashboard.greeting.afternoon")
      : t("dashboard.greeting.evening");

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "success":
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case "warning":
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
      case "error":
        return <AlertTriangle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-blue-500" />;
    }
  };

  const getActivityTimeLabel = (activity: RecentActivity) => {
    if (activity.timeUnit === "minutes") {
      return t("dashboard.time.minutesAgo", {
        values: { count: activity.timeCount },
      });
    }
    if (activity.timeUnit === "hours") {
      return t("dashboard.time.hoursAgo", {
        values: { count: activity.timeCount },
      });
    }
    if (activity.timeUnit === "days") {
      return t("dashboard.time.daysAgo", {
        values: { count: activity.timeCount },
      });
    }
    return t("dashboard.time.justNow");
  };

  return (
    <ResponsiveLayout className="pb-20">
      {" "}
      {/* Extra padding for mobile nav */}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {greeting}, {userName}!
          </h1>
          <p className="text-muted-foreground">
            {t("dashboard.mobile.header.subtitle")}
          </p>
        </div>
        <Button variant="outline" size="sm" className="h-10 w-10 p-0">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
      {/* Stats Overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <MobileFirstCard className="text-center">
          <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg mx-auto mb-3">
            <Building2 className="h-6 w-6 text-blue-600" />
          </div>
          <div className="text-2xl font-bold">{mockStats.totalProperties}</div>
          <div className="text-sm text-muted-foreground">
            {t("dashboard.mobile.stats.properties")}
          </div>
        </MobileFirstCard>

        <MobileFirstCard className="text-center">
          <div className="flex items-center justify-center w-12 h-12 bg-green-100 rounded-lg mx-auto mb-3">
            <Users className="h-6 w-6 text-green-600" />
          </div>
          <div className="text-2xl font-bold">{mockStats.totalTenants}</div>
          <div className="text-sm text-muted-foreground">
            {t("dashboard.mobile.stats.tenants")}
          </div>
        </MobileFirstCard>

        <MobileFirstCard className="text-center">
          <div className="flex items-center justify-center w-12 h-12 bg-purple-100 rounded-lg mx-auto mb-3">
            <DollarSign className="h-6 w-6 text-purple-600" />
          </div>
          <div className="text-lg font-bold">
            {formatCurrency(mockStats.monthlyRevenue)}
          </div>
          <div className="text-sm text-muted-foreground">
            {t("dashboard.mobile.stats.monthlyRevenue")}
          </div>
        </MobileFirstCard>

        <MobileFirstCard className="text-center">
          <div className="flex items-center justify-center w-12 h-12 bg-orange-100 rounded-lg mx-auto mb-3">
            <Wrench className="h-6 w-6 text-orange-600" />
          </div>
          <div className="text-2xl font-bold">{mockStats.pendingIssues}</div>
          <div className="text-sm text-muted-foreground">
            {t("dashboard.mobile.stats.pendingIssues")}
          </div>
        </MobileFirstCard>
      </div>
      {/* Quick Actions */}
      <MobileFirstCard className="mb-6">
        <CardHeader className="pb-4">
          <CardTitle className="text-lg">
            {t("dashboard.mobile.quickActions.title")}
          </CardTitle>
          <CardDescription>
            {t("dashboard.mobile.quickActions.description")}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action) => {
              const Icon = action.icon;
              return (
                <TouchOptimizedButton
                  key={action.href}
                  className="h-auto p-4 flex-col gap-2 relative"
                  variant="outline"
                >
                  <div
                    className={`w-10 h-10 rounded-lg ${action.color} flex items-center justify-center`}
                  >
                    <Icon className="h-5 w-5 text-white" />
                  </div>
                  <div className="text-center">
                    <div className="font-medium text-sm">
                      {t(action.titleKey)}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {t(action.descriptionKey)}
                    </div>
                  </div>
                  {action.count && (
                    <Badge
                      variant="destructive"
                      className="absolute -top-1 -end-1 h-5 w-5 p-0 text-xs flex items-center justify-center"
                    >
                      {action.count}
                    </Badge>
                  )}
                </TouchOptimizedButton>
              );
            })}
          </div>
        </CardContent>
      </MobileFirstCard>
      {/* Key Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
        <MobileFirstCard>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-500" />
              {t("dashboard.mobile.metrics.occupancyRate.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-green-600">
              {mockStats.occupancyRate}%
            </div>
            <div className="text-sm text-muted-foreground">
              {t("dashboard.mobile.metrics.occupancyRate.change")}
            </div>
          </CardContent>
        </MobileFirstCard>

        <MobileFirstCard>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-500" />
              {t("dashboard.mobile.metrics.overduePayments.title")}
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="text-2xl font-bold text-red-600">
              {mockStats.overduePayments}
            </div>
            <div className="text-sm text-muted-foreground">
              {t("dashboard.mobile.metrics.overduePayments.description")}
            </div>
          </CardContent>
        </MobileFirstCard>
      </div>
      {/* Recent Activity */}
      <MobileFirstCard>
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">
                {t("dashboard.mobile.recentActivity.title")}
              </CardTitle>
              <CardDescription>
                {t("dashboard.mobile.recentActivity.description")}
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm">
              <Eye className="h-4 w-4 me-2" />
              {t("dashboard.mobile.recentActivity.viewAll")}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-3">
            {recentActivities.map((activity) => (
              <SwipeableCard
                key={activity.id}
                className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                onSwipeLeft={() => {}}
                onSwipeRight={() => {}}
              >
                <div className="flex-shrink-0">
                  {getStatusIcon(activity.status)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm truncate">
                    {activity.title}
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {activity.description}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {getActivityTimeLabel(activity)}
                  </div>
                </div>
                {activity.amount && (
                  <div className="flex-shrink-0 text-end">
                    <div className="font-medium text-sm">
                      {formatCurrency(activity.amount)}
                    </div>
                  </div>
                )}
                <ArrowRight className="h-4 w-4 text-muted-foreground flex-shrink-0 rtl:-scale-x-100" />
              </SwipeableCard>
            ))}
          </div>
        </CardContent>
      </MobileFirstCard>
    </ResponsiveLayout>
  );
}
