/**
 * PropertyPro - Enhanced Error Logging Service
 * Centralized error logging with context and monitoring integration
 */

export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export enum ErrorCategory {
  AUTHENTICATION = "authentication",
  AUTHORIZATION = "authorization",
  VALIDATION = "validation",
  NETWORK = "network",
  DATABASE = "database",
  PAYMENT = "payment",
  FILE_UPLOAD = "file_upload",
  API = "api",
  UI = "ui",
  UNKNOWN = "unknown",
}

export interface ErrorContext {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  url?: string;
  path?: string;
  method?: string;
  userAgent?: string;
  timestamp: string;
  sessionId?: string;
  requestId?: string;
  [key: string]: any;
}

export interface LoggedError {
  id: string;
  message: string;
  stack?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  context: ErrorContext;
  digest?: string;
  metadata?: Record<string, any>;
}

class ErrorLogger {
  private static instance: ErrorLogger;
  private static readonly ignoredBrowserErrorMessages = [
    "ResizeObserver loop completed with undelivered notifications.",
    "ResizeObserver loop limit exceeded",
  ];

  private errorQueue: LoggedError[] = [];
  private isProcessing = false;
  private maxQueueSize = 100;

  private constructor() {
    // Initialize error logger
    if (typeof window !== "undefined") {
      // Set up global error handlers
      this.setupGlobalHandlers();
    }
  }

  static getInstance(): ErrorLogger {
    if (!ErrorLogger.instance) {
      ErrorLogger.instance = new ErrorLogger();
    }
    return ErrorLogger.instance;
  }

  /**
   * Set up global error handlers for uncaught errors
   */
  private setupGlobalHandlers() {
    // Handle uncaught errors
    window.addEventListener("error", (event) => {
      if (this.isIgnoredBrowserError(event.message || event.error?.message)) {
        event.preventDefault();
        return;
      }

      this.logError({
        error: event.error || new Error(event.message),
        category: ErrorCategory.UI,
        severity: ErrorSeverity.HIGH,
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
        },
      });
    });

    // Handle unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      const reasonMessage =
        event.reason instanceof Error
          ? event.reason.message
          : String(event.reason);

      if (this.isIgnoredBrowserError(reasonMessage)) {
        event.preventDefault();
        return;
      }

      this.logError({
        error:
          event.reason instanceof Error ? event.reason : new Error(reasonMessage),
        category: ErrorCategory.UNKNOWN,
        severity: ErrorSeverity.HIGH,
        context: {
          type: "unhandled_promise_rejection",
        },
      });
    });
  }

  /**
   * Ignore benign browser layout notifications that are commonly emitted by
   * ResizeObserver-based UI libraries during development.
   */
  private isIgnoredBrowserError(message?: string): boolean {
    if (!message) return false;

    return ErrorLogger.ignoredBrowserErrorMessages.some((ignoredMessage) =>
      message.includes(ignoredMessage),
    );
  }

  /**
   * Categorize error based on error object and context
   */
  private categorizeError(error: Error, providedCategory?: ErrorCategory): ErrorCategory {
    if (providedCategory) return providedCategory;

    const message = error.message.toLowerCase();

    if (message.includes("unauthorized") || message.includes("authentication")) {
      return ErrorCategory.AUTHENTICATION;
    }
    if (message.includes("forbidden") || message.includes("permission")) {
      return ErrorCategory.AUTHORIZATION;
    }
    if (message.includes("validation") || message.includes("invalid")) {
      return ErrorCategory.VALIDATION;
    }
    if (message.includes("network") || message.includes("fetch") || message.includes("timeout")) {
      return ErrorCategory.NETWORK;
    }
    if (message.includes("database") || message.includes("mongo")) {
      return ErrorCategory.DATABASE;
    }
    if (message.includes("payment") || message.includes("stripe")) {
      return ErrorCategory.PAYMENT;
    }
    if (message.includes("upload") || message.includes("file")) {
      return ErrorCategory.FILE_UPLOAD;
    }

    return ErrorCategory.UNKNOWN;
  }

  /**
   * Determine error severity
   */
  private determineSeverity(
    error: Error,
    category: ErrorCategory,
    providedSeverity?: ErrorSeverity
  ): ErrorSeverity {
    if (providedSeverity) return providedSeverity;

    // Critical categories
    if (
      category === ErrorCategory.AUTHENTICATION ||
      category === ErrorCategory.DATABASE ||
      category === ErrorCategory.PAYMENT
    ) {
      return ErrorSeverity.HIGH;
    }

    // Medium severity
    if (
      category === ErrorCategory.AUTHORIZATION ||
      category === ErrorCategory.API ||
      category === ErrorCategory.FILE_UPLOAD
    ) {
      return ErrorSeverity.MEDIUM;
    }

    // Check error message for severity indicators
    const message = error.message.toLowerCase();
    if (message.includes("critical") || message.includes("fatal")) {
      return ErrorSeverity.CRITICAL;
    }

    return ErrorSeverity.LOW;
  }

  /**
   * Get current context information
   */
  private getContext(additionalContext?: Partial<ErrorContext>): ErrorContext {
    const context: ErrorContext = {
      timestamp: new Date().toISOString(),
      ...additionalContext,
    };

    if (typeof window !== "undefined") {
      context.url = window.location.href;
      context.path = window.location.pathname;
      context.userAgent = navigator.userAgent;
    }

    return context;
  }

  /**
   * Log an error
   */
  logError({
    error,
    category,
    severity,
    context,
    digest,
    metadata,
  }: {
    error: Error;
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    context?: Partial<ErrorContext>;
    digest?: string;
    metadata?: Record<string, any>;
  }): void {
    if (this.isIgnoredBrowserError(error.message)) {
      return;
    }

    const errorCategory = this.categorizeError(error, category);
    const errorSeverity = this.determineSeverity(error, errorCategory, severity);
    const errorContext = this.getContext(context);

    const loggedError: LoggedError = {
      id: this.generateErrorId(),
      message: error.message,
      stack: error.stack,
      category: errorCategory,
      severity: errorSeverity,
      context: errorContext,
      digest,
      metadata,
    };

    // Add to queue
    this.addToQueue(loggedError);

    // Log to console in development
    if (process.env.NODE_ENV === "development") {
      console.group(`🔴 Error [${errorSeverity.toUpperCase()}] - ${errorCategory}`);
      console.error("Message:", error.message);
      console.error("Stack:", error.stack);
      console.error("Context:", errorContext);
      if (metadata) console.error("Metadata:", metadata);
      console.groupEnd();
    }

    // Process queue
    this.processQueue();
  }

  /**
   * Generate unique error ID
   */
  private generateErrorId(): string {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add error to queue
   */
  private addToQueue(error: LoggedError): void {
    this.errorQueue.push(error);

    // Limit queue size
    if (this.errorQueue.length > this.maxQueueSize) {
      this.errorQueue.shift();
    }
  }

  /**
   * Process error queue
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.errorQueue.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const errors = [...this.errorQueue];
      this.errorQueue = [];

      // Send to backend API
      await this.sendToBackend(errors);

      // Send to external monitoring service (if configured)
      await this.sendToMonitoring(errors);
    } catch (error) {
      console.error("Failed to process error queue:", error);
      // Re-add errors to queue if sending failed
      // this.errorQueue.unshift(...errors);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Send errors to backend API
   */
  private async sendToBackend(errors: LoggedError[]): Promise<void> {
    try {
      const response = await fetch("/api/errors/log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ errors }),
      });

      if (!response.ok) {
        throw new Error(`Failed to log errors: ${response.statusText}`);
      }
    } catch (error) {
      // Silently fail to avoid infinite error loops
      if (process.env.NODE_ENV === "development") {
        console.warn("Failed to send errors to backend:", error);
      }
    }
  }

  /**
   * Send errors to external monitoring service
   */
  private async sendToMonitoring(errors: LoggedError[]): Promise<void> {
    // TODO: Integrate with external monitoring services
    // Examples: Sentry, LogRocket, Datadog, etc.
    
    // Example Sentry integration:
    // if (typeof window !== "undefined" && (window as any).Sentry) {
    //   errors.forEach((error) => {
    //     (window as any).Sentry.captureException(new Error(error.message), {
    //       level: error.severity,
    //       tags: {
    //         category: error.category,
    //       },
    //       extra: {
    //         context: error.context,
    //         metadata: error.metadata,
    //       },
    //     });
    //   });
    // }
  }

  /**
   * Get error statistics
   */
  getStats(): {
    totalErrors: number;
    byCategory: Record<ErrorCategory, number>;
    bySeverity: Record<ErrorSeverity, number>;
  } {
    const stats = {
      totalErrors: this.errorQueue.length,
      byCategory: {} as Record<ErrorCategory, number>,
      bySeverity: {} as Record<ErrorSeverity, number>,
    };

    this.errorQueue.forEach((error) => {
      stats.byCategory[error.category] = (stats.byCategory[error.category] || 0) + 1;
      stats.bySeverity[error.severity] = (stats.bySeverity[error.severity] || 0) + 1;
    });

    return stats;
  }

  /**
   * Clear error queue
   */
  clearQueue(): void {
    this.errorQueue = [];
  }
}

// Export singleton instance
export const errorLogger = ErrorLogger.getInstance();

// Convenience functions
export function logError(
  error: Error,
  options?: {
    category?: ErrorCategory;
    severity?: ErrorSeverity;
    context?: Partial<ErrorContext>;
    metadata?: Record<string, any>;
  }
) {
  errorLogger.logError({
    error,
    ...options,
  });
}

export function logCriticalError(error: Error, context?: Partial<ErrorContext>) {
  errorLogger.logError({
    error,
    severity: ErrorSeverity.CRITICAL,
    context,
  });
}

export function logNetworkError(error: Error, context?: Partial<ErrorContext>) {
  errorLogger.logError({
    error,
    category: ErrorCategory.NETWORK,
    context,
  });
}

export function logAuthError(error: Error, context?: Partial<ErrorContext>) {
  errorLogger.logError({
    error,
    category: ErrorCategory.AUTHENTICATION,
    severity: ErrorSeverity.HIGH,
    context,
  });
}
