"use client";

import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  AlertTriangle,
  Clock,
  User,
  Building,
  Phone,
  AlertCircle,
  CheckCircle,
  XCircle,
  Zap,
  Timer,
  MapPin,
} from "lucide-react";
import { MaintenanceStatus } from "@/types";
import { formatAddress } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { dateFnsLocale } from "@/lib/utils/date-fns-locale";

interface EmergencyRequest {
  _id: string;
  title: string;
  description: string;
  priority: string;
  status: MaintenanceStatus;
  category: string;
  createdAt: string;
  updatedAt: string;
  hoursSinceCreation: number;
  isOverdue: boolean;
  urgencyLevel: "normal" | "overdue" | "critical" | "completed";
  property: {
    _id: string;
    name: string;
    address:
      | string
      | {
          street: string;
          city: string;
          state: string;
          zipCode: string;
          country: string;
        };
  };
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
  assignedUser?: {
    _id: string;
    firstName: string;
    lastName: string;
    email: string;
  };
  estimatedCost?: number;
  actualCost?: number;
}

interface EmergencyCardProps {
  request: EmergencyRequest;
  onEdit?: (requestId: string) => void;
  onDelete?: (requestId: string) => void;
  showActions?: boolean;
}

export default function EmergencyCard({
  request,
  onEdit,
  onDelete,
  showActions = true,
}: EmergencyCardProps) {
  const { t, formatCurrency, language } = useLocalizationContext();
  /** "in_progress" → the "inProgress" status key. */
  const camel = (value: string) =>
    value.toLowerCase().replace(/[_\s]+([a-z])/g, (_, c: string) => c.toUpperCase());

  const getUrgencyBadge = (urgencyLevel: string, isOverdue: boolean) => {
    if (urgencyLevel === "completed") {
      return (
        <Badge
          variant="secondary"
          className="bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800"
        >
          <CheckCircle className="h-3 w-3 me-1" />
          {t("maintenance.emergency.card.completed", { defaultValue: "Completed" })}
        </Badge>
      );
    }
    if (urgencyLevel === "critical" || isOverdue) {
      return (
        <Badge variant="destructive" className="animate-pulse">
          <AlertTriangle className="h-3 w-3 me-1" />
          {t("maintenance.emergency.card.critical", { defaultValue: "Critical" })}
        </Badge>
      );
    }
    if (urgencyLevel === "overdue") {
      return (
        <Badge
          variant="secondary"
          className="bg-orange-100 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300 border-orange-200 dark:border-orange-800"
        >
          <Timer className="h-3 w-3 me-1" />
          {t("maintenance.emergency.card.overdue", { defaultValue: "Overdue" })}
        </Badge>
      );
    }
    return (
      <Badge variant="outline">
        <Clock className="h-3 w-3 me-1" />
        {t("maintenance.emergency.card.normal", { defaultValue: "Normal" })}
      </Badge>
    );
  };

  const getStatusBadge = (status: MaintenanceStatus) => {
    const statusConfig = {
      [MaintenanceStatus.SUBMITTED]: {
        variant: "secondary" as const,
        color:
          "bg-yellow-100 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-300 border-yellow-200 dark:border-yellow-800",
        icon: Clock,
      },
      [MaintenanceStatus.ASSIGNED]: {
        variant: "default" as const,
        color:
          "bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800",
        icon: User,
      },
      [MaintenanceStatus.IN_PROGRESS]: {
        variant: "default" as const,
        color:
          "bg-blue-100 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-800",
        icon: Timer,
      },
      [MaintenanceStatus.COMPLETED]: {
        variant: "secondary" as const,
        color:
          "bg-green-100 dark:bg-green-950/30 text-green-800 dark:text-green-300 border-green-200 dark:border-green-800",
        icon: CheckCircle,
      },
      [MaintenanceStatus.CANCELLED]: {
        variant: "secondary" as const,
        color:
          "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300 border-gray-200 dark:border-gray-700",
        icon: XCircle,
      },
    };

    // Get config with fallback to SUBMITTED if status not found
    const config =
      statusConfig[status] || statusConfig[MaintenanceStatus.SUBMITTED];
    const StatusIcon = config.icon;

    return (
      <Badge variant={config.variant} className={config.color}>
        <StatusIcon className="h-3 w-3 me-1" />
        {t(`maintenance.status.${camel(status)}`, {
          defaultValue: status
            .replace(/_/g, " ")
            .toLowerCase()
            .replace(/\b\w/g, (l) => l.toUpperCase()),
        })}
      </Badge>
    );
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <CardTitle className="text-lg text-red-700 dark:text-red-400">
              <Link
                href={`/dashboard/maintenance/${request._id}`}
                className="hover:underline"
              >
                {request.title}
              </Link>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              {getUrgencyBadge(request.urgencyLevel, request.isOverdue)}
              {getStatusBadge(request.status)}
              <Badge variant="outline">
                {t(`maintenance.categories.${camel(request.category ?? "")}`, {
                  defaultValue: request.category,
                })}
              </Badge>
            </div>
          </div>
          <div className="text-end text-sm text-muted-foreground">
            <div>
              {t("maintenance.emergency.card.created", { defaultValue: "Reported {time}", values: { time: formatDistanceToNow(new Date(request.createdAt), { addSuffix: true, locale: dateFnsLocale(language) }) } })}
            </div>
            <div className="font-medium">
              {t("maintenance.emergency.card.elapsed", { defaultValue: "{hours}h elapsed", values: { hours: Math.round(request.hoursSinceCreation) } })}
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Description */}
        <CardDescription className="line-clamp-2">
          {request.description}
        </CardDescription>

        {/* Property and Tenant Info */}
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex items-center gap-2">
            <Building className="h-4 w-4 text-muted-foreground" />
            <div>
              <div className="font-medium text-sm">{request.property.name}</div>
              <div className="text-xs text-muted-foreground">
                {formatAddress(request.property.address)}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Avatar className="h-8 w-8">
              <AvatarFallback className="bg-primary/10 text-xs">
                {request.tenant.firstName[0]}
                {request.tenant.lastName[0]}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="font-medium text-sm">
                {request.tenant.firstName} {request.tenant.lastName}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Phone className="h-3 w-3" />
                {request.tenant.phone}
              </div>
            </div>
          </div>
        </div>

        {/* Assignment and Actions */}
        <div className="flex items-center justify-between pt-2 border-t">
          <div className="flex items-center gap-2">
            {request.assignedUser ? (
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-green-600" />
                <span className="text-sm">
                  {request.assignedUser.firstName}{" "}
                  {request.assignedUser.lastName}
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4 text-orange-600" />
                <span className="text-sm text-orange-600">
                  {t("maintenance.emergency.unassigned", { defaultValue: "Unassigned" })}
                </span>
              </div>
            )}
            {request.estimatedCost && (
              <div className="text-sm text-muted-foreground">
                {formatCurrency(request.estimatedCost)}
              </div>
            )}
          </div>

          {showActions && (
            <div className="flex items-center gap-2">
              <Link href={`/dashboard/maintenance/${request._id}`}>
                <Button variant="outline" size="sm">
                  {t("leases.card.viewDetails", { defaultValue: "View details" })}
                </Button>
              </Link>
              {request.status !== MaintenanceStatus.COMPLETED && (
                <Button size="sm" className="bg-red-600 hover:bg-red-700">
                  {t("maintenance.emergency.card.act", { defaultValue: "Take action" })}
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
