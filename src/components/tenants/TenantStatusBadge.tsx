"use client";

import { Badge } from "@/components/ui/badge";
import {
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  FileText,
} from "lucide-react";
import type { TenantStatus } from "./types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface TenantStatusBadgeProps {
  status?: TenantStatus;
  showIcon?: boolean;
  size?: "sm" | "default" | "lg";
  className?: string;
}

const getStatusInfo = (status?: TenantStatus, t?: (key: string) => string) => {
  const statusMap = {
    application_submitted: {
      label: t
        ? t("tenants.status.applicationSubmitted")
        : "Application Submitted",
      color: "secondary" as const,
      icon: FileText,
      bgColor: "bg-blue-50 text-blue-700 border-blue-200",
      darkBgColor: "dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800",
    },
    under_review: {
      label: t ? t("tenants.status.underReview") : "Under Review",
      color: "outline" as const,
      icon: Clock,
      bgColor: "bg-yellow-50 text-yellow-700 border-yellow-200",
      darkBgColor:
        "dark:bg-yellow-950 dark:text-yellow-300 dark:border-yellow-800",
    },
    approved: {
      label: t ? t("tenants.status.approved") : "Approved",
      color: "default" as const,
      icon: CheckCircle,
      bgColor: "bg-green-50 text-green-700 border-green-200",
      darkBgColor:
        "dark:bg-green-950 dark:text-green-300 dark:border-green-800",
    },
    active: {
      label: t ? t("tenants.status.active") : "Active",
      color: "default" as const,
      icon: UserCheck,
      bgColor: "bg-emerald-50 text-emerald-700 border-emerald-200",
      darkBgColor:
        "dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800",
    },
    inactive: {
      label: t ? t("tenants.status.inactive") : "Inactive",
      color: "secondary" as const,
      icon: UserX,
      bgColor: "bg-gray-50 text-gray-700 border-gray-200",
      darkBgColor: "dark:bg-gray-950 dark:text-gray-300 dark:border-gray-800",
    },
    moved_out: {
      label: t ? t("tenants.status.movedOut") : "Moved Out",
      color: "secondary" as const,
      icon: UserX,
      bgColor: "bg-purple-50 text-purple-700 border-purple-200",
      darkBgColor:
        "dark:bg-purple-950 dark:text-purple-300 dark:border-purple-800",
    },
    terminated: {
      label: t ? t("tenants.status.terminated") : "Terminated",
      color: "destructive" as const,
      icon: XCircle,
      bgColor: "bg-red-50 text-red-700 border-red-200",
      darkBgColor: "dark:bg-red-950 dark:text-red-300 dark:border-red-800",
    },
  };

  return statusMap[status || "application_submitted"];
};

export default function TenantStatusBadge({
  status,
  showIcon = true,
  size = "default",
  className = "",
}: TenantStatusBadgeProps) {
  const { t } = useLocalizationContext();
  const statusInfo = getStatusInfo(status, t);
  const Icon = statusInfo.icon;

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
      variant={statusInfo.color}
      className={`
        inline-flex items-center gap-1.5 font-medium
        ${statusInfo.bgColor}
        ${statusInfo.darkBgColor}
        ${sizeClasses[size]}
        ${className}
      `}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {statusInfo.label}
    </Badge>
  );
}

export { getStatusInfo };

// Note: This is a static export for use in non-component contexts
// For component usage, use the translation context directly
export const getStatusOptions = (t: (key: string) => string) => [
  {
    value: "application_submitted" as TenantStatus,
    label: t("tenants.status.applicationSubmitted"),
    description: t("tenants.statusDescriptions.applicationSubmitted"),
  },
  {
    value: "under_review" as TenantStatus,
    label: t("tenants.status.underReview"),
    description: t("tenants.statusDescriptions.underReview"),
  },
  {
    value: "approved" as TenantStatus,
    label: t("tenants.status.approved"),
    description: t("tenants.statusDescriptions.approved"),
  },
  {
    value: "active" as TenantStatus,
    label: t("tenants.status.active"),
    description: t("tenants.statusDescriptions.active"),
  },
  {
    value: "inactive" as TenantStatus,
    label: t("tenants.status.inactive"),
    description: t("tenants.statusDescriptions.inactive"),
  },
  {
    value: "moved_out" as TenantStatus,
    label: t("tenants.status.movedOut"),
    description: t("tenants.statusDescriptions.movedOut"),
  },
  {
    value: "terminated" as TenantStatus,
    label: t("tenants.status.terminated"),
    description: t("tenants.statusDescriptions.terminated"),
  },
];

export const statusColors = {
  application_submitted: "#3b82f6",
  under_review: "#f59e0b",
  approved: "#10b981",
  active: "#059669",
  inactive: "#6b7280",
  moved_out: "#8b5cf6",
  terminated: "#ef4444",
};
