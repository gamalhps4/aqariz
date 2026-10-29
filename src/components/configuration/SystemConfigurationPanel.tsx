"use client";

import React, { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Settings,
  Save,
  RotateCcw,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  Mail,
  Target,
} from "lucide-react";

interface PaymentConfiguration {
  gracePeriods: {
    default: number;
    firstTimeRenters: number;
    longTermTenants: number;
    autoPayUsers: number;
  };
  lateFees: {
    enabled: boolean;
    gracePeriodDays: number;
    feeStructure: {
      type: "fixed" | "percentage" | "tiered" | "daily";
      fixedAmount?: number;
      percentage?: number;
      dailyAmount?: number;
    };
    maximumFee?: number;
    autoApplication: boolean;
  };
  communicationTiming: {
    paymentReminders: {
      firstReminder: number;
      secondReminder: number;
      finalReminder: number;
      overdueNotice: number;
      escalationNotice: number;
    };
    channels: {
      email: boolean;
      sms: boolean;
      pushNotification: boolean;
    };
    businessHours: {
      enabled: boolean;
      start: string;
      end: string;
      timezone: string;
      weekendsEnabled: boolean;
    };
  };
  autoPayIncentives: {
    enabled: boolean;
    discountType: "fixed" | "percentage";
    discountAmount: number;
    gracePeriodExtension: number;
  };
}

interface OptimizationRecommendation {
  parameter: string;
  currentValue: any;
  recommendedValue: any;
  reason: string;
  expectedImpact: string;
  confidence: "high" | "medium" | "low";
  priority: "high" | "medium" | "low";
}

export default function SystemConfigurationPanel() {
  const [config, setConfig] = useState<PaymentConfiguration | null>(null);
  const [recommendations, setRecommendations] = useState<
    OptimizationRecommendation[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    loadConfiguration();
    loadRecommendations();
  }, []);

  const loadConfiguration = async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/configuration?action=current");
      const data = await response.json();

      if (data.success) {
        setConfig(data?.data?.configuration);
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Failed to load configuration");
    } finally {
      setLoading(false);
    }
  };

  const loadRecommendations = async () => {
    try {
      const response = await fetch("/api/configuration?action=analyze");
      const data = await response.json();

      if (data.success) {
        setRecommendations(data?.data?.recommendations || []);
      }
    } catch (err) {
      console.error("Failed to load recommendations:", err);
    }
  };

  const saveConfiguration = async () => {
    if (!config) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch("/api/configuration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update",
          configuration: config,
          reason: "Manual configuration update",
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess("Configuration updated successfully");
        setHasChanges(false);
        loadRecommendations(); // Reload recommendations after update
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Failed to save configuration");
    } finally {
      setLoading(false);
    }
  };

  const applyRecommendation = async (
    recommendation: OptimizationRecommendation
  ) => {
    try {
      const response = await fetch("/api/configuration", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "apply-recommendations",
          recommendations: [recommendation],
          selectedIds: ["0"],
        }),
      });

      const data = await response.json();

      if (data.success) {
        setSuccess("Recommendation applied successfully");
        setConfig(data.data.configuration);
        loadRecommendations();
      } else {
        setError(data.message);
      }
    } catch (err) {
      setError("Failed to apply recommendation");
    }
  };

  const updateConfig = (path: string, value: any) => {
    if (!config) return;

    const newConfig = { ...config };
    const keys = path.split(".");
    let current: any = newConfig;

    for (let i = 0; i < keys.length - 1; i++) {
      current = current[keys[i]];
    }

    current[keys[keys.length - 1]] = value;
    setConfig(newConfig);
    setHasChanges(true);
  };

  const getPriorityBadge = (priority: string) => {
    const colors = {
      high: "bg-red-500",
      medium: "bg-yellow-500",
      low: "bg-green-500",
    };

    return (
      <Badge className={colors[priority as keyof typeof colors]}>
        {priority.toUpperCase()}
      </Badge>
    );
  };

  const getConfidenceBadge = (confidence: string) => {
    const colors = {
      high: "bg-green-500",
      medium: "bg-yellow-500",
      low: "bg-gray-500",
    };

    return (
      <Badge className={colors[confidence as keyof typeof colors]}>
        {confidence.toUpperCase()}
      </Badge>
    );
  };

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center h-64">
        <Settings className="h-8 w-8 animate-spin" />
        <span className="ms-2">Loading configuration...</span>
      </div>
    );
  }

  if (!config) {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>Failed to load system configuration</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">
            System Configuration
          </h2>
          <p className="text-muted-foreground">
            Fine-tune system parameters for optimal performance
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            onClick={loadConfiguration}
            variant="outline"
            disabled={loading}
          >
            <RotateCcw
              className={`h-4 w-4 me-2 ${loading ? "animate-spin" : ""}`}
            />
            Reset
          </Button>
          <Button onClick={saveConfiguration} disabled={loading || !hasChanges}>
            <Save className="h-4 w-4 me-2" />
            Save Changes
          </Button>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert>
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}

      {/* Optimization Recommendations */}
      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Optimization Recommendations
            </CardTitle>
            <CardDescription>
              Data-driven suggestions to improve system performance
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recommendations.map((rec, index) => (
                <div key={index} className="border rounded-lg p-4">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{rec.parameter}</h4>
                      {getPriorityBadge(rec.priority)}
                      {getConfidenceBadge(rec.confidence)}
                    </div>
                    <Button
                      size="sm"
                      onClick={() => applyRecommendation(rec)}
                      disabled={loading}
                    >
                      Apply
                    </Button>
                  </div>

                  <p className="text-sm text-muted-foreground mb-2">
                    {rec.reason}
                  </p>

                  <div className="flex justify-between text-sm">
                    <span>
                      Current: <strong>{rec.currentValue}</strong>
                    </span>
                    <span>
                      Recommended: <strong>{rec.recommendedValue}</strong>
                    </span>
                  </div>

                  <p className="text-sm text-green-600 mt-1">
                    Expected Impact: {rec.expectedImpact}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Configuration Tabs */}
      <Tabs defaultValue="grace-periods" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="grace-periods">Grace Periods</TabsTrigger>
          <TabsTrigger value="late-fees">Late Fees</TabsTrigger>
          <TabsTrigger value="communication">Communication</TabsTrigger>
          <TabsTrigger value="incentives">Auto-pay Incentives</TabsTrigger>
        </TabsList>

        <TabsContent value="grace-periods" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Grace Period Configuration
              </CardTitle>
              <CardDescription>
                Set grace periods for different tenant types
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="default-grace">
                    Default Grace Period (days)
                  </Label>
                  <Input
                    id="default-grace"
                    type="number"
                    value={config.gracePeriods.default}
                    onChange={(e) =>
                      updateConfig(
                        "gracePeriods.default",
                        parseInt(e.target.value)
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="first-time-grace">
                    First-time Renters (days)
                  </Label>
                  <Input
                    id="first-time-grace"
                    type="number"
                    value={config.gracePeriods.firstTimeRenters}
                    onChange={(e) =>
                      updateConfig(
                        "gracePeriods.firstTimeRenters",
                        parseInt(e.target.value)
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="long-term-grace">
                    Long-term Tenants (days)
                  </Label>
                  <Input
                    id="long-term-grace"
                    type="number"
                    value={config.gracePeriods.longTermTenants}
                    onChange={(e) =>
                      updateConfig(
                        "gracePeriods.longTermTenants",
                        parseInt(e.target.value)
                      )
                    }
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="autopay-grace">Auto-pay Users (days)</Label>
                  <Input
                    id="autopay-grace"
                    type="number"
                    value={config.gracePeriods.autoPayUsers}
                    onChange={(e) =>
                      updateConfig(
                        "gracePeriods.autoPayUsers",
                        parseInt(e.target.value)
                      )
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="late-fees" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5" />
                Late Fee Configuration
              </CardTitle>
              <CardDescription>
                Configure late fee structure and automation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="late-fees-enabled"
                  checked={config.lateFees.enabled}
                  onCheckedChange={(checked) =>
                    updateConfig("lateFees.enabled", checked)
                  }
                />
                <Label htmlFor="late-fees-enabled">Enable Late Fees</Label>
              </div>

              {config.lateFees.enabled && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="late-grace">Grace Period (days)</Label>
                      <Input
                        id="late-grace"
                        type="number"
                        value={config.lateFees.gracePeriodDays}
                        onChange={(e) =>
                          updateConfig(
                            "lateFees.gracePeriodDays",
                            parseInt(e.target.value)
                          )
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="fee-type">Fee Structure</Label>
                      <Select
                        value={config.lateFees.feeStructure.type}
                        onValueChange={(value) =>
                          updateConfig("lateFees.feeStructure.type", value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed Amount</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                          <SelectItem value="tiered">Tiered</SelectItem>
                          <SelectItem value="daily">Daily</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  {config.lateFees.feeStructure.type === "fixed" && (
                    <div className="space-y-2">
                      <Label htmlFor="fixed-amount">Fixed Amount ($)</Label>
                      <Input
                        id="fixed-amount"
                        type="number"
                        value={config.lateFees.feeStructure.fixedAmount || 0}
                        onChange={(e) =>
                          updateConfig(
                            "lateFees.feeStructure.fixedAmount",
                            parseFloat(e.target.value)
                          )
                        }
                      />
                    </div>
                  )}

                  {config.lateFees.feeStructure.type === "percentage" && (
                    <div className="space-y-2">
                      <Label htmlFor="percentage">Percentage (%)</Label>
                      <Input
                        id="percentage"
                        type="number"
                        value={config.lateFees.feeStructure.percentage || 0}
                        onChange={(e) =>
                          updateConfig(
                            "lateFees.feeStructure.percentage",
                            parseFloat(e.target.value)
                          )
                        }
                      />
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="max-fee">Maximum Fee ($)</Label>
                    <Input
                      id="max-fee"
                      type="number"
                      value={config.lateFees.maximumFee || 0}
                      onChange={(e) =>
                        updateConfig(
                          "lateFees.maximumFee",
                          parseFloat(e.target.value)
                        )
                      }
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="auto-application"
                      checked={config.lateFees.autoApplication}
                      onCheckedChange={(checked) =>
                        updateConfig("lateFees.autoApplication", checked)
                      }
                    />
                    <Label htmlFor="auto-application">
                      Automatic Application
                    </Label>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="communication" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Communication Settings
              </CardTitle>
              <CardDescription>
                Configure payment reminders and communication channels
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <h4 className="font-semibold mb-3">
                  Payment Reminder Schedule
                </h4>
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="first-reminder">
                      First Reminder (days before)
                    </Label>
                    <Input
                      id="first-reminder"
                      type="number"
                      value={
                        config.communicationTiming.paymentReminders
                          .firstReminder
                      }
                      onChange={(e) =>
                        updateConfig(
                          "communicationTiming.paymentReminders.firstReminder",
                          parseInt(e.target.value)
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="second-reminder">
                      Second Reminder (days before)
                    </Label>
                    <Input
                      id="second-reminder"
                      type="number"
                      value={
                        config.communicationTiming.paymentReminders
                          .secondReminder
                      }
                      onChange={(e) =>
                        updateConfig(
                          "communicationTiming.paymentReminders.secondReminder",
                          parseInt(e.target.value)
                        )
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="final-reminder">
                      Final Reminder (days before)
                    </Label>
                    <Input
                      id="final-reminder"
                      type="number"
                      value={
                        config.communicationTiming.paymentReminders
                          .finalReminder
                      }
                      onChange={(e) =>
                        updateConfig(
                          "communicationTiming.paymentReminders.finalReminder",
                          parseInt(e.target.value)
                        )
                      }
                    />
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Communication Channels</h4>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="email-enabled"
                      checked={config.communicationTiming.channels.email}
                      onCheckedChange={(checked) =>
                        updateConfig(
                          "communicationTiming.channels.email",
                          checked
                        )
                      }
                    />
                    <Label htmlFor="email-enabled">Email Notifications</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="sms-enabled"
                      checked={config.communicationTiming.channels.sms}
                      onCheckedChange={(checked) =>
                        updateConfig(
                          "communicationTiming.channels.sms",
                          checked
                        )
                      }
                    />
                    <Label htmlFor="sms-enabled">SMS Notifications</Label>
                  </div>

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="push-enabled"
                      checked={
                        config.communicationTiming.channels.pushNotification
                      }
                      onCheckedChange={(checked) =>
                        updateConfig(
                          "communicationTiming.channels.pushNotification",
                          checked
                        )
                      }
                    />
                    <Label htmlFor="push-enabled">Push Notifications</Label>
                  </div>
                </div>
              </div>

              <div>
                <h4 className="font-semibold mb-3">Business Hours</h4>
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="business-hours"
                      checked={config.communicationTiming.businessHours.enabled}
                      onCheckedChange={(checked) =>
                        updateConfig(
                          "communicationTiming.businessHours.enabled",
                          checked
                        )
                      }
                    />
                    <Label htmlFor="business-hours">
                      Restrict to Business Hours
                    </Label>
                  </div>

                  {config.communicationTiming.businessHours.enabled && (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="start-time">Start Time</Label>
                        <Input
                          id="start-time"
                          type="time"
                          value={config.communicationTiming.businessHours.start}
                          onChange={(e) =>
                            updateConfig(
                              "communicationTiming.businessHours.start",
                              e.target.value
                            )
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label htmlFor="end-time">End Time</Label>
                        <Input
                          id="end-time"
                          type="time"
                          value={config.communicationTiming.businessHours.end}
                          onChange={(e) =>
                            updateConfig(
                              "communicationTiming.businessHours.end",
                              e.target.value
                            )
                          }
                        />
                      </div>
                    </div>
                  )}

                  <div className="flex items-center space-x-2">
                    <Switch
                      id="weekends-enabled"
                      checked={
                        config.communicationTiming.businessHours.weekendsEnabled
                      }
                      onCheckedChange={(checked) =>
                        updateConfig(
                          "communicationTiming.businessHours.weekendsEnabled",
                          checked
                        )
                      }
                    />
                    <Label htmlFor="weekends-enabled">Include Weekends</Label>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="incentives" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5" />
                Auto-pay Incentives
              </CardTitle>
              <CardDescription>
                Configure incentives to encourage auto-pay adoption
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Switch
                  id="incentives-enabled"
                  checked={config.autoPayIncentives.enabled}
                  onCheckedChange={(checked) =>
                    updateConfig("autoPayIncentives.enabled", checked)
                  }
                />
                <Label htmlFor="incentives-enabled">
                  Enable Auto-pay Incentives
                </Label>
              </div>

              {config.autoPayIncentives.enabled && (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="discount-type">Discount Type</Label>
                      <Select
                        value={config.autoPayIncentives.discountType}
                        onValueChange={(value) =>
                          updateConfig("autoPayIncentives.discountType", value)
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="fixed">Fixed Amount</SelectItem>
                          <SelectItem value="percentage">Percentage</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="discount-amount">
                        Discount Amount{" "}
                        {config.autoPayIncentives.discountType === "fixed"
                          ? "($)"
                          : "(%)"}
                      </Label>
                      <Input
                        id="discount-amount"
                        type="number"
                        value={config.autoPayIncentives.discountAmount}
                        onChange={(e) =>
                          updateConfig(
                            "autoPayIncentives.discountAmount",
                            parseFloat(e.target.value)
                          )
                        }
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="grace-extension">
                      Grace Period Extension (days)
                    </Label>
                    <Input
                      id="grace-extension"
                      type="number"
                      value={config.autoPayIncentives.gracePeriodExtension}
                      onChange={(e) =>
                        updateConfig(
                          "autoPayIncentives.gracePeriodExtension",
                          parseInt(e.target.value)
                        )
                      }
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
