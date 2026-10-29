"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/utils/formatting";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  BarChart3,
  TrendingUp,
  Clock,
  AlertTriangle,
} from "lucide-react";
import { EmergencyAnalytics } from "@/components/emergency/emergency-analytics";
import { EmergencyDashboardCards } from "@/components/emergency/emergency-dashboard-cards";

export default function EmergencyAnalyticsPage() {
  const [activeTab, setActiveTab] = useState("overview");

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/dashboard/maintenance/emergency">
          <Button variant="outline" size="sm">
            <ArrowLeft className="me-2 h-4 w-4 rtl:-scale-x-100" />
            Back to Emergency Requests
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Emergency Analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Comprehensive analytics and performance metrics for emergency
            response
          </p>
        </div>
      </div>

      {/* Analytics Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="space-y-6"
      >
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview" className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Overview
          </TabsTrigger>
          <TabsTrigger value="performance" className="flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Performance
          </TabsTrigger>
          <TabsTrigger value="trends" className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Trends
          </TabsTrigger>
          <TabsTrigger value="alerts" className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Alerts
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <EmergencyDashboardCards showRefresh={true} />
          <EmergencyAnalytics timeframe={30} />
        </TabsContent>

        <TabsContent value="performance" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            <Card className="border-blue-200">
              <CardHeader>
                <CardTitle className="text-blue-700">SLA Compliance</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-blue-600 mb-2">87%</div>
                <p className="text-sm text-muted-foreground">
                  Emergencies resolved within 2-hour SLA
                </p>
                <div className="mt-4 bg-blue-100 rounded-full h-2">
                  <div
                    className="bg-blue-600 h-2 rounded-full"
                    style={{ width: "87%" }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-green-200">
              <CardHeader>
                <CardTitle className="text-green-700">
                  Resolution Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-green-600 mb-2">
                  94%
                </div>
                <p className="text-sm text-muted-foreground">
                  Emergency requests successfully resolved
                </p>
                <div className="mt-4 bg-green-100 rounded-full h-2">
                  <div
                    className="bg-green-600 h-2 rounded-full"
                    style={{ width: "94%" }}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="border-orange-200">
              <CardHeader>
                <CardTitle className="text-orange-700">
                  Escalation Rate
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold text-orange-600 mb-2">
                  12%
                </div>
                <p className="text-sm text-muted-foreground">
                  Emergencies requiring escalation
                </p>
                <div className="mt-4 bg-orange-100 rounded-full h-2">
                  <div
                    className="bg-orange-600 h-2 rounded-full"
                    style={{ width: "12%" }}
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Performance Metrics by Category</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {[
                  {
                    category: "Water Leak",
                    avgTime: "1.2h",
                    sla: "98%",
                    cost: 245,
                  },
                  {
                    category: "Electrical Hazard",
                    avgTime: "0.8h",
                    sla: "100%",
                    cost: 380,
                  },
                  {
                    category: "HVAC Failure",
                    avgTime: "2.1h",
                    sla: "85%",
                    cost: 520,
                  },
                  {
                    category: "Security Breach",
                    avgTime: "0.5h",
                    sla: "100%",
                    cost: 150,
                  },
                  {
                    category: "Gas Leak",
                    avgTime: "0.3h",
                    sla: "100%",
                    cost: 420,
                  },
                ].map((item, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="font-medium">{item.category}</div>
                    <div className="flex items-center gap-6 text-sm">
                      <div>
                        <span className="text-muted-foreground">
                          Avg Time:{" "}
                        </span>
                        <span className="font-medium">{item.avgTime}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">SLA: </span>
                        <span className="font-medium">{item.sla}</span>
                      </div>
                      <div>
                        <span className="text-muted-foreground">
                          Avg Cost:{" "}
                        </span>
                        <span className="font-medium">
                          {formatCurrency(item.cost)}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="trends" className="space-y-6">
          <EmergencyAnalytics timeframe={90} />

          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Monthly Trends</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { month: "January", emergencies: 23, change: "+12%" },
                    { month: "February", emergencies: 18, change: "-22%" },
                    { month: "March", emergencies: 31, change: "+72%" },
                    { month: "April", emergencies: 15, change: "-52%" },
                    { month: "May", emergencies: 27, change: "+80%" },
                  ].map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between"
                    >
                      <span className="font-medium">{item.month}</span>
                      <div className="flex items-center gap-2">
                        <span>{item.emergencies} emergencies</span>
                        <span
                          className={`text-sm ${
                            item.change.startsWith("+")
                              ? "text-red-600"
                              : "text-green-600"
                          }`}
                        >
                          {item.change}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Peak Hours Analysis</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { time: "6:00 AM - 9:00 AM", count: 8, percentage: "15%" },
                    {
                      time: "9:00 AM - 12:00 PM",
                      count: 12,
                      percentage: "23%",
                    },
                    {
                      time: "12:00 PM - 3:00 PM",
                      count: 15,
                      percentage: "29%",
                    },
                    { time: "3:00 PM - 6:00 PM", count: 10, percentage: "19%" },
                    { time: "6:00 PM - 9:00 PM", count: 5, percentage: "10%" },
                    { time: "9:00 PM - 6:00 AM", count: 2, percentage: "4%" },
                  ].map((item, index) => (
                    <div
                      key={index}
                      className="flex items-center justify-between"
                    >
                      <span className="text-sm">{item.time}</span>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{item.count}</span>
                        <span className="text-sm text-muted-foreground">
                          ({item.percentage})
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="alerts" className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-red-700 flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5" />
                  Critical Alerts
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-red-600 mb-2">3</div>
                <p className="text-sm text-red-700">
                  Emergencies over 4 hours old
                </p>
              </CardContent>
            </Card>

            <Card className="border-orange-200 bg-orange-50">
              <CardHeader>
                <CardTitle className="text-orange-700 flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  SLA Breaches
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-orange-600 mb-2">7</div>
                <p className="text-sm text-orange-700">
                  Requests past 2-hour SLA
                </p>
              </CardContent>
            </Card>

            <Card className="border-yellow-200 bg-yellow-50">
              <CardHeader>
                <CardTitle className="text-yellow-700">Unassigned</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-yellow-600 mb-2">2</div>
                <p className="text-sm text-yellow-700">
                  Emergencies awaiting assignment
                </p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Alert History</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    time: "2 hours ago",
                    type: "SLA Breach",
                    message:
                      "Water leak at Sunset Apartments exceeded 2-hour SLA",
                    severity: "high",
                  },
                  {
                    time: "4 hours ago",
                    type: "Critical Alert",
                    message: "Electrical hazard at Oak Plaza over 4 hours old",
                    severity: "critical",
                  },
                  {
                    time: "6 hours ago",
                    type: "Escalation",
                    message: "HVAC failure escalated to property manager",
                    severity: "medium",
                  },
                ].map((alert, index) => (
                  <div
                    key={index}
                    className="flex items-start gap-3 p-3 border rounded-lg"
                  >
                    <div
                      className={`w-2 h-2 rounded-full mt-2 ${
                        alert.severity === "critical"
                          ? "bg-red-500"
                          : alert.severity === "high"
                          ? "bg-orange-500"
                          : "bg-yellow-500"
                      }`}
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{alert.type}</span>
                        <span className="text-sm text-muted-foreground">
                          {alert.time}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {alert.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
