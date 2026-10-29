"use client";

import { ErrorMonitoringDashboard } from "@/components/admin/error-monitoring-dashboard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  Bug, 
  AlertCircle, 
  Wifi, 
  Database, 
  Shield,
  FileWarning,
} from "lucide-react";
import { errorLogger, ErrorCategory, ErrorSeverity } from "@/lib/error-logger";
import { toast } from "sonner";

export default function ErrorMonitoringPage() {
  // Test error functions for demonstration
  const triggerNetworkError = () => {
    const error = new Error("Failed to fetch data from server");
    errorLogger.logError({
      error,
      category: ErrorCategory.NETWORK,
      severity: ErrorSeverity.HIGH,
      context: {
        endpoint: "/api/test",
        method: "GET",
      },
    });
    toast.error("Network error logged");
  };

  const triggerAuthError = () => {
    const error = new Error("Unauthorized access attempt");
    errorLogger.logError({
      error,
      category: ErrorCategory.AUTHENTICATION,
      severity: ErrorSeverity.HIGH,
      context: {
        attemptedAction: "access_admin_panel",
      },
    });
    toast.error("Auth error logged");
  };

  const triggerDatabaseError = () => {
    const error = new Error("Database connection timeout");
    errorLogger.logError({
      error,
      category: ErrorCategory.DATABASE,
      severity: ErrorSeverity.CRITICAL,
      context: {
        operation: "query",
        collection: "properties",
      },
    });
    toast.error("Database error logged");
  };

  const triggerValidationError = () => {
    const error = new Error("Invalid email format");
    errorLogger.logError({
      error,
      category: ErrorCategory.VALIDATION,
      severity: ErrorSeverity.MEDIUM,
      context: {
        field: "email",
        value: "invalid-email",
      },
    });
    toast.error("Validation error logged");
  };

  const triggerCriticalError = () => {
    const error = new Error("Critical system failure");
    errorLogger.logError({
      error,
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.CRITICAL,
      context: {
        system: "core",
      },
    });
    toast.error("Critical error logged");
  };

  const triggerComponentError = () => {
    // This will be caught by the error boundary
    throw new Error("Component rendering error");
  };

  return (
    <div className="space-y-8 p-6">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Error Monitoring</h1>
        <p className="text-sm text-muted-foreground">
          Monitor and track application errors in real-time
        </p>
      </div>

      {/* Test Error Triggers (Development Only) */}
      {process.env.NODE_ENV === "development" && (
        <Card className="border-orange-200 bg-orange-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-orange-800">
              <Bug className="size-5" />
              Error Testing Tools
              <Badge variant="outline" className="ms-2">Development Only</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-orange-700 mb-4">
              Use these buttons to test different error scenarios and see how they appear in the monitoring dashboard.
            </p>
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <Button
                onClick={triggerNetworkError}
                variant="outline"
                className="gap-2 border-blue-300 hover:bg-blue-50"
              >
                <Wifi className="size-4" />
                Network Error
              </Button>
              <Button
                onClick={triggerAuthError}
                variant="outline"
                className="gap-2 border-purple-300 hover:bg-purple-50"
              >
                <Shield className="size-4" />
                Auth Error
              </Button>
              <Button
                onClick={triggerDatabaseError}
                variant="outline"
                className="gap-2 border-red-300 hover:bg-red-50"
              >
                <Database className="size-4" />
                Database Error
              </Button>
              <Button
                onClick={triggerValidationError}
                variant="outline"
                className="gap-2 border-yellow-300 hover:bg-yellow-50"
              >
                <FileWarning className="size-4" />
                Validation Error
              </Button>
              <Button
                onClick={triggerCriticalError}
                variant="outline"
                className="gap-2 border-red-500 hover:bg-red-50"
              >
                <AlertCircle className="size-4" />
                Critical Error
              </Button>
              <Button
                onClick={triggerComponentError}
                variant="outline"
                className="gap-2 border-orange-300 hover:bg-orange-50"
              >
                <Bug className="size-4" />
                Component Error
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Error Monitoring Dashboard */}
      <ErrorMonitoringDashboard />

      {/* Error Handling Guide */}
      <Card>
        <CardHeader>
          <CardTitle>Error Handling Guide</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <h3 className="font-semibold mb-2">Error Severity Levels</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge variant="destructive">Critical</Badge>
                <span className="text-muted-foreground">
                  Requires immediate attention - system is down or severely impacted
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="destructive">High</Badge>
                <span className="text-muted-foreground">
                  Should be addressed soon - major functionality affected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="default">Medium</Badge>
                <span className="text-muted-foreground">
                  Should be monitored - minor functionality affected
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary">Low</Badge>
                <span className="text-muted-foreground">
                  Informational - no immediate action required
                </span>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-semibold mb-2">Error Categories</h3>
            <div className="grid gap-2 md:grid-cols-2 text-sm">
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-muted-foreground" />
                <span><strong>Authentication:</strong> Login, session errors</span>
              </div>
              <div className="flex items-center gap-2">
                <Shield className="size-4 text-muted-foreground" />
                <span><strong>Authorization:</strong> Permission errors</span>
              </div>
              <div className="flex items-center gap-2">
                <Wifi className="size-4 text-muted-foreground" />
                <span><strong>Network:</strong> Connection, timeout errors</span>
              </div>
              <div className="flex items-center gap-2">
                <Database className="size-4 text-muted-foreground" />
                <span><strong>Database:</strong> Query, connection errors</span>
              </div>
              <div className="flex items-center gap-2">
                <FileWarning className="size-4 text-muted-foreground" />
                <span><strong>Validation:</strong> Form, data validation</span>
              </div>
              <div className="flex items-center gap-2">
                <Bug className="size-4 text-muted-foreground" />
                <span><strong>UI:</strong> Component rendering errors</span>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t">
            <p className="text-sm text-muted-foreground">
              For more information, see the{" "}
              <a href="/docs/error-handling" className="text-primary hover:underline">
                Error Handling Documentation
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

