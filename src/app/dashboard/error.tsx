"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertCircle,
  RefreshCw,
  ArrowLeft,
  LayoutDashboard,
  Shield,
  Database,
  Wifi,
  Settings,
  MessageSquare,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import Link from "next/link";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Translate = ReturnType<typeof useLocalizationContext>["t"];

interface DashboardErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

function getErrorContext(error: Error, t: Translate) {
  const message = error.message.toLowerCase();

  if (message.includes("unauthorized") || message.includes("session")) {
    return {
      type: "auth",
      icon: Shield,
      title: t("errors.dashboard.auth.title", { defaultValue: "Session expired" }),
      description: t("errors.dashboard.auth.description", { defaultValue: "Your session has ended, or you are not allowed to open this page." }),
      action: t("errors.dashboard.auth.action", { defaultValue: "Sign in again to continue." }),
      color: "orange",
    };
  }

  if (message.includes("network") || message.includes("fetch")) {
    return {
      type: "network",
      icon: Wifi,
      title: t("errors.dashboard.network.title", { defaultValue: "Connection problem" }),
      description: t("errors.dashboard.network.description", { defaultValue: "The page could not load its data because of a network error." }),
      action: t("errors.dashboard.network.action", { defaultValue: "Check your connection and try again." }),
      color: "blue",
    };
  }

  if (message.includes("database") || message.includes("data")) {
    return {
      type: "database",
      icon: Database,
      title: t("errors.dashboard.database.title", { defaultValue: "Could not load the data" }),
      description: t("errors.dashboard.database.description", { defaultValue: "Something went wrong while loading this page's data." }),
      action: t("errors.dashboard.database.action", { defaultValue: "This is usually temporary. Please try again." }),
      color: "purple",
    };
  }

  return {
    type: "unknown",
    icon: AlertCircle,
    title: t("errors.dashboard.unknown.title", { defaultValue: "Something went wrong" }),
    description: t("errors.dashboard.unknown.description", { defaultValue: "An unexpected error stopped this page from loading." }),
    action: t("errors.dashboard.unknown.action", { defaultValue: "Try again, or contact support if it keeps happening." }),
    color: "red",
  };
}

export default function DashboardError({ error, reset }: DashboardErrorProps) {
  const router = useRouter();
  const { t } = useLocalizationContext();
  const errorContext = getErrorContext(error, t);
  const ErrorIcon = errorContext.icon;

  useEffect(() => {
    const dashboardErrorDetails = {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      type: errorContext.type,
      timestamp: new Date().toISOString(),
    };

    // Avoid showing an extra Next.js dev overlay panel for our own logger
    if (process.env.NODE_ENV === "development") {
      console.warn("Dashboard Error:", dashboardErrorDetails);
    } else {
      console.error("Dashboard Error:", dashboardErrorDetails);
    }

    // Track error in analytics
    if (typeof window !== "undefined" && (window as any).gtag) {
      (window as any).gtag("event", "exception", {
        description: `Dashboard Error: ${error.message}`,
        fatal: false,
      });
    }
  }, [error.message, error.stack, error.digest, errorContext.type]);

  return (
    <div className="flex items-center justify-center bg-linear-to-br from-background via-background to-muted/20">
      <Card className="max-w-2xl w-full border-border/60 shadow-xl">
        <CardHeader className="text-center">
          <div className="mx-auto relative">
            <div
              className={`absolute inset-0 bg-${errorContext.color}-500/20 blur-2xl rounded-full`}
            />
            <div
              className={`relative bg-${errorContext.color}-500/10 rounded-full inline-block`}
            >
              <ErrorIcon className={`size-12 text-${errorContext.color}-600`} />
            </div>
          </div>
          <CardTitle className="text-2xl md:text-3xl font-bold">
            {errorContext.title}
          </CardTitle>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Error Description */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>
              {t("errors.dashboard.whatHappened", { defaultValue: "What happened?" })}
            </AlertTitle>
            <AlertDescription className="mt-2">
              {errorContext.description}
            </AlertDescription>
          </Alert>

          {/* Action Suggestion */}
          <div className="bg-muted/50 border border-border rounded-lg p-4">
            <p className="text-sm font-medium mb-2 flex items-center gap-2">
              <Settings className="size-4" />
              {t("errors.dashboard.suggested", { defaultValue: "What to do" })}
            </p>
            <p className="text-sm text-muted-foreground">
              {errorContext.action}
            </p>
          </div>

          {/* Development Details */}
          {process.env.NODE_ENV === "development" && (
            <details className="group">
              <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground transition-colors list-none">
                <div className="flex items-center gap-2">
                  <div className="transition-transform group-open:rotate-90">
                    ▶
                  </div>
                  Technical Details (Development)
                </div>
              </summary>
              <div className="mt-3 p-4 bg-muted/50 rounded-lg border border-border space-y-3">
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                    Error Type
                  </div>
                  <code className="text-xs bg-background px-2 py-1 rounded border">
                    {errorContext.type}
                  </code>
                </div>
                <div>
                  <div className="text-xs font-semibold text-muted-foreground mb-1">
                    Error Message
                  </div>
                  <code className="text-xs bg-background px-2 py-1 rounded border block">
                    {error.message}
                  </code>
                </div>
                {error.digest && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                      Error Digest
                    </div>
                    <code className="text-xs bg-background px-2 py-1 rounded border block">
                      {error.digest}
                    </code>
                  </div>
                )}
                {error.stack && (
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground mb-1">
                      Stack Trace
                    </div>
                    <pre className="text-xs bg-background p-3 rounded border overflow-auto max-h-48">
                      {error.stack}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          )}

          {/* Production Error Reference */}
          {process.env.NODE_ENV === "production" && error.digest && (
            <div className="text-center text-xs text-muted-foreground">
              <p>
                {t("errors.dashboard.errorId", { defaultValue: "Error ID:" })}{" "}
                <code className="font-mono bg-muted px-2 py-1 rounded">
                  {error.digest}
                </code>
              </p>
              <p className="mt-1">
                {t("errors.dashboard.errorIdHint", { defaultValue: "Mention this ID when you contact support" })}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button onClick={() => reset()} className="flex-1 gap-2" size="lg">
              <RefreshCw className="size-4" />
              {t("maintenance.emergency.retry", { defaultValue: "Try again" })}
            </Button>
            {/* The platform's own contact form, which reaches the Super
                Admin's inbox. */}
            <Button
              asChild
              size="lg"
              variant="outline"
              className="flex-1 gap-2 bg-blue-50 hover:bg-blue-100"
            >
              <Link href="/contact">
                <MessageSquare className="size-4" />
                {t("errors.dashboard.contact", { defaultValue: "Contact support" })}
              </Link>
            </Button>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <Button
              onClick={() => router.back()}
              variant="outline"
              className="flex-1 gap-2"
            >
              <ArrowLeft className="size-4 rtl:-scale-x-100" />
              {t("errors.dashboard.back", { defaultValue: "Go back" })}
            </Button>
            <Button
              onClick={() => router.push("/dashboard")}
              variant="outline"
              className="flex-1 gap-2"
            >
              <LayoutDashboard className="size-4" />
              {t("errors.dashboard.home", { defaultValue: "Dashboard" })}
            </Button>
          </div>

          {/* Quick Links */}
          <div className="pt-4 border-t border-border/50">
            <p className="text-xs text-muted-foreground text-center mb-3">
              {t("errors.dashboard.quickLinks", { defaultValue: "Or go to:" })}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link href="/dashboard/properties">
                  {t("nav.properties", { defaultValue: "Buildings" })}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link href="/dashboard/tenants">
                  {t("nav.tenants", { defaultValue: "Clients (Tenants)" })}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link href="/dashboard/maintenance">
                  {t("nav.section.maintenanceOps", { defaultValue: "Maintenance" })}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="text-xs">
                <Link href="/dashboard/settings">
                  {t("nav.settings", { defaultValue: "Settings" })}
                </Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
