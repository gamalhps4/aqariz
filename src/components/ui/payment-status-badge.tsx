/**
 * PropertyPro - Payment Status Badge Component
 * Visual indicator for payment status with appropriate colors and icons
 */

import { Badge } from "@/components/ui/badge";
import { PaymentStatus } from "@/types";
import {
  Clock,
  CheckCircle,
  XCircle,
  AlertCircle,
  DollarSign,
  RefreshCw,
  Ban,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  className?: string;
  showIcon?: boolean;
  size?: "sm" | "md" | "lg";
}

const statusConfig = {
  [PaymentStatus.PENDING]: {
    label: "Pending",
    variant: "secondary" as const,
    icon: Clock,
    className: "bg-yellow-100 text-yellow-800 border-yellow-200",
  },
  [PaymentStatus.PAID]: {
    label: "Paid",
    variant: "secondary" as const,
    icon: CheckCircle,
    className: "bg-green-100 text-green-800 border-green-200",
  },
  [PaymentStatus.FAILED]: {
    label: "Failed",
    variant: "destructive" as const,
    icon: XCircle,
    className: "bg-red-100 text-red-800 border-red-200",
  },
  [PaymentStatus.REFUNDED]: {
    label: "Refunded",
    variant: "outline" as const,
    icon: RefreshCw,
    className: "bg-gray-100 text-gray-800 border-gray-200",
  },
  [PaymentStatus.OVERDUE]: {
    label: "Overdue",
    variant: "destructive" as const,
    icon: AlertCircle,
    className: "bg-red-100 text-red-800 border-red-200",
  },
  [PaymentStatus.PARTIAL]: {
    label: "Partial",
    variant: "secondary" as const,
    icon: DollarSign,
    className: "bg-orange-100 text-orange-800 border-orange-200",
  },
  [PaymentStatus.CANCELLED]: {
    label: "Cancelled",
    variant: "outline" as const,
    icon: Ban,
    className: "bg-gray-100 text-gray-800 border-gray-200",
  },
};

export function PaymentStatusBadge({
  status,
  className,
  showIcon = true,
  size = "md",
}: PaymentStatusBadgeProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const sizeClasses = {
    sm: "text-xs px-2 py-1",
    md: "text-sm px-2.5 py-1.5",
    lg: "text-base px-3 py-2",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-4 w-4",
    lg: "h-5 w-5",
  };

  return (
    <Badge
      variant={config.variant}
      className={cn(
        config.className,
        sizeClasses[size],
        "flex items-center gap-1.5 font-medium",
        className
      )}
    >
      {showIcon && <Icon className={iconSizes[size]} />}
      {config.label}
    </Badge>
  );
}

export function PaymentStatusIndicator({
  status,
  className,
}: {
  status: PaymentStatus;
  className?: string;
}) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        className={cn(
          "w-2 h-2 rounded-full",
          status === PaymentStatus.PAID && "bg-green-500",
          status === PaymentStatus.PENDING && "bg-yellow-500",
          status === PaymentStatus.FAILED && "bg-red-500",
          status === PaymentStatus.OVERDUE && "bg-red-600",
          status === PaymentStatus.PARTIAL && "bg-orange-500",
          status === PaymentStatus.REFUNDED && "bg-gray-500",
          status === PaymentStatus.CANCELLED && "bg-gray-400"
        )}
      />
      <span className="text-sm font-medium">{config.label}</span>
    </div>
  );
}
