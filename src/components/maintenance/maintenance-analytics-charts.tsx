"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  AreaChart,
  Area,
} from "recharts";
import {
  TrendingUp,
  BarChart3,
  PieChart as PieChartIcon,
  Activity,
} from "lucide-react";

interface MaintenanceAnalyticsData {
  overview: {
    totalRequests: number;
    pendingRequests: number;
    inProgressRequests: number;
    completedRequests: number;
    totalCost: number;
    avgCompletionTime: number;
    avgCost: number;
    completionRate: number;
  };
  trends: {
    monthly: Array<{
      month: string;
      requests: number;
      cost: number;
      avgTime: number;
    }>;
    categories: Array<{
      category: string;
      count: number;
      cost: number;
      avgTime: number;
    }>;
  };
}

interface MaintenanceAnalyticsChartsProps {
  data: MaintenanceAnalyticsData | null;
}

const COLORS = [
  "#0088FE",
  "#00C49F",
  "#FFBB28",
  "#FF8042",
  "#8884D8",
  "#82CA9D",
];

// Mock data for demonstration
const mockMonthlyData = [
  { month: "Jan", requests: 45, cost: 12500, avgTime: 3.2, completed: 42 },
  { month: "Feb", requests: 38, cost: 9800, avgTime: 2.8, completed: 36 },
  { month: "Mar", requests: 52, cost: 15200, avgTime: 3.5, completed: 48 },
  { month: "Apr", requests: 41, cost: 11600, avgTime: 2.9, completed: 39 },
  { month: "May", requests: 47, cost: 13800, avgTime: 3.1, completed: 44 },
  { month: "Jun", requests: 39, cost: 10900, avgTime: 2.7, completed: 37 },
];

const mockCategoryData = [
  { category: "Plumbing", count: 85, cost: 25600, avgTime: 4.2 },
  { category: "HVAC", count: 62, cost: 31200, avgTime: 5.8 },
  { category: "Electrical", count: 48, cost: 18900, avgTime: 3.1 },
  { category: "General", count: 73, cost: 12400, avgTime: 2.3 },
  { category: "Appliances", count: 34, cost: 15800, avgTime: 3.7 },
  { category: "Flooring", count: 29, cost: 22100, avgTime: 6.2 },
];

const mockStatusData = [
  { name: "Completed", value: 78, color: "#00C49F" },
  { name: "In Progress", value: 15, color: "#0088FE" },
  { name: "Pending", value: 7, color: "#FFBB28" },
];

const mockPriorityData = [
  { name: "Low", value: 45, color: "#00C49F" },
  { name: "Medium", value: 35, color: "#FFBB28" },
  { name: "High", value: 15, color: "#FF8042" },
  { name: "Emergency", value: 5, color: "#FF0000" },
];

import { formatCurrency } from "@/lib/utils/formatting";

export function MaintenanceAnalyticsCharts({
  data,
}: MaintenanceAnalyticsChartsProps) {
  // const formatCurrency = (value: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //     minimumFractionDigits: 0,
  //     maximumFractionDigits: 0,
  //   }).format(value);
  // };

  const formatHours = (value: number) => {
    return `${value.toFixed(1)}h`;
  };

  // Use real data if available, otherwise use mock data
  const monthlyData = data?.trends?.monthly || mockMonthlyData;
  const categoryData = data?.trends?.categories || mockCategoryData;

  return (
    <div className="space-y-6">
      {/* Monthly Trends */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Monthly Request Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="requests"
                  stackId="1"
                  stroke="#8884d8"
                  fill="#8884d8"
                  fillOpacity={0.6}
                  name="Total Requests"
                />
                <Area
                  type="monotone"
                  dataKey="completed"
                  stackId="2"
                  stroke="#82ca9d"
                  fill="#82ca9d"
                  fillOpacity={0.6}
                  name="Completed"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              Monthly Cost Analysis
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip
                  formatter={(value) => formatCurrency(value as number)}
                />
                <Legend />
                <Bar dataKey="cost" fill="#8884d8" name="Total Cost" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Category Analysis */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Maintenance by Category
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={categoryData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="category" />
              <YAxis yAxisId="left" />
              <YAxis yAxisId="right" orientation="right" />
              <Tooltip
                formatter={(value, name) => {
                  if (name === "cost") return formatCurrency(value as number);
                  if (name === "avgTime") return formatHours(value as number);
                  return value;
                }}
              />
              <Legend />
              <Bar
                yAxisId="left"
                dataKey="count"
                fill="#8884d8"
                name="Request Count"
              />
              <Bar
                yAxisId="right"
                dataKey="cost"
                fill="#82ca9d"
                name="Total Cost"
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Status and Priority Distribution */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Request Status Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={mockStatusData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name} ${((percent as number) * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {mockStatusData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Priority Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={mockPriorityData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name} ${((percent as number) * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {mockPriorityData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Completion Time Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Average Completion Time Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={monthlyData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => formatHours(value as number)} />
              <Legend />
              <Line
                type="monotone"
                dataKey="avgTime"
                stroke="#8884d8"
                strokeWidth={2}
                name="Avg Completion Time"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
