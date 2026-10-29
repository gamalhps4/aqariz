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
  DollarSign,
  TrendingUp,
  Clock,
  AlertTriangle,
  Calendar,
  Target,
  RefreshCw,
  Download,
  Filter,
} from "lucide-react";
import { DashboardMetrics } from "@/lib/services/payment-dashboard.service";
import { paymentApiClient } from "@/lib/api/payment-api.client";
import { toast } from "sonner";
import { formatCurrency } from "@/lib/utils/formatting";

interface EnhancedPaymentDashboardProps {
  propertyId?: string;
  managerId?: string;
  onRefresh?: () => void;
}

export function EnhancedPaymentDashboard({
  propertyId,
  managerId,
  onRefresh,
}: EnhancedPaymentDashboardProps) {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedTimeRange, setSelectedTimeRange] = useState("current");

  useEffect(() => {
    fetchDashboardMetrics();
  }, [propertyId, managerId, selectedTimeRange]);

  const fetchDashboardMetrics = async () => {
    try {
      setLoading(true);
      const response = await paymentApiClient.getDashboardMetrics({
        propertyId,
        managerId,
        timeRange: selectedTimeRange,
      });

      if (response.success) {
        setMetrics(response.data);
      } else {
        toast.error(response.message || "Failed to load dashboard metrics");
      }
    } catch (error) {
      console.error("Error fetching dashboard metrics:", error);
      toast.error("Failed to load dashboard metrics");
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const response = await paymentApiClient.refreshDashboardMetrics(
        propertyId
      );
      if (response.success) {
        setMetrics(response.data);
        toast.success("Dashboard refreshed");
      } else {
        toast.error(response.message || "Failed to refresh dashboard");
      }
    } catch (error) {
      console.error("Error refreshing dashboard:", error);
      toast.error("Failed to refresh dashboard");
    }
    setRefreshing(false);
    onRefresh?.();
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat("en-US", {
  //     style: "currency",
  //     currency: "USD",
  //   }).format(amount);
  // };

  const formatPercentage = (value: number) => {
    return `${value.toFixed(1)}%`;
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-6">
                <div className="animate-pulse space-y-2">
                  <div className="h-4 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-8 bg-gray-200 rounded w-1/2"></div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          Unable to load dashboard metrics. Please try refreshing the page.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">
            Payment Dashboard
          </h2>
          <p className="text-muted-foreground">
            Real-time payment analytics and collection metrics
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            <RefreshCw
              className={`h-4 w-4 me-2 ${refreshing ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
          <Button variant="outline" size="sm">
            <Download className="h-4 w-4 me-2" />
            Export
          </Button>
          <Button variant="outline" size="sm">
            <Filter className="h-4 w-4 me-2" />
            Filter
          </Button>
        </div>
      </div>

      {/* Alerts */}
      {metrics.alerts.length > 0 && (
        <div className="space-y-2">
          {metrics.alerts.slice(0, 3).map((alert, index) => (
            <Alert
              key={index}
              variant={alert.type === "error" ? "destructive" : "default"}
            >
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{alert.message}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Collection Rate
                </p>
                <p className="text-2xl font-bold">
                  {formatPercentage(
                    metrics.collectionMetrics.currentMonth.collectionRate
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  vs{" "}
                  {formatPercentage(
                    metrics.collectionMetrics.previousMonth.collectionRate
                  )}{" "}
                  last month
                </p>
              </div>
              <div className="h-8 w-8 bg-green-100 rounded-full flex items-center justify-center">
                <Target className="h-4 w-4 text-green-600" />
              </div>
            </div>
            <Progress
              value={metrics.collectionMetrics.currentMonth.collectionRate}
              className="mt-3"
            />
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Current Month Collected
                </p>
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    metrics.collectionMetrics.currentMonth.collected
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  of{" "}
                  {formatCurrency(
                    metrics.collectionMetrics.currentMonth.expected
                  )}{" "}
                  expected
                </p>
              </div>
              <div className="h-8 w-8 bg-blue-100 rounded-full flex items-center justify-center">
                <DollarSign className="h-4 w-4 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Outstanding Amount
                </p>
                <p className="text-2xl font-bold">
                  {formatCurrency(
                    metrics.collectionMetrics.currentMonth.outstanding
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {metrics.agingReport.totalOverdue.count} overdue payments
                </p>
              </div>
              <div className="h-8 w-8 bg-red-100 rounded-full flex items-center justify-center">
                <AlertTriangle className="h-4 w-4 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Avg Days to Payment
                </p>
                <p className="text-2xl font-bold">
                  {metrics.collectionMetrics.averageDaysToPayment}
                </p>
                <p className="text-xs text-muted-foreground">
                  {metrics.paymentBehavior.averageLateDays} avg late days
                </p>
              </div>
              <div className="h-8 w-8 bg-yellow-100 rounded-full flex items-center justify-center">
                <Clock className="h-4 w-4 text-yellow-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Detailed Analytics */}
      <Tabs defaultValue="aging" className="space-y-4">
        <TabsList>
          <TabsTrigger value="aging">Aging Report</TabsTrigger>
          <TabsTrigger value="behavior">Payment Behavior</TabsTrigger>
          <TabsTrigger value="cashflow">Cash Flow</TabsTrigger>
          <TabsTrigger value="trends">Trends</TabsTrigger>
        </TabsList>

        <TabsContent value="aging" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Aging Report</CardTitle>
              <CardDescription>
                Breakdown of overdue payments by age
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="text-center p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">0-30 Days</p>
                  <p className="text-2xl font-bold text-green-600">
                    {formatCurrency(metrics.agingReport.current.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.agingReport.current.count} payments
                  </p>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">31-60 Days</p>
                  <p className="text-2xl font-bold text-yellow-600">
                    {formatCurrency(metrics.agingReport.early.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.agingReport.early.count} payments
                  </p>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">61-90 Days</p>
                  <p className="text-2xl font-bold text-orange-600">
                    {formatCurrency(metrics.agingReport.serious.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.agingReport.serious.count} payments
                  </p>
                </div>
                <div className="text-center p-4 border rounded-lg">
                  <p className="text-sm text-muted-foreground">90+ Days</p>
                  <p className="text-2xl font-bold text-red-600">
                    {formatCurrency(metrics.agingReport.critical.amount)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {metrics.agingReport.critical.count} payments
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="behavior" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Payment Timing</CardTitle>
                <CardDescription>
                  On-time vs late payment analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">On-time Payments</span>
                    <Badge variant="secondary">
                      {metrics.paymentBehavior.onTimePayments}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Late Payments</span>
                    <Badge variant="destructive">
                      {metrics.paymentBehavior.latePayments}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Average Late Days</span>
                    <span className="text-sm font-medium">
                      {metrics.paymentBehavior.averageLateDays} days
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Repeat Offenders</CardTitle>
                <CardDescription>
                  Tenants with multiple late payments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {metrics.paymentBehavior.repeatOffenders
                    .slice(0, 5)
                    .map((offender, index) => (
                      <div
                        key={index}
                        className="flex items-center justify-between p-2 border rounded"
                      >
                        <div>
                          <p className="text-sm font-medium">
                            {offender.tenantName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {offender.averageLateDays} avg days late
                          </p>
                        </div>
                        <Badge variant="outline">
                          {offender.latePaymentCount} late
                        </Badge>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cashflow" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader>
                <CardTitle>Next Month Projection</CardTitle>
                <CardDescription>
                  Expected vs projected collections
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Expected</span>
                    <span className="font-medium">
                      {formatCurrency(
                        metrics.cashFlowProjection.nextMonth.expected
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Projected</span>
                    <span className="font-medium">
                      {formatCurrency(
                        metrics.cashFlowProjection.nextMonth.projected
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Confidence</span>
                    <Badge variant="secondary">
                      {formatPercentage(
                        metrics.cashFlowProjection.nextMonth.confidence * 100
                      )}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>3-Month Outlook</CardTitle>
                <CardDescription>Quarterly projection summary</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Expected</span>
                    <span className="font-medium">
                      {formatCurrency(
                        metrics.cashFlowProjection.next3Months.expected
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Projected</span>
                    <span className="font-medium">
                      {formatCurrency(
                        metrics.cashFlowProjection.next3Months.projected
                      )}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm">Confidence</span>
                    <Badge variant="secondary">
                      {formatPercentage(
                        metrics.cashFlowProjection.next3Months.confidence * 100
                      )}
                    </Badge>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="trends" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Performance Trends</CardTitle>
              <CardDescription>Historical performance analysis</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8 text-muted-foreground">
                <TrendingUp className="h-12 w-12 mx-auto mb-4" />
                <p>Trend analysis coming soon</p>
                <p className="text-sm">
                  Historical data visualization will be available here
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
