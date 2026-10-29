/**
 * PropertyPro - Enhanced Error Alert Components
 * Reusable error components for better UX
 */

"use client";

import React from "react";
import {
  AlertCircle,
  RefreshCw,
  X,
  Info,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

export interface ErrorAlertProps {
  title?: string;
  message: string;
  variant?: "error" | "warning" | "info" | "success";
  onRetry?: () => void;
  onDismiss?: () => void;
  retryText?: string;
  className?: string;
  showIcon?: boolean;
}

export function ErrorAlert({
  title,
  message,
  variant = "error",
  onRetry,
  onDismiss,
  retryText,
  className,
  showIcon = true,
}: ErrorAlertProps) {
  const { t } = useLocalizationContext();
  const getVariantStyles = () => {
    switch (variant) {
      case "error":
        return {
          alertClass:
            "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300",
          icon: AlertCircle,
          iconClass: "text-red-600 dark:text-red-400",
        };
      case "warning":
        return {
          alertClass:
            "border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-300",
          icon: AlertTriangle,
          iconClass: "text-orange-600 dark:text-orange-400",
        };
      case "info":
        return {
          alertClass:
            "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 text-blue-800 dark:text-blue-300",
          icon: Info,
          iconClass: "text-blue-600 dark:text-blue-400",
        };
      case "success":
        return {
          alertClass:
            "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-300",
          icon: CheckCircle,
          iconClass: "text-green-600 dark:text-green-400",
        };
      default:
        return {
          alertClass:
            "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300",
          icon: AlertCircle,
          iconClass: "text-red-600",
        };
    }
  };

  const { alertClass, icon: Icon, iconClass } = getVariantStyles();

  return (
    <Alert className={cn(alertClass, className)}>
      <div className="flex items-start justify-between">
        <div className="flex items-start space-x-3">
          {showIcon && <Icon className={cn("h-5 w-5 mt-0.5", iconClass)} />}
          <div className="flex-1">
            {title && <AlertTitle className="mb-1">{title}</AlertTitle>}
            <AlertDescription className="text-sm">{message}</AlertDescription>
          </div>
        </div>

        <div className="flex items-center space-x-2 ms-4">
          {onRetry && (
            <Button
              onClick={onRetry}
              variant="outline"
              size="sm"
              className={cn(
                "h-8 px-3",
                variant === "error" &&
                  "border-red-300 text-red-700 hover:bg-red-100",
                variant === "warning" &&
                  "border-orange-300 text-orange-700 hover:bg-orange-100",
                variant === "info" &&
                  "border-blue-300 text-blue-700 hover:bg-blue-100",
                variant === "success" &&
                  "border-green-300 text-green-700 hover:bg-green-100"
              )}
            >
              <RefreshCw className="h-3 w-3 me-1" />
              {retryText ?? t("errors.ui.tryAgain", { defaultValue: "Try again" })}
            </Button>
          )}

          {onDismiss && (
            <Button
              onClick={onDismiss}
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 hover:bg-transparent"
              aria-label={t("common.dismiss", { defaultValue: "Dismiss" })}
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </Alert>
  );
}

// Specific error types for common scenarios
export function NetworkErrorAlert({
  onRetry,
  onDismiss,
}: {
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useLocalizationContext();
  return (
    <ErrorAlert
      title={t("errors.ui.network.title", { defaultValue: "Connection problem" })}
      message={t("errors.ui.network.message", { defaultValue: "Could not reach the server. Check your internet connection and try again." })}
      variant="error"
      onRetry={onRetry}
      onDismiss={onDismiss}
    />
  );
}

export function ValidationErrorAlert({
  errors,
  onDismiss,
}: {
  errors: string[];
  onDismiss?: () => void;
}) {
  const { t } = useLocalizationContext();
  return (
    <ErrorAlert
      title={t("errors.ui.validation.title", { defaultValue: "Check the form" })}
      message={
        errors.length === 1
          ? errors[0]
          : t("errors.ui.validation.list", { defaultValue: "Fix these first: {issues}", values: { issues: errors.join(", ") } })
      }
      variant="warning"
      onDismiss={onDismiss}
    />
  );
}

export function PermissionErrorAlert({
  onDismiss,
}: {
  onDismiss?: () => void;
}) {
  const { t } = useLocalizationContext();
  return (
    <ErrorAlert
      title={t("errors.ui.permission.title", { defaultValue: "Not allowed" })}
      message={t("errors.ui.permission.message", { defaultValue: "Your role does not allow this. Ask your administrator for access." })}
      variant="error"
      onDismiss={onDismiss}
    />
  );
}

export function NotFoundErrorAlert({
  resource,
  onRetry,
  onDismiss,
}: {
  resource?: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}) {
  const { t } = useLocalizationContext();
  return (
    <ErrorAlert
      title={t("errors.ui.notFound.title", { defaultValue: "Not found" })}
      message={
        resource
          ? t("errors.ui.notFound.named", { defaultValue: "This {resource} could not be found. It may have been deleted or moved.", values: { resource } })
          : t("errors.ui.notFound.message", { defaultValue: "This could not be found. It may have been deleted or moved." })
      }
      variant="warning"
      onRetry={onRetry}
      onDismiss={onDismiss}
      retryText={t("errors.ui.refresh", { defaultValue: "Refresh" })}
    />
  );
}

// Fixed position error alert for critical errors
export function FixedErrorAlert({
  title,
  message,
  variant = "error",
  onRetry,
  onDismiss,
  retryText,
  position = "top",
}: ErrorAlertProps & { position?: "top" | "bottom" }) {
  const positionClasses = {
    top: "fixed top-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md mx-4",
    bottom:
      "fixed bottom-4 left-1/2 transform -translate-x-1/2 z-50 w-full max-w-md mx-4",
  };

  return (
    <div className={positionClasses[position]}>
      <ErrorAlert
        title={title}
        message={message}
        variant={variant}
        onRetry={onRetry}
        onDismiss={onDismiss}
        retryText={retryText}
        className="shadow-lg border-2"
      />
    </div>
  );
}
