"use client";

import React, { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Progress } from "@/components/ui/progress";
import {
  Play,
  Pause,
  Settings,
  Mail,
  MessageSquare,
  DollarSign,
  Clock,
  Users,
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Zap,
} from "lucide-react";

interface AutomationRule {
  id: string;
  name: string;
  type: "payment_generation" | "reminder" | "late_fee" | "overdue_notice";
  enabled: boolean;
  schedule: string;
  lastRun: Date | null;
  nextRun: Date;
  successRate: number;
  totalRuns: number;
}

interface AutomationMetrics {
  totalAutomations: number;
  activeAutomations: number;
  paymentsGenerated: number;
  remindersSent: number;
  lateFeesApplied: number;
  automationSuccessRate: number;
}

interface ScheduledTask {
  id: string;
  type:
    | "generate_rent"
    | "send_reminder"
    | "apply_late_fee"
    | "send_overdue_notice";
  tenantName: string;
  propertyAddress: string;
  amount: number;
  scheduledTime: Date;
  status: "pending" | "running" | "completed" | "failed";
  retryCount: number;
}
import { formatCurrency } from "@/lib/utils/formatting";

export default function AutomatedPaymentDashboard() {
  const [metrics, setMetrics] = useState<AutomationMetrics>({
    totalAutomations: 12,
    activeAutomations: 10,
    paymentsGenerated: 45,
    remindersSent: 23,
    lateFeesApplied: 3,
    automationSuccessRate: 0.96,
  });

  const [automationRules, setAutomationRules] = useState<AutomationRule[]>([
    {
      id: "auto_1",
      name: "Monthly Rent Generation",
      type: "payment_generation",
      enabled: true,
      schedule: "1st of every month at 12:00 AM",
      lastRun: new Date("2024-01-01"),
      nextRun: new Date("2024-02-01"),
      successRate: 1.0,
      totalRuns: 12,
    },
    {
      id: "auto_2",
      name: "Payment Reminder (7 days)",
      type: "reminder",
      enabled: true,
      schedule: "7 days before due date",
      lastRun: new Date("2024-01-25"),
      nextRun: new Date("2024-01-25"),
      successRate: 0.95,
      totalRuns: 156,
    },
    {
      id: "auto_3",
      name: "Payment Reminder (3 days)",
      type: "reminder",
      enabled: true,
      schedule: "3 days before due date",
      lastRun: new Date("2024-01-29"),
      nextRun: new Date("2024-01-29"),
      successRate: 0.98,
      totalRuns: 142,
    },
    {
      id: "auto_4",
      name: "Final Payment Reminder",
      type: "reminder",
      enabled: true,
      schedule: "1 day before due date",
      lastRun: new Date("2024-01-31"),
      nextRun: new Date("2024-01-31"),
      successRate: 0.97,
      totalRuns: 138,
    },
    {
      id: "auto_5",
      name: "Late Fee Application",
      type: "late_fee",
      enabled: true,
      schedule: "5 days after due date",
      lastRun: new Date("2024-01-06"),
      nextRun: new Date("2024-02-06"),
      successRate: 1.0,
      totalRuns: 8,
    },
    {
      id: "auto_6",
      name: "Overdue Notice (15 days)",
      type: "overdue_notice",
      enabled: true,
      schedule: "15 days after due date",
      lastRun: new Date("2024-01-16"),
      nextRun: new Date("2024-02-16"),
      successRate: 0.92,
      totalRuns: 5,
    },
  ]);

  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([
    {
      id: "task_1",
      type: "send_reminder",
      tenantName: "John Smith",
      propertyAddress: "123 Main St, Apt 101",
      amount: 1500,
      scheduledTime: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2 hours from now
      status: "pending",
      retryCount: 0,
    },
    {
      id: "task_2",
      type: "generate_rent",
      tenantName: "Sarah Johnson",
      propertyAddress: "456 Oak Ave, Unit 2B",
      amount: 1800,
      scheduledTime: new Date("2024-02-01T00:00:00"),
      status: "pending",
      retryCount: 0,
    },
    {
      id: "task_3",
      type: "apply_late_fee",
      tenantName: "Mike Davis",
      propertyAddress: "789 Pine St, Apt 3A",
      amount: 50,
      scheduledTime: new Date(Date.now() + 24 * 60 * 60 * 1000), // 1 day from now
      status: "pending",
      retryCount: 0,
    },
  ]);

  const [masterAutomationEnabled, setMasterAutomationEnabled] = useState(true);

  const toggleAutomationRule = (ruleId: string) => {
    setAutomationRules((rules) =>
      rules.map((rule) =>
        rule.id === ruleId ? { ...rule, enabled: !rule.enabled } : rule
      )
    );
  };

  const getAutomationIcon = (type: AutomationRule["type"]) => {
    switch (type) {
      case "payment_generation":
        return <DollarSign className="h-4 w-4" />;
      case "reminder":
        return <Mail className="h-4 w-4" />;
      case "late_fee":
        return <AlertTriangle className="h-4 w-4" />;
      case "overdue_notice":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <Settings className="h-4 w-4" />;
    }
  };

  const getTaskIcon = (type: ScheduledTask["type"]) => {
    switch (type) {
      case "generate_rent":
        return <DollarSign className="h-4 w-4" />;
      case "send_reminder":
        return <Mail className="h-4 w-4" />;
      case "apply_late_fee":
        return <AlertTriangle className="h-4 w-4" />;
      case "send_overdue_notice":
        return <MessageSquare className="h-4 w-4" />;
      default:
        return <Clock className="h-4 w-4" />;
    }
  };

  const getStatusBadge = (status: ScheduledTask["status"]) => {
    const statusConfig = {
      pending: { label: "Pending", variant: "secondary" },
      running: { label: "Running", variant: "default" },
      completed: { label: "Completed", variant: "default" },
      failed: { label: "Failed", variant: "destructive" },
    };

    const config = statusConfig[status];
    return <Badge variant={config.variant as any}>{config.label}</Badge>;
  };

  // const formatCurrency = (amount: number) => {
  //   return new Intl.NumberFormat('en-US', {
  //     style: 'currency',
  //     currency: 'USD',
  //   }).format(amount);
  // };

  const formatPercentage = (value: number) => {
    return `${(value * 100).toFixed(1)}%`;
  };

  const formatRelativeTime = (date: Date) => {
    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

    if (Math.abs(diffHours) < 24) {
      if (diffHours === 0) return "Now";
      return diffHours > 0 ? `In ${diffHours}h` : `${Math.abs(diffHours)}h ago`;
    } else {
      return diffDays > 0 ? `In ${diffDays}d` : `${Math.abs(diffDays)}d ago`;
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            Payment Automation
          </h2>
          <p className="text-muted-foreground">
            Manage automated payment processing and communication workflows
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center space-x-2">
            <Switch
              id="master-automation"
              checked={masterAutomationEnabled}
              onCheckedChange={setMasterAutomationEnabled}
            />
            <Label htmlFor="master-automation" className="font-medium">
              Master Automation {masterAutomationEnabled ? "ON" : "OFF"}
            </Label>
          </div>
          <Button>
            <Settings className="h-4 w-4 me-2" />
            Configure
          </Button>
        </div>
      </div>

      {/* Automation Status Alert */}
      {!masterAutomationEnabled && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Master automation is disabled. All automated processes are paused.
          </AlertDescription>
        </Alert>
      )}

      {/* Metrics Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Active Automations
            </CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.activeAutomations}
            </div>
            <p className="text-xs text-muted-foreground">
              of {metrics.totalAutomations} total rules
            </p>
            <Progress
              value={
                (metrics.activeAutomations / metrics.totalAutomations) * 100
              }
              className="mt-2"
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Payments Generated
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {metrics.paymentsGenerated}
            </div>
            <p className="text-xs text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Reminders Sent
            </CardTitle>
            <Mail className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{metrics.remindersSent}</div>
            <p className="text-xs text-muted-foreground">This month</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Success Rate</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatPercentage(metrics.automationSuccessRate)}
            </div>
            <p className="text-xs text-muted-foreground">
              Automation reliability
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="rules" className="space-y-4">
        <TabsList>
          <TabsTrigger value="rules">Automation Rules</TabsTrigger>
          <TabsTrigger value="schedule">Scheduled Tasks</TabsTrigger>
          <TabsTrigger value="history">Execution History</TabsTrigger>
        </TabsList>

        <TabsContent value="rules" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Automation Rules</CardTitle>
              <CardDescription>
                Configure and manage automated payment processing rules
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {automationRules.map((rule) => (
                  <div
                    key={rule.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {getAutomationIcon(rule.type)}
                        <div>
                          <div className="font-medium">{rule.name}</div>
                          <div className="text-sm text-muted-foreground">
                            {rule.schedule}
                          </div>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium">Success Rate</div>
                        <div className="text-lg font-bold text-green-600">
                          {formatPercentage(rule.successRate)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {rule.totalRuns} runs
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm font-medium">Next Run</div>
                        <div className="text-sm">
                          {rule.nextRun.toLocaleDateString()}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatRelativeTime(rule.nextRun)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Switch
                        checked={rule.enabled && masterAutomationEnabled}
                        onCheckedChange={() => toggleAutomationRule(rule.id)}
                        disabled={!masterAutomationEnabled}
                      />
                      <Button size="sm" variant="outline">
                        <Settings className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Scheduled Tasks</CardTitle>
              <CardDescription>
                Upcoming automated tasks and their execution status
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {scheduledTasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        {getTaskIcon(task.type)}
                        <div>
                          <div className="font-medium">
                            {task.type
                              .replace("_", " ")
                              .replace(/\b\w/g, (l) => l.toUpperCase())}
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {task.tenantName} - {task.propertyAddress}
                          </div>
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="font-medium">
                          {formatCurrency(task.amount)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Amount
                        </div>
                      </div>
                      <div className="text-center">
                        <div className="text-sm">
                          {task.scheduledTime.toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatRelativeTime(task.scheduledTime)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {getStatusBadge(task.status)}
                      {task.retryCount > 0 && (
                        <Badge variant="outline">Retry {task.retryCount}</Badge>
                      )}
                      <div className="flex gap-1">
                        <Button size="sm" variant="outline">
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button size="sm" variant="outline">
                          <Pause className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Execution History</CardTitle>
              <CardDescription>
                Recent automation execution results and performance
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {[
                  {
                    rule: "Monthly Rent Generation",
                    executed: new Date("2024-01-01T00:00:00"),
                    status: "completed",
                    affected: 45,
                    duration: "2.3s",
                  },
                  {
                    rule: "Payment Reminder (7 days)",
                    executed: new Date("2024-01-25T09:00:00"),
                    status: "completed",
                    affected: 23,
                    duration: "1.8s",
                  },
                  {
                    rule: "Late Fee Application",
                    executed: new Date("2024-01-06T00:00:00"),
                    status: "completed",
                    affected: 3,
                    duration: "0.5s",
                  },
                  {
                    rule: "Payment Reminder (3 days)",
                    executed: new Date("2024-01-29T09:00:00"),
                    status: "failed",
                    affected: 0,
                    duration: "0.1s",
                    error: "Email service temporarily unavailable",
                  },
                ].map((execution, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 border rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`w-3 h-3 rounded-full ${
                          execution.status === "completed"
                            ? "bg-green-500"
                            : "bg-red-500"
                        }`}
                      />
                      <div>
                        <div className="font-medium">{execution.rule}</div>
                        <div className="text-sm text-muted-foreground">
                          {execution.executed.toLocaleString()}
                        </div>
                        {execution.error && (
                          <div className="text-xs text-red-600">
                            {execution.error}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="text-end">
                      <div className="text-sm font-medium">
                        {execution.affected} affected • {execution.duration}
                      </div>
                      {getStatusBadge(
                        execution.status as ScheduledTask["status"]
                      )}
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
