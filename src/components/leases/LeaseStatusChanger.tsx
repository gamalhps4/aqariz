/**
 * PropertyPro - Lease Status Changer Component
 * Allow changing lease status with proper validation
 */

"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle, Info } from "lucide-react";
import { LeaseStatus } from "@/types";
import { leaseService, LeaseResponse } from "@/lib/services/lease.service";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  getNextPossibleStatuses,
  canEditLease,
  canSignLease,
  canTerminateLease,
  canRenewLease,
} from "@/components/leases/LeaseStatusBadge";
import { TerminateContractDialog } from "@/components/leases/TerminateContractDialog";
import { notifyInstallmentGeneration } from "@/components/leases/installment-generation-notice";

interface LeaseStatusChangerProps {
  lease: LeaseResponse;
  onUpdate: () => void;
  disabled?: boolean;
}

export function LeaseStatusChanger({
  lease,
  onUpdate,
  disabled = false,
}: LeaseStatusChangerProps) {
  const { t } = useLocalizationContext();
  const [selectedStatus, setSelectedStatus] = useState<LeaseStatus | "">("");
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [showTerminateDialog, setShowTerminateDialog] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);

  const possibleStatuses = getNextPossibleStatuses(lease.status);

  const getLocalizedStatus = (status: LeaseStatus) => {
    const key = `leases.status.${status}`;
    const localizedStatus = t(key);
    return localizedStatus === key ? status : localizedStatus;
  };

  const getStatusChangeMessage = (newStatus: LeaseStatus) => {
    switch (newStatus) {
      case LeaseStatus.PENDING:
        return t("leases.details.status.messages.change.pending");
      case LeaseStatus.ACTIVE:
        return t("leases.details.status.messages.change.active");
      case LeaseStatus.EXPIRED:
        return t("leases.details.status.messages.change.expired");
      case LeaseStatus.TERMINATED:
        return t("leases.details.status.messages.change.terminated");
      case LeaseStatus.DRAFT:
        return t("leases.details.status.messages.change.draft");
      default:
        return t("leases.details.status.messages.change.default");
    }
  };

  const getStatusChangeWarning = (newStatus: LeaseStatus) => {
    switch (newStatus) {
      case LeaseStatus.ACTIVE:
        if (!lease.signedDate) {
          return t("leases.details.status.messages.warning.activeUnsigned");
        }
        break;
      case LeaseStatus.TERMINATED:
        return t("leases.details.status.messages.warning.terminated");
      case LeaseStatus.EXPIRED:
        return t("leases.details.status.messages.warning.expired");
    }
    return null;
  };

  const handleStatusChange = (newStatus: string) => {
    if (!newStatus || newStatus === lease.status) return;

    // Cancelling is not a status to confirm: it takes a date and a reason.
    // Chosen here it used to set the status alone, and the contract reached
    // the Cancelled register with neither.
    if (newStatus === LeaseStatus.TERMINATED) {
      setShowTerminateDialog(true);
      return;
    }

    setSelectedStatus(newStatus as LeaseStatus);
    setShowConfirmDialog(true);
  };

  const confirmStatusChange = async () => {
    if (!selectedStatus) return;

    try {
      setIsUpdating(true);
      const updated = await leaseService.changeLeaseStatus(
        lease._id,
        selectedStatus
      );

      toast.success(t("leases.details.status.toasts.updateSuccessTitle"), {
        description: t("leases.details.status.toasts.updateSuccessDescription", {
          values: { status: getLocalizedStatus(selectedStatus) },
        }),
        duration: 5000,
      });
      // Made active here, the contract was billed; say so, or say it failed.
      notifyInstallmentGeneration(updated?.invoiceGeneration, t);

      setShowConfirmDialog(false);
      setSelectedStatus("");
      onUpdate();
    } catch (error) {
      console.error("Error updating lease status:", error);
      toast.error(t("leases.details.status.toasts.updateErrorTitle"), {
        description:
          error instanceof Error
            ? error.message
            : t("leases.details.status.toasts.updateErrorDescription"),
        duration: 5000,
      });
    } finally {
      setIsUpdating(false);
    }
  };

  const getStatusIcon = (status: LeaseStatus) => {
    switch (status) {
      case LeaseStatus.ACTIVE:
        return (
          <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
        );
      case LeaseStatus.TERMINATED:
      case LeaseStatus.EXPIRED:
        return (
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
        );
      default:
        return <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />;
    }
  };

  const getStatusDescription = (status: LeaseStatus) => {
    switch (status) {
      case LeaseStatus.DRAFT:
        return t("leases.details.status.messages.description.draft");
      case LeaseStatus.PENDING:
        return t("leases.details.status.messages.description.pending");
      case LeaseStatus.ACTIVE:
        return t("leases.details.status.messages.description.active");
      case LeaseStatus.EXPIRED:
        return t("leases.details.status.messages.description.expired");
      case LeaseStatus.TERMINATED:
        return t("leases.details.status.messages.description.terminated");
      default:
        return t("leases.details.status.messages.description.default");
    }
  };

  if (possibleStatuses.length === 0) {
    return (
      <div className="flex items-center gap-2">
        <Label className="text-sm text-muted-foreground">
          {t("leases.details.status.label")}
        </Label>
        <Badge variant="outline" className="flex items-center gap-1">
          {getStatusIcon(lease.status)}
          {getLocalizedStatus(lease.status)}
        </Badge>
        <span className="text-xs text-muted-foreground">
          ({t("leases.details.status.noChangesAvailable")})
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center gap-4">
        <Label htmlFor="status-select" className="text-sm font-medium">
          {t("leases.details.status.changeStatus")}
        </Label>
        <Select
          value=""
          onValueChange={handleStatusChange}
          disabled={disabled || isUpdating}
        >
          <SelectTrigger id="status-select" className="w-48">
            <SelectValue
              placeholder={t("leases.details.status.currentStatus", {
                values: { status: getLocalizedStatus(lease.status) },
              })}
            />
          </SelectTrigger>
          <SelectContent>
            {possibleStatuses.map((status) => (
              <SelectItem key={status} value={status}>
                <div className="flex items-center gap-2">
                  {getStatusIcon(status)}
                  <span>{getLocalizedStatus(status)}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {selectedStatus && getStatusIcon(selectedStatus)}
              {t("leases.details.status.dialog.title")}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <div>
                {selectedStatus &&
                  t("leases.details.status.dialog.changeFromTo", {
                    values: {
                      from: getLocalizedStatus(lease.status),
                      to: getLocalizedStatus(selectedStatus),
                    },
                  })}
              </div>

              {selectedStatus && (
                <div className="text-sm">
                  <p className="font-medium mb-1">
                    {t("leases.details.status.dialog.whatThisMeans")}
                  </p>
                  <p>{getStatusDescription(selectedStatus)}</p>
                </div>
              )}

              {selectedStatus && (
                <div className="text-sm">
                  <p>{getStatusChangeMessage(selectedStatus)}</p>
                </div>
              )}

              {selectedStatus && getStatusChangeWarning(selectedStatus) && (
                <div className="flex items-start gap-2 p-3 rounded-md border bg-warning/10 dark:bg-warning/15 border-warning/20">
                  <AlertTriangle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-warning">
                    {getStatusChangeWarning(selectedStatus)}
                  </p>
                </div>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setSelectedStatus("")}>
              {t("leases.details.status.dialog.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmStatusChange}
              disabled={isUpdating}
              className={
                selectedStatus === LeaseStatus.TERMINATED ||
                selectedStatus === LeaseStatus.EXPIRED
                  ? "bg-red-600 hover:bg-red-700"
                  : ""
              }
            >
              {isUpdating
                ? t("leases.details.status.dialog.updating")
                : t("leases.details.status.dialog.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <TerminateContractDialog
        open={showTerminateDialog}
        onOpenChange={setShowTerminateDialog}
        leaseId={lease._id}
        propertyName={
          lease.propertyId?.name ??
          t("leases.actions.thisProperty", { defaultValue: "this property" })
        }
        onTerminated={onUpdate}
      />
    </>
  );
}

// Helper component for displaying lease capabilities
interface LeaseCapabilitiesProps {
  lease: LeaseResponse;
}

export function LeaseCapabilities({ lease }: LeaseCapabilitiesProps) {
  const { t } = useLocalizationContext();
  const capabilities = [
    {
      label: t("leases.details.status.capabilities.canEdit"),
      value: canEditLease(lease.status),
      icon: "✏️",
    },
    {
      label: t("leases.details.status.capabilities.canSign"),
      value: canSignLease(lease.status),
      icon: "✍️",
    },
    {
      label: t("leases.details.status.capabilities.canTerminate"),
      value: canTerminateLease(lease.status),
      icon: "❌",
    },
    {
      label: t("leases.details.status.capabilities.canRenew"),
      value: canRenewLease(lease.status),
      icon: "🔄",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2">
      {capabilities.map((capability) => (
        <div
          key={capability.label}
          className={`flex items-center gap-2 p-2 rounded-md text-sm border transition-colors ${
            capability.value
              ? "bg-success/10 dark:bg-success/15 text-success border-success/20"
              : "bg-muted text-muted-foreground border-border"
          }`}
        >
          <span>{capability.icon}</span>
          <span>{capability.label}</span>
          <span
            className={
              capability.value
                ? "ms-auto text-success"
                : "ms-auto text-destructive"
            }
          >
            {capability.value ? "✓" : "✗"}
          </span>
        </div>
      ))}
    </div>
  );
}
