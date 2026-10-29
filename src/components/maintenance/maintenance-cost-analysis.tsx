"use client";

import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Bar,
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
  ComposedChart,
  Area,
  AreaChart,
} from "recharts";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Target,
  AlertTriangle,
  CheckCircle,
  Calculator,
  PieChart as PieChartIcon,
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

interface MaintenanceCostAnalysisProps {
  data?: MaintenanceAnalyticsData;
}

// Mock data for comprehensive cost analysis
const mockCostBreakdown = [
  {
    category: "Labor",
    amount: 45600,
    percentage: 52.3,
    budget: 50000,
    variance: -8.8,
  },
  {
    category: "Materials",
    amount: 28900,
    percentage: 33.1,
    budget: 30000,
    variance: -3.7,
  },
  {
    category: "Equipment",
    amount: 8200,
    percentage: 9.4,
    budget: 8000,
    variance: 2.5,
  },
  {
    category: "Subcontractors",
    amount: 4500,
    percentage: 5.2,
    budget: 5000,
    variance: -10.0,
  },
];

const mockMonthlyCosts = [
  {
    month: "Jan",
    planned: 8500,
    actual: 9200,
    labor: 4800,
    materials: 3100,
    equipment: 800,
    other: 500,
  },
  {
    month: "Feb",
    planned: 7800,
    actual: 7400,
    labor: 3900,
    materials: 2200,
    equipment: 700,
    other: 600,
  },
  {
    month: "Mar",
    planned: 9200,
    actual: 10100,
    labor: 5400,
    materials: 3200,
    equipment: 900,
    other: 600,
  },
  {
    month: "Apr",
    planned: 8000,
    actual: 7800,
    labor: 4100,
    materials: 2400,
    equipment: 700,
    other: 600,
  },
  {
    month: "May",
    planned: 8800,
    actual: 9400,
    labor: 5000,
    materials: 2900,
    equipment: 800,
    other: 700,
  },
  {
    month: "Jun",
    planned: 7500,
    actual: 7200,
    labor: 3800,
    materials: 2100,
    equipment: 600,
    other: 700,
  },
];

const mockPropertyCosts = [
  {
    property: "Sunset Apartments",
    cost: 15600,
    budget: 16000,
    variance: -2.5,
    requests: 45,
  },
  {
    property: "Downtown Lofts",
    cost: 12800,
    budget: 13500,
    variance: -5.2,
    requests: 38,
  },
  {
    property: "Garden View Complex",
    cost: 18900,
    budget: 18000,
    variance: 5.0,
    requests: 52,
  },
  {
    property: "Riverside Towers",
    cost: 9400,
    budget: 10000,
    variance: -6.0,
    requests: 29,
  },
  {
    property: "Metro Heights",
    cost: 14200,
    budget: 14500,
    variance: -2.1,
    requests: 41,
  },
];

const mockCostTrends = [
  { quarter: "Q1 2023", preventive: 15200, reactive: 28400, emergency: 8900 },
  { quarter: "Q2 2023", preventive: 16800, reactive: 24600, emergency: 7200 },
  { quarter: "Q3 2023", preventive: 18200, reactive: 22100, emergency: 6800 },
  { quarter: "Q4 2023", preventive: 19600, reactive: 20800, emergency: 6200 },
];

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8"];
import { formatCurrency } from "@/lib/utils/formatting";

export function MaintenanceCostAnalysis({
  data,
}: MaintenanceCostAnalysisProps) {
  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //     minimumFractionDigits: 0,
  //     maximumFractionDigits: 0,
  //   }).format(amount);
  // };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  const getVarianceColor = (variance: number) => {
    if (variance <= -5) return "text-green-600"; // Under budget is good
    if (variance <= 5) return "text-blue-600"; // Within tolerance
    return "text-red-600"; // Over budget
  };

  const getVarianceBadge = (variance: number) => {
    if (variance <= -5)
      return {
        label: "Under Budget",
        variant: "bg-green-100 text-green-800 border-green-200",
      };
    if (variance <= 5)
      return {
        label: "On Track",
        variant: "bg-blue-100 text-blue-800 border-blue-200",
      };
    return {
      label: "Over Budget",
      variant: "bg-red-100 text-red-800 border-red-200",
    };
  };

  const totalBudget = mockCostBreakdown.reduce(
    (sum, item) => sum + item.budget,
    0,
  );
  const totalActual = mockCostBreakdown.reduce(
    (sum, item) => sum + item.amount,
    0,
  );
  const totalVariance = ((totalActual - totalBudget) / totalBudget) * 100;

  return (
    <div className="space-y-6">
      {/* Cost Overview Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Budget</CardTitle>
            <Target className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">
              {formatCurrency(totalBudget)}
            </div>
            <p className="text-xs text-muted-foreground">
              Annual maintenance budget
            </p>
          </CardContent>
        </Card>

        <Card className="border-green-200 bg-green-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Actual Spend</CardTitle>
            <DollarSign className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {formatCurrency(totalActual)}
            </div>
            <p className="text-xs text-muted-foreground">
              Year-to-date spending
            </p>
          </CardContent>
        </Card>

        <Card
          className={`border-${totalVariance <= 0 ? "green" : "red"}-200 bg-${
            totalVariance <= 0 ? "green" : "red"
          }-50`}
        >
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Budget Variance
            </CardTitle>
            {totalVariance <= 0 ? (
              <TrendingDown className="h-4 w-4 text-green-600" />
            ) : (
              <TrendingUp className="h-4 w-4 text-red-600" />
            )}
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${getVarianceColor(
                totalVariance,
              )}`}
            >
              {formatPercentage(Math.abs(totalVariance))}
            </div>
            <p className="text-xs text-muted-foreground">
              {totalVariance <= 0 ? "Under budget" : "Over budget"}
            </p>
          </CardContent>
        </Card>

        <Card className="border-purple-200 bg-purple-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Cost per Request
            </CardTitle>
            <Calculator className="h-4 w-4 text-purple-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-600">
              {formatCurrency(data?.overview?.avgCost ?? 425)}
            </div>
            <p className="text-xs text-muted-foreground">
              Average cost per request
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Cost Breakdown */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-5 w-5" />
              Cost Breakdown by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={mockCostBreakdown}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  nameKey="category"
                  label={({ name, percent }) =>
                    `${name ?? ""} ${(((percent ?? 0) as number) * 100).toFixed(0)}%`
                  }
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="amount"
                >
                  {mockCostBreakdown.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => formatCurrency(value as number)}
                />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Budget vs Actual by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mockCostBreakdown.map((item, index) => (
                <div key={index} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{item.category}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">
                        {formatCurrency(item.amount)} /{" "}
                        {formatCurrency(item.budget)}
                      </span>
                      <Badge
                        variant="outline"
                        className={getVarianceBadge(item.variance).variant}
                      >
                        {formatPercentage(Math.abs(item.variance))}
                      </Badge>
                    </div>
                  </div>
                  <Progress
                    value={(item.amount / item.budget) * 100}
                    className="h-2"
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Cost Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Monthly Cost Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={mockMonthlyCosts}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(value as number)} />
              <Legend />
              <Bar dataKey="planned" fill="#8884d8" name="Planned Budget" />
              <Bar dataKey="actual" fill="#82ca9d" name="Actual Spend" />
              <Line
                type="monotone"
                dataKey="labor"
                stroke="#ff7300"
                strokeWidth={2}
                name="Labor Costs"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Property Cost Analysis */}
      <Card>
        <CardHeader>
          <CardTitle>Cost Analysis by Property</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {mockPropertyCosts.map((property, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-4 border rounded-lg hover:bg-gray-50"
              >
                <div className="flex-1">
                  <h4 className="font-semibold">{property.property}</h4>
                  <p className="text-sm text-muted-foreground">
                    {property.requests} requests
                  </p>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-end">
                    <div className="font-semibold">
                      {formatCurrency(property.cost)}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Budget: {formatCurrency(property.budget)}
                    </div>
                  </div>
                  <div className="text-end">
                    <div
                      className={`font-semibold ${getVarianceColor(
                        property.variance,
                      )}`}
                    >
                      {formatPercentage(Math.abs(property.variance))}
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Variance
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={getVarianceBadge(property.variance).variant}
                  >
                    {getVarianceBadge(property.variance).label}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cost Type Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Maintenance Cost Types Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={mockCostTrends}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="quarter" />
              <YAxis />
              <Tooltip formatter={(value) => formatCurrency(value as number)} />
              <Legend />
              <Area
                type="monotone"
                dataKey="preventive"
                stackId="1"
                stroke="#00C49F"
                fill="#00C49F"
                fillOpacity={0.6}
                name="Preventive"
              />
              <Area
                type="monotone"
                dataKey="reactive"
                stackId="1"
                stroke="#0088FE"
                fill="#0088FE"
                fillOpacity={0.6}
                name="Reactive"
              />
              <Area
                type="monotone"
                dataKey="emergency"
                stackId="1"
                stroke="#FF8042"
                fill="#FF8042"
                fillOpacity={0.6}
                name="Emergency"
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Cost Optimization Insights */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-green-200 bg-green-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cost Savings</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">$4,200</div>
            <p className="text-xs text-muted-foreground">
              Saved through preventive maintenance
            </p>
          </CardContent>
        </Card>

        <Card className="border-yellow-200 bg-yellow-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Optimization Potential
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-yellow-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-yellow-600">15%</div>
            <p className="text-xs text-muted-foreground">
              Potential cost reduction
            </p>
          </CardContent>
        </Card>

        <Card className="border-blue-200 bg-blue-50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              ROI on Preventive
            </CardTitle>
            <Target className="h-4 w-4 text-blue-600" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-600">3.2x</div>
            <p className="text-xs text-muted-foreground">
              Return on preventive investment
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
