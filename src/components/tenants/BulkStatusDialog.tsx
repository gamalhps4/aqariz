"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  AlertTriangle,
  Loader2,
  Users,
} from "lucide-react";
import type { TenantStatus } from "./types";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { useRolePermissions } from "@/hooks/useRolePermissions";

interface BulkStatusDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedTenants: Array<{
    _id: string;
    firstName: string;
    lastName: string;
    tenantStatus?: TenantStatus;
  }>;
  onBulkStatusChange: (tenantIds: string[], newStatus: TenantStatus) => void;
  userRole?: string;
}

const getStatusOptions = (t: (key: string) => string) => [
  {
    value: "under_review" as TenantStatus,
    label: t("tenants.bulkStatusDialog.actions.startReview"),
    icon: Clock,
    color: "outline" as const,
    description: t("tenants.bulkStatusDialog.descriptions.startReview"),
  },
  {
    value: "approved" as TenantStatus,
    label: t("tenants.bulkStatusDialog.actions.approve"),
    icon: CheckCircle,
    color: "default" as const,
    description: t("tenants.bulkStatusDialog.descriptions.approve"),
  },
  {
    value: "terminated" as TenantStatus,
    label: t("tenants.bulkStatusDialog.actions.terminate"),
    icon: XCircle,
    color: "destructive" as const,
    description: t("tenants.bulkStatusDialog.descriptions.terminate"),
  },
];

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

export default function BulkStatusDialog({
  isOpen,
  onClose,
  selectedTenants,
  onBulkStatusChange,
}: BulkStatusDialogProps) {
  const { t } = useLocalizationContext();
  const { isCompanyStaff, accessProfile } = useAuthorization();
  const { hasAnyPermission } = useRolePermissions();
  const [selectedStatus, setSelectedStatus] = useState<TenantStatus | "">("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmAction, setConfirmAction] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const canManageStatus = accessProfile.isSystemRole
    ? isCompanyStaff
    : hasAnyPermission(["tenant_management", "tenant_edit"]);
  const statusOptions = getStatusOptions(t);

  const handleClose = () => {
    setSelectedStatus("");
    setReason("");
    setNotes("");
    setConfirmAction(false);
    onClose();
  };

  const handleBulkStatusChange = async () => {
    if (!selectedStatus) {
      toast.error(t("tenants.bulkStatusDialog.toasts.selectStatus"));
      return;
    }

    if (!confirmAction) {
      toast.error(t("tenants.bulkStatusDialog.toasts.confirmRequired"));
      return;
    }

    setIsLoading(true);
    try {
      const tenantIds = selectedTenants.map((t) => t._id);

      const batchSize = 5;
      const batches = [];
      for (let i = 0; i < tenantIds.length; i += batchSize) {
        batches.push(tenantIds.slice(i, i + batchSize));
      }

      let successCount = 0;
      let errorCount = 0;
      const failedTenantIds: string[] = [];
      const tenantNameMap = new Map(
        selectedTenants.map((tenant) => [
          tenant._id,
          `${tenant.firstName} ${tenant.lastName}`.trim(),
        ])
      );

      for (const batch of batches) {
        const promises = batch.map(async (tenantId) => {
          try {
            const response = await fetch(`/api/tenants/${tenantId}/status`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                newStatus: selectedStatus,
                reason: reason.trim() || "Bulk status update by admin",
                notes: notes.trim(),
              }),
            });

            if (!response.ok) {
              throw new Error(`Failed to update tenant ${tenantId}`);
            }

            successCount++;
            return tenantId;
          } catch (error) {
            errorCount++;
            failedTenantIds.push(tenantId);
            return null;
          }
        });

        await Promise.all(promises);
      }

      if (successCount > 0) {
        const selectedStatusInfo = getStatusInfo(selectedStatus, t);
        const failureSummary =
          errorCount > 0
            ? (() => {
                const names = failedTenantIds
                  .map((id) => tenantNameMap.get(id) || id)
                  .slice(0, 3)
                  .join(", ");
                return errorCount > 3
                  ? t("tenants.bulkStatusDialog.toasts.failedWithExamples", {
                      values: { count: errorCount, names },
                    })
                  : t("tenants.bulkStatusDialog.toasts.failedCount", {
                      values: {
                        count: errorCount,
                        names: names ? ` (${names})` : "",
                      },
                    });
              })()
            : "";

        toast.success(t("tenants.bulkStatusDialog.toasts.updateSuccess"), {
          description: t(
            "tenants.bulkStatusDialog.toasts.updateSuccessDescription",
            {
              values: {
                count: successCount,
                status: selectedStatusInfo.label,
                failures: failureSummary ? `, ${failureSummary}` : "",
              },
            }
          ),
        });

        onBulkStatusChange(tenantIds, selectedStatus);
      } else {
        toast.error(t("tenants.bulkStatusDialog.toasts.updateFailed"), {
          description: t(
            "tenants.bulkStatusDialog.toasts.updateFailedDescription"
          ),
        });
      }

      handleClose();
    } catch (error) {
      toast.error(t("tenants.bulkStatusDialog.toasts.updateFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("tenants.bulkStatusDialog.toasts.tryAgain"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!canManageStatus || selectedTenants.length === 0) {
    return null;
  }

  const selectedStatusInfo = selectedStatus
    ? getStatusInfo(selectedStatus, t)
    : null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("tenants.bulkStatusDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("tenants.bulkStatusDialog.description", {
              values: { count: selectedTenants.length },
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="space-y-2">
            <Label>
              {t("tenants.bulkStatusDialog.selectedTenants", {
                values: { count: selectedTenants.length },
              })}
            </Label>
            <div className="max-h-32 overflow-y-auto border rounded-lg p-3 bg-muted/50">
              <div className="space-y-1">
                {selectedTenants.map((tenant) => {
                  const statusInfo = getStatusInfo(tenant.tenantStatus, t);
                  return (
                    <div
                      key={tenant._id}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-medium">
                        {tenant.firstName} {tenant.lastName}
                      </span>
                      <Badge variant={statusInfo.color} className="text-xs">
                        {statusInfo.label}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">
              {t("tenants.bulkStatusDialog.newStatus")}
            </Label>
            <Select
              value={selectedStatus}
              onValueChange={(value) =>
                setSelectedStatus(value as TenantStatus)
              }
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={t(
                    "tenants.bulkStatusDialog.selectNewStatusPlaceholder"
                  )}
                />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
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

          <div className="space-y-2">
            <Label htmlFor="reason">
              {t("tenants.bulkStatusDialog.reasonLabel")}
            </Label>
            <Input
              id="reason"
              placeholder={t("tenants.bulkStatusDialog.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">
              {t("tenants.bulkStatusDialog.notesLabel")}
            </Label>
            <Textarea
              id="notes"
              placeholder={t("tenants.bulkStatusDialog.notesPlaceholder")}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </div>

          <div className="flex items-start gap-2 p-3 border rounded-lg bg-muted/50">
            <Checkbox
              id="confirm"
              checked={confirmAction}
              onCheckedChange={(checked) =>
                setConfirmAction(checked as boolean)
              }
            />
            <div className="space-y-1">
              <Label
                htmlFor="confirm"
                className="text-sm font-medium cursor-pointer"
              >
                {t("tenants.bulkStatusDialog.confirmLabel")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("tenants.bulkStatusDialog.confirmDescription", {
                  values: { count: selectedTenants.length },
                })}
                {selectedStatus === "terminated" &&
                  " " + t("tenants.bulkStatusDialog.terminateWarningShort")}
              </p>
            </div>
          </div>

          {selectedStatus === "terminated" && (
            <div className="flex items-start gap-2 p-3 border border-destructive/20 bg-destructive/5 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-destructive">
                  {t("tenants.bulkStatusDialog.warning")}
                </p>
                <p className="text-muted-foreground">
                  {t("tenants.bulkStatusDialog.terminateWarning")}
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {t("tenants.bulkStatusDialog.cancel")}
          </Button>
          <Button
            onClick={handleBulkStatusChange}
            disabled={
              isLoading || !selectedStatus || !reason.trim() || !confirmAction
            }
            variant={
              selectedStatus === "terminated" ? "destructive" : "default"
            }
          >
            {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("tenants.bulkStatusDialog.updateButton", {
              values: { count: selectedTenants.length },
            })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
