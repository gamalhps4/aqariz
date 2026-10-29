/**
 * PropertyPro - Audit Middleware
 * Automatic audit logging for API requests and responses
 */

import { NextRequest, NextResponse } from "next/server";
import { auditService } from "@/lib/audit-service";
import { AuditCategory, AuditAction, AuditSeverity } from "@/lib/audit-service";

// Paths that should be audited
const AUDIT_PATHS = [
  "/api/properties",
  "/api/tenants",
  "/api/leases",
  "/api/payments",
  "/api/maintenance",
  "/api/documents",
  "/api/users",
  "/api/auth",
  "/api/settings",
  "/api/import",
  "/api/export",
];

// Paths that should not be audited (to avoid noise)
const EXCLUDE_PATHS = [
  "/api/health",
  "/api/ping",
  "/api/audit", // Avoid recursive logging
  "/api/_next",
  "/api/static",
];

// Sensitive fields that should be redacted in logs
const SENSITIVE_FIELDS = [
  "password",
  "token",
  "secret",
  "key",
  "ssn",
  "creditCard",
  "bankAccount",
  "apiKey",
  "authorization",
];

interface AuditableRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  body?: any;
  headers: Record<string, string>;
  user?: any;
  timestamp: Date;
}

interface AuditableResponse {
  status: number;
  statusText: string;
  body?: any;
  headers: Record<string, string>;
  timestamp: Date;
  duration: number;
}

export class AuditMiddleware {
  // Check if path should be audited
  shouldAuditPath(path: string): boolean {
    // Exclude specific paths
    if (EXCLUDE_PATHS.some((excludePath) => path.startsWith(excludePath))) {
      return false;
    }

    // Include specific paths
    return AUDIT_PATHS.some((auditPath) => path.startsWith(auditPath));
  }

  // Extract request information for auditing
  extractRequestInfo(request: NextRequest, user?: any): AuditableRequest {
    const url = new URL(request.url);
    const query: Record<string, string> = {};

    // Extract query parameters
    url.searchParams.forEach((value, key) => {
      query[key] = value;
    });

    // Extract headers (excluding sensitive ones)
    const headers: Record<string, string> = {};
    request.headers.forEach((value, key) => {
      if (
        !SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field))
      ) {
        headers[key] = value;
      }
    });

    return {
      method: request.method,
      path: url.pathname,
      query,
      headers,
      user,
      timestamp: new Date(),
    };
  }

  // Extract response information for auditing
  extractResponseInfo(
    response: NextResponse,
    startTime: Date
  ): AuditableResponse {
    const endTime = new Date();
    const duration = endTime.getTime() - startTime.getTime();

    // Extract response headers
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    return {
      status: response.status,
      statusText: response.statusText,
      headers,
      timestamp: endTime,
      duration,
    };
  }

  // Redact sensitive information from data
  redactSensitiveData(data: any): any {
    if (!data || typeof data !== "object") {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map((item) => this.redactSensitiveData(item));
    }

    const redacted = { ...data };

    Object.keys(redacted).forEach((key) => {
      if (SENSITIVE_FIELDS.some((field) => key.toLowerCase().includes(field))) {
        redacted[key] = "[REDACTED]";
      } else if (typeof redacted[key] === "object") {
        redacted[key] = this.redactSensitiveData(redacted[key]);
      }
    });

    return redacted;
  }

  // Determine audit category based on path
  getCategoryFromPath(path: string): AuditCategory {
    if (path.includes("/auth")) return AuditCategory.AUTHENTICATION;
    if (path.includes("/users")) return AuditCategory.USER_MANAGEMENT;
    if (path.includes("/properties")) return AuditCategory.PROPERTY_MANAGEMENT;
    if (path.includes("/tenants")) return AuditCategory.TENANT_MANAGEMENT;
    if (path.includes("/leases")) return AuditCategory.LEASE_MANAGEMENT;
    if (path.includes("/payments")) return AuditCategory.PAYMENT_MANAGEMENT;
    if (path.includes("/maintenance"))
      return AuditCategory.MAINTENANCE_MANAGEMENT;
    if (path.includes("/documents")) return AuditCategory.DOCUMENT_MANAGEMENT;
    if (path.includes("/import") || path.includes("/export"))
      return AuditCategory.DATA_EXPORT;
    if (path.includes("/settings")) return AuditCategory.SYSTEM_CONFIGURATION;

    return AuditCategory.SYSTEM_CONFIGURATION;
  }

  // Determine audit action based on method and path
  getActionFromRequest(method: string, path: string): AuditAction {
    switch (method.toUpperCase()) {
      case "GET":
        if (path.includes("/export")) return AuditAction.BULK_EXPORT;
        return AuditAction.READ;
      case "POST":
        if (path.includes("/import")) return AuditAction.BULK_IMPORT;
        if (path.includes("/auth/login")) return AuditAction.LOGIN;
        if (path.includes("/auth/logout")) return AuditAction.LOGOUT;
        return AuditAction.CREATE;
      case "PUT":
      case "PATCH":
        return AuditAction.UPDATE;
      case "DELETE":
        return AuditAction.DELETE;
      default:
        return AuditAction.READ;
    }
  }

  // Determine severity based on action and response
  getSeverity(
    action: AuditAction,
    status: number,
    path: string
  ): AuditSeverity {
    // Critical actions
    if (
      action === AuditAction.DELETE ||
      action === AuditAction.BULK_DELETE ||
      path.includes("/settings")
    ) {
      return AuditSeverity.HIGH;
    }

    // Bulk operations
    if (
      action === AuditAction.BULK_IMPORT ||
      action === AuditAction.BULK_EXPORT
    ) {
      return AuditSeverity.MEDIUM;
    }

    // Failed requests
    if (status >= 400) {
      if (status >= 500) return AuditSeverity.HIGH;
      if (status === 401 || status === 403) return AuditSeverity.MEDIUM;
      return AuditSeverity.LOW;
    }

    // Authentication events
    if (action === AuditAction.LOGIN || action === AuditAction.LOGOUT) {
      return AuditSeverity.LOW;
    }

    return AuditSeverity.LOW;
  }

  // Generate description for audit log
  generateDescription(
    request: AuditableRequest,
    response: AuditableResponse
  ): string {
    const { method, path, user } = request;
    const { status } = response;

    const userInfo = user ? `${user.firstName} ${user.lastName}` : "Anonymous";
    const statusText = status >= 400 ? "failed" : "succeeded";

    // Special cases
    if (path.includes("/auth/login")) {
      return status === 200
        ? `User ${userInfo} logged in successfully`
        : `Login failed for ${user?.email || "unknown user"}`;
    }

    if (path.includes("/auth/logout")) {
      return `User ${userInfo} logged out`;
    }

    if (path.includes("/import")) {
      return `${userInfo} ${statusText} to import data via ${method} ${path}`;
    }

    if (path.includes("/export")) {
      return `${userInfo} ${statusText} to export data via ${method} ${path}`;
    }

    // Generic description
    return `${userInfo} ${statusText} ${method} request to ${path}`;
  }

  // Main audit logging function
  async logRequest(
    request: AuditableRequest,
    response: AuditableResponse,
    requestBody?: any
  ): Promise<void> {
    try {
      const category = this.getCategoryFromPath(request.path);
      const action = this.getActionFromRequest(request.method, request.path);
      const severity = this.getSeverity(action, response.status, request.path);
      const description = this.generateDescription(request, response);

      // Prepare audit context
      const context = auditService.extractContextFromRequest(
        {
          headers: new Headers(request.headers),
          nextUrl: { pathname: request.path },
          method: request.method,
        } as any,
        request.user
      );

      // Prepare audit details
      const details: Record<string, any> = {
        method: request.method,
        path: request.path,
        query: request.query,
        status: response.status,
        duration: response.duration,
      };

      // Add request body if present (redacted)
      if (requestBody) {
        details.requestBody = this.redactSensitiveData(requestBody);
      }

      // Add response body for errors
      if (response.status >= 400 && response.body) {
        details.responseBody = this.redactSensitiveData(response.body);
      }

      // Log the audit event
      await auditService.logEvent(
        {
          category,
          action,
          severity,
          description,
          details,
          tags: [
            "api_request",
            request.method.toLowerCase(),
            response.status >= 400 ? "error" : "success",
          ],
        },
        context
      );
    } catch (error) {
      console.error("Failed to log audit event:", error);
      // Don't throw error to avoid breaking the main request flow
    }
  }

  // Middleware wrapper for Next.js API routes
  withAuditLogging(handler: Function) {
    return async (request: NextRequest, ...args: any[]) => {
      const startTime = new Date();

      // Check if this path should be audited
      if (!this.shouldAuditPath(request.nextUrl.pathname)) {
        return handler(request, ...args);
      }

      let requestBody: any;
      let response: NextResponse;
      let user: any;

      try {
        // Extract request body if present
        if (
          request.method !== "GET" &&
          request.headers.get("content-type")?.includes("application/json")
        ) {
          try {
            requestBody = await request.json();
            // Create new request with the body for the handler
            request = new NextRequest(request.url, {
              method: request.method,
              headers: request.headers,
              body: JSON.stringify(requestBody),
            });
          } catch (error) {
            // Body might not be JSON or already consumed
          }
        }

        // Extract user from request (this would depend on your auth implementation)
        // user = await extractUserFromRequest(request);

        // Execute the original handler
        response = await handler(request, ...args);

        // Extract request and response info
        const requestInfo = this.extractRequestInfo(request, user);
        const responseInfo = this.extractResponseInfo(response, startTime);

        // Log the audit event asynchronously
        setImmediate(() => {
          this.logRequest(requestInfo, responseInfo, requestBody);
        });

        return response;
      } catch (error) {
        // Log error response
        const errorResponse = NextResponse.json(
          { error: "Internal Server Error" },
          { status: 500 }
        );

        const requestInfo = this.extractRequestInfo(request, user);
        const responseInfo = this.extractResponseInfo(errorResponse, startTime);

        // Log the audit event asynchronously
        setImmediate(() => {
          this.logRequest(requestInfo, responseInfo, requestBody);
        });

        throw error;
      }
    };
  }
}

// Create singleton instance
export const auditMiddleware = new AuditMiddleware();
