"use client";

import React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { errorLogger, ErrorCategory, ErrorSeverity } from "@/lib/error-logger";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

/** What the boundary shows by default. A function, so it can read the language. */
function DefaultErrorCard({
  error,
  stack,
  retry,
}: {
  error?: Error;
  stack?: boolean;
  retry: () => void;
}) {
  const { t } = useLocalizationContext();
  return (
    <Card className="border-red-200 bg-red-50">
      <CardHeader>
        <CardTitle className="flex items-center text-red-800">
          <AlertCircle className="h-5 w-5 me-2" />
          {t("errors.ui.boundary.title", { defaultValue: "Something went wrong" })}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-red-700">
          {error?.message ||
            t("errors.ui.boundary.message", { defaultValue: "An unexpected error occurred." })}
        </p>

        {stack && (
          <details className="text-sm text-red-600">
            <summary className="cursor-pointer font-medium">Error details (development)</summary>
            <pre className="mt-2 p-2 bg-red-100 rounded text-xs overflow-auto">
              {error?.stack}
            </pre>
          </details>
        )}

        <Button
          onClick={retry}
          variant="outline"
          className="border-red-300 text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="h-4 w-4 me-2" />
          {t("errors.ui.tryAgain", { defaultValue: "Try again" })}
        </Button>
      </CardContent>
    </Card>
  );
}

function ImageLoadFailed({ retry }: { error: Error; retry: () => void }) {
  const { t } = useLocalizationContext();
  return (
    <Card className="border-orange-200 bg-orange-50">
      <CardContent className="flex flex-col items-center justify-center py-8">
        <AlertCircle className="h-12 w-12 text-orange-500 mb-4" />
        <h3 className="text-lg font-semibold text-orange-800 mb-2">{t("errors.ui.images.title", { defaultValue: "The pictures did not load" })}</h3>
        <p className="text-orange-700 text-center mb-4">
          {t("errors.ui.images.message", { defaultValue: "The connection may have dropped, or an image file is damaged." })}
        </p>
        <Button
          onClick={retry}
          variant="outline"
          className="border-orange-300 text-orange-700 hover:bg-orange-100"
        >
          <RefreshCw className="h-4 w-4 me-2" />
          {t("errors.ui.images.retry", { defaultValue: "Load the pictures again" })}
        </Button>
      </CardContent>
    </Card>
  );
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
  errorInfo?: React.ErrorInfo;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);

    this.setState({
      error,
      errorInfo,
    });

    // Log error to error logger
    errorLogger.logError({
      error,
      category: ErrorCategory.UI,
      severity: ErrorSeverity.HIGH,
      context: {
        componentStack: errorInfo.componentStack,
      },
      metadata: {
        errorInfo: errorInfo.componentStack,
      },
    });

    // Call the onError callback if provided
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: undefined, errorInfo: undefined });
  };

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return (
          <FallbackComponent
            error={this.state.error!}
            retry={this.handleRetry}
          />
        );
      }

      // Default error UI
      return (
        <DefaultErrorCard
          error={this.state.error}
          stack={process.env.NODE_ENV === "development" && !!this.state.errorInfo}
          retry={this.handleRetry}
        />
      );
    }

    return this.props.children;
  }
}

// Hook version for functional components
export function useErrorHandler() {
  const [error, setError] = React.useState<Error | null>(null);

  const resetError = React.useCallback(() => {
    setError(null);
  }, []);

  const handleError = React.useCallback((error: Error) => {
    console.error("Error caught by useErrorHandler:", error);
    setError(error);
  }, []);

  React.useEffect(() => {
    if (error) {
      throw error;
    }
  }, [error]);

  return { handleError, resetError };
}

// Specific error boundary for image-related errors
export function ImageErrorBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ErrorBoundary
      fallback={ImageLoadFailed}
      onError={(error, errorInfo) => {
        // Log image-specific errors
        console.error("Image Error:", error);
        console.error("Error Info:", errorInfo);
      }}
    >
      {children}
    </ErrorBoundary>
  );
}

export default ErrorBoundary;
