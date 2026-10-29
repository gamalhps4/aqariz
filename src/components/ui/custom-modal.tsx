/**
 * Custom Modal Component
 *
 * A flexible modal component with predefined sizes and better control over layout.
 *
 * Features:
 * - Multiple size options: sm, md, lg, xl, 3/4, full
 * - Backdrop click to close
 * - Escape key to close
 * - Prevents body scroll when open
 * - Composable structure with Header, Body, and Footer components
 *
 * Usage:
 * ```tsx
 * <CustomModal open={isOpen} onOpenChange={setIsOpen} size="3/4">
 *   <CustomModalHeader onClose={() => setIsOpen(false)}>
 *     <CustomModalTitle>Modal Title</CustomModalTitle>
 *     <CustomModalDescription>Modal description</CustomModalDescription>
 *   </CustomModalHeader>
 *   <CustomModalBody>
 *     Content goes here
 *   </CustomModalBody>
 *   <CustomModalFooter>
 *     <Button onClick={() => setIsOpen(false)}>Close</Button>
 *   </CustomModalFooter>
 * </CustomModal>
 * ```
 */

"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUiText } from "@/components/ui/use-ui-text";

interface CustomModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl" | "3/4" | "full";
}

export function CustomModal({
  open,
  onOpenChange,
  children,
  className,
  size = "md",
}: CustomModalProps) {
  // Handle escape key
  React.useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        onOpenChange(false);
      }
    };

    if (open) {
      document.addEventListener("keydown", handleEscape);
      // Prevent body scroll when modal is open
      document.body.style.overflow = "hidden";
    }

    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "unset";
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const sizeClasses = {
    sm: "w-full max-w-md h-auto max-h-[60vh]",
    md: "w-full max-w-2xl h-auto max-h-[70vh]",
    lg: "w-full max-w-4xl h-auto max-h-[80vh]",
    xl: "w-full max-w-6xl h-auto max-h-[85vh]",
    "3/4": "w-[75vw] h-[75vh]",
    full: "w-[95vw] h-[95vh]",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />

      {/* Modal Content */}
      <div
        className={cn(
          "relative bg-white dark:bg-gray-800 rounded-lg shadow-2xl flex flex-col",
          sizeClasses[size],
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface CustomModalHeaderProps {
  children: React.ReactNode;
  onClose?: () => void;
  className?: string;
}

export function CustomModalHeader({
  children,
  onClose,
  className,
}: CustomModalHeaderProps) {
  const { text } = useUiText();
  return (
    <div
      className={cn(
        "flex items-start justify-between px-6 py-4 border-b bg-white dark:bg-gray-800 dark:border-gray-700 rounded-t-lg",
        className
      )}
    >
      <div className="flex-1">{children}</div>
      {onClose && (
        <button
          onClick={onClose}
          className="ms-4 text-gray-400 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 transition-colors"
          aria-label={text("ui.close", "Close")}
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}

interface CustomModalTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function CustomModalTitle({
  children,
  className,
}: CustomModalTitleProps) {
  return (
    <h2
      className={cn(
        "text-xl font-semibold text-gray-900 dark:text-gray-100",
        className
      )}
    >
      {children}
    </h2>
  );
}

interface CustomModalDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function CustomModalDescription({
  children,
  className,
}: CustomModalDescriptionProps) {
  return (
    <p
      className={cn("text-sm text-gray-600 dark:text-gray-400 mt-1", className)}
    >
      {children}
    </p>
  );
}

interface CustomModalBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function CustomModalBody({ children, className }: CustomModalBodyProps) {
  return (
    <div className={cn("flex-1 overflow-y-auto px-6 py-4", className)}>
      {children}
    </div>
  );
}

interface CustomModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function CustomModalFooter({
  children,
  className,
}: CustomModalFooterProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-end gap-3 px-6 py-4 border-t bg-gray-50 dark:bg-gray-900 dark:border-gray-700 rounded-b-lg",
        className
      )}
    >
      {children}
    </div>
  );
}
