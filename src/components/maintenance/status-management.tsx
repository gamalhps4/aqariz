"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Clock,
  User,
  Play,
  CheckCircle,
  X,
  AlertTriangle,
  Calendar,
  ArrowRight,
} from "lucide-react";
import { MaintenanceStatus, MaintenancePriority } from "@/types";
import { useAuthorization } from "@/hooks/useAuthorization";

interface StatusBadgeProps {
  status: MaintenanceStatus;
  priority?: MaintenancePriority;
  className?: string;
}

export function StatusBadge({
  status,
  priority,
  className = "",
}: StatusBadgeProps) {
  const getStatusConfig = (status: MaintenanceStatus) => {
    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return {
          variant: "default" as const,
          icon: Clock,
          label: "Submitted",
        };
      case MaintenanceStatus.ASSIGNED:
        return {
          variant: "secondary" as const,
          icon: User,
          label: "Assigned",
        };
      case MaintenanceStatus.IN_PROGRESS:
        return {
          variant: "default" as const,
          icon: Play,
          label: "In Progress",
        };
      case MaintenanceStatus.COMPLETED:
        return {
          variant: "secondary" as const,
          icon: CheckCircle,
          label: "Completed",
        };
      case MaintenanceStatus.CANCELLED:
        return {
          variant: "outline" as const,
          icon: X,
          label: "Cancelled",
        };
      default:
        return {
          variant: "outline" as const,
          icon: Clock,
          label: "Unknown",
        };
    }
  };

  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <Badge
      variant={config.variant}
      className={`flex items-center gap-1 ${className}`}
    >
      <Icon className="h-3 w-3" />
      {config.label}
      {priority === MaintenancePriority.EMERGENCY && (
        <AlertTriangle className="h-3 w-3 ms-1 text-red-500" />
      )}
    </Badge>
  );
}

interface PriorityBadgeProps {
  priority: MaintenancePriority;
  className?: string;
}

export function PriorityBadge({
  priority,
  className = "",
}: PriorityBadgeProps) {
  const getPriorityConfig = (priority: MaintenancePriority) => {
    switch (priority) {
      case MaintenancePriority.EMERGENCY:
        return {
          variant: "destructive" as const,
          icon: AlertTriangle,
          label: "Emergency",
        };
      case MaintenancePriority.HIGH:
        return {
          variant: "destructive" as const,
          icon: AlertTriangle,
          label: "High",
        };
      case MaintenancePriority.MEDIUM:
        return {
          variant: "default" as const,
          icon: null,
          label: "Medium",
        };
      case MaintenancePriority.LOW:
        return {
          variant: "secondary" as const,
          icon: null,
          label: "Low",
        };
      default:
        return {
          variant: "outline" as const,
          icon: null,
          label: "Unknown",
        };
    }
  };

  const config = getPriorityConfig(priority);
  const Icon = config.icon;

  return (
    <Badge variant={config.variant} className={`capitalize ${className}`}>
      {Icon && <Icon className="h-3 w-3 me-1" />}
      {config.label}
    </Badge>
  );
}

interface StatusProgressProps {
  status: MaintenanceStatus;
  createdAt: Date;
  scheduledDate?: Date;
  completedDate?: Date;
  className?: string;
}

export function StatusProgress({
  status,
  createdAt,
  scheduledDate,
  completedDate,
  className = "",
}: StatusProgressProps) {
  const getProgressValue = (status: MaintenanceStatus) => {
    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        return 20;
      case MaintenanceStatus.ASSIGNED:
        return 40;
      case MaintenanceStatus.IN_PROGRESS:
        return 70;
      case MaintenanceStatus.COMPLETED:
        return 100;
      case MaintenanceStatus.CANCELLED:
        return 0;
      default:
        return 0;
    }
  };

  const progressValue = getProgressValue(status);
  const isCompleted = status === MaintenanceStatus.COMPLETED;
  const isCancelled = status === MaintenanceStatus.CANCELLED;

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex justify-between text-sm">
        <span className="font-medium">Progress</span>
        <span className="text-muted-foreground">{progressValue}%</span>
      </div>
      <Progress
        value={progressValue}
        className={`h-2 ${
          isCompleted
            ? "bg-green-100"
            : isCancelled
            ? "bg-red-100"
            : "bg-gray-100"
        }`}
      />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Created: {createdAt.toLocaleDateString()}</span>
        {completedDate && (
          <span>Completed: {completedDate.toLocaleDateString()}</span>
        )}
      </div>
    </div>
  );
}

interface StatusTimelineProps {
  status: MaintenanceStatus;
  createdAt: Date;
  assignedAt?: Date;
  startedAt?: Date;
  completedAt?: Date;
  cancelledAt?: Date;
  className?: string;
}

export function StatusTimeline({
  status,
  createdAt,
  assignedAt,
  startedAt,
  completedAt,
  cancelledAt,
  className = "",
}: StatusTimelineProps) {
  const timelineSteps = [
    {
      status: MaintenanceStatus.SUBMITTED,
      label: "Submitted",
      icon: Clock,
      date: createdAt,
      completed: true,
    },
    {
      status: MaintenanceStatus.ASSIGNED,
      label: "Assigned",
      icon: User,
      date: assignedAt,
      completed: assignedAt !== undefined,
    },
    {
      status: MaintenanceStatus.IN_PROGRESS,
      label: "In Progress",
      icon: Play,
      date: startedAt,
      completed: startedAt !== undefined,
    },
    {
      status: MaintenanceStatus.COMPLETED,
      label: "Completed",
      icon: CheckCircle,
      date: completedAt,
      completed: completedAt !== undefined,
    },
  ];

  // Handle cancelled status
  if (status === MaintenanceStatus.CANCELLED) {
    timelineSteps.push({
      status: MaintenanceStatus.CANCELLED,
      label: "Cancelled",
      icon: X,
      date: cancelledAt,
      completed: cancelledAt !== undefined,
    });
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-lg">Status Timeline</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {timelineSteps.map((step, index) => {
            const Icon = step.icon;
            const isActive = step.status === status;
            const isCompleted = step.completed;
            const isCancelled = step.status === MaintenanceStatus.CANCELLED;

            return (
              <div key={step.status} className="flex items-center space-x-3">
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                    isCompleted
                      ? isCancelled
                        ? "border-red-500 bg-red-500 text-white"
                        : "border-green-500 bg-green-500 text-white"
                      : isActive
                      ? "border-blue-500 bg-blue-500 text-white"
                      : "border-gray-300 bg-gray-100 text-gray-400"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center justify-between">
                    <span
                      className={`font-medium ${
                        isCompleted
                          ? isCancelled
                            ? "text-red-600"
                            : "text-green-600"
                          : isActive
                          ? "text-blue-600"
                          : "text-gray-500"
                      }`}
                    >
                      {step.label}
                    </span>
                    {step.date && (
                      <span className="text-sm text-muted-foreground">
                        {step.date.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </span>
                    )}
                  </div>
                </div>
                {index < timelineSteps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-gray-300 rtl:-scale-x-100" />
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

interface NextActionProps {
  status: MaintenanceStatus;
  assignedTo?: string;
  currentUserId?: string;
  onAction: (action: string) => void;
  className?: string;
}

export function NextAction({
  status,
  assignedTo,
  currentUserId,
  onAction,
  className = "",
}: NextActionProps) {
  const { isCompanyStaff } = useAuthorization();

  const getNextAction = () => {
    const canManage = isCompanyStaff;
    const canWork = isCompanyStaff;
    const isAssignedToUser = assignedTo === currentUserId;

    switch (status) {
      case MaintenanceStatus.SUBMITTED:
        if (canManage) {
          return {
            action: "assign",
            label: "Assign Technician",
            icon: User,
            variant: "default" as const,
          };
        }
        break;

      case MaintenanceStatus.ASSIGNED:
        if (canWork && (isAssignedToUser || canManage)) {
          return {
            action: "start",
            label: "Start Work",
            icon: Play,
            variant: "default" as const,
          };
        }
        break;

      case MaintenanceStatus.IN_PROGRESS:
        if (canWork && (isAssignedToUser || canManage)) {
          return {
            action: "complete",
            label: "Mark Complete",
            icon: CheckCircle,
            variant: "default" as const,
          };
        }
        break;

      default:
        return null;
    }

    return null;
  };

  const nextAction = getNextAction();

  if (!nextAction) {
    return null;
  }

  const Icon = nextAction.icon;

  return (
    <div className={`space-y-2 ${className}`}>
      <h4 className="font-medium text-sm">Next Action</h4>
      <Button
        variant={nextAction.variant}
        onClick={() => onAction(nextAction.action)}
        className="w-full"
      >
        <Icon className="h-4 w-4 me-2" />
        {nextAction.label}
      </Button>
    </div>
  );
}
