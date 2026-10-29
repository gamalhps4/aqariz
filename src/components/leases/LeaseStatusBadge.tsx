/**
 * PropertyPro - Lease Status Badge Component
 * Display lease status with appropriate styling and icons
 */

"use client";

import { Badge } from "@/components/ui/badge";
import {
  Edit,
  Clock,
  CheckCircle,
  AlertTriangle,
  XCircle,
  FileText,
} from "lucide-react";
import { LeaseStatus } from "@/types";
import { leaseTransitionRefusal } from "@/lib/lease-lifecycle";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface LeaseStatusBadgeProps {
  status: LeaseStatus;
  showIcon?: boolean;
  size?: "sm" | "default" | "lg";
  className?: string;
}

export function LeaseStatusBadge({
  status,
  showIcon = true,
  size = "default",
  className = "",
}: LeaseStatusBadgeProps) {
  const { t } = useLocalizationContext();
  const getStatusConfig = (status: LeaseStatus) => {
    switch (status) {
      case LeaseStatus.DRAFT:
        return {
          variant: "outline" as const,
          icon: Edit,
          labelKey: "leases.status.draft",
          className: "border-gray-300 text-gray-700 bg-gray-50",
        };
      case LeaseStatus.PENDING:
        return {
          variant: "default" as const,
          icon: Clock,
          labelKey: "leases.status.pending",
          className: "border-yellow-300 text-yellow-700 bg-yellow-50",
        };
      case LeaseStatus.ACTIVE:
        return {
          variant: "secondary" as const,
          icon: CheckCircle,
          labelKey: "leases.status.active",
          className: "border-green-300 text-green-700 bg-green-50",
        };
      case LeaseStatus.EXPIRED:
        return {
          variant: "destructive" as const,
          icon: AlertTriangle,
          labelKey: "leases.status.expired",
          className: "border-red-300 text-red-700 bg-red-50",
        };
      case LeaseStatus.TERMINATED:
        return {
          variant: "destructive" as const,
          icon: XCircle,
          labelKey: "leases.status.terminated",
          className: "border-red-300 text-red-700 bg-red-50",
        };
      case LeaseStatus.RENEWED:
        // Every renewal leaves one of these behind in the list; it used to
        // read "renewed", untranslated, whatever the language.
        return {
          variant: "outline" as const,
          icon: FileText,
          labelKey: "leases.status.renewed",
          className: "border-gray-300 text-gray-700 bg-gray-50",
        };
      default:
        return {
          variant: "outline" as const,
          icon: FileText,
          labelKey: null,
          className: "border-gray-300 text-gray-700 bg-gray-50",
        };
    }
  };

  const config = getStatusConfig(status);
  const Icon = config.icon;
  const label = config.labelKey
    ? t(config.labelKey)
    : status.replace(/_/g, " ");

  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    default: "text-sm px-2.5 py-1",
    lg: "text-base px-3 py-1.5",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    default: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <Badge
      variant={config.variant}
      className={`${config.className} ${sizeClasses[size]} ${className} flex items-center gap-1.5 font-medium`}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {label}
    </Badge>
  );
}

// Utility function to get status color for other components
export function getLeaseStatusColor(status: LeaseStatus): string {
  switch (status) {
    case LeaseStatus.DRAFT:
      return "gray";
    case LeaseStatus.PENDING:
      return "yellow";
    case LeaseStatus.ACTIVE:
      return "green";
    case LeaseStatus.EXPIRED:
      return "red";
    case LeaseStatus.TERMINATED:
      return "red";
    default:
      return "gray";
  }
}

// Utility function to check if lease status allows editing
export function canEditLease(status: LeaseStatus): boolean {
  return status === LeaseStatus.DRAFT;
}

// Utility function to check if lease can be signed
export function canSignLease(status: LeaseStatus): boolean {
  return status === LeaseStatus.DRAFT || status === LeaseStatus.PENDING;
}

// Utility function to check if lease can be terminated
export function canTerminateLease(status: LeaseStatus): boolean {
  return status === LeaseStatus.ACTIVE;
}

// Utility function to check if lease can be renewed
export function canRenewLease(status: LeaseStatus): boolean {
  return status === LeaseStatus.ACTIVE || status === LeaseStatus.EXPIRED;
}

/**
 * The statuses the status changer offers from here: a chosen few, and never
 * one the transition table refuses (lib/lease-lifecycle.ts), which the
 * server applies to every status change.
 */
export function getNextPossibleStatuses(
  currentStatus: LeaseStatus
): LeaseStatus[] {
  return offeredStatuses(currentStatus).filter(
    (status) => leaseTransitionRefusal(currentStatus, status) === null
  );
}

// Renewing has its own dialog, and cancelling a contract that never came into
// force is done by deleting the draft — neither is offered here.
function offeredStatuses(currentStatus: LeaseStatus): LeaseStatus[] {
  switch (currentStatus) {
    case LeaseStatus.DRAFT:
      return [LeaseStatus.PENDING, LeaseStatus.ACTIVE];
    case LeaseStatus.PENDING:
      return [LeaseStatus.ACTIVE, LeaseStatus.DRAFT];
    case LeaseStatus.ACTIVE:
      return [LeaseStatus.TERMINATED, LeaseStatus.EXPIRED];
    case LeaseStatus.EXPIRED:
      // An expired contract has already ended. "Terminated" used to be
      // offered here although the server has always refused that change;
      // what an expired contract can still do is be renewed.
      return [];
    case LeaseStatus.TERMINATED:
      return []; // Terminal status
    default:
      return [];
  }
}

// Component for displaying lease status with additional context
interface LeaseStatusDisplayProps {
  status: LeaseStatus;
  signedDate?: string;
  startDate?: string;
  endDate?: string;
  showDetails?: boolean;
}

export function LeaseStatusDisplay({
  status,
  signedDate,
  startDate,
  endDate,
  showDetails = false,
}: LeaseStatusDisplayProps) {
  const getStatusMessage = () => {
    const now = new Date();
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;

    switch (status) {
      case LeaseStatus.DRAFT:
        return "Lease is in draft mode and needs to be finalized";
      case LeaseStatus.PENDING:
        return "Waiting for tenant signature";
      case LeaseStatus.ACTIVE:
        if (end && end < now) {
          return "Lease has expired but status not updated";
        }
        return signedDate
          ? `Active since ${new Date(signedDate).toLocaleDateString()}`
          : "Active lease";
      case LeaseStatus.EXPIRED:
        return end
          ? `Expired on ${end.toLocaleDateString()}`
          : "Lease has expired";
      case LeaseStatus.TERMINATED:
        return "Lease has been terminated";
      default:
        return "";
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <LeaseStatusBadge status={status} />
      {showDetails && (
        <p className="text-xs text-muted-foreground">{getStatusMessage()}</p>
      )}
    </div>
  );
}
