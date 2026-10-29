/**
 * PropertyPro - Confirmation Dialog Component
 * Reusable confirmation dialog for destructive actions
 */

"use client";

import React from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Loader2 } from "lucide-react";
import { useUiText } from "@/components/ui/use-ui-text";

interface ConfirmationDialogProps {
  children: React.ReactNode;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
}

export function ConfirmationDialog({
  children,
  title,
  description,
  confirmText,
  cancelText,
  variant = "default",
  onConfirm,
  loading = false,
  disabled = false,
}: ConfirmationDialogProps) {
  const { text } = useUiText();
  const [open, setOpen] = React.useState(false);

  const handleConfirm = async () => {
    try {
      await onConfirm();
      setOpen(false);
    } catch (error) {
      // Error handling is done in the parent component
      console.error("Confirmation action failed:", error);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild disabled={disabled}>
        {children}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>
            {cancelText ?? text("ui.cancel", "Cancel")}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={handleConfirm}
            disabled={loading}
            className={
              variant === "destructive"
                ? "bg-red-600 hover:bg-red-700 text-white focus:ring-red-600"
                : ""
            }
          >
            {loading && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
            {confirmText ?? text("ui.confirm", "Confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// Specific confirmation dialogs for common actions
interface DeleteConfirmationDialogProps {
  children: React.ReactNode;
  itemName: string;
  itemType?: string;
  /** Replaces the default line under the title. */
  description?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
}

/**
 * The kinds of record whose delete moves them to the Archive, where they can
 * be restored. Telling someone deleting one of these "This cannot be undone"
 * was false, and put people off a routine action for fear of losing it.
 */
const ARCHIVED_ITEM_TYPES = new Set([
  "lease",
  "contract",
  "tenant",
  "owner",
  "property",
  "building",
  "unit",
  "compound",
  "agreement",
  "invoice",
  "payment",
  "maintenance",
]);

// The title names the item itself, which reads correctly in every language;
// `itemType` decides only whether the delete can be undone from the Archive.
export function DeleteConfirmationDialog({
  children,
  itemName,
  itemType,
  description,
  onConfirm,
  loading = false,
  disabled = false,
}: DeleteConfirmationDialogProps) {
  const { text } = useUiText();
  const archived = itemType !== undefined && ARCHIVED_ITEM_TYPES.has(itemType);
  return (
    <ConfirmationDialog
      title={text("ui.confirmDelete.title", "Delete {name}?").replace("{name}", `“${itemName}”`)}
      description={
        description ??
        (archived
          ? text(
              "ui.confirmDelete.archiveDescription",
              "It moves to the Archive, where it can be restored.",
            )
          : text("ui.confirmDelete.description", "This cannot be undone."))
      }
      confirmText={text("ui.delete", "Delete")}
      variant="destructive"
      onConfirm={onConfirm}
      loading={loading}
      disabled={disabled}
    >
      {children}
    </ConfirmationDialog>
  );
}

interface CancelConfirmationDialogProps {
  children: React.ReactNode;
  itemName: string;
  itemType?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
}

export function CancelConfirmationDialog({
  children,
  itemName,
  onConfirm,
  loading = false,
  disabled = false,
}: CancelConfirmationDialogProps) {
  const { text } = useUiText();
  return (
    <ConfirmationDialog
      title={text("ui.confirmCancel.title", "Cancel {name}?").replace("{name}", `“${itemName}”`)}
      description={text("ui.confirmCancel.description", "Any work in progress on it may be affected.")}
      confirmText={text("ui.confirmCancel.action", "Cancel it")}
      variant="destructive"
      onConfirm={onConfirm}
      loading={loading}
      disabled={disabled}
    >
      {children}
    </ConfirmationDialog>
  );
}

interface CompleteConfirmationDialogProps {
  children: React.ReactNode;
  itemName: string;
  itemType?: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
}

export function CompleteConfirmationDialog({
  children,
  itemName,
  onConfirm,
  loading = false,
  disabled = false,
}: CompleteConfirmationDialogProps) {
  const { text } = useUiText();
  return (
    <ConfirmationDialog
      title={text("ui.confirmComplete.title", "Mark {name} as done?").replace("{name}", `“${itemName}”`)}
      description={text("ui.confirmComplete.description", "This closes the work.")}
      confirmText={text("ui.confirmComplete.action", "Mark as done")}
      onConfirm={onConfirm}
      loading={loading}
      disabled={disabled}
    >
      {children}
    </ConfirmationDialog>
  );
}

interface AssignConfirmationDialogProps {
  children: React.ReactNode;
  itemName: string;
  technicianName: string;
  onConfirm: () => void | Promise<void>;
  loading?: boolean;
  disabled?: boolean;
}

export function AssignConfirmationDialog({
  children,
  itemName,
  technicianName,
  onConfirm,
  loading = false,
  disabled = false,
}: AssignConfirmationDialogProps) {
  const { text } = useUiText();
  return (
    <ConfirmationDialog
      title={text("ui.confirmAssign.title", "Assign a technician")}
      description={text("ui.confirmAssign.description", "Assign {name} to {technician}?")
        .replace("{name}", `“${itemName}”`)
        .replace("{technician}", technicianName)}
      confirmText={text("ui.confirmAssign.action", "Assign")}
      onConfirm={onConfirm}
      loading={loading}
      disabled={disabled}
    >
      {children}
    </ConfirmationDialog>
  );
}
