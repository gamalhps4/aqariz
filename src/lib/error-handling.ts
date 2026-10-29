/**
 * PropertyPro - Comprehensive Error Handling System
 * Centralized error handling with user-friendly messages and recovery strategies
 */

import { toast } from "sonner";

export enum ErrorType {
  NETWORK = "NETWORK",
  VALIDATION = "VALIDATION",
  AUTHENTICATION = "AUTHENTICATION",
  AUTHORIZATION = "AUTHORIZATION",
  PAYMENT = "PAYMENT",
  DATABASE = "DATABASE",
  UNKNOWN = "UNKNOWN",
}

export interface AppError {
  type: ErrorType;
  message: string;
  code?: string;
  details?: any;
  recoverable?: boolean;
  retryable?: boolean;
}

export class PropertyProError extends Error {
  public type: ErrorType;
  public code?: string;
  public details?: any;
  public recoverable: boolean;
  public retryable: boolean;

  constructor(
    type: ErrorType,
    message: string,
    options: {
      code?: string;
      details?: any;
      recoverable?: boolean;
      retryable?: boolean;
    } = {}
  ) {
    super(message);
    this.name = "PropertyProError";
    this.type = type;
    this.code = options.code;
    this.details = options.details;
    this.recoverable = options.recoverable ?? true;
    this.retryable = options.retryable ?? false;
  }
}

// Error message mappings for user-friendly display
const ERROR_MESSAGES: Record<string, string> = {
  // Network errors
  NETWORK_TIMEOUT:
    "Request timed out. Please check your connection and try again.",
  NETWORK_OFFLINE:
    "You appear to be offline. Please check your internet connection.",
  NETWORK_SERVER_ERROR:
    "Server is temporarily unavailable. Please try again later.",

  // Payment errors
  PAYMENT_DECLINED:
    "Your payment was declined. Please check your payment method and try again.",
  PAYMENT_INSUFFICIENT_FUNDS:
    "Insufficient funds. Please use a different payment method.",
  PAYMENT_EXPIRED_CARD:
    "Your card has expired. Please update your payment method.",
  PAYMENT_INVALID_CARD:
    "Invalid card information. Please check your details and try again.",
  PAYMENT_PROCESSING_ERROR:
    "Payment processing failed. Please try again or contact support.",

  // Validation errors
  VALIDATION_REQUIRED_FIELD: "Please fill in all required fields.",
  VALIDATION_INVALID_EMAIL: "Please enter a valid email address.",
  VALIDATION_INVALID_PHONE: "Please enter a valid phone number.",
  VALIDATION_INVALID_AMOUNT: "Please enter a valid amount.",

  // Authentication errors
  AUTH_INVALID_CREDENTIALS: "Invalid email or password. Please try again.",
  AUTH_SESSION_EXPIRED: "Your session has expired. Please log in again.",
  AUTH_ACCOUNT_LOCKED:
    "Your account has been temporarily locked. Please contact support.",

  // Database errors
  DB_CONNECTION_ERROR: "Database connection failed. Please try again later.",
  DB_RECORD_NOT_FOUND: "The requested record was not found.",
  DB_DUPLICATE_ENTRY: "This record already exists.",

  // Default fallbacks
  UNKNOWN_ERROR:
    "An unexpected error occurred. Please try again or contact support.",
};

export function getErrorMessage(error: any): string {
  if (error instanceof PropertyProError) {
    return ERROR_MESSAGES[error.code || ""] || error.message;
  }

  if (error?.code && ERROR_MESSAGES[error.code]) {
    return ERROR_MESSAGES[error.code];
  }

  if (error?.message) {
    return error.message;
  }

  return ERROR_MESSAGES.UNKNOWN_ERROR;
}

export function handleApiError(error: any): PropertyProError {
  // Network errors
  if (!navigator.onLine) {
    return new PropertyProError(ErrorType.NETWORK, "Network unavailable", {
      code: "NETWORK_OFFLINE",
      retryable: true,
    });
  }

  // Fetch errors
  if (error instanceof TypeError && error.message.includes("fetch")) {
    return new PropertyProError(ErrorType.NETWORK, "Network request failed", {
      code: "NETWORK_TIMEOUT",
      retryable: true,
    });
  }

  // HTTP errors
  if (error?.status) {
    switch (error.status) {
      case 400:
        return new PropertyProError(ErrorType.VALIDATION, "Invalid request", {
          code: "VALIDATION_REQUIRED_FIELD",
          details: error.data,
        });
      case 401:
        return new PropertyProError(
          ErrorType.AUTHENTICATION,
          "Authentication failed",
          {
            code: "AUTH_INVALID_CREDENTIALS",
          }
        );
      case 403:
        return new PropertyProError(ErrorType.AUTHORIZATION, "Access denied", {
          code: "AUTH_ACCOUNT_LOCKED",
        });
      case 404:
        return new PropertyProError(ErrorType.DATABASE, "Resource not found", {
          code: "DB_RECORD_NOT_FOUND",
        });
      case 409:
        return new PropertyProError(
          ErrorType.DATABASE,
          "Resource already exists",
          {
            code: "DB_DUPLICATE_ENTRY",
          }
        );
      case 500:
        return new PropertyProError(ErrorType.DATABASE, "Server error", {
          code: "NETWORK_SERVER_ERROR",
          retryable: true,
        });
      default:
        return new PropertyProError(ErrorType.UNKNOWN, "Unknown error", {
          code: "UNKNOWN_ERROR",
          retryable: true,
        });
    }
  }

  return new PropertyProError(
    ErrorType.UNKNOWN,
    error?.message || "Unknown error",
    {
      code: "UNKNOWN_ERROR",
    }
  );
}

export function handlePaymentError(error: any): PropertyProError {
  const errorCode = error?.code || error?.type;

  switch (errorCode) {
    case "card_declined":
      return new PropertyProError(ErrorType.PAYMENT, "Payment declined", {
        code: "PAYMENT_DECLINED",
        retryable: true,
      });
    case "insufficient_funds":
      return new PropertyProError(ErrorType.PAYMENT, "Insufficient funds", {
        code: "PAYMENT_INSUFFICIENT_FUNDS",
      });
    case "expired_card":
      return new PropertyProError(ErrorType.PAYMENT, "Card expired", {
        code: "PAYMENT_EXPIRED_CARD",
      });
    case "invalid_card":
      return new PropertyProError(ErrorType.PAYMENT, "Invalid card", {
        code: "PAYMENT_INVALID_CARD",
      });
    default:
      return new PropertyProError(
        ErrorType.PAYMENT,
        "Payment processing failed",
        {
          code: "PAYMENT_PROCESSING_ERROR",
          retryable: true,
        }
      );
  }
}

export function showErrorToast(error: any) {
  const appError =
    error instanceof PropertyProError ? error : handleApiError(error);
  const message = getErrorMessage(appError);

  toast.error(message, {
    duration: appError.retryable ? 5000 : 4000,
    action: appError.retryable
      ? {
          label: "Retry",
          onClick: () => {
            // Retry logic would be handled by the calling component

          },
        }
      : undefined,
  });

  return appError;
}

export function showSuccessToast(
  message: string,
  options?: { duration?: number; action?: any }
) {
  toast.success(message, {
    duration: options?.duration || 3000,
    action: options?.action,
  });
}

export function showWarningToast(message: string) {
  toast.warning(message, {
    duration: 4000,
  });
}

export function showInfoToast(message: string) {
  toast.info(message, {
    duration: 3000,
  });
}

// Retry utility with exponential backoff
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt === maxRetries) {
        throw error;
      }

      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError;
}

// Form validation helpers
export function validateRequired(value: any, fieldName: string): string | null {
  if (!value || (typeof value === "string" && value.trim() === "")) {
    return `${fieldName} is required`;
  }
  return null;
}

export function validateEmail(email: string): string | null {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return "Please enter a valid email address";
  }
  return null;
}

export function validatePhone(phone: string): string | null {
  const phoneRegex = /^\+?[\d\s\-\(\)]+$/;
  if (!phoneRegex.test(phone) || phone.replace(/\D/g, "").length < 10) {
    return "Please enter a valid phone number";
  }
  return null;
}

export function validateAmount(amount: number | string): string | null {
  const numAmount = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(numAmount) || numAmount <= 0) {
    return "Please enter a valid amount greater than 0";
  }
  return null;
}
