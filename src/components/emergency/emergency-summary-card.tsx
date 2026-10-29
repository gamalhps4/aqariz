"use client";

import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Clock,
  Zap,
  TrendingUp,
  RefreshCw,
  ArrowRight,
} from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EmergencyStats {
  activeEmergencies: number;
  overdueEmergencies: number;
  criticalCount: number;
  avgResponseTime: number;
  completionRate: number;
}

interface EmergencySummaryCardProps {
  className?: string;
}

export function EmergencySummaryCard({
  className = "",
}: EmergencySummaryCardProps) {
  const [stats, setStats] = useState<EmergencyStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStats = async () => {
    try {
      const response = await fetch(
        "/api/maintenance/emergency/stats?timeframe=7"
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch emergency statistics");
      }

      setStats(result.data.overview);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, []);

  // Auto-refresh every 2 minutes
  useEffect(() => {
    const interval = setInterval(() => {
      if (!loading) {
        fetchStats();
      }
    }, 120000);

    return () => clearInterval(interval);
  }, [loading]);

  if (loading) {
    return (
      <Card className={`border-red-200 ${className}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-semibold text-red-700 flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Emergency Status
          </CardTitle>
          <div className="h-4 w-4 bg-gray-200 rounded animate-pulse" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="space-y-1">
                <div className="h-3 bg-gray-200 rounded w-16 animate-pulse" />
                <div className="h-6 bg-gray-200 rounded w-8 animate-pulse" />
              </div>
            ))}
          </div>
          <div className="h-9 bg-gray-200 rounded animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (error || !stats) {
    return (
      <Card className={`border-red-200 ${className}`}>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-base font-semibold text-red-700 flex items-center gap-2">
            <Zap className="h-5 w-5" />
            Emergency Status
          </CardTitle>
          <AlertTriangle className="h-4 w-4 text-red-500" />
        </CardHeader>
        <CardContent>
          <div className="text-center py-4">
            <p className="text-sm text-muted-foreground">
              Failed to load emergency data
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchStats}
              className="mt-2"
            >
              <RefreshCw className="me-2 h-3 w-3" />
              Retry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const getStatusColor = () => {
    if (stats.criticalCount > 0) return "text-red-600";
    if (stats.overdueEmergencies > 0) return "text-orange-600";
    if (stats.activeEmergencies > 0) return "text-yellow-600";
    return "text-green-600";
  };

  const getStatusText = () => {
    if (stats.criticalCount > 0) return "Critical";
    if (stats.overdueEmergencies > 0) return "Overdue";
    if (stats.activeEmergencies > 0) return "Active";
    return "All Clear";
  };

  const getStatusBadge = () => {
    if (stats.criticalCount > 0) {
      return (
        <Badge variant="destructive" className="animate-pulse">
          Critical
        </Badge>
      );
    }
    if (stats.overdueEmergencies > 0) {
      return <Badge variant="destructive">Overdue</Badge>;
    }
    if (stats.activeEmergencies > 0) {
      return <Badge variant="secondary">Active</Badge>;
    }
    return (
      <Badge variant="default" className="bg-green-100 text-green-800">
        All Clear
      </Badge>
    );
  };

  return (
    <Card
      className={`border-red-200 hover:shadow-md transition-shadow ${className}`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-base font-semibold text-red-700 flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Emergency Status
        </CardTitle>
        {getStatusBadge()}
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Active</p>
            <p
              className={`text-lg font-bold ${
                stats.activeEmergencies > 0 ? "text-red-600" : "text-green-600"
              }`}
            >
              {stats.activeEmergencies}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Overdue</p>
            <p
              className={`text-lg font-bold ${
                stats.overdueEmergencies > 0
                  ? "text-orange-600"
                  : "text-green-600"
              }`}
            >
              {stats.overdueEmergencies}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Critical</p>
            <p
              className={`text-lg font-bold ${
                stats.criticalCount > 0 ? "text-red-700" : "text-green-600"
              }`}
            >
              {stats.criticalCount}
            </p>
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Avg Response</p>
            <p
              className={`text-lg font-bold ${
                stats.avgResponseTime <= 2
                  ? "text-green-600"
                  : stats.avgResponseTime <= 4
                  ? "text-yellow-600"
                  : "text-red-600"
              }`}
            >
              {stats.avgResponseTime
                ? `${Math.round(stats.avgResponseTime)}h`
                : "N/A"}
            </p>
          </div>
        </div>

        {/* Status Summary */}
        <div
          className={`p-3 rounded-lg ${
            stats.criticalCount > 0
              ? "bg-red-50 border border-red-200"
              : stats.overdueEmergencies > 0
              ? "bg-orange-50 border border-orange-200"
              : stats.activeEmergencies > 0
              ? "bg-yellow-50 border border-yellow-200"
              : "bg-green-50 border border-green-200"
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {stats.criticalCount > 0 ? (
                <AlertTriangle className="h-4 w-4 text-red-600" />
              ) : stats.overdueEmergencies > 0 ? (
                <Clock className="h-4 w-4 text-orange-600" />
              ) : stats.activeEmergencies > 0 ? (
                <Zap className="h-4 w-4 text-yellow-600" />
              ) : (
                <TrendingUp className="h-4 w-4 text-green-600" />
              )}
              <span className={`text-sm font-medium ${getStatusColor()}`}>
                {getStatusText()}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">Last 7 days</span>
          </div>
          {stats.criticalCount > 0 && (
            <p className="text-xs text-red-600 mt-1">
              {stats.criticalCount} critical emergencies need immediate
              attention
            </p>
          )}
          {stats.overdueEmergencies > 0 && stats.criticalCount === 0 && (
            <p className="text-xs text-orange-600 mt-1">
              {stats.overdueEmergencies} emergencies are overdue
            </p>
          )}
          {stats.activeEmergencies > 0 &&
            stats.overdueEmergencies === 0 &&
            stats.criticalCount === 0 && (
              <p className="text-xs text-yellow-600 mt-1">
                {stats.activeEmergencies} active emergencies being handled
              </p>
            )}
          {stats.activeEmergencies === 0 && (
            <p className="text-xs text-green-600 mt-1">
              No active emergencies - system running smoothly
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Link href="/dashboard/maintenance/emergency" className="flex-1">
            <Button variant="outline" size="sm" className="w-full">
              View All
              <ArrowRight className="ms-2 h-3 w-3 rtl:-scale-x-100" />
            </Button>
          </Link>
          <Link href="/dashboard/maintenance/emergency/new">
            <Button size="sm" className="bg-red-600 hover:bg-red-700">
              Report
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
