"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  Area,
  AreaChart,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Clock,
  AlertTriangle,
  CheckCircle,
  Target,
  RefreshCw,
  Download,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { buildCsv } from "@/lib/reports/csv";

interface EmergencyAnalyticsData {
  overview: {
    totalEmergencies: number;
    activeEmergencies: number;
    overdueEmergencies: number;
    completedEmergencies: number;
    avgResponseTime: number;
    completionRate: number;
    onTimeRate: number;
  };
  categoryBreakdown: {
    _id: string;
    count: number;
    avgResponseTime: number;
  }[];
  trendData: {
    _id: string;
    count: number;
    completed: number;
  }[];
  responseTimeDistribution: {
    /** Bucket boundary in hours (0/2/4/8/24/48) or "other" for the overflow bucket. */
    _id: string | number;
    count: number;
    avgCost: number;
  }[];
}

interface EmergencyAnalyticsProps {
  className?: string;
  timeframe?: number;
}

const COLORS = {
  primary: "#dc2626",
  secondary: "#ea580c",
  success: "#16a34a",
  warning: "#ca8a04",
  info: "#2563eb",
  muted: "#6b7280",
};

const CHART_COLORS = [
  COLORS.primary,
  COLORS.secondary,
  COLORS.warning,
  COLORS.info,
  COLORS.success,
  COLORS.muted,
];

export function EmergencyAnalytics({
  className = "",
  timeframe = 30,
}: EmergencyAnalyticsProps) {
  const [data, setData] = useState<EmergencyAnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTimeframe, setSelectedTimeframe] = useState(
    timeframe.toString()
  );
  const [error, setError] = useState<string | null>(null);

  const fetchAnalytics = async (days: number = timeframe) => {
    try {
      setLoading(true);
      const response = await fetch(
        `/api/maintenance/emergency/stats?timeframe=${days}`
      );
      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to fetch analytics data");
      }

      setData(result.data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
      toast.error("Failed to load emergency analytics");
    } finally {
      setLoading(false);
    }
  };

  const handleTimeframeChange = (value: string) => {
    setSelectedTimeframe(value);
    fetchAnalytics(parseInt(value));
  };

  const handleRefresh = () => {
    fetchAnalytics(parseInt(selectedTimeframe));
  };

  const exportData = () => {
    if (!data) return;

    // Create CSV data
    const csvData = [
      ["Metric", "Value"],
      ["Total Emergencies", data.overview.totalEmergencies],
      ["Active Emergencies", data.overview.activeEmergencies],
      ["Overdue Emergencies", data.overview.overdueEmergencies],
      ["Completed Emergencies", data.overview.completedEmergencies],
      ["Average Response Time (hours)", data.overview.avgResponseTime],
      ["Completion Rate (%)", data.overview.completionRate],
      ["On-Time Rate (%)", data.overview.onTimeRate],
    ];

    // Through the shared CSV writer: the byte-order mark Excel needs, and
    // cells quoted where they have to be.
    const csvContent = buildCsv(csvData);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emergency-analytics-${selectedTimeframe}days.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  if (loading) {
    return (
      <div className={`space-y-6 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="h-8 bg-gray-200 rounded w-48 animate-pulse" />
          <div className="flex gap-2">
            <div className="h-9 w-32 bg-gray-200 rounded animate-pulse" />
            <div className="h-9 w-24 bg-gray-200 rounded animate-pulse" />
          </div>
        </div>
        <div className="grid gap-6 md:grid-cols-2">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-6 bg-gray-200 rounded w-32 animate-pulse" />
              </CardHeader>
              <CardContent>
                <div className="h-64 bg-gray-200 rounded animate-pulse" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <Card className={className}>
        <CardContent className="flex flex-col items-center justify-center min-h-[400px] space-y-4">
          <AlertTriangle className="h-12 w-12 text-red-500" />
          <h3 className="text-lg font-semibold">Failed to Load Analytics</h3>
          <p className="text-muted-foreground text-center">{error}</p>
          <Button onClick={handleRefresh} variant="outline">
            <RefreshCw className="me-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    );
  }

  // Prepare chart data
  const responseTimeData = data.responseTimeDistribution.map((item) => ({
    range:
      item._id === "other"
        ? "48+ hours"
        : item._id === 0
        ? "0-2 hours"
        : item._id === 2
        ? "2-4 hours"
        : item._id === 4
        ? "4-8 hours"
        : item._id === 8
        ? "8-24 hours"
        : item._id === 24
        ? "24-48 hours"
        : `${item._id}+ hours`,
    count: item.count,
    avgCost: item.avgCost || 0,
  }));

  const trendChartData = data.trendData.map((item) => ({
    date: new Date(item._id).toLocaleDateString(),
    total: item.count,
    completed: item.completed,
    pending: item.count - item.completed,
  }));

  const categoryData = data.categoryBreakdown.map((item) => ({
    category: item._id,
    count: item.count,
    avgResponseTime: item.avgResponseTime || 0,
  }));

  // KPI calculations
  const responseTimeTarget = 2; // 2 hours SLA
  const completionRateTarget = 95; // 95% target
  const onTimeTarget = 90; // 90% on-time target

  const kpis = [
    {
      title: "Avg Response Time",
      value: `${Math.round(data.overview.avgResponseTime * 10) / 10}h`,
      target: `${responseTimeTarget}h`,
      status:
        data.overview.avgResponseTime <= responseTimeTarget ? "good" : "poor",
      icon: Clock,
    },
    {
      title: "Completion Rate",
      value: `${Math.round(data.overview.completionRate)}%`,
      target: `${completionRateTarget}%`,
      status:
        data.overview.completionRate >= completionRateTarget ? "good" : "poor",
      icon: CheckCircle,
    },
    {
      title: "On-Time Rate",
      value: `${Math.round(data.overview.onTimeRate)}%`,
      target: `${onTimeTarget}%`,
      status: data.overview.onTimeRate >= onTimeTarget ? "good" : "poor",
      icon: Target,
    },
    {
      title: "Active Emergencies",
      value: data.overview.activeEmergencies.toString(),
      target: "0",
      status: data.overview.activeEmergencies === 0 ? "good" : "poor",
      icon: AlertTriangle,
    },
  ];

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-red-600">
            Emergency Analytics
          </h2>
          <p className="text-muted-foreground">
            Performance metrics and trends for emergency response
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedTimeframe}
            onValueChange={handleTimeframeChange}
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 days</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="365">1 year</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="me-2 h-4 w-4" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportData}>
            <Download className="me-2 h-4 w-4" />
            Export
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi, index) => {
          const Icon = kpi.icon;
          const isGood = kpi.status === "good";
          return (
            <Card
              key={index}
              className={isGood ? "border-green-200" : "border-red-200"}
            >
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  {kpi.title}
                </CardTitle>
                <Icon
                  className={`h-4 w-4 ${
                    isGood ? "text-green-600" : "text-red-600"
                  }`}
                />
              </CardHeader>
              <CardContent>
                <div
                  className={`text-2xl font-bold ${
                    isGood ? "text-green-600" : "text-red-600"
                  }`}
                >
                  {kpi.value}
                  {isGood ? (
                    <TrendingUp className="inline ms-2 h-4 w-4" />
                  ) : (
                    <TrendingDown className="inline ms-2 h-4 w-4" />
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Target: {kpi.target}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Charts Grid */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Response Time Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Response Time Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={responseTimeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="range" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="count" fill={COLORS.primary} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Emergency Categories */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              Emergency Categories
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={(props) => {
                    // Recharts spreads each datum's fields into the label
                    // props at runtime; `category` comes from categoryData.
                    const { category, percent } = props as {
                      category?: string;
                      percent?: number;
                    };
                    return `${category} ${((percent ?? 0) * 100).toFixed(0)}%`;
                  }}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {categoryData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Trend Analysis */}
        <Card className="md:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Emergency Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="total"
                  stackId="1"
                  stroke={COLORS.primary}
                  fill={COLORS.primary}
                  fillOpacity={0.6}
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  stackId="2"
                  stroke={COLORS.success}
                  fill={COLORS.success}
                  fillOpacity={0.6}
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
