"use client";

import React, { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { useRealTimePayments } from "@/hooks/useRealTimePayments";
import {
  DollarSign,
  TrendingUp,
  AlertTriangle,
  Clock,
  Calendar,
  CreditCard,
  FileText,
  Download,
} from "lucide-react";
import { formatCurrency } from "@/lib/utils/formatting";

interface PaymentMetrics {
  currentMonthCollected: number;
  currentMonthTarget: number;
  outstandingThisMonth: number;
  overdue30Plus: number;
  totalPortfolioCollected: number;
  averageDaysToPayment: number;
  collectionRate: number;
}

interface AgingData {
  category: string;
  amount: number;
  count: number;
  color: string;
  urgency: "low" | "medium" | "high" | "critical";
}

interface PaymentStatus {
  id: string;
  tenantName: string;
  propertyAddress: string;
  amount: number;
  dueDate: Date;
  status: "pending" | "paid" | "partial" | "overdue" | "cancelled" | "refunded" | "failed";
  daysOverdue: number;
  lateFees: number;
  paymentMethod: string;
}

export default function PaymentManagementDashboard() {
  const [metrics, setMetrics] = useState<PaymentMetrics>({
    currentMonthCollected: 45750,
    currentMonthTarget: 52000,
    outstandingThisMonth: 6250,
    overdue30Plus: 3200,
    totalPortfolioCollected: 0.88,
    averageDaysToPayment: 3.2,
    collectionRate: 0.94,
  });

  // Real-time payment updates for all properties
  const { isConnected, lastUpdate, connectionError, reconnect } =
    useRealTimePayments({
      enabled: true, // Monitor all payments
    });

  // Function to refresh payment metrics
  const refreshPaymentMetrics = async () => {
    try {
      // Simulate API call to refresh metrics

      // In a real implementation, this would fetch updated metrics from the API
      // For now, we'll simulate incremental changes
      setMetrics((prev) => ({
        ...prev,
        currentMonthCollected: prev.currentMonthCollected + 50,
        outstandingThisMonth: Math.max(
          0,
          prev.outstandingThisMonth - 25
        ),
      }));
    } catch (error) {
      console.error("Error refreshing payment metrics:", error);
    }
  };

  // Refresh metrics when payments change
  useEffect(() => {
    if (lastUpdate) {
      // Refresh payment metrics when any payment changes
      refreshPaymentMetrics();
    }
  }, [lastUpdate]);

  const [agingData, setAgingData] = useState<AgingData[]>([
    {
      category: "0-30 days",
      amount: 6250,
      count: 5,
      color: "#22c55e",
      urgency: "low",
    },
    {
      category: "31-60 days",
      amount: 2100,
      count: 2,
      color: "#eab308",
      urgency: "medium",
    },
    {
      category: "61-90 days",
      amount: 850,
      count: 1,
      color: "#f97316",
      urgency: "high",
    },
    {
      category: "90+ days",
      amount: 250,
      count: 1,
      color: "#ef4444",
      urgency: "critical",
    },
  ]);

  const [paymentStatuses, setPaymentStatuses] = useState<PaymentStatus[]>([
    {
      id: "1",
      tenantName: "John Smith",
      propertyAddress: "123 Main St, Apt 101",
      amount: 1500,
      dueDate: new Date("2024-02-01"),
      status: "pending",
      daysOverdue: 0,
      lateFees: 0,
      paymentMethod: "auto_pay",
    },
    {
      id: "2",
      tenantName: "Sarah Johnson",
      propertyAddress: "456 Oak Ave, Unit 2B",
      amount: 1800,
      dueDate: new Date("2024-01-25"),
      status: "overdue",
      daysOverdue: 7,
      lateFees: 50,
      paymentMethod: "manual",
    },
    {
      id: "3",
      tenantName: "Mike Davis",
      propertyAddress: "789 Pine St, Apt 3A",
      amount: 1200,
      dueDate: new Date("2024-02-03"),
      status: "pending",
      daysOverdue: 0,
      lateFees: 0,
      paymentMethod: "online",
    },
  ]);

  const getStatusBadge = (status: PaymentStatus["status"]) => {
    const statusConfig = {
      pending: {
        label: "Pending",
        variant: "secondary",
        color: "bg-yellow-500",
      },
      paid: {
        label: "Paid",
        variant: "default",
        color: "bg-green-500",
      },
      partial: {
        label: "Partial",
        variant: "default",
        color: "bg-blue-500",
      },
      overdue: {
        label: "Overdue",
        variant: "secondary",
        color: "bg-yellow-600",
      },
      cancelled: { label: "Cancelled", variant: "secondary", color: "bg-gray-500" },
      refunded: { label: "Refunded", variant: "secondary", color: "bg-purple-500" },
      failed: { label: "Failed", variant: "destructive", color: "bg-red-500" },
    };

    const config = statusConfig[status];
    return (
      <Badge variant={config.variant as any} className={config.color}>
        {config.label}
      </Badge>
    );
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const collectionPercentage =
    (metrics.currentMonthCollected / metrics.currentMonthTarget) * 100;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Payment Management
          </h2>
          <p className="text-muted-foreground">
            Monitor collections, track overdue payments, and manage tenant
            accounts
          </p>
        </div>
        <div className="flex items-center gap-4">
          {/* Real-time Connection Status */}
          <div className="flex items-center gap-2">
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-muted-foreground">
              {isConnected ? "Live Updates" : "Offline"}
            </span>
            {connectionError && (
              <Button size="sm" variant="outline" onClick={reconnect}>
                Reconnect
              </Button>
            )}
          </div>

          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="h-4 w-4 me-2" />
              Export Report
            </Button>
            <Button>
              <CreditCard className="h-4 w-4 me-2" />
              Process Payment
            </Button>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Current Month Collected
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics.currentMonthCollected)}
            </div>
            <div className="text-xs text-muted-foreground">
              of {formatCurrency(metrics.currentMonthTarget)} target
            </div>
            <Progress value={collectionPercentage} className="mt-2" />
            <div className="text-xs text-muted-foreground mt-1">
              {collectionPercentage.toFixed(1)}% collected
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Outstanding This Month
            </CardTitle>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCurrency(metrics.outstandingThisMonth)}
            </div>
            <p className="text-xs text-muted-foreground">
              {
                paymentStatuses.filter((p) =>
                  ["pending", "overdue", "partial"].includes(p.status)
                ).length
              }{" "}
              payments pending
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Overdue (30+ days)
            </CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">
              {formatCurrency(metrics.overdue30Plus)}
            </div>
            <p className="text-xs text-muted-foreground">
              Requires immediate attention
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Collection Rate
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPercentage(metrics.collectionRate)}
            </div>
            <p className="text-xs text-muted-foreground">
              Avg. {metrics.averageDaysToPayment} days to payment
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="aging">Aging Report</TabsTrigger>
          <TabsTrigger value="payments">Payment Status</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Collection Progress */}
            <Card>
              <CardHeader>
                <CardTitle>Monthly Collection Progress</CardTitle>
                <CardDescription>
                  Current month performance vs target
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Collected</span>
                    <span className="font-bold text-green-600">
                      {formatCurrency(metrics.currentMonthCollected)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Outstanding</span>
                    <span className="font-bold text-orange-600">
                      {formatCurrency(metrics.outstandingThisMonth)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Target</span>
                    <span className="font-bold">
                      {formatCurrency(metrics.currentMonthTarget)}
                    </span>
                  </div>
                  <Progress value={collectionPercentage} className="h-3" />
                  <div className="text-center text-sm text-muted-foreground">
                    {collectionPercentage.toFixed(1)}% of monthly target
                    achieved
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Payment Status Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Payment Status Summary</CardTitle>
                <CardDescription>
                  Current payment statuses across portfolio
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    {
                      status: "pending",
                      count: paymentStatuses.filter(
                        (p) => p.status === "pending"
                      ).length,
                      label: "Pending",
                    },
                    {
                      status: "paid",
                      count: paymentStatuses.filter(
                        (p) => p.status === "paid"
                      ).length,
                      label: "Paid",
                    },
                    {
                      status: "partial",
                      count: paymentStatuses.filter(
                        (p) => p.status === "partial"
                      ).length,
                      label: "Partial",
                    },
                    {
                      status: "overdue",
                      count: paymentStatuses.filter(
                        (p) => p.status === "overdue"
                      ).length,
                      label: "Overdue",
                    },
                    {
                      status: "failed",
                      count: paymentStatuses.filter(
                        (p) => p.status === "failed"
                      ).length,
                      label: "Failed",
                    },
                  ].map((item) => (
                    <div
                      key={item.status}
                      className="flex justify-between items-center"
                    >
                      <span className="text-sm">{item.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.count}</span>
                        {getStatusBadge(item.status as PaymentStatus["status"])}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Payment Activity</CardTitle>
              <CardDescription>
                Latest payment transactions and status changes
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    tenant: "Alice Brown",
                    action: "Payment received",
                    amount: 1600,
                    time: "2 hours ago",
                    type: "success",
                  },
                  {
                    tenant: "Bob Wilson",
                    action: "Auto-pay failed",
                    amount: 1400,
                    time: "5 hours ago",
                    type: "error",
                  },
                  {
                    tenant: "Carol Davis",
                    action: "Late fee applied",
                    amount: 50,
                    time: "1 day ago",
                    type: "warning",
                  },
                  {
                    tenant: "David Miller",
                    action: "Payment reminder sent",
                    amount: 0,
                    time: "2 days ago",
                    type: "info",
                  },
                ].map((activity, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          activity.type === "success"
                            ? "bg-green-500"
                            : activity.type === "error"
                            ? "bg-red-500"
                            : activity.type === "warning"
                            ? "bg-yellow-500"
                            : "bg-blue-500"
                        }`}
                      />
                      <div>
                        <div className="font-medium">{activity.tenant}</div>
                        <div className="text-sm text-muted-foreground">
                          {activity.action}
                        </div>
                      </div>
                    </div>
                    <div className="text-end">
                      {activity.amount > 0 && (
                        <div className="font-medium">
                          {formatCurrency(activity.amount)}
                        </div>
                      )}
                      <div className="text-xs text-muted-foreground">
                        {activity.time}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="aging" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            {/* Aging Chart */}
            <Card>
              <CardHeader>
                <CardTitle>Aging Report</CardTitle>
                <CardDescription>Outstanding balances by age</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={agingData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={(props) => {
                        // Recharts spreads each datum's fields into the label
                        // props at runtime; these come from agingData.
                        const { category, amount } = props as {
                          category?: string;
                          amount?: number;
                        };
                        return `${category}: ${formatCurrency(amount ?? 0)}`;
                      }}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="amount"
                    >
                      {agingData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value) => formatCurrency(value as number)}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Aging Details */}
            <Card>
              <CardHeader>
                <CardTitle>Aging Breakdown</CardTitle>
                <CardDescription>Detailed aging analysis</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {agingData.map((item) => (
                    <div key={item.category} className="space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="font-medium">{item.category}</span>
                        <Badge
                          variant={
                            item.urgency === "critical"
                              ? "destructive"
                              : item.urgency === "high"
                              ? "destructive"
                              : item.urgency === "medium"
                              ? "default"
                              : "secondary"
                          }
                        >
                          {item.urgency.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span>Amount: {formatCurrency(item.amount)}</span>
                        <span>Count: {item.count} payment(s)</span>
                      </div>
                      <Progress
                        value={
                          (item.amount /
                            agingData.reduce((sum, d) => sum + d.amount, 0)) *
                          100
                        }
                        className="h-2"
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Action Items */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                Action Required
              </CardTitle>
              <CardDescription>
                Payments requiring immediate attention
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {paymentStatuses
                  .filter((p) => p.status === "overdue")
                  .map((payment) => (
                    <Alert key={payment.id} variant="destructive">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        <div className="flex justify-between items-center">
                          <div>
                            <strong>{payment.tenantName}</strong> -{" "}
                            {payment.propertyAddress}
                            <br />
                            {formatCurrency(
                              payment.amount + payment.lateFees
                            )}{" "}
                            total due ({payment.daysOverdue} days overdue)
                          </div>
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline">
                              Contact
                            </Button>
                            <Button size="sm">Process Payment</Button>
                          </div>
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Payment Status Overview</CardTitle>
              <CardDescription>
                All current payment statuses and actions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {paymentStatuses.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div>
                        <div className="font-medium">{payment.tenantName}</div>
                        <div className="text-sm text-muted-foreground">
                          {payment.propertyAddress}
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="font-medium">
                          {formatCurrency(payment.amount)}
                        </div>
                        {payment.lateFees > 0 && (
                          <div className="text-xs text-red-600">
                            +{formatCurrency(payment.lateFees)} late fee
                          </div>
                        )}
                      </div>
                      <div className="text-center">
                        <div className="text-sm">
                          {payment.dueDate.toLocaleDateString()}
                        </div>
                        {payment.daysOverdue > 0 && (
                          <div className="text-xs text-red-600">
                            {payment.daysOverdue} days overdue
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(payment.status)}
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline">
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline">
                          <CreditCard className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Collection Trends</CardTitle>
                <CardDescription>
                  Monthly collection performance
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart
                    data={[
                      { month: "Oct", collected: 48000, target: 50000 },
                      { month: "Nov", collected: 51000, target: 52000 },
                      { month: "Dec", collected: 49500, target: 51000 },
                      { month: "Jan", collected: 45750, target: 52000 },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="month" />
                    <YAxis />
                    <Tooltip
                      formatter={(value) => formatCurrency(value as number)}
                    />
                    <Bar dataKey="collected" fill="#22c55e" name="Collected" />
                    <Bar dataKey="target" fill="#e5e7eb" name="Target" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Key Performance Indicators</CardTitle>
                <CardDescription>Portfolio performance metrics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex justify-between items-center">
                    <span>Collection Rate</span>
                    <div className="text-end">
                      <div className="font-bold text-green-600">
                        {formatPercentage(metrics.collectionRate)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Target: 95%
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Average Days to Payment</span>
                    <div className="text-end">
                      <div className="font-bold">
                        {metrics.averageDaysToPayment} days
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Target: &lt;3 days
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Late Payment Rate</span>
                    <div className="text-end">
                      <div className="font-bold text-orange-600">12%</div>
                      <div className="text-xs text-muted-foreground">
                        Target: &lt;10%
                      </div>
                    </div>
                  </div>
                  <div className="flex justify-between items-center">
                    <span>Auto-pay Adoption</span>
                    <div className="text-end">
                      <div className="font-bold text-blue-600">68%</div>
                      <div className="text-xs text-muted-foreground">
                        Target: 75%
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
