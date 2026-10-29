"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Mail,
  Phone,
  Briefcase,
  CreditCard,
  Calendar,
  MoreHorizontal,
  Edit,
  Trash2,
  Eye,
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  UserX,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils/formatting";
import type { TenantRecord } from "./types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

const currencyDisplayOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
} as const;

const formatTenantDate = (value?: string) =>
  value ? formatDate(value, { format: "medium" }) : undefined;

const formatIncome = (amount?: number) =>
  typeof amount === "number"
    ? formatCurrency(amount, undefined, currencyDisplayOptions)
    : undefined;

interface TenantCardProps {
  tenant: TenantRecord;
  onEdit?: (tenantId: string) => void;
  onDelete?: (tenant: TenantRecord) => void;
  showActions?: boolean;
  deleteLoading?: boolean;
}

export default function TenantCard({
  tenant,
  onEdit,
  onDelete,
  showActions = true,
  deleteLoading = false,
}: TenantCardProps) {
  const { t } = useLocalizationContext();

  const getStatusInfo = () => {
    if (tenant?.tenantStatus) {
      const statusMap = {
        application_submitted: {
          status: t("tenants.status.applicationSubmitted"),
          color: "secondary" as const,
          icon: Clock,
          description: t("tenants.status.description.applicationSubmitted"),
        },
        under_review: {
          status: t("tenants.status.underReview"),
          color: "outline" as const,
          icon: Clock,
          description: t("tenants.status.description.underReview"),
        },
        approved: {
          status: t("tenants.status.approved"),
          color: "default" as const,
          icon: CheckCircle,
          description: t("tenants.status.description.approved"),
        },
        active: {
          status: t("tenants.status.active"),
          color: "default" as const,
          icon: UserCheck,
          description: t("tenants.status.description.active"),
        },
        inactive: {
          status: t("tenants.status.inactive"),
          color: "secondary" as const,
          icon: UserX,
          description: t("tenants.status.description.inactive"),
        },
        moved_out: {
          status: t("tenants.status.movedOut"),
          color: "secondary" as const,
          icon: UserX,
          description: t("tenants.status.description.movedOut"),
        },
        terminated: {
          status: t("tenants.status.terminated"),
          color: "destructive" as const,
          icon: XCircle,
          description: t("tenants.status.description.terminated"),
        },
      };
      return (
        statusMap[tenant.tenantStatus] || {
          status: t("tenants.status.unknown"),
          color: "outline" as const,
          icon: Clock,
          description: t("tenants.status.description.unknown"),
        }
      );
    }

    return {
      status: t("tenants.status.applicationSubmitted"),
      color: "secondary" as const,
      icon: Clock,
      description: t("tenants.status.description.applicationSubmitted"),
    };
  };

  const statusInfo = getStatusInfo();
  const StatusIcon = statusInfo.icon;
  const employmentIncome = formatIncome(tenant?.employmentInfo?.income);
  const applicationDate = formatTenantDate(tenant?.applicationDate);
  const moveInDate = formatTenantDate(tenant?.moveInDate);
  const moveOutDate = formatTenantDate(tenant?.moveOutDate);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Avatar className="h-12 w-12">
              <AvatarImage src={tenant?.avatar || ""} />
              <AvatarFallback className="bg-primary/10">
                {tenant?.firstName?.[0] || ""}
                {tenant?.lastName?.[0] || ""}
              </AvatarFallback>
            </Avatar>
            <div>
              <CardTitle className="text-lg">
                <Link
                  href={`/dashboard/tenants/${tenant?._id ?? ""}`}
                  className="hover:underline"
                >
                  {tenant?.firstName ?? ""} {tenant?.lastName ?? ""}
                </Link>
              </CardTitle>
              <CardDescription className="flex items-center gap-2">
                <Badge variant={statusInfo.color} className="text-xs">
                  <StatusIcon className="h-3 w-3 me-1" />
                  {statusInfo.status}
                </Badge>
                <span className="text-xs">{statusInfo.description}</span>
              </CardDescription>
            </div>
          </div>
          {showActions && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/tenants/${tenant?._id ?? ""}`}>
                    <Eye className="h-4 w-4 me-2" />
                    {t("tenants.menu.viewDetails")}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href={`/dashboard/tenants/${tenant?._id ?? ""}/edit`}>
                    <Edit className="h-4 w-4 me-2" />
                    {t("tenants.menu.editTenant")}
                  </Link>
                </DropdownMenuItem>
                {/* DISABLED: Delete functionality temporarily disabled */}
                {/* <DropdownMenuSeparator />
                <DeleteConfirmationDialog
                  itemName={`${tenant?.firstName ?? ""} ${
                    tenant?.lastName ?? ""
                  }`}
                  itemType="tenant"
                  onConfirm={() => onDelete?.(tenant)}
                  loading={deleteLoading}
                >
                  <DropdownMenuItem
                    onSelect={(e) => e.preventDefault()}
                    className="text-destructive"
                  >
                    <Trash2 className="h-4 w-4 me-2" />
                    Delete
                  </DropdownMenuItem>
                </DeleteConfirmationDialog> */}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-center text-sm text-muted-foreground">
            <Mail className="h-3 w-3 me-2" />
            <span className="truncate">{tenant?.email ?? ""}</span>
          </div>
          <div className="flex items-center text-sm text-muted-foreground">
            <Phone className="h-3 w-3 me-2" />
            <span>{tenant?.phone ?? ""}</span>
          </div>
        </div>

        {tenant?.employmentInfo && (
          <div className="space-y-1">
            <div className="flex items-center text-sm">
              <Briefcase className="h-3 w-3 me-2 text-muted-foreground" />
              <span className="font-medium">
                {tenant.employmentInfo?.employer ?? ""}
              </span>
            </div>
            <div className="text-xs text-muted-foreground ms-5">
              {tenant.employmentInfo?.position ?? ""} •{" "}
              {employmentIncome ? `${employmentIncome}/year` : "-"}
            </div>
          </div>
        )}

        {tenant?.creditScore !== undefined && tenant?.creditScore !== null && (
          <div className="flex items-center text-sm">
            <CreditCard className="h-3 w-3 me-2 text-muted-foreground" />
            <span>{t("tenants.details.creditScore")}: </span>
            <Badge
              variant={
                tenant.creditScore >= 700
                  ? "default"
                  : tenant.creditScore >= 600
                  ? "secondary"
                  : "destructive"
              }
              className="ms-1"
            >
              {tenant.creditScore}
            </Badge>
          </div>
        )}

        <div className="flex items-center text-sm text-muted-foreground">
          <Calendar className="h-3 w-3 me-2" />
          <span>
            {t("tenants.details.applied")}: {applicationDate ?? "-"}
          </span>
        </div>

        {(tenant?.moveInDate || tenant?.moveOutDate) && (
          <div className="space-y-1 text-sm">
            {tenant?.moveInDate && (
              <div className="text-muted-foreground">
                {t("tenants.details.movedIn")}: {moveInDate ?? "-"}
              </div>
            )}
            {tenant?.moveOutDate && (
              <div className="text-muted-foreground">
                {t("tenants.details.movedOut")}: {moveOutDate ?? "-"}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
