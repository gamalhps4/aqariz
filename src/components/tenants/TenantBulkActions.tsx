"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  RefreshCw,
  Mail,
  Download,
  MoreHorizontal,
  UserCheck,
  UserX,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";

interface TenantBulkActionsProps {
  selectedTenants: string[];
  onClearSelection: () => void;
  onStatusChange: (tenantIds: string[], newStatus: string) => void;
  onDelete: (tenantIds: string[]) => void;
  onSendEmail: (tenantIds: string[]) => void;
  onExport: (tenantIds: string[]) => void;
}

export default function TenantBulkActions({
  selectedTenants,
  onClearSelection,
  onStatusChange,
  onDelete,
  onSendEmail,
  onExport,
}: TenantBulkActionsProps) {
  const [showStatusDialog, setShowStatusDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [selectedStatus, setSelectedStatus] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const statusOptions = [
    {
      value: "application_submitted",
      label: "Application Submitted",
      icon: Clock,
    },
    { value: "under_review", label: "Under Review", icon: Clock },
    { value: "approved", label: "Approved", icon: CheckCircle },
    { value: "active", label: "Active", icon: UserCheck },
    { value: "inactive", label: "Inactive", icon: UserX },
    { value: "moved_out", label: "Moved Out", icon: UserX },
    { value: "terminated", label: "Terminated", icon: XCircle },
  ];

  const handleStatusChange = async () => {
    if (!selectedStatus) {
      toast.error("Please select a status");
      return;
    }

    try {
      setIsLoading(true);
      await onStatusChange(selectedTenants, selectedStatus);
      toast.success(`Status updated for ${selectedTenants.length} tenant(s)`);
      setShowStatusDialog(false);
      setSelectedStatus("");
    } catch (error) {
      toast.error("Failed to update tenant status");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      setIsLoading(true);
      await onDelete(selectedTenants);
      toast.success(`${selectedTenants.length} tenant(s) deleted successfully`);
      setShowDeleteDialog(false);
    } catch (error) {
      toast.error("Failed to delete tenants");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendEmail = async () => {
    try {
      setIsLoading(true);
      await onSendEmail(selectedTenants);
      toast.success(`Email sent to ${selectedTenants.length} tenant(s)`);
    } catch (error) {
      toast.error("Failed to send emails");
    } finally {
      setIsLoading(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsLoading(true);
      await onExport(selectedTenants);
      toast.success(`Exported ${selectedTenants.length} tenant(s)`);
    } catch (error) {
      toast.error("Failed to export tenants");
    } finally {
      setIsLoading(false);
    }
  };

  if (selectedTenants.length === 0) {
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between p-4 bg-muted/50 border-b">
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="text-sm">
            {selectedTenants.length} selected
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearSelection}
            className="text-muted-foreground hover:text-foreground"
          >
            Clear selection
          </Button>
        </div>

        <div className="flex items-center gap-2">
          {/* Quick Actions */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowStatusDialog(true)}
            disabled={isLoading}
          >
            <RefreshCw className="h-4 w-4 me-2" />
            Change Status
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleSendEmail}
            disabled={isLoading}
          >
            <Mail className="h-4 w-4 me-2" />
            Send Email
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isLoading}
          >
            <Download className="h-4 w-4 me-2" />
            Export
          </Button>

          {/* More Actions Dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Bulk Actions</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setShowStatusDialog(true)}>
                <RefreshCw className="me-2 h-4 w-4" />
                Change Status
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleSendEmail}>
                <Mail className="me-2 h-4 w-4" />
                Send Email
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleExport}>
                <Download className="me-2 h-4 w-4" />
                Export Data
              </DropdownMenuItem>
              {/* DISABLED: Delete functionality temporarily disabled */}
              {/* <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => setShowDeleteDialog(true)}
                className="text-red-600 focus:text-red-600"
              >
                <Trash2 className="me-2 h-4 w-4" />
                Delete Selected
              </DropdownMenuItem> */}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Status Change Dialog */}
      <AlertDialog open={showStatusDialog} onOpenChange={setShowStatusDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Change Tenant Status</AlertDialogTitle>
            <AlertDialogDescription>
              Change the status for {selectedTenants.length} selected tenant(s).
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4">
            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="Select new status" />
              </SelectTrigger>
              <SelectContent>
                {statusOptions.map((option) => {
                  const Icon = option.icon;
                  return (
                    <SelectItem key={option.value} value={option.value}>
                      <div className="flex items-center">
                        <Icon className="h-4 w-4 me-2" />
                        {option.label}
                      </div>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStatusChange}
              disabled={!selectedStatus || isLoading}
            >
              {isLoading ? "Updating..." : "Update Status"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* DISABLED: Delete functionality temporarily disabled */}
      {/* <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tenants</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete {selectedTenants.length} selected
              tenant(s)? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isLoading}
              className="bg-red-600 hover:bg-red-700"
            >
              {isLoading ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog> */}
    </>
  );
}
