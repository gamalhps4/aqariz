"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Clock,
  CheckCircle,
  TrendingUp,
  TrendingDown,
  Zap,
  Users,
  Timer,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";
import Link from "next/link";

interface EmergencyStats {
  totalEmergencies: number;
  activeEmergencies: number;
  overdueEmergencies: number;
  completedEmergencies: number;
  unassignedEmergencies: number;
  avgResponseTime: number;
  criticalCount: number;
  overdueCount: number;
  normalCount: number;
  completionRate: number;
  onTimeRate: number;
}

interface EmergencyDashboardCardsProps {
  className?: string;
  showRefresh?: boolean;
  timeframe?: number; // days
}

export function EmergencyDashboardCards({
  className = "",
  showRefresh = true,
  timeframe = 30,
}: EmergencyDashboardCardsProps) {
  const [stats, setStats] = useState<EmergencyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const response = await fetch(
        `/api/maintenance/emergency/stats?timeframe=${timeframe}`
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch emergency statistics");
      }

      setStats(result.data.overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      toast.error("Failed to load emergency statistics");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = () => {
    setRefreshing(true);
    fetchStats();
  };

  useEffect(() => {
    fetchStats();
  }, [timeframe]);

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading && !refreshing) {
        fetchStats();
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [loading, refreshing]);

  if (loading) {
    return (
      <div className={`grid gap-4 md:grid-cols-2 lg:grid-cols-4 ${className}`}>
        {[...Array(8)].map((_, i) => (
          <Card key={i} className="border-red-200">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <div className="h-4 bg-gray-200 rounded w-20 animate-pulse" />
              <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
            </CardHeader>
            <CardContent>
              <div className="h-8 bg-gray-200 rounded w-16 animate-pulse mb-2" />
              <div className="h-3 bg-gray-200 rounded w-24 animate-pulse" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (error || !stats) {
    return (
      <Card className="border-red-200">
        <CardContent className="flex flex-col items-center justify-center min-h-[200px] space-y-4">
          <AlertTriangle className="h-12 w-12 text-red-500" />
          <h3 className="text-lg font-semibold">
            Failed to Load Emergency Statistics
          </h3>
          <p className="text-muted-foreground text-center">{error}</p>
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="me-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  const cards = [
    {
      title: "Active Emergencies",
      value: stats.activeEmergencies,
      icon: Zap,
      color: "text-red-600 dark:text-red-400",
      bgColor: "bg-red-50 dark:bg-red-950/30",
      borderColor: "border-red-200 dark:border-red-800",
      description: "Requiring immediate attention",
      trend: stats.activeEmergencies > 0 ? "critical" : "good",
      href: "/dashboard/maintenance/emergency?status=active",
    },
    {
      title: "Overdue Emergencies",
      value: stats.overdueEmergencies,
      icon: AlertTriangle,
      color: "text-orange-600 dark:text-orange-400",
      bgColor: "bg-orange-50 dark:bg-orange-950/30",
      borderColor: "border-orange-200 dark:border-orange-800",
      description: ">2 hours without response",
      trend: stats.overdueEmergencies > 0 ? "warning" : "good",
      href: "/dashboard/maintenance/emergency?responseTime=overdue",
    },
    {
      title: "Critical Level",
      value: stats.criticalCount,
      icon: AlertCircle,
      color: "text-red-700 dark:text-red-400",
      bgColor: "bg-red-100 dark:bg-red-950/40",
      borderColor: "border-red-300 dark:border-red-800",
      description: ">4 hours elapsed",
      trend: stats.criticalCount > 0 ? "critical" : "good",
      href: "/dashboard/maintenance/emergency?responseTime=critical",
    },
    {
      title: "Unassigned",
      value: stats.unassignedEmergencies,
      icon: Users,
      color: "text-yellow-600 dark:text-yellow-400",
      bgColor: "bg-yellow-50 dark:bg-yellow-950/30",
      borderColor: "border-yellow-200 dark:border-yellow-800",
      description: "Awaiting assignment",
      trend: stats.unassignedEmergencies > 0 ? "warning" : "good",
      href: "/dashboard/maintenance/emergency?assignedTo=unassigned",
    },
    {
      title: "Completed Today",
      value: stats.completedEmergencies,
      icon: CheckCircle,
      color: "text-green-600 dark:text-green-400",
      bgColor: "bg-green-50 dark:bg-green-950/30",
      borderColor: "border-green-200 dark:border-green-800",
      description: "Successfully resolved",
      trend: "good",
      href: "/dashboard/maintenance/emergency?status=completed",
    },
    {
      title: "Avg Response Time",
      value: stats.avgResponseTime
        ? `${Math.round(stats.avgResponseTime)}h`
        : "N/A",
      icon: Timer,
      color: "text-blue-600 dark:text-blue-400",
      bgColor: "bg-blue-50 dark:bg-blue-950/30",
      borderColor: "border-blue-200 dark:border-blue-800",
      description: "Average resolution time",
      trend:
        stats.avgResponseTime <= 2
          ? "good"
          : stats.avgResponseTime <= 4
          ? "warning"
          : "critical",
    },
    {
      title: "Completion Rate",
      value: `${Math.round(stats.completionRate)}%`,
      icon: TrendingUp,
      color: "text-purple-600",
      bgColor: "bg-purple-50",
      borderColor: "border-purple-200",
      description: "Emergency resolution rate",
      trend:
        stats.completionRate >= 90
          ? "good"
          : stats.completionRate >= 70
          ? "warning"
          : "critical",
    },
    {
      title: "On-Time Rate",
      value: `${Math.round(stats.onTimeRate)}%`,
      icon: Clock,
      color: "text-indigo-600",
      bgColor: "bg-indigo-50",
      borderColor: "border-indigo-200",
      description: "Resolved within SLA",
      trend:
        stats.onTimeRate >= 80
          ? "good"
          : stats.onTimeRate >= 60
          ? "warning"
          : "critical",
    },
  ];

  const getTrendIndicator = (trend: string) => {
    switch (trend) {
      case "critical":
        return <TrendingDown className="h-3 w-3 text-red-500" />;
      case "warning":
        return <AlertTriangle className="h-3 w-3 text-yellow-500" />;
      case "good":
        return <TrendingUp className="h-3 w-3 text-green-500" />;
      default:
        return null;
    }
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-red-600 flex items-center gap-2">
            <Zap className="h-6 w-6" />
            Emergency Overview
          </h2>
          <p className="text-muted-foreground">
            Critical maintenance metrics for the last {timeframe} days
          </p>
        </div>
        {showRefresh && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`me-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        )}
      </div>

      {/* Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {cards.map((card, index) => {
          const Icon = card.icon;
          return (
            <Card
              key={index}
              className={`${card.borderColor} ${card.bgColor} hover:shadow-md transition-shadow cursor-pointer`}
            >
              {card.href ? (
                <Link href={card.href}>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      {card.title}
                    </CardTitle>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`text-2xl font-bold ${card.color} flex items-center gap-2`}
                    >
                      {card.value}
                      {getTrendIndicator(card.trend)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {card.description}
                    </p>
                  </CardContent>
                </Link>
              ) : (
                <>
                  <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">
                      {card.title}
                    </CardTitle>
                    <Icon className={`h-4 w-4 ${card.color}`} />
                  </CardHeader>
                  <CardContent>
                    <div
                      className={`text-2xl font-bold ${card.color} flex items-center gap-2`}
                    >
                      {card.value}
                      {getTrendIndicator(card.trend)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {card.description}
                    </p>
                  </CardContent>
                </>
              )}
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
              <div>
                <div className="font-medium text-red-700 dark:text-red-400">
                  Emergency Response Center
                </div>
                <div className="text-sm text-red-600">
                  {stats.activeEmergencies > 0
                    ? `${stats.activeEmergencies} active emergencies need immediate attention`
                    : "All emergencies are under control"}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/dashboard/maintenance/emergency">
                <Button variant="outline" size="sm">
                  View All
                </Button>
              </Link>
              <Link href="/dashboard/maintenance/emergency/new">
                <Button size="sm" className="bg-red-600 hover:bg-red-700">
                  Report Emergency
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
