"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  AlertCircle,
  RefreshCw,
  Home,
  ArrowLeft,
  Bug,
  Shield,
  Wifi,
  Database,
  Server,
  FileWarning,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

// Determine error type based on error message and properties
function getErrorType(error: Error) {
  const message = error.message.toLowerCase();
  
  if (message.includes("network") || message.includes("fetch") || message.includes("connection")) {
    return "network";
  }
  if (message.includes("unauthorized") || message.includes("authentication")) {
    return "auth";
  }
  if (message.includes("forbidden") || message.includes("permission")) {
    return "permission";
  }
  if (message.includes("database") || message.includes("mongo")) {
    return "database";
  }
  if (message.includes("validation") || message.includes("invalid")) {
    return "validation";
  }
  return "unknown";
}

// Get error icon based on type
function getErrorIcon(type: string) {
  switch (type) {
    case "network":
      return Wifi;
    case "auth":
      return Shield;
    case "database":
      return Database;
    case "permission":
      return Shield;
    case "validation":
      return FileWarning;
    default:
      return Bug;
  }
}

// Get user-friendly error message, in the reader's language
function getErrorMessage(
  type: string,
  t: (key: string, options?: { defaultValue?: string }) => string,
) {
  const kind = ["network", "auth", "permission", "database", "validation"].includes(type)
    ? type
    : "unknown";
  // The English wording lives in the catalogue (errors.page.*); the key alone
  // is enough here.
  return {
    title: t(`errors.page.${kind}.title`),
    description: t(`errors.page.${kind}.description`),
    suggestion: t(`errors.page.${kind}.suggestion`),
  };
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  const router = useRouter();
  const { t, isRTL } = useLocalizationContext();
  const errorType = getErrorType(error);
  const errorInfo = getErrorMessage(errorType, t);
  const ErrorIcon = getErrorIcon(errorType);

  useEffect(() => {
    // Log error to console in development
    if (process.env.NODE_ENV === "development") {
      console.error("Application Error:", {
        message: error.message,
        stack: error.stack,
        digest: error.digest,
        type: errorType,
      });
    }

    // Log error to monitoring service in production
    if (process.env.NODE_ENV === "production") {
      // TODO: Send to error monitoring service (e.g., Sentry, LogRocket)
      console.error("Error digest:", error.digest);
    }
  }, [error, errorType]);

  return (
    <div
      dir={isRTL ? "rtl" : "ltr"}
      className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/20"
    >
      <Card className="max-w-3xl w-full border-border/60 shadow-2xl overflow-hidden">
        <CardContent className="p-0">
          {/* Decorative Header */}
          <div className="relative h-32 bg-gradient-to-r from-destructive/10 via-destructive/5 to-transparent overflow-hidden">
            <div className="absolute inset-0 opacity-10">
              <div className="absolute top-4 start-8 w-32 h-32 rounded-full bg-destructive blur-3xl" />
              <div className="absolute bottom-4 end-8 w-40 h-40 rounded-full bg-destructive/60 blur-3xl" />
            </div>
            <div className="relative h-full flex items-center justify-center">
              <div className="relative">
                <Server className="size-16 text-destructive/30 absolute -top-2 -start-2 blur-sm" />
                <ErrorIcon className="size-16 text-destructive relative z-10" />
              </div>
            </div>
          </div>

          {/* Content */}
          <div className="p-8 md:p-12 space-y-6">
            {/* Error Title */}
            <div className="text-center space-y-3">
              <h1 className="text-3xl md:text-4xl font-bold text-foreground">
                {errorInfo.title}
              </h1>
              <p className="text-muted-foreground max-w-2xl mx-auto leading-relaxed">
                {errorInfo.description}
              </p>
            </div>

            {/* Error Details Alert */}
            <Alert className="border-destructive/50 bg-destructive/5">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm">
                <strong>{t("errors.page.suggestion", { defaultValue: "What to do:" })}</strong>{" "}
                {errorInfo.suggestion}
              </AlertDescription>
            </Alert>

            {/* Technical Details (Development Only) */}
            {process.env.NODE_ENV === "development" && (
              <details className="mt-4">
                <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">
                  Technical Details (Development Mode)
                </summary>
                <div className="mt-3 p-4 bg-muted/50 rounded-lg border border-border">
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="font-semibold">Error Type:</span>{" "}
                      <code className="px-2 py-1 bg-background rounded text-xs">
                        {errorType}
                      </code>
                    </div>
                    <div>
                      <span className="font-semibold">Message:</span>{" "}
                      <code className="px-2 py-1 bg-background rounded text-xs">
                        {error.message}
                      </code>
                    </div>
                    {error.digest && (
                      <div>
                        <span className="font-semibold">Digest:</span>{" "}
                        <code className="px-2 py-1 bg-background rounded text-xs">
                          {error.digest}
                        </code>
                      </div>
                    )}
                    {error.stack && (
                      <div className="mt-3">
                        <span className="font-semibold">Stack Trace:</span>
                        <pre className="mt-2 p-3 bg-background rounded text-xs overflow-auto max-h-48 border border-border">
                          {error.stack}
                        </pre>
                      </div>
                    )}
                  </div>
                </div>
              </details>
            )}

            {/* Error Reference (Production) */}
            {process.env.NODE_ENV === "production" && error.digest && (
              <div className="text-center">
                <p className="text-xs text-muted-foreground">
                  {t("errors.page.reference", { defaultValue: "Error reference:" })}{" "}
                  <code className="font-mono">{error.digest}</code>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("errors.page.referenceHint", { defaultValue: "Include this reference if you contact support." })}
                </p>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-4">
              <Button
                onClick={() => reset()}
                size="lg"
                className="gap-2"
              >
                <RefreshCw className="size-4" />
                {t("errors.ui.tryAgain", { defaultValue: "Try again" })}
              </Button>
              <Button
                onClick={() => router.back()}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                <ArrowLeft className="size-4 rtl:rotate-180" />
                {t("errors.page.back", { defaultValue: "Go back" })}
              </Button>
              <Button
                onClick={() => router.push("/")}
                variant="outline"
                size="lg"
                className="gap-2"
              >
                <Home className="size-4" />
                {t("errors.page.home", { defaultValue: "Home page" })}
              </Button>
            </div>

            {/* Help Section */}
            <div className="pt-6 border-t border-border/50 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                {t("errors.page.help", { defaultValue: "Need help?" })}
              </p>
              <div className="flex flex-wrap gap-2 justify-center">
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                >
                  {/* A hard navigation on purpose. This is the error
                      boundary: the React tree below it has already failed, and
                      a <Link> would try to transition *within* that tree
                      rather than replacing it. */}
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/dashboard">
                    {t("errors.page.dashboard", { defaultValue: "Go to the dashboard" })}
                  </a>
                </Button>
                <Button
                  asChild
                  variant="ghost"
                  size="sm"
                  className="text-xs"
                >
                  {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
                  <a href="/contact">
                    {t("errors.page.contact", { defaultValue: "Contact support" })}
                  </a>
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

