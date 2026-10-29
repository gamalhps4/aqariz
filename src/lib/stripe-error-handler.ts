/**
 * PropertyPro - Stripe Error Handler
 * Comprehensive error handling for Stripe payment processing
 */

import Stripe from "stripe";

export interface PaymentError {
  code: string;
  message: string;
  userMessage: string;
  type:
    | "card_error"
    | "validation_error"
    | "api_error"
    | "authentication_error"
    | "rate_limit_error"
    | "unknown";
  retryable: boolean;
  severity: "low" | "medium" | "high" | "critical";
}

/**
 * Handle Stripe errors and convert them to user-friendly messages
 */
export function handleStripeError(error: any): PaymentError {
  console.error("Stripe error:", error);

  // Default error response
  let paymentError: PaymentError = {
    code: "unknown_error",
    message: "An unexpected error occurred",
    userMessage:
      "We're experiencing technical difficulties. Please try again later.",
    type: "unknown",
    retryable: false,
    severity: "medium",
  };

  if (error instanceof Stripe.errors.StripeError) {
    switch (error.type) {
      case "StripeCardError":
        paymentError = handleCardError(error as Stripe.errors.StripeCardError);
        break;
      case "StripeRateLimitError":
        paymentError = {
          code: "rate_limit_exceeded",
          message: "Too many requests made to the API too quickly",
          userMessage:
            "We're experiencing high traffic. Please wait a moment and try again.",
          type: "rate_limit_error",
          retryable: true,
          severity: "medium",
        };
        break;
      case "StripeInvalidRequestError":
        paymentError = {
          code: "invalid_request",
          message: error.message,
          userMessage:
            "There was an issue with your payment information. Please check and try again.",
          type: "validation_error",
          retryable: false,
          severity: "low",
        };
        break;
      case "StripeAPIError":
        paymentError = {
          code: "api_error",
          message: "An error occurred with our payment processor",
          userMessage:
            "We're experiencing technical difficulties. Please try again later.",
          type: "api_error",
          retryable: true,
          severity: "high",
        };
        break;
      case "StripeConnectionError":
        paymentError = {
          code: "connection_error",
          message: "Network communication with Stripe failed",
          userMessage:
            "Connection issue detected. Please check your internet connection and try again.",
          type: "api_error",
          retryable: true,
          severity: "medium",
        };
        break;
      case "StripeAuthenticationError":
        paymentError = {
          code: "authentication_error",
          message: "Authentication with Stripe failed",
          userMessage:
            "Payment processing is temporarily unavailable. Please contact support.",
          type: "authentication_error",
          retryable: false,
          severity: "critical",
        };
        break;
      default:
        paymentError = {
          code: error.code || "stripe_error",
          message: error.message,
          userMessage:
            "Payment processing failed. Please try again or contact support.",
          type: "unknown",
          retryable: false,
          severity: "medium",
        };
    }
  } else if (error.name === "ValidationError") {
    paymentError = {
      code: "validation_error",
      message: error.message,
      userMessage: "Please check your payment information and try again.",
      type: "validation_error",
      retryable: false,
      severity: "low",
    };
  } else if (error.code === "ENOTFOUND" || error.code === "ECONNREFUSED") {
    paymentError = {
      code: "network_error",
      message: "Network connection failed",
      userMessage:
        "Unable to process payment due to connection issues. Please try again.",
      type: "api_error",
      retryable: true,
      severity: "medium",
    };
  }

  return paymentError;
}

/**
 * Handle specific card errors from Stripe
 */
function handleCardError(error: Stripe.errors.StripeCardError): PaymentError {
  const baseError: Omit<PaymentError, "code" | "message" | "userMessage"> = {
    type: "card_error",
    retryable: false,
    severity: "low",
  };

  switch (error.code) {
    case "card_declined":
      return {
        ...baseError,
        code: "card_declined",
        message: "Your card was declined",
        userMessage:
          "Your card was declined. Please try a different payment method or contact your bank.",
      };

    case "insufficient_funds":
      return {
        ...baseError,
        code: "insufficient_funds",
        message: "Your card has insufficient funds",
        userMessage:
          "Your card has insufficient funds. Please try a different payment method.",
      };

    case "expired_card":
      return {
        ...baseError,
        code: "expired_card",
        message: "Your card has expired",
        userMessage:
          "Your card has expired. Please use a different payment method.",
      };

    case "incorrect_cvc":
      return {
        ...baseError,
        code: "incorrect_cvc",
        message: "Your card's security code is incorrect",
        userMessage:
          "Your card's security code (CVC) is incorrect. Please check and try again.",
        retryable: true,
      };

    case "incorrect_number":
      return {
        ...baseError,
        code: "incorrect_number",
        message: "Your card number is incorrect",
        userMessage:
          "Your card number is incorrect. Please check and try again.",
        retryable: true,
      };

    case "incorrect_zip":
      return {
        ...baseError,
        code: "incorrect_zip",
        message: "Your card's zip code failed validation",
        userMessage:
          "Your billing zip code is incorrect. Please check and try again.",
        retryable: true,
      };

    case "processing_error":
      return {
        ...baseError,
        code: "processing_error",
        message: "An error occurred while processing your card",
        userMessage:
          "We couldn't process your payment. Please try again or use a different payment method.",
        retryable: true,
        severity: "medium",
      };

    case "rate_limit":
      return {
        ...baseError,
        code: "rate_limit",
        message: "You have exceeded the rate limit",
        userMessage:
          "Too many payment attempts. Please wait a moment and try again.",
        retryable: true,
        type: "rate_limit_error",
      };

    default:
      return {
        ...baseError,
        code: error.code || "card_error",
        message: error.message,
        userMessage:
          "There was an issue with your payment method. Please try again or use a different card.",
      };
  }
}

/**
 * Log payment errors for monitoring and debugging
 */
export function logPaymentError(
  error: PaymentError,
  context: {
    userId?: string;
    invoiceId?: string;
    amount?: number;
    paymentIntentId?: string;
    timestamp?: Date;
  }
) {
  const logData = {
    error: {
      code: error.code,
      message: error.message,
      type: error.type,
      severity: error.severity,
      retryable: error.retryable,
    },
    context: {
      ...context,
      timestamp: context.timestamp || new Date(),
    },
  };

  // Log based on severity
  switch (error.severity) {
    case "critical":
      console.error("[CRITICAL] Payment Error:", logData);
      break;
    case "high":
      console.error("[HIGH] Payment Error:", logData);
      break;
    case "medium":
      console.warn("[MEDIUM] Payment Error:", logData);
      break;
    case "low":
      console.info("[LOW] Payment Error:", logData);
      break;
  }

  // In production, you would send this to your monitoring service
  // Example: Sentry, DataDog, CloudWatch, etc.
}

/**
 * Determine if an error should trigger a retry
 */
export function shouldRetryPayment(
  error: PaymentError,
  attemptCount: number
): boolean {
  const maxRetries = 3;

  if (attemptCount >= maxRetries) {
    return false;
  }

  return error.retryable && error.type !== "card_error";
}

/**
 * Get user-friendly error message for display
 */
export function getDisplayErrorMessage(error: PaymentError): string {
  return error.userMessage;
}

/**
 * Check if error requires immediate attention
 */
export function requiresImmediateAttention(error: PaymentError): boolean {
  return error.severity === "critical" || error.type === "authentication_error";
}
