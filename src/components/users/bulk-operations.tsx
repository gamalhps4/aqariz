/**
 * PropertyPro - Bulk User Operations Component
 * Handle bulk operations for user management
 */

"use client";

import React, { useState, useMemo } from "react";
import { toast } from "sonner";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Users,
  UserCheck,
  UserX,
  Shield,
  Mail,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import { UserRole, IUser } from "@/types";
import { ASSIGNABLE_ORG_ROLES } from "@/lib/permissions-manager";
import { RoleBadge, getRoleLabel } from "@/components/ui/role-badge";

interface BulkOperationsProps {
  selectedUsers: IUser[];
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type BulkAction =
  | "activate"
  | "deactivate"
  | "change_role"
  | "send_email"
  | "delete";

interface BulkActionConfig {
  id: BulkAction;
  label: string;
  description: string;
  icon: React.ReactNode;
  variant: "default" | "destructive" | "secondary";
  requiresConfirmation: boolean;
}

export function BulkOperations({
  selectedUsers,
  isOpen,
  onClose,
  onSuccess,
}: BulkOperationsProps) {
  const { t } = useLocalizationContext();
  const [selectedAction, setSelectedAction] = useState<BulkAction | "">("");
  const [newRole, setNewRole] = useState<UserRole | "">("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);

  const bulkActions: BulkActionConfig[] = useMemo(
    () => [
      {
        id: "activate",
        label: t("admin.bulk.activate.label"),
        description: t("admin.bulk.activate.description"),
        icon: <UserCheck className="h-4 w-4" />,
        variant: "default",
        requiresConfirmation: false,
      },
      {
        id: "deactivate",
        label: t("admin.bulk.deactivate.label"),
        description: t("admin.bulk.deactivate.description"),
        icon: <UserX className="h-4 w-4" />,
        variant: "secondary",
        requiresConfirmation: true,
      },
      {
        id: "change_role",
        label: t("admin.bulk.changeRole.label"),
        description: t("admin.bulk.changeRole.description"),
        icon: <Shield className="h-4 w-4" />,
        variant: "default",
        requiresConfirmation: true,
      },
      {
        id: "send_email",
        label: t("admin.bulk.sendEmail.label"),
        description: t("admin.bulk.sendEmail.description"),
        icon: <Mail className="h-4 w-4" />,
        variant: "default",
        requiresConfirmation: false,
      },
      {
        id: "delete",
        label: t("admin.bulk.delete.label"),
        description: t("admin.bulk.delete.description"),
        icon: <AlertTriangle className="h-4 w-4" />,
        variant: "destructive",
        requiresConfirmation: true,
      },
    ],
    [t]
  );

  const selectedActionConfig = bulkActions.find(
    (action) => action.id === selectedAction
  );

  const handleActionSelect = (action: BulkAction) => {
    setSelectedAction(action);
    const actionConfig = bulkActions.find((a) => a.id === action);

    if (actionConfig?.requiresConfirmation) {
      setShowConfirmation(true);
    }
  };

  const executeBulkAction = async () => {
    if (!selectedAction || selectedUsers.length === 0) return;

    try {
      setIsLoading(true);
      const userIds = selectedUsers.map((user) => user._id.toString());

      let endpoint = "/api/users";
      let method = "PUT";
      let body: any = { userIds };

      switch (selectedAction) {
        case "activate":
          body.updates = { isActive: true };
          break;

        case "deactivate":
          body.updates = { isActive: false };
          break;

        case "change_role":
          if (!newRole) {
            toast.error(t("admin.bulk.toast.selectRole"));
            return;
          }
          body.updates = { role: newRole };
          break;

        case "send_email":
          if (!emailSubject || !emailMessage) {
            toast.error(t("admin.bulk.toast.emailRequired"));
            return;
          }
          endpoint = "/api/users/bulk-email";
          body = {
            userIds,
            subject: emailSubject,
            message: emailMessage,
          };
          method = "POST";
          break;

        case "delete":
          endpoint = `/api/users?ids=${userIds.join(",")}`;
          method = "DELETE";
          body = undefined;
          break;

        default:
          toast.error(t("admin.bulk.toast.invalidAction"));
          return;
      }

      const response = await fetch(endpoint, {
        method,
        headers:
          method !== "DELETE"
            ? {
                "Content-Type": "application/json",
              }
            : {},
        body: body ? JSON.stringify(body) : undefined,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.message || t("admin.bulk.toast.failed"));
      }

      toast.success(
        t("admin.bulk.toast.success", {
          values: {
            action: selectedActionConfig?.label.toLowerCase() ?? "",
            count: selectedUsers.length,
          },
        })
      );
      onSuccess();
      handleClose();
    } catch (error) {
      console.error("Bulk operation error:", error);
      toast.error(
        error instanceof Error
          ? error.message
          : t("admin.bulk.toast.failed")
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setSelectedAction("");
    setNewRole("");
    setEmailSubject("");
    setEmailMessage("");
    setShowConfirmation(false);
    onClose();
  };

  const renderActionForm = () => {
    switch (selectedAction) {
      case "change_role":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="new-role">{t("admin.bulk.changeRole.newRole")}</Label>
              <Select
                value={newRole}
                onValueChange={(value) => setNewRole(value as UserRole)}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("admin.bulk.changeRole.selectPlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {ASSIGNABLE_ORG_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      <div className="flex items-center gap-2">
                        <RoleBadge role={role} size="sm" />
                        <span>{getRoleLabel(role, t)}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case "send_email":
        return (
          <div className="space-y-4">
            <div>
              <Label htmlFor="email-subject">
                {t("admin.bulk.sendEmail.subject")}
              </Label>
              <input
                id="email-subject"
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder={t("admin.bulk.sendEmail.subjectPlaceholder")}
                className="w-full px-3 py-2 border border-input rounded-md"
              />
            </div>
            <div>
              <Label htmlFor="email-message">
                {t("admin.bulk.sendEmail.message")}
              </Label>
              <Textarea
                id="email-message"
                value={emailMessage}
                onChange={(e) => setEmailMessage(e.target.value)}
                placeholder={t("admin.bulk.sendEmail.messagePlaceholder")}
                rows={4}
              />
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t("admin.bulk.title")}
          </DialogTitle>
          <DialogDescription>
            {t("admin.bulk.description", {
              values: { count: selectedUsers.length },
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Selected Users Summary */}
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-sm font-medium mb-2">
              {t("admin.bulk.selectedUsers")}
            </p>
            <div className="flex flex-wrap gap-1">
              {selectedUsers.slice(0, 3).map((user) => (
                <Badge
                  key={user._id.toString()}
                  variant="outline"
                  className="text-xs"
                >
                  {user.firstName} {user.lastName}
                </Badge>
              ))}
              {selectedUsers.length > 3 && (
                <Badge variant="outline" className="text-xs">
                  {t("admin.bulk.more", {
                    values: { count: selectedUsers.length - 3 },
                  })}
                </Badge>
              )}
            </div>
          </div>

          {/* Action Selection */}
          {!showConfirmation && (
            <div>
              <Label>{t("admin.bulk.selectAction")}</Label>
              <div className="grid gap-2 mt-2">
                {bulkActions.map((action) => (
                  <Button
                    key={action.id}
                    variant={
                      selectedAction === action.id ? action.variant : "outline"
                    }
                    className="justify-start h-auto p-3"
                    onClick={() => handleActionSelect(action.id)}
                  >
                    <div className="flex items-start gap-3">
                      {action.icon}
                      <div className="text-start">
                        <div className="font-medium">{action.label}</div>
                        <div className="text-xs text-muted-foreground">
                          {action.description}
                        </div>
                      </div>
                    </div>
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Action Form */}
          {selectedAction && !showConfirmation && renderActionForm()}

          {/* Confirmation */}
          {showConfirmation && selectedActionConfig && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                {t("admin.bulk.confirmation", {
                  values: {
                    action: selectedActionConfig.label.toLowerCase(),
                    count: selectedUsers.length,
                  },
                })}
                {selectedActionConfig.id === "delete" &&
                  " " + t("admin.bulk.confirmationDelete").trim()}
              </AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {t("admin.bulk.cancel")}
          </Button>
          {selectedAction && (
            <Button
              variant={selectedActionConfig?.variant}
              onClick={
                showConfirmation
                  ? executeBulkAction
                  : () => setShowConfirmation(true)
              }
              disabled={isLoading}
            >
              {isLoading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
              {showConfirmation
                ? t("admin.bulk.confirm")
                : t("admin.bulk.continue")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
