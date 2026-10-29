"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Clock,
  User,
  CheckCircle,
  ArrowRight,
  Zap,
  Bell,
  Phone,
  Mail,
  Settings,
} from "lucide-react";
import { MaintenanceStatus } from "@/types";

interface WorkflowStep {
  id: string;
  title: string;
  description: string;
  status: "completed" | "current" | "pending" | "skipped";
  icon: React.ComponentType<{ className?: string }>;
  timestamp?: string;
  assignedTo?: string;
  duration?: string;
  slaTarget?: string;
  actions?: Array<{
    label: string;
    onClick: () => void;
    variant: "default" | "destructive" | "outline";
  }>;
}

interface EmergencyWorkflowProps {
  requestId: string;
  currentStatus: MaintenanceStatus;
  createdAt: string;
  assignedUser?: {
    firstName: string;
    lastName: string;
  };
  completedAt?: string;
  isOverdue: boolean;
  urgencyLevel: "normal" | "overdue" | "critical";
  onStatusChange?: (newStatus: MaintenanceStatus) => void;
  onEscalate?: () => void;
  onNotify?: () => void;
}

export function EmergencyWorkflow({
  requestId,
  currentStatus,
  createdAt,
  assignedUser,
  completedAt,
  isOverdue,
  urgencyLevel,
  onStatusChange,
  onEscalate,
  onNotify,
}: EmergencyWorkflowProps) {
  const getWorkflowSteps = (): WorkflowStep[] => {
    const steps: WorkflowStep[] = [
      {
        id: "submitted",
        title: "Emergency Reported",
        description: "Emergency request submitted and logged",
        status: "completed",
        icon: AlertTriangle,
        timestamp: new Date(createdAt).toLocaleString(),
        slaTarget: "Immediate",
      },
      {
        id: "notification",
        title: "Notifications Sent",
        description: "Emergency alerts sent to on-call staff",
        status: "completed",
        icon: Bell,
        timestamp: new Date(
          new Date(createdAt).getTime() + 30000
        ).toLocaleString(), // 30 seconds after
        slaTarget: "< 1 minute",
      },
      {
        id: "assigned",
        title: "Staff Assigned",
        description: "Emergency assigned to qualified personnel",
        status:
          currentStatus === MaintenanceStatus.SUBMITTED
            ? "current"
            : "completed",
        icon: User,
        timestamp:
          currentStatus !== MaintenanceStatus.SUBMITTED
            ? new Date(new Date(createdAt).getTime() + 300000).toLocaleString() // 5 minutes after
            : undefined,
        assignedTo: assignedUser
          ? `${assignedUser.firstName} ${assignedUser.lastName}`
          : undefined,
        slaTarget: "< 15 minutes",
        actions:
          currentStatus === MaintenanceStatus.SUBMITTED
            ? [
                {
                  label: "Assign Now",
                  onClick: () => onStatusChange?.(MaintenanceStatus.ASSIGNED),
                  variant: "destructive",
                },
                {
                  label: "Escalate",
                  onClick: () => onEscalate?.(),
                  variant: "outline",
                },
              ]
            : undefined,
      },
      {
        id: "response",
        title: "Response Initiated",
        description: "Staff contacted tenant and began assessment",
        status:
          currentStatus === MaintenanceStatus.ASSIGNED
            ? "current"
            : [
                MaintenanceStatus.IN_PROGRESS,
                MaintenanceStatus.COMPLETED,
              ].includes(currentStatus)
            ? "completed"
            : "pending",
        icon: Phone,
        timestamp:
          currentStatus === MaintenanceStatus.IN_PROGRESS ||
          currentStatus === MaintenanceStatus.COMPLETED
            ? new Date(new Date(createdAt).getTime() + 900000).toLocaleString() // 15 minutes after
            : undefined,
        slaTarget: "< 30 minutes",
        actions:
          currentStatus === MaintenanceStatus.ASSIGNED
            ? [
                {
                  label: "Start Response",
                  onClick: () =>
                    onStatusChange?.(MaintenanceStatus.IN_PROGRESS),
                  variant: "default",
                },
              ]
            : undefined,
      },
      {
        id: "in_progress",
        title: "Work in Progress",
        description: "Emergency repair/resolution in progress",
        status:
          currentStatus === MaintenanceStatus.IN_PROGRESS
            ? "current"
            : currentStatus === MaintenanceStatus.COMPLETED
            ? "completed"
            : "pending",
        icon: Settings,
        timestamp:
          currentStatus === MaintenanceStatus.COMPLETED
            ? new Date(new Date(createdAt).getTime() + 3600000).toLocaleString() // 1 hour after
            : undefined,
        slaTarget: "< 2 hours",
        actions:
          currentStatus === MaintenanceStatus.IN_PROGRESS
            ? [
                {
                  label: "Mark Complete",
                  onClick: () => onStatusChange?.(MaintenanceStatus.COMPLETED),
                  variant: "default",
                },
              ]
            : undefined,
      },
      {
        id: "completed",
        title: "Emergency Resolved",
        description: "Emergency successfully resolved and verified",
        status:
          currentStatus === MaintenanceStatus.COMPLETED
            ? "completed"
            : "pending",
        icon: CheckCircle,
        timestamp: completedAt
          ? new Date(completedAt).toLocaleString()
          : undefined,
        slaTarget: "< 4 hours total",
      },
    ];

    return steps;
  };

  const getStepColor = (status: WorkflowStep["status"], isOverdue: boolean) => {
    switch (status) {
      case "completed":
        return "bg-green-100 text-green-800 border-green-200";
      case "current":
        return isOverdue
          ? "bg-red-100 text-red-800 border-red-200 animate-pulse"
          : "bg-blue-100 text-blue-800 border-blue-200";
      case "pending":
        return "bg-gray-100 text-gray-600 border-gray-200";
      case "skipped":
        return "bg-yellow-100 text-yellow-800 border-yellow-200";
      default:
        return "bg-gray-100 text-gray-600 border-gray-200";
    }
  };

  const getStepIcon = (status: WorkflowStep["status"]) => {
    switch (status) {
      case "completed":
        return "✓";
      case "current":
        return "●";
      case "pending":
        return "○";
      case "skipped":
        return "⚠";
      default:
        return "○";
    }
  };

  const getTotalElapsedTime = () => {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    const hours = Math.floor(elapsed / (1000 * 60 * 60));
    const minutes = Math.floor((elapsed % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours}h ${minutes}m`;
  };

  const getSLAStatus = () => {
    const elapsed = Date.now() - new Date(createdAt).getTime();
    const hoursElapsed = elapsed / (1000 * 60 * 60);

    if (currentStatus === MaintenanceStatus.COMPLETED) {
      return hoursElapsed <= 4 ? "On Time" : "SLA Missed";
    }

    if (hoursElapsed > 4) return "Critical Delay";
    if (hoursElapsed > 2) return "SLA Risk";
    return "On Track";
  };

  const getSLAColor = () => {
    const slaStatus = getSLAStatus();
    switch (slaStatus) {
      case "On Time":
      case "On Track":
        return "text-green-600";
      case "SLA Risk":
        return "text-yellow-600";
      case "Critical Delay":
      case "SLA Missed":
        return "text-red-600";
      default:
        return "text-gray-600";
    }
  };

  const steps = getWorkflowSteps();

  return (
    <Card className="border-red-200">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-red-600" />
            Emergency Workflow
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={getSLAColor()}>
              {getSLAStatus()}
            </Badge>
            <Badge variant="secondary">{getTotalElapsedTime()} elapsed</Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {/* Workflow Steps */}
          <div className="relative">
            {steps.map((step, index) => {
              const Icon = step.icon;
              const isLast = index === steps.length - 1;

              return (
                <div key={step.id} className="relative">
                  {/* Connector Line */}
                  {!isLast && (
                    <div className="absolute start-6 top-12 w-0.5 h-16 bg-gray-200" />
                  )}

                  {/* Step Content */}
                  <div className="flex items-start gap-4 pb-6">
                    {/* Step Icon */}
                    <div
                      className={`flex items-center justify-center w-12 h-12 rounded-full border-2 ${getStepColor(
                        step.status,
                        isOverdue && step.status === "current"
                      )}`}
                    >
                      <Icon className="h-5 w-5" />
                    </div>

                    {/* Step Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <h4 className="font-medium text-gray-900 dark:text-gray-100">
                          {step.title}
                        </h4>
                        <div className="flex items-center gap-2">
                          {step.slaTarget && (
                            <Badge variant="outline" className="text-xs">
                              SLA: {step.slaTarget}
                            </Badge>
                          )}
                          <span
                            className={`text-xs font-medium ${
                              getStepColor(step.status, false).split(" ")[1]
                            }`}
                          >
                            {getStepIcon(step.status)}
                          </span>
                        </div>
                      </div>

                      <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                        {step.description}
                      </p>

                      {/* Step Metadata */}
                      <div className="flex items-center gap-4 text-xs text-gray-500">
                        {step.timestamp && (
                          <div className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            {step.timestamp}
                          </div>
                        )}
                        {step.assignedTo && (
                          <div className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {step.assignedTo}
                          </div>
                        )}
                        {step.duration && (
                          <div className="flex items-center gap-1">
                            Duration: {step.duration}
                          </div>
                        )}
                      </div>

                      {/* Step Actions */}
                      {step.actions && step.actions.length > 0 && (
                        <div className="flex items-center gap-2 mt-3">
                          {step.actions.map((action, actionIndex) => (
                            <Button
                              key={actionIndex}
                              variant={action.variant}
                              size="sm"
                              onClick={action.onClick}
                            >
                              {action.label}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Emergency Actions */}
          {currentStatus !== MaintenanceStatus.COMPLETED && (
            <div className="border-t pt-4">
              <h4 className="font-medium text-gray-900 mb-3">
                Emergency Actions
              </h4>
              <div className="flex flex-wrap gap-2">
                {onEscalate && (
                  <Button variant="destructive" size="sm" onClick={onEscalate}>
                    <ArrowRight className="me-2 h-4 w-4 rtl:-scale-x-100" />
                    Escalate Emergency
                  </Button>
                )}
                {onNotify && (
                  <Button variant="outline" size="sm" onClick={onNotify}>
                    <Bell className="me-2 h-4 w-4" />
                    Send Notifications
                  </Button>
                )}
                <Button variant="outline" size="sm">
                  <Mail className="me-2 h-4 w-4" />
                  Contact Tenant
                </Button>
              </div>
            </div>
          )}

          {/* SLA Information */}
          <div className="border-t pt-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="text-center">
                <div className="text-lg font-bold text-blue-600">2h</div>
                <div className="text-xs text-gray-500">Response SLA</div>
              </div>
              <div className="text-center">
                <div className="text-lg font-bold text-orange-600">4h</div>
                <div className="text-xs text-gray-500">Resolution SLA</div>
              </div>
              <div className="text-center">
                <div className={`text-lg font-bold ${getSLAColor()}`}>
                  {getTotalElapsedTime()}
                </div>
                <div className="text-xs text-gray-500">Time Elapsed</div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
