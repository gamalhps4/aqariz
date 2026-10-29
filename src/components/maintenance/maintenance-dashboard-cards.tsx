"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Wrench,
  DollarSign,
  Target,
  TrendingUp,
  TrendingDown,
  Timer,
} from "lucide-react";
import {
  AnalyticsCard,
  AnalyticsCardGrid,
} from "@/components/analytics/AnalyticsCard";

interface MaintenanceOverviewData {
  totalRequests: number;
  pendingRequests: number;
  inProgressRequests: number;
  completedRequests: number;
  totalCost: number;
  avgCompletionTime: number;
  avgCost: number;
  completionRate: number;
}

interface MaintenanceDashboardCardsProps {
  data?: MaintenanceOverviewData;
}
import { formatCurrency } from "@/lib/utils/formatting";

export function MaintenanceDashboardCards({
  data,
}: MaintenanceDashboardCardsProps) {
  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const formatDuration = (hours: number | null | undefined) => {
    if (!hours || hours === 0) {
      return "0h";
    }
    if (hours < 24) {
      return `${hours.toFixed(1)}h`;
    }
    const days = Math.floor(hours / 24);
    const remainingHours = hours % 24;
    return `${days}d ${remainingHours.toFixed(1)}h`;
  };

  // Mock previous period data for trend calculation
  const previousData = {
    totalRequests: data ? data.totalRequests - 15 : 0,
    totalCost: data ? data.totalCost - 5000 : 0,
    avgCompletionTime: data ? data.avgCompletionTime + 2 : 0,
    completionRate: data ? data.completionRate - 5 : 0,
  };

  const calculateChange = (current: number, previous: number) => {
    if (previous === 0) return { value: "0", isPositive: true };
    const change = ((current - previous) / previous) * 100;
    return {
      value: Math.abs(change).toFixed(1),
      isPositive: change >= 0,
    };
  };

  const requestsChange = data
    ? calculateChange(data.totalRequests, previousData.totalRequests)
    : { value: "0", isPositive: true };
  const costChange = data
    ? calculateChange(data.totalCost, previousData.totalCost)
    : { value: "0", isPositive: true };
  const timeChange = data
    ? calculateChange(data.avgCompletionTime, previousData.avgCompletionTime)
    : { value: "0", isPositive: true };
  const completionChange = data
    ? calculateChange(data.completionRate, previousData.completionRate)
    : { value: "0", isPositive: true };

  if (!data) {
    return (
      <AnalyticsCardGrid>
        {[...Array(4)].map((_, i) => (
          <Card
            key={i}
            className="animate-pulse hover:shadow-md transition-shadow"
          >
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-3/4"></div>
              <div className="h-4 w-4 bg-gray-200 rounded"></div>
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-1/2 mb-2"></div>
              <div className="h-3 bg-gray-200 rounded w-full"></div>
            </CardContent>
          </Card>
        ))}
      </AnalyticsCardGrid>
    );
  }

  return (
    <AnalyticsCardGrid>
      <AnalyticsCard
        title="Total Requests"
        value={data.totalRequests}
        description={`${data.pendingRequests} pending, ${data.inProgressRequests} in progress`}
        icon={Wrench}
        iconColor="primary"
        trend={{
          value: `${requestsChange.value}% from last period`,
          isPositive: requestsChange.isPositive,
          icon: requestsChange.isPositive ? TrendingUp : TrendingDown,
        }}
      />

      <AnalyticsCard
        title="Total Cost"
        value={formatCurrency(data.totalCost)}
        description={`Avg: ${formatCurrency(data.avgCost)} per request`}
        icon={DollarSign}
        iconColor="success"
        trend={{
          value: `${costChange.value}% from last period`,
          isPositive: !costChange.isPositive,
          icon: costChange.isPositive ? TrendingUp : TrendingDown,
        }}
      />

      <AnalyticsCard
        title="Avg Completion Time"
        value={formatDuration(data.avgCompletionTime)}
        description="Average time to complete"
        icon={Timer}
        iconColor="warning"
        trend={{
          value: `${timeChange.value}% from last period`,
          isPositive: !timeChange.isPositive,
          icon: timeChange.isPositive ? TrendingUp : TrendingDown,
        }}
      />

      <AnalyticsCard
        title="Completion Rate"
        value={formatPercentage(data.completionRate)}
        description={`${data.completedRequests} completed requests`}
        icon={Target}
        iconColor="info"
        trend={{
          value: `${completionChange.value}% from last period`,
          isPositive: completionChange.isPositive,
          icon: completionChange.isPositive ? TrendingUp : TrendingDown,
        }}
      />
    </AnalyticsCardGrid>
  );
}
