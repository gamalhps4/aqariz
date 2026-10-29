"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { DatePicker } from "@/components/ui/date-picker";
import type { TenantStatus } from "./types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useRolePermissions } from "@/hooks/useRolePermissions";
import { pickedDay } from "@/lib/dates/business-day";

interface TenantStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    tenantStatus?: TenantStatus;
    lastStatusUpdate?: string;
  };
  onStatusChange: (newStatus: TenantStatus) => void;
  userRole?: string;
}

const getStatusOptions = (t: (key: string) => string) => [
  {
    value: "under_review" as TenantStatus,
    label: t("tenants.statusDialog.actions.startReview"),
    icon: Clock,
    color: "outline" as const,
    description: t("tenants.statusDialog.descriptions.startReview"),
  },
  {
    value: "approved" as TenantStatus,
    label: t("tenants.statusDialog.actions.approve"),
    icon: CheckCircle,
    color: "default" as const,
    description: t("tenants.statusDialog.descriptions.approve"),
  },
  {
    value: "active" as TenantStatus,
    label: t("tenants.statusDialog.actions.activate"),
    icon: UserCheck,
    color: "default" as const,
    description: t("tenants.statusDialog.descriptions.activate"),
  },
  {
    value: "inactive" as TenantStatus,
    label: t("tenants.statusDialog.actions.deactivate"),
    icon: UserX,
    color: "secondary" as const,
    description: t("tenants.statusDialog.descriptions.deactivate"),
  },
  {
    value: "moved_out" as TenantStatus,
    label: t("tenants.statusDialog.actions.markMovedOut"),
    icon: UserX,
    color: "secondary" as const,
    description: t("tenants.statusDialog.descriptions.markMovedOut"),
  },
  {
    value: "terminated" as TenantStatus,
    label: t("tenants.statusDialog.actions.terminate"),
    icon: XCircle,
    color: "destructive" as const,
    description: t("tenants.statusDialog.descriptions.terminate"),
  },
];

const getAvailableTransitions = (
  currentStatus?: TenantStatus
): TenantStatus[] => {
  const transitions: Record<TenantStatus, TenantStatus[]> = {
    application_submitted: ["under_review", "approved", "terminated"],
    under_review: ["approved", "terminated"],
    approved: ["active", "terminated"],
    active: ["inactive", "moved_out", "terminated"],
    inactive: ["active", "moved_out", "terminated"],
    moved_out: ["terminated"],
    terminated: [],
  };

  return transitions[currentStatus || "application_submitted"] || [];
};

const getStatusInfo = (status?: TenantStatus, t?: (key: string) => string) => {
  const statusMap = {
    application_submitted: {
      label: t
        ? t("tenants.status.applicationSubmitted")
        : "Application Submitted",
      color: "secondary" as const,
      icon: Clock,
    },
    under_review: {
      label: t ? t("tenants.status.underReview") : "Under Review",
      color: "outline" as const,
      icon: Clock,
    },
    approved: {
      label: t ? t("tenants.status.approved") : "Approved",
      color: "default" as const,
      icon: CheckCircle,
    },
    active: {
      label: t ? t("tenants.status.active") : "Active",
      color: "default" as const,
      icon: UserCheck,
    },
    inactive: {
      label: t ? t("tenants.status.inactive") : "Inactive",
      color: "secondary" as const,
      icon: UserX,
    },
    moved_out: {
      label: t ? t("tenants.status.movedOut") : "Moved Out",
      color: "secondary" as const,
      icon: UserX,
    },
    terminated: {
      label: t ? t("tenants.status.terminated") : "Terminated",
      color: "destructive" as const,
      icon: XCircle,
    },
  };

  return statusMap[status || "application_submitted"];
};

export default function TenantStatusDialog({
  isOpen,
  onClose,
  tenant,
  onStatusChange,
}: TenantStatusDialogProps) {
  const { t, formatDate } = useLocalizationContext();
  const { isCompanyStaff, accessProfile } = useAuthorization();
  const { hasAnyPermission } = useRolePermissions();
  const [selectedStatus, setSelectedStatus] = useState<TenantStatus | "">("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [moveDate, setMoveDate] = useState<Date | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);

  const canManageStatus = accessProfile.isSystemRole
    ? isCompanyStaff
    : hasAnyPermission(["tenant_management", "tenant_edit"]);
  const currentStatus = tenant.tenantStatus || "application_submitted";
  const availableTransitions = getAvailableTransitions(currentStatus);
  const currentStatusInfo = getStatusInfo(currentStatus, t);
  const selectedStatusInfo = selectedStatus
    ? getStatusInfo(selectedStatus, t)
    : null;
  const lastUpdated = tenant.lastStatusUpdate
    ? formatDate(tenant.lastStatusUpdate, { format: "medium" })
    : t("tenants.statusDialog.recentlyUpdated");
  const statusOptions = getStatusOptions(t);

  const handleClose = () => {
    setSelectedStatus("");
    setReason("");
    setNotes("");
    setMoveDate(undefined);
    onClose();
  };

  const handleStatusChange = async () => {
    if (!selectedStatus) {
      toast.error(t("tenants.statusDialog.toasts.selectStatus"));
      return;
    }

    if (!reason.trim()) {
      toast.error(t("tenants.statusDialog.toasts.reasonRequired"));
      return;
    }

    if (
      (selectedStatus === "active" || selectedStatus === "moved_out") &&
      !moveDate
    ) {
      toast.error(
        t("tenants.statusDialog.toasts.dateRequired", {
          values: {
            type:
              selectedStatus === "active"
                ? t("tenants.statusDialog.moveIn")
                : t("tenants.statusDialog.moveOut"),
          },
        })
      );
      return;
    }

    setIsLoading(true);
    try {
      const response = await fetch(`/api/tenants/${tenant._id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newStatus: selectedStatus,
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          moveDate: pickedDay(moveDate) || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || t("tenants.statusDialog.toasts.updateFailed")
        );
      }

      toast.success(
        t("tenants.statusDialog.toasts.updateSuccess", {
          values: { status: selectedStatusInfo?.label || "" },
        }),
        {
          description: t(
            "tenants.statusDialog.toasts.updateSuccessDescription",
            {
              values: { name: `${tenant.firstName} ${tenant.lastName}` },
            }
          ),
        }
      );

      onStatusChange(selectedStatus);
      handleClose();
    } catch (error) {
      toast.error(t("tenants.statusDialog.toasts.updateFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("tenants.statusDialog.toasts.tryAgain"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!canManageStatus) {
    return null;
  }

  const availableOptions = statusOptions.filter((option) =>
    availableTransitions.includes(option.value)
  );

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>{t("tenants.statusDialog.title")}</DialogTitle>
          <DialogDescription>
            {t("tenants.statusDialog.description", {
              values: { name: `${tenant.firstName} ${tenant.lastName}` },
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border">
            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-background border">
              <Clock className="h-4 w-4 text-muted-foreground" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                {t("tenants.statusDialog.currentStatus")}
              </p>
              <p className="font-semibold">{currentStatusInfo.label}</p>
              <p className="text-xs text-muted-foreground">{lastUpdated}</p>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status" className="text-sm font-medium">
              {t("tenants.statusDialog.newStatus")}
            </Label>
            <Select
              value={selectedStatus}
              onValueChange={(value) =>
                setSelectedStatus(value as TenantStatus)
              }
            >
              <SelectTrigger className="h-11">
                <SelectValue
                  placeholder={t("tenants.statusDialog.selectNewStatus")}
                />
              </SelectTrigger>
              <SelectContent>
                {availableOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SelectItem
                      key={option.value}
                      value={option.value}
                      className="py-3"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-muted">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-medium">{option.label}</div>
                          <div className="text-xs text-muted-foreground">
                            {option.description}
                          </div>
                        </div>
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {(selectedStatus === "active" || selectedStatus === "moved_out") && (
            <div className="space-y-2">
              <Label htmlFor="moveDate" className="text-sm font-medium">
                {selectedStatus === "active"
                  ? t("tenants.statusDialog.moveInDate")
                  : t("tenants.statusDialog.moveOutDate")}
              </Label>
              <DatePicker
                date={moveDate}
                onSelect={setMoveDate}
                placeholder={t("tenants.statusDialog.selectDatePlaceholder", {
                  values: {
                    type:
                      selectedStatus === "active"
                        ? t("tenants.statusDialog.moveIn")
                        : t("tenants.statusDialog.moveOut"),
                  },
                })}
                disabled={(date) => date > new Date()}
              />
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason" className="text-sm font-medium">
              {t("tenants.statusDialog.reasonLabel")}
            </Label>
            <Textarea
              id="reason"
              placeholder={t("tenants.statusDialog.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes" className="text-sm font-medium">
              {t("tenants.statusDialog.notesLabel")}
            </Label>
            <Textarea
              id="notes"
              placeholder={t("tenants.statusDialog.notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          {selectedStatus === "terminated" && (
            <div className="flex items-start gap-3 p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
              <div className="flex items-center justify-center w-8 h-8 rounded-full bg-destructive/10 border border-destructive/20">
                <AlertTriangle className="h-4 w-4 text-destructive" />
              </div>
              <div className="text-sm">
                <p className="font-medium text-destructive mb-1">
                  {t("tenants.statusDialog.warning")}
                </p>
                <p className="text-muted-foreground">
                  {t("tenants.statusDialog.terminateWarning")}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isLoading}
            className="h-11"
          >
            {t("tenants.statusDialog.cancel")}
          </Button>
          <Button
            onClick={handleStatusChange}
            disabled={isLoading || !selectedStatus || !reason.trim()}
            variant={
              selectedStatus === "terminated" ? "destructive" : "default"
            }
            className="h-11"
          >
            {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("tenants.statusDialog.updateStatus")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
