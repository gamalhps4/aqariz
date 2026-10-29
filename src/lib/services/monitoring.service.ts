/**
 * PropertyPro - Monitoring Service
 * Comprehensive system monitoring, health checks, and alerting
 */

import { isBillingConfigured } from "@/lib/billing/stripe";

export interface HealthCheckResult {
  service: string;
  status: "healthy" | "degraded" | "unhealthy";
  responseTime: number;
  details?: any;
  error?: string;
  timestamp: Date;
}

export interface SystemMetrics {
  uptime: number;
  memoryUsage: {
    used: number;
    total: number;
    percentage: number;
  };
  cpuUsage: number;
  activeConnections: number;
  requestsPerMinute: number;
  errorRate: number;
  averageResponseTime: number;
}

export interface AlertConfig {
  type: "email" | "sms" | "webhook";
  threshold: number;
  metric: string;
  recipients: string[];
  cooldownMinutes: number;
}

class MonitoringService {
  // A check may return null to signal the service is optional and not
  // configured, so it is excluded from health scoring and alerts entirely.
  private healthChecks: Map<string, () => Promise<HealthCheckResult | null>> =
    new Map();
  private metrics: SystemMetrics;
  private alerts: AlertConfig[] = [];
  private lastAlerts: Map<string, Date> = new Map();
  private requestCount: number = 0;
  private errorCount: number = 0;
  private responseTimes: number[] = [];

  constructor() {
    this.metrics = {
      uptime: 0,
      memoryUsage: { used: 0, total: 0, percentage: 0 },
      cpuUsage: 0,
      activeConnections: 0,
      requestsPerMinute: 0,
      errorRate: 0,
      averageResponseTime: 0,
    };

    this.initializeHealthChecks();
    this.startMetricsCollection();
  }

  /**
   * Initialize all health checks
   */
  private initializeHealthChecks() {
    // Database health check
    this.healthChecks.set("database", async () => {
      const startTime = Date.now();
      try {
        const { db } = await import("@/lib/db/prisma");
        await db.$queryRaw`SELECT 1`;

        return {
          service: "database",
          status: "healthy",
          responseTime: Date.now() - startTime,
          details: { connection: "active" },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: "database",
          status: "unhealthy",
          responseTime: Date.now() - startTime,
          error:
            error instanceof Error
              ? error.message
              : "Database connection failed",
          timestamp: new Date(),
        };
      }
    });

    // Email service health check
    this.healthChecks.set("email", async () => {
      const startTime = Date.now();
      try {
        const { emailService } = await import("./email.service");
        const providerInfo = await emailService.getProviderInfo();

        // Email is optional: when no provider is configured we don't monitor
        // it, so it never shows up as a "degraded" problem or raises an alert.
        if (!providerInfo.configured) {
          return null;
        }

        const isConnected = await emailService.verifyConnection();

        return {
          service: "email",
          status: isConnected ? "healthy" : "degraded",
          responseTime: Date.now() - startTime,
          details: providerInfo,
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: "email",
          status: "unhealthy",
          responseTime: Date.now() - startTime,
          error:
            error instanceof Error
              ? error.message
              : "Email service check failed",
          timestamp: new Date(),
        };
      }
    });

    // SMS / WhatsApp health check (optional integration)
    this.healthChecks.set("sms", async () => {
      const startTime = Date.now();

      // The platform's own gateway per channel: the Super Admin's default
      // (Admin → Settings → Messaging), else the environment's. Offices with
      // their own provider account are their own concern, not a platform
      // signal. When neither channel has one the check is skipped instead of
      // reporting a permanent "degraded" that would raise a false alert.
      const { resolvePlatformGateway } = await import("@/lib/messaging/store");
      const [sms, whatsapp] = await Promise.all([
        resolvePlatformGateway("sms"),
        resolvePlatformGateway("whatsapp"),
      ]);
      if (!sms && !whatsapp) {
        return null;
      }

      const describe = (gateway: typeof sms) =>
        gateway ? { provider: gateway.provider, source: gateway.source } : null;
      return {
        service: "sms",
        status: "healthy",
        responseTime: Date.now() - startTime,
        details: { sms: describe(sms), whatsapp: describe(whatsapp) },
        timestamp: new Date(),
      };
    });

    // Stripe service health check (optional integration)
    this.healthChecks.set("stripe", async () => {
      const startTime = Date.now();
      try {
        // Reports the PLATFORM's Stripe (subscription billing). Each
        // organization's own collection credentials are per-tenant and are not
        // a platform health signal. Optional: skip rather than flag degraded.
        const hasStripeKey = isBillingConfigured();
        if (!hasStripeKey) {
          return null;
        }

        return {
          service: "stripe",
          status: "healthy",
          responseTime: Date.now() - startTime,
          details: { configured: true },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: "stripe",
          status: "unhealthy",
          responseTime: Date.now() - startTime,
          error:
            error instanceof Error
              ? error.message
              : "Stripe service check failed",
          timestamp: new Date(),
        };
      }
    });

    // Payment system health check
    this.healthChecks.set("payment-system", async () => {
      const startTime = Date.now();
      try {
        // Lightweight, accurate check: confirm the payment subsystem is
        // queryable and look for a spike of recently failed payments. (The
        // previous implementation referenced a non-existent orchestrator export
        // and method, so it always threw and reported a false "unhealthy".)
        const { db } = await import("@/lib/db/prisma");
        const { PaymentStatus } = await import("@/types");

        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const failedLast24h = await db.payment.count({
          where: {
            deletedAt: null,
            status: PaymentStatus.FAILED,
            updatedAt: { gte: since },
          },
        });

        return {
          service: "payment-system",
          status: failedLast24h > 10 ? "degraded" : "healthy",
          responseTime: Date.now() - startTime,
          details: { failedLast24h },
          timestamp: new Date(),
        };
      } catch (error) {
        return {
          service: "payment-system",
          status: "unhealthy",
          responseTime: Date.now() - startTime,
          error:
            error instanceof Error
              ? error.message
              : "Payment system check failed",
          timestamp: new Date(),
        };
      }
    });
  }

  /**
   * Start collecting system metrics
   */
  private startMetricsCollection() {
    // Collect metrics every minute
    setInterval(() => {
      this.collectSystemMetrics();
    }, 60000);

    // Reset counters every minute
    setInterval(() => {
      this.metrics.requestsPerMinute = this.requestCount;
      this.metrics.errorRate =
        this.requestCount > 0 ? this.errorCount / this.requestCount : 0;
      this.metrics.averageResponseTime =
        this.responseTimes.length > 0
          ? this.responseTimes.reduce((a, b) => a + b, 0) /
            this.responseTimes.length
          : 0;

      // Reset counters
      this.requestCount = 0;
      this.errorCount = 0;
      this.responseTimes = [];
    }, 60000);
  }

  /**
   * Collect system metrics
   */
  private collectSystemMetrics() {
    // Memory usage
    if (typeof process !== "undefined") {
      const memUsage = process.memoryUsage();
      this.metrics.memoryUsage = {
        used: memUsage.heapUsed,
        total: memUsage.heapTotal,
        percentage: (memUsage.heapUsed / memUsage.heapTotal) * 100,
      };

      // Uptime
      this.metrics.uptime = process.uptime();
    }

    // Check alert thresholds
    this.checkAlertThresholds();
  }

  /**
   * Record a request for metrics
   */
  recordRequest(responseTime: number, isError: boolean = false) {
    this.requestCount++;
    this.responseTimes.push(responseTime);

    if (isError) {
      this.errorCount++;
    }
  }

  /**
   * Run all health checks
   */
  async runHealthChecks(): Promise<HealthCheckResult[]> {
    const results: HealthCheckResult[] = [];

    for (const [name, checkFn] of this.healthChecks) {
      try {
        const result = await checkFn();
        // Skip optional services that report themselves as not configured.
        if (result) {
          results.push(result);
        }
      } catch (error) {
        results.push({
          service: name,
          status: "unhealthy",
          responseTime: 0,
          error: error instanceof Error ? error.message : "Health check failed",
          timestamp: new Date(),
        });
      }
    }

    return results;
  }

  /**
   * Get current system metrics
   */
  getSystemMetrics(): SystemMetrics {
    return { ...this.metrics };
  }

  /**
   * Configure alerts
   */
  configureAlerts(alerts: AlertConfig[]) {
    this.alerts = alerts;
  }

  /**
   * Check alert thresholds and send alerts if needed
   */
  private async checkAlertThresholds() {
    for (const alert of this.alerts) {
      const alertKey = `${alert.metric}-${alert.threshold}`;
      const lastAlert = this.lastAlerts.get(alertKey);

      // Check cooldown period
      if (
        lastAlert &&
        Date.now() - lastAlert.getTime() < alert.cooldownMinutes * 60000
      ) {
        continue;
      }

      let shouldAlert = false;
      let currentValue = 0;

      switch (alert.metric) {
        case "memory_usage":
          currentValue = this.metrics.memoryUsage.percentage;
          shouldAlert = currentValue > alert.threshold;
          break;
        case "error_rate":
          currentValue = this.metrics.errorRate * 100;
          shouldAlert = currentValue > alert.threshold;
          break;
        case "response_time":
          currentValue = this.metrics.averageResponseTime;
          shouldAlert = currentValue > alert.threshold;
          break;
        case "requests_per_minute":
          currentValue = this.metrics.requestsPerMinute;
          shouldAlert = currentValue > alert.threshold;
          break;
      }

      if (shouldAlert) {
        await this.sendAlert(alert, currentValue);
        this.lastAlerts.set(alertKey, new Date());
      }
    }
  }

  /**
   * Send alert notification
   */
  private async sendAlert(alert: AlertConfig, currentValue: number) {
    const alertMessage = `🚨 PropertyPro Alert: ${
      alert.metric
    } is ${currentValue.toFixed(2)} (threshold: ${alert.threshold})`;

    try {
      switch (alert.type) {
        case "email":
          await this.sendEmailAlert(alert.recipients, alertMessage);
          break;
        case "sms":
          await this.sendSMSAlert(alert.recipients, alertMessage);
          break;
        case "webhook":
          await this.sendWebhookAlert(
            alert.recipients[0],
            alertMessage,
            currentValue
          );
          break;
      }


    } catch (error) {
      console.error("Failed to send alert:", error);
    }
  }

  /**
   * Send email alert
   */
  private async sendEmailAlert(recipients: string[], message: string) {
    const { emailService } = await import("./email.service");

    for (const recipient of recipients) {
      await emailService.sendEmail({
        to: recipient,
        subject: "PropertyPro System Alert",
        html: `
          <h2>🚨 System Alert</h2>
          <p>${message}</p>
          <p><strong>Timestamp:</strong> ${new Date().toISOString()}</p>
          <p>Please check the system immediately.</p>
        `,
        text: `${message}\n\nTimestamp: ${new Date().toISOString()}\n\nPlease check the system immediately.`,
      });
    }
  }

  /**
   * Send SMS alert (disabled - SMS service not configured)
   */
  private async sendSMSAlert(recipients: string[], message: string) {
    console.warn("SMS service not configured, skipping SMS alert");
    return;
  }

  /**
   * Send webhook alert
   */
  private async sendWebhookAlert(
    webhookUrl: string,
    message: string,
    value: number
  ) {
    const payload = {
      alert: message,
      value,
      timestamp: new Date().toISOString(),
      service: "PropertyPro",
    };

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Webhook failed: ${response.status}`);
      }
    } catch (error) {
      console.error("Webhook alert failed:", error);
    }
  }

  /**
   * Get system status summary
   */
  async getSystemStatus(): Promise<{
    overall: "healthy" | "degraded" | "unhealthy";
    services: HealthCheckResult[];
    metrics: SystemMetrics;
    uptime: string;
  }> {
    const healthResults = await this.runHealthChecks();

    // Determine overall status
    let overall: "healthy" | "degraded" | "unhealthy" = "healthy";

    const unhealthyServices = healthResults.filter(
      (r) => r.status === "unhealthy"
    );
    const degradedServices = healthResults.filter(
      (r) => r.status === "degraded"
    );

    if (unhealthyServices.length > 0) {
      overall = "unhealthy";
    } else if (degradedServices.length > 0) {
      overall = "degraded";
    }

    // Format uptime
    const uptimeSeconds = this.metrics.uptime;
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const uptime = `${hours}h ${minutes}m`;

    return {
      overall,
      services: healthResults,
      metrics: this.getSystemMetrics(),
      uptime,
    };
  }

  /**
   * Generate monitoring report
   */
  async generateMonitoringReport(): Promise<{
    timestamp: Date;
    status: any;
    recommendations: string[];
  }> {
    const status = await this.getSystemStatus();
    const recommendations: string[] = [];

    // Generate recommendations based on metrics
    if (status.metrics.memoryUsage.percentage > 80) {
      recommendations.push(
        "High memory usage detected - consider scaling or optimization"
      );
    }

    if (status.metrics.errorRate > 0.05) {
      recommendations.push(
        "High error rate detected - investigate application issues"
      );
    }

    if (status.metrics.averageResponseTime > 2000) {
      recommendations.push(
        "Slow response times detected - optimize performance"
      );
    }

    const unhealthyServices = status.services.filter(
      (s) => s.status === "unhealthy"
    );
    if (unhealthyServices.length > 0) {
      recommendations.push(
        `Unhealthy services detected: ${unhealthyServices
          .map((s) => s.service)
          .join(", ")}`
      );
    }

    return {
      timestamp: new Date(),
      status,
      recommendations,
    };
  }
}

export const monitoringService = new MonitoringService();
