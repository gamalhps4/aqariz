"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  CheckCircle,
  XCircle,
  Clock,
  UserCheck,
  UserX,
  Settings,
  History,
  AlertTriangle,
} from "lucide-react";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import { useAuthorization } from "@/hooks/useAuthorization";
import { formatDisplayDate } from "@/lib/utils/formatting";

interface TenantStatusManagerProps {
  tenant: {
    _id: string;
    firstName: string;
    lastName: string;
    tenantStatus?: string;
    displayStatus?: string;
    statusColor?: string;
    backgroundCheckStatus?: string;
    lastStatusUpdate?: string;
    statusHistory?: Array<{
      status: string;
      changedBy: {
        firstName: string;
        lastName: string;
      };
      changedAt: string;
      reason?: string;
      notes?: string;
    }>;
  };
  onStatusChange?: (newStatus: string) => void;
  userRole?: string;
}

export default function TenantStatusManager({
  tenant,
  onStatusChange,
}: TenantStatusManagerProps) {
  const { t } = useLocalizationContext();
  const { isCompanyStaff } = useAuthorization();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const canManageStatus = isCompanyStaff;

  const statusOptions = [
    {
      value: "under_review",
      label: t("tenants.statusManager.actions.startReview"),
      icon: Clock,
      color: "outline",
    },
    {
      value: "approved",
      label: t("tenants.statusManager.actions.approve"),
      icon: CheckCircle,
      color: "default",
    },
    {
      value: "active",
      label: t("tenants.statusManager.actions.activate"),
      icon: UserCheck,
      color: "default",
    },
    {
      value: "inactive",
      label: t("tenants.statusManager.actions.deactivate"),
      icon: UserX,
      color: "secondary",
    },
    {
      value: "moved_out",
      label: t("tenants.statusManager.actions.markMovedOut"),
      icon: UserX,
      color: "secondary",
    },
    {
      value: "terminated",
      label: t("tenants.statusManager.actions.terminate"),
      icon: XCircle,
      color: "destructive",
    },
  ];

  const getAvailableTransitions = (currentStatus: string) => {
    const transitions: Record<string, string[]> = {
      application_submitted: ["under_review", "terminated"],
      under_review: ["approved", "terminated"],
      approved: ["active", "terminated"],
      active: ["inactive", "moved_out", "terminated"],
      inactive: ["active", "moved_out", "terminated"],
      moved_out: ["terminated"],
      terminated: [],
    };
    return transitions[currentStatus] || [];
  };

  const handleStatusChange = async () => {
    if (!selectedStatus) {
      toast.error(t("tenants.statusManager.validation.selectStatus"));
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
          reason: reason.trim() || t("tenants.statusManager.defaultReason"),
          notes: notes.trim(),
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(
          errorData.message || t("tenants.toasts.statusUpdateError")
        );
      }

      const data = await response.json();
      toast.success(
        t("tenants.toasts.statusUpdateSuccess", {
          values: { status: selectedStatus },
        }),
        {
          description: reason,
        }
      );

      onStatusChange?.(selectedStatus);
      setIsDialogOpen(false);
      setSelectedStatus("");
      setReason("");
      setNotes("");
    } catch (error) {
      toast.error(t("tenants.toasts.statusUpdateError"), {
        description:
          error instanceof Error
            ? error.message
            : t("tenants.error.unexpected"),
      });
    } finally {
      setIsLoading(false);
    }
  };

  const getStatusIcon = (status: string) => {
    const iconMap: Record<string, typeof Clock> = {
      application_submitted: Clock,
      under_review: Clock,
      approved: CheckCircle,
      active: UserCheck,
      inactive: UserX,
      moved_out: UserX,
      terminated: XCircle,
    };
    return iconMap[status] || Clock;
  };

  const getStatusColor = (status: string) => {
    const colorMap: Record<string, string> = {
      application_submitted: "secondary",
      under_review: "outline",
      approved: "default",
      active: "default",
      inactive: "secondary",
      moved_out: "secondary",
      terminated: "destructive",
    };
    return colorMap[status] || "outline";
  };

  const currentStatus = tenant.tenantStatus || "application_submitted";
  const availableTransitions = getAvailableTransitions(currentStatus);
  const StatusIcon = getStatusIcon(currentStatus);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              {t("tenants.statusManager.title")}
            </CardTitle>
            <CardDescription>
              {t("tenants.statusManager.description", {
                values: {
                  name: `${tenant.firstName} ${tenant.lastName}`,
                },
              })}
            </CardDescription>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowHistory(!showHistory)}
          >
            <History className="h-4 w-4 me-2" />
            {showHistory
              ? t("tenants.statusManager.hideHistory")
              : t("tenants.statusManager.showHistory")}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Current Status */}
        <div className="flex items-center justify-between p-4 border rounded-lg">
          <div className="flex items-center gap-3">
            <StatusIcon className="h-5 w-5" />
            <div>
              <p className="font-medium">
                {t("tenants.statusManager.currentStatus")}
              </p>
              <Badge
                variant={getStatusColor(currentStatus) as any}
                className="mt-1"
              >
                {tenant.displayStatus ||
                  t(`tenants.status.${currentStatus}`, {
                    defaultValue: currentStatus.replace(/_/g, " "),
                  })}
              </Badge>
            </div>
          </div>
          {tenant.lastStatusUpdate && (
            <div className="text-end text-sm text-muted-foreground">
              <p>{t("tenants.statusManager.lastUpdated")}</p>
              <p>{formatDisplayDate(tenant.lastStatusUpdate)}</p>
            </div>
          )}
        </div>

        {/* Status Actions */}
        {canManageStatus && availableTransitions.length > 0 && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              {t("tenants.statusManager.availableActions")}
            </Label>
            <div className="flex flex-wrap gap-2">
              {availableTransitions.map((status) => {
                const option = statusOptions.find(
                  (opt) => opt.value === status
                );
                if (!option) return null;

                const OptionIcon = option.icon;
                return (
                  <Dialog
                    key={status}
                    open={isDialogOpen && selectedStatus === status}
                    onOpenChange={(open) => {
                      if (!open) {
                        setIsDialogOpen(false);
                        setSelectedStatus("");
                        setReason("");
                        setNotes("");
                      }
                    }}
                  >
                    <DialogTrigger asChild>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setSelectedStatus(status);
                          setIsDialogOpen(true);
                        }}
                        className="flex items-center gap-2"
                      >
                        <OptionIcon className="h-4 w-4" />
                        {option.label}
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>
                          {option.label} - {tenant.firstName} {tenant.lastName}
                        </DialogTitle>
                        <DialogDescription>
                          {t("tenants.statusManager.dialog.description", {
                            values: { status: option.label.toLowerCase() },
                          })}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="space-y-4">
                        <div>
                          <Label htmlFor="reason">
                            {t("tenants.statusManager.dialog.reasonLabel")}
                          </Label>
                          <Textarea
                            id="reason"
                            placeholder={t(
                              "tenants.statusManager.dialog.reasonPlaceholder"
                            )}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                        <div>
                          <Label htmlFor="notes">
                            {t("tenants.statusManager.dialog.notesLabel")}
                          </Label>
                          <Textarea
                            id="notes"
                            placeholder={t(
                              "tenants.statusManager.dialog.notesPlaceholder"
                            )}
                            value={notes}
                            onChange={(e) => setNotes(e.target.value)}
                            className="mt-1"
                          />
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="outline"
                          onClick={() => setIsDialogOpen(false)}
                          disabled={isLoading}
                        >
                          {t("tenants.statusManager.dialog.cancel")}
                        </Button>
                        <Button
                          onClick={handleStatusChange}
                          disabled={isLoading || !reason.trim()}
                          variant={
                            option.color === "destructive"
                              ? "destructive"
                              : "default"
                          }
                        >
                          {isLoading
                            ? t("tenants.statusManager.dialog.updating")
                            : t("tenants.statusManager.dialog.confirm", {
                                values: { action: option.label },
                              })}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                );
              })}
            </div>
          </div>
        )}

        {/* Status History */}
        {showHistory &&
          tenant.statusHistory &&
          tenant.statusHistory.length > 0 && (
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                {t("tenants.statusManager.statusHistory")}
              </Label>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {tenant.statusHistory.map((entry, index) => (
                  <div key={index} className="p-3 border rounded-lg text-sm">
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={getStatusColor(entry.status) as any}
                        className="text-xs"
                      >
                        {t(`tenants.status.${entry.status}`, {
                          defaultValue: entry.status.replace(/_/g, " "),
                        })}
                      </Badge>
                      <span className="text-muted-foreground">
                        {formatDisplayDate(entry.changedAt)}
                      </span>
                    </div>
                    <p className="mt-1">
                      {t("tenants.statusManager.history.changedBy", {
                        values: {
                          name: `${entry.changedBy.firstName} ${entry.changedBy.lastName}`,
                        },
                      })}
                    </p>
                    {entry.reason && (
                      <p className="mt-1 text-muted-foreground">
                        {t("tenants.statusManager.history.reason")}:{" "}
                        {entry.reason}
                      </p>
                    )}
                    {entry.notes && (
                      <p className="mt-1 text-muted-foreground">
                        {t("tenants.statusManager.history.notes")}:{" "}
                        {entry.notes}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

        {/* No Actions Available */}
        {canManageStatus && availableTransitions.length === 0 && (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("tenants.statusManager.noActionsAvailable")}
            </p>
          </div>
        )}

        {/* Permission Message */}
        {!canManageStatus && (
          <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {t("tenants.statusManager.noPermission")}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
