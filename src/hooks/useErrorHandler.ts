/**
 * PropertyPro - Enhanced Error Handling Hook
 * Comprehensive error handling with better UX
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";

export interface ErrorState {
  hasError: boolean;
  error: Error | null;
  errorType:
    | "network"
    | "validation"
    | "permission"
    | "notFound"
    | "server"
    | "unknown";
  statusCode?: number;
  retryCount: number;
}

export interface ErrorHandlerOptions {
  showToast?: boolean;
  maxRetries?: number;
  onError?: (error: Error, errorType: string) => void;
  onRetry?: () => void;
}

export function useErrorHandler(options: ErrorHandlerOptions = {}) {
  const { showToast = true, maxRetries = 3, onError, onRetry } = options;

  const [errorState, setErrorState] = useState<ErrorState>({
    hasError: false,
    error: null,
    errorType: "unknown",
    retryCount: 0,
  });

  const parseError = useCallback((error: any): ErrorState => {
    let errorType: ErrorState["errorType"] = "unknown";
    let statusCode: number | undefined;
    let errorMessage = "An unexpected error occurred";

    if (error instanceof Error) {
      errorMessage = error.message;
    } else if (typeof error === "string") {
      errorMessage = error;
    }

    // Parse HTTP errors
    if (error?.response?.status || error?.status) {
      statusCode = error.response?.status || error.status;

      switch (statusCode) {
        case 400:
          errorType = "validation";
          break;
        case 401:
        case 403:
          errorType = "permission";
          break;
        case 404:
          errorType = "notFound";
          break;
        case 500:
        case 502:
        case 503:
        case 504:
          errorType = "server";
          break;
        default:
          errorType = "unknown";
      }
    }
    // Parse network errors
    else if (
      errorMessage.toLowerCase().includes("network") ||
      errorMessage.toLowerCase().includes("fetch") ||
      errorMessage.toLowerCase().includes("connection")
    ) {
      errorType = "network";
    }
    // Parse validation errors
    else if (
      errorMessage.toLowerCase().includes("validation") ||
      errorMessage.toLowerCase().includes("required") ||
      errorMessage.toLowerCase().includes("invalid")
    ) {
      errorType = "validation";
    }
    // Parse permission errors
    else if (
      errorMessage.toLowerCase().includes("permission") ||
      errorMessage.toLowerCase().includes("unauthorized") ||
      errorMessage.toLowerCase().includes("forbidden")
    ) {
      errorType = "permission";
    }
    // Parse not found errors
    else if (
      errorMessage.toLowerCase().includes("not found") ||
      errorMessage.toLowerCase().includes("does not exist")
    ) {
      errorType = "notFound";
    }

    return {
      hasError: true,
      error: error instanceof Error ? error : new Error(errorMessage),
      errorType,
      statusCode,
      retryCount: 0,
    };
  }, []);

  const getErrorMessage = useCallback((errorState: ErrorState): string => {
    const { error, errorType, statusCode } = errorState;

    switch (errorType) {
      case "network":
        return "Connection failed. Please check your internet connection and try again.";
      case "validation":
        return error?.message || "Please check your input and try again.";
      case "permission":
        return "You don't have permission to perform this action.";
      case "notFound":
        return "The requested resource could not be found.";
      case "server":
        return "Server error occurred. Please try again later.";
      default:
        return error?.message || "An unexpected error occurred.";
    }
  }, []);

  const getToastMessage = useCallback((errorState: ErrorState): string => {
    const { errorType } = errorState;

    switch (errorType) {
      case "network":
        return "Connection failed";
      case "validation":
        return "Invalid input";
      case "permission":
        return "Permission denied";
      case "notFound":
        return "Resource not found";
      case "server":
        return "Server error";
      default:
        return "Operation failed";
    }
  }, []);

  const handleError = useCallback(
    (error: any) => {
      const newErrorState = parseError(error);
      setErrorState(newErrorState);

      // Show toast notification
      if (showToast) {
        const toastMessage = getToastMessage(newErrorState);
        const fullMessage = getErrorMessage(newErrorState);

        toast.error(toastMessage, {
          description: fullMessage,
          duration: 5000,
        });
      }

      // Call custom error handler
      if (onError) {
        onError(newErrorState.error!, newErrorState.errorType);
      }

      console.error("Error handled:", {
        error: newErrorState.error,
        type: newErrorState.errorType,
        statusCode: newErrorState.statusCode,
      });
    },
    [parseError, showToast, getErrorMessage, getToastMessage, onError]
  );

  const retry = useCallback(() => {
    if (errorState.retryCount >= maxRetries) {
      toast.error("Maximum retry attempts reached");
      return;
    }

    setErrorState((prev) => ({
      ...prev,
      retryCount: prev.retryCount + 1,
    }));

    if (onRetry) {
      onRetry();
    }
  }, [errorState.retryCount, maxRetries, onRetry]);

  const clearError = useCallback(() => {
    setErrorState({
      hasError: false,
      error: null,
      errorType: "unknown",
      retryCount: 0,
    });
  }, []);

  const canRetry = useCallback(() => {
    return (
      errorState.hasError &&
      errorState.retryCount < maxRetries &&
      (errorState.errorType === "network" || errorState.errorType === "server")
    );
  }, [errorState, maxRetries]);

  return {
    errorState,
    handleError,
    retry,
    clearError,
    canRetry: canRetry(),
    getErrorMessage: () => getErrorMessage(errorState),
  };
}
