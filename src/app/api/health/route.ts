/**
 * PropertyPro - Health Check API
 * System health monitoring endpoint for production monitoring
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { monitoringService } from "@/lib/services/monitoring.service";
import {
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
} from "@/lib/api-utils";

// Helper functions
function createSuccessResponse(
  data: any,
  message: string,
  status: number = 200
) {
  return createApiSuccessResponse(data, message);
}

function createErrorResponse(message: string, status: number = 500) {
  return createApiErrorResponse(message, status, message);
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const detailed = searchParams.get("detailed") === "true";
    const service = searchParams.get("service");

    if (service) {
      // Check specific service health
      const healthResults = await monitoringService.runHealthChecks();
      const serviceResult = healthResults.find((r) => r.service === service);

      if (!serviceResult) {
        return createErrorResponse(`Service '${service}' not found`, 404);
      }

      const responseTime = Date.now() - startTime;
      monitoringService.recordRequest(
        responseTime,
        serviceResult.status === "unhealthy"
      );

      return createSuccessResponse(
        serviceResult,
        `Health check for ${service} completed`
      );
    }

    // Get overall system status
    const systemStatus = await monitoringService.getSystemStatus();

    // Record request metrics
    const responseTime = Date.now() - startTime;
    const isError = systemStatus.overall === "unhealthy";
    monitoringService.recordRequest(responseTime, isError);

    if (detailed) {
      // Return detailed health information
      return createSuccessResponse(
        {
          status: systemStatus.overall,
          timestamp: new Date().toISOString(),
          uptime: systemStatus.uptime,
          services: systemStatus.services,
          metrics: systemStatus.metrics,
          responseTime,
        },
        "Detailed health check completed"
      );
    } else {
      // Return basic health status
      const basicStatus = {
        status: systemStatus.overall,
        timestamp: new Date().toISOString(),
        uptime: systemStatus.uptime,
        services: systemStatus.services.map((s) => ({
          service: s.service,
          status: s.status,
          responseTime: s.responseTime,
        })),
        responseTime,
      };

      return createSuccessResponse(basicStatus, "Health check completed");
    }
  } catch (error) {
    console.error("Error in health check API:", error);

    const responseTime = Date.now() - startTime;
    monitoringService.recordRequest(responseTime, true);

    return createErrorResponse(
      error instanceof Error ? error.message : "Health check failed",
      500
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // Parse request body for alert configuration
    const body = await request.json();
    const { action, alerts } = body;

    if (action === "configure-alerts" && alerts) {
      // Configure monitoring alerts
      monitoringService.configureAlerts(alerts);

      return createSuccessResponse(
        { alertsConfigured: alerts.length },
        "Monitoring alerts configured successfully"
      );
    }

    if (action === "generate-report") {
      // Generate comprehensive monitoring report
      const report = await monitoringService.generateMonitoringReport();

      return createSuccessResponse(
        report,
        "Monitoring report generated successfully"
      );
    }

    return createErrorResponse("Invalid action specified", 400);
  } catch (error) {
    console.error("Error in health check configuration API:", error);
    return createErrorResponse(
      error instanceof Error
        ? error.message
        : "Health check configuration failed",
      500
    );
  }
}
