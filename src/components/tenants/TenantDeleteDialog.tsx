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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { personErrorText } from "@/lib/person-error-text";

interface TenantDeleteDialogProps {
  isOpen: boolean;
  onClose: () => void;
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    tenantStatus?: string;
    hasActiveLease?: boolean;
    activeLeaseCount?: number;
  };
  onDelete: (tenantId: string) => void;
  userRole?: string;
}

export default function TenantDeleteDialog({
  isOpen,
  onClose,
  tenant,
  onDelete,
}: TenantDeleteDialogProps) {
  const { t } = useLocalizationContext();
  const { isCompanyStaff } = useAuthorization();
  const [reason, setReason] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  const canDelete = isCompanyStaff;
  const activeLeaseCount =
    tenant.activeLeaseCount ?? (tenant.hasActiveLease ? 1 : 0);
  const hasActiveLease = tenant.hasActiveLease || activeLeaseCount > 0;
  const activeLeaseDeleteMessage = t("tenants.delete.blockedActiveLease", {
    defaultValue:
      "This tenant has an active lease. Terminate the lease before deleting the tenant.",
  });

  const handleClose = () => {
    setReason("");
    setConfirmDelete(false);
    onClose();
  };

  const handleDelete = async () => {
    if (hasActiveLease) {
      toast.error(activeLeaseDeleteMessage);
      return;
    }

    if (!reason.trim()) {
      toast.error(t("tenants.deleteDialog.toasts.reasonRequired"));
      return;
    }

    if (!confirmDelete) {
      toast.error(t("tenants.deleteDialog.toasts.confirmRequired"));
      return;
    }

    setIsLoading(true);
    try {
      const statusResponse = await fetch(`/api/tenants/${tenant._id}/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          newStatus: "terminated",
          reason: `Tenant deleted: ${reason.trim()}`,
          notes: "Tenant record deleted by administrator",
        }),
      });

      if (!statusResponse.ok) {
        toast.warning(t("tenants.deleteDialog.toasts.statusUpdateWarning"));
      }

      const deleteResponse = await fetch(`/api/tenants/${tenant._id}`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reason: reason.trim(),
        }),
      });

      if (!deleteResponse.ok) {
        const errorData = await deleteResponse.json().catch(() => null);
        // The API's reason is in `error` (and a code for the ones worth
        // translating); `message` is never set on a refusal.
        throw new Error(
          personErrorText(
            t,
            errorData,
            t("tenants.deleteDialog.toasts.deleteFailed"),
          )
        );
      }

      toast.success(t("tenants.deleteDialog.toasts.deleteSuccess"), {
        description: t("tenants.deleteDialog.toasts.deleteSuccessDescription", {
          values: { name: `${tenant.firstName} ${tenant.lastName}` },
        }),
      });

      onDelete(tenant._id);
      handleClose();
    } catch (error) {
      toast.error(t("tenants.deleteDialog.toasts.deleteFailed"), {
        description:
          error instanceof Error
            ? error.message
            : t("tenants.deleteDialog.toasts.tryAgain"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  if (!canDelete) {
    return null;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            {t("tenants.deleteDialog.title")}
          </DialogTitle>
          <DialogDescription>
            {t("tenants.deleteDialog.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          <div className="flex items-start gap-2 p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
            <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-destructive">
                {t("tenants.deleteDialog.description")}
              </p>
              <div className="mt-2 space-y-1 text-muted-foreground">
                <p>
                  • {t("tenants.status.terminated")}
                </p>
              </div>
            </div>
          </div>

          <div className="p-3 border rounded-lg bg-muted/50">
            <div className="space-y-1">
              <p className="font-medium">
                {tenant.firstName} {tenant.lastName}
              </p>
              <p className="text-sm text-muted-foreground">
                {t("tenants.table.status")}:{" "}
                {tenant.tenantStatus
                  ? t(`tenants.status.${tenant.tenantStatus}`, {
                      defaultValue: tenant.tenantStatus.replace(/_/g, " "),
                    })
                  : t("tenants.status.unknown")}
              </p>
            </div>
          </div>

          {hasActiveLease && (
            <div className="flex items-start gap-2 p-4 border border-amber-200 bg-amber-50 text-amber-900 rounded-lg dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-200">
              <AlertTriangle className="h-5 w-5 mt-0.5" />
              <div className="text-sm">
                <p className="font-medium">
                  {t("tenants.deleteDialog.activeLeaseTitle", {
                    defaultValue: "Active lease detected",
                  })}
                </p>
                <p className="mt-1">{activeLeaseDeleteMessage}</p>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="reason">{t("tenants.bulkStatusDialog.reasonLabel")}</Label>
            <Textarea
              id="reason"
              placeholder={t("tenants.bulkStatusDialog.reasonPlaceholder")}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={hasActiveLease}
              rows={3}
            />
          </div>

          <div className="flex items-start gap-2 p-3 border rounded-lg">
            <Checkbox
              id="confirm"
              checked={confirmDelete}
              onCheckedChange={(checked) => setConfirmDelete(!!checked)}
              disabled={hasActiveLease}
            />
            <div className="space-y-1">
              <Label htmlFor="confirm" className="text-sm font-medium cursor-pointer">
                {t("tenants.deleteDialog.confirmLabel", {
                  defaultValue: "Move this tenant to the Archive",
                })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("tenants.deleteDialog.confirmDescription", {
                  defaultValue:
                    "They leave the tenants list. Their contracts, invoices and payments are kept, and they can be restored from the Archive.",
                })}
              </p>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {t("tenants.deleteDialog.cancel")}
          </Button>
          <Button
            variant="destructive"
            onClick={handleDelete}
            disabled={isLoading || hasActiveLease || !reason.trim() || !confirmDelete}
          >
            {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {t("tenants.deleteDialog.delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Tenant
          </DialogTitle>
          <DialogDescription>
            Are you sure you want to delete {tenant.firstName} {tenant.lastName}
            ?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          //  Warning 
          // <div className="flex items-start gap-2 p-4 border border-destructive/20 bg-destructive/5 rounded-lg">
          //   <AlertTriangle className="h-5 w-5 text-destructive mt-0.5" />
          //   <div className="text-sm">
          //     <p className="font-medium text-destructive">
          //       Warning: This action cannot be undone
          //     </p>
          //     <div className="mt-2 space-y-1 text-muted-foreground">
          //       <p>• The tenant will be marked as terminated</p>
          //       <p>• All tenant data will be soft-deleted</p>
          //       <p>
          //         • Associated leases and payments will remain for record
          //         keeping
          //       </p>
          //       <p>• The tenant will no longer appear in active lists</p>
          //     </div>
          //   </div>
          // </div>

          //  Tenant Info 
          // <div className="p-3 border rounded-lg bg-muted/50">
          //   <div className="space-y-1">
          //     <p className="font-medium">
          //       {tenant.firstName} {tenant.lastName}
          //     </p>
          //     <p className="text-sm text-muted-foreground">
          //       Current Status:{" "}
          //       {tenant.tenantStatus?.replace("_", " ").toUpperCase() ||
          //         "Unknown"}
          //     </p>
          //   </div>
          // </div>

          // Reason
          // <div className="space-y-2">
          //   <Label htmlFor="reason">Reason for Deletion *</Label>
          //   <Textarea
          //     id="reason"
          //     placeholder="Enter the reason for deleting this tenant (required for audit trail)"
          //     value={reason}
          //     onChange={(e) => setReason(e.target.value)}
          //     rows={3}
          //   />
          // </div>

          //  Confirmation
        //   <div className="flex items-start gap-2 p-3 border rounded-lg">
        //     <Checkbox
        //       id="confirm"
        //       checked={confirmDelete}
        //       onCheckedChange={(checked) =>
        //         setConfirmDelete(checked as boolean)
        //       }
        //     />
        //     <div className="space-y-1">
        //       <Label
        //         htmlFor="confirm"
        //         className="text-sm font-medium cursor-pointer"
        //       >
        //         I understand this action cannot be undone
        //       </Label>
        //       <p className="text-xs text-muted-foreground">
        //         This will permanently remove the tenant from active management
        //         while preserving historical records.
        //       </p>
        //     </div>
        //   </div>
        // </div>

    //     <DialogFooter>
    //       <Button variant="outline" onClick={handleClose} disabled={isLoading}>
    //         Cancel
    //       </Button>
    //       <Button
    //         variant="destructive"
    //         onClick={handleDelete}
    //         disabled={isLoading || !reason.trim() || !confirmDelete}
    //       >
    //         {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
    //         Delete Tenant
    //       </Button>
    //     </DialogFooter>
    //   </DialogContent>
    // </Dialog>
  // ); */
