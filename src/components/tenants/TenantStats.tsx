"use client";

import { useMemo } from "react";
import {
  Users,
  UserCheck,
  Clock,
  TrendingUp,
  TrendingDown,
  Calendar,
} from "lucide-react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";
import type { TenantRecord } from "./types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Tenant = TenantRecord;

interface TenantStatsProps {
  tenants: Tenant[];
}

export default function TenantStats({ tenants }: TenantStatsProps) {
  const { t } = useLocalizationContext();

  const stats = useMemo(() => {
    if (!tenants.length) {
      return {
        total: 0,
        active: 0,
        pending: 0,
        thisMonthApplications: 0,
        lastMonthApplications: 0,
      };
    }

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const active = tenants.filter((t) => t.tenantStatus === "active").length;
    const pending = tenants.filter(
      (t) =>
        t.tenantStatus === "application_submitted" ||
        t.tenantStatus === "under_review"
    ).length;

    const thisMonthApplications = tenants.filter(
      (t) => new Date(t.applicationDate) >= thisMonth
    ).length;

    const lastMonthApplications = tenants.filter((t) => {
      const appDate = new Date(t.applicationDate);
      return appDate >= lastMonth && appDate <= lastMonthEnd;
    }).length;

    return {
      total: tenants.length,
      active,
      pending,
      thisMonthApplications,
      lastMonthApplications,
    };
  }, [tenants]);

  const getApplicationTrend = () => {
    if (stats.lastMonthApplications === 0) {
      return { trend: "neutral", percentage: 0 };
    }

    const change =
      ((stats.thisMonthApplications - stats.lastMonthApplications) /
        stats.lastMonthApplications) *
      100;
    return {
      trend: change > 0 ? "up" : change < 0 ? "down" : "neutral",
      percentage: Math.abs(Math.round(change)),
    };
  };

  const applicationTrend = getApplicationTrend();

  return (
    <AnalyticsCardGrid className="lg:grid-cols-4">
      <AnalyticsCard
        title={t("tenants.stats.total.title")}
        value={stats.total}
        description={t("tenants.stats.total.description")}
        icon={Users}
        iconColor="primary"
      />

      <AnalyticsCard
        title={t("tenants.stats.active.title")}
        value={stats.active}
        description={t("tenants.stats.active.description")}
        icon={UserCheck}
        iconColor="success"
      />

      <AnalyticsCard
        title={t("tenants.stats.pending.title")}
        value={stats.pending}
        description={t("tenants.stats.pending.description")}
        icon={Clock}
        iconColor="warning"
      />

      <AnalyticsCard
        title={t("tenants.stats.thisMonth.title")}
        value={stats.thisMonthApplications}
        description={t("tenants.stats.thisMonth.description")}
        icon={Calendar}
        iconColor="info"
        trend={
          applicationTrend.trend !== "neutral"
            ? {
                value: t("tenants.stats.thisMonth.trend", {
                  values: { percentage: applicationTrend.percentage },
                }),
                isPositive: applicationTrend.trend === "up",
                icon:
                  applicationTrend.trend === "up" ? TrendingUp : TrendingDown,
              }
            : undefined
        }
      />
    </AnalyticsCardGrid>
  );
}
