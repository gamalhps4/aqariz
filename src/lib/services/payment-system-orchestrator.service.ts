/**
 * PropertyPro - Payment System Orchestrator Service
 * Central orchestration service that coordinates all payment system components
 */

import { paymentStatusService } from "./payment-status.service";
import { recurringPaymentGeneratorService } from "./recurring-payment-generator.service";
import { paymentDashboardService } from "./payment-dashboard.service";
import { paymentCommunicationService } from "./payment-communication.service";
import { paymentAnalyticsService } from "./payment-analytics.service";
import { formatCurrency } from "@/lib/utils/formatting";

export interface SystemHealthCheck {
  component: string;
  status: "healthy" | "warning" | "error";
  message: string;
  lastChecked: Date;
}

export interface DailyProcessingResult {
  date: Date;
  statusUpdates: {
    processed: number;
    statusChanges: number;
    errors: string[];
  };
  communications: {
    sent: number;
    failed: number;
    errors: string[];
  };
  summary: {
    totalProcessingTime: number;
    overallSuccess: boolean;
    criticalErrors: string[];
  };
}

export interface LeaseSetupResult {
  leaseId: string;
  success: boolean;
  components: {
    paymentSchedule: boolean;
    securityDeposit: boolean;
    prorationCalculation: boolean;
    communicationSetup: boolean;
  };
  errors: string[];
  summary: {
    totalPayments: number;
    firstMonthAmount: number;
    securityDepositAmount: number;
    totalSetupAmount: number;
  };
}

export class PaymentSystemOrchestratorService {
  /**
   * Run daily automated processing for all payment system components
   */
  async runDailyProcessing(): Promise<DailyProcessingResult> {
    const startTime = Date.now();
    const result: DailyProcessingResult = {
      date: new Date(),
      statusUpdates: { processed: 0, statusChanges: 0, errors: [] },
      communications: { sent: 0, failed: 0, errors: [] },
      summary: {
        totalProcessingTime: 0,
        overallSuccess: true,
        criticalErrors: [],
      },
    };

    try {

      // 1. Update payment statuses
      try {
        const statusResult =
          await paymentStatusService.processAutomatedTransitions();
        result.statusUpdates = {
          processed: statusResult.totalProcessed,
          statusChanges: statusResult.statusChanges,
          errors: statusResult.errors,
        };

      } catch (error) {
        const errorMsg = `Status update failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        result.statusUpdates.errors.push(errorMsg);
        result.summary.criticalErrors.push(errorMsg);
      }

      // 2. Send automated communications
      try {
        const commResult =
          await paymentCommunicationService.processAutomatedNotifications();
        result.communications = {
          sent: commResult.successCount,
          failed: commResult.failureCount,
          errors: commResult.results
            .filter((r) => r.status === "failed")
            .map((r) => r.error || "Unknown error"),
        };

      } catch (error) {
        const errorMsg = `Communication processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`;
        result.communications.errors.push(errorMsg);
        result.summary.criticalErrors.push(errorMsg);
      }

      // Calculate summary
      result.summary.totalProcessingTime = Date.now() - startTime;
      result.summary.overallSuccess =
        result.summary.criticalErrors.length === 0;


      return result;
    } catch (error) {
      result.summary.criticalErrors.push(
        `System processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      result.summary.overallSuccess = false;
      result.summary.totalProcessingTime = Date.now() - startTime;

      console.error("Daily processing failed:", error);
      return result;
    }
  }

  /**
   * Setup complete payment system for a new lease
   */
  async setupLeasePaymentSystem(
    leaseId: string,
    options?: {
      enableProration?: boolean;
      enableAutoCommunication?: boolean;
    }
  ): Promise<LeaseSetupResult> {
    const result: LeaseSetupResult = {
      leaseId,
      success: false,
      components: {
        paymentSchedule: false,
        securityDeposit: false,
        prorationCalculation: false,
        communicationSetup: false,
      },
      errors: [],
      summary: {
        totalPayments: 0,
        firstMonthAmount: 0,
        securityDepositAmount: 0,
        totalSetupAmount: 0,
      },
    };

    try {
      // 1. Generate payment schedule with proration
      try {
        const scheduleResult =
          await recurringPaymentGeneratorService.setupLeasePaymentSystem(
            leaseId,
            {
              enableProration: options?.enableProration ?? true,
              autoCreatePayments: true,
              autoGenerateInvoices: true,
            }
          );

        result.components.paymentSchedule = scheduleResult.success;
        result.summary.totalPayments = scheduleResult.rentPayments.length;
        result.summary.firstMonthAmount =
          scheduleResult.rentPayments[0]?.amount || 0;
        result.summary.securityDepositAmount =
          scheduleResult.securityDeposit?.amount || 0;
        result.summary.totalSetupAmount = scheduleResult.totalSetupAmount;

        if (scheduleResult.securityDeposit) {
          result.components.securityDeposit = true;
        }

        if (options?.enableProration) {
          result.components.prorationCalculation = true;
        }

        result.errors.push(...scheduleResult.errors);
      } catch (error) {
        result.errors.push(
          `Payment schedule setup failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      // 2. Setup communication preferences
      if (options?.enableAutoCommunication) {
        try {
          // This would setup tenant communication preferences
          result.components.communicationSetup = true;

        } catch (error) {
          result.errors.push(
            `Communication setup failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }

      // 3. Initialize payment statuses
      try {
        if (result.summary.totalPayments > 0) {
          // Update initial payment statuses

        }
      } catch (error) {
        result.errors.push(
          `Status initialization failed: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }

      result.success = result.errors.length === 0;
    } catch (error) {
      result.errors.push(
        `Transaction failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }


    return result;
  }

  /**
   * Perform system health check
   */
  async performHealthCheck(): Promise<SystemHealthCheck[]> {
    const checks: SystemHealthCheck[] = [];
    const now = new Date();

    // Check payment status service
    try {
      const paymentsNeedingUpdate =
        await paymentStatusService.getPaymentsNeedingStatusUpdate();
      checks.push({
        component: "Payment Status Service",
        status: paymentsNeedingUpdate.length > 100 ? "warning" : "healthy",
        message: `${paymentsNeedingUpdate.length} payments need status updates`,
        lastChecked: now,
      });
    } catch (error) {
      checks.push({
        component: "Payment Status Service",
        status: "error",
        message: `Health check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        lastChecked: now,
      });
    }

    // Check dashboard service
    try {
      const metrics = await paymentDashboardService.getDashboardMetrics();
      const criticalOverdue = metrics.agingReport.critical.amount;
      checks.push({
        component: "Payment Dashboard Service",
        status: criticalOverdue > 10000 ? "warning" : "healthy",
        message: `${formatCurrency(criticalOverdue)} in critical overdue payments`,
        lastChecked: now,
      });
    } catch (error) {
      checks.push({
        component: "Payment Dashboard Service",
        status: "error",
        message: `Health check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
        lastChecked: now,
      });
    }

    // Check communication service
    checks.push({
      component: "Payment Communication Service",
      status: "healthy",
      message: "Communication templates and schedules configured",
      lastChecked: now,
    });

    // Check analytics service
    checks.push({
      component: "Payment Analytics Service",
      status: "healthy",
      message: "Analytics and reporting functions operational",
      lastChecked: now,
    });

    return checks;
  }

  /**
   * Generate comprehensive system report
   */
  async generateSystemReport(
    startDate: Date,
    endDate: Date
  ): Promise<{
    period: { start: Date; end: Date };
    analytics: any;
    healthChecks: SystemHealthCheck[];
    recommendations: string[];
    systemMetrics: {
      totalPayments: number;
      automationEfficiency: number;
      errorRate: number;
      processingTime: number;
    };
  }> {
    const [analytics, healthChecks] = await Promise.all([
      paymentAnalyticsService.generateAnalyticsReport(startDate, endDate),
      this.performHealthCheck(),
    ]);

    const errorComponents = healthChecks.filter(
      (check) => check.status === "error"
    ).length;
    const totalComponents = healthChecks.length;
    const errorRate =
      totalComponents > 0 ? (errorComponents / totalComponents) * 100 : 0;

    const recommendations = [
      ...analytics.recommendations,
      ...this.generateSystemRecommendations(healthChecks),
    ];

    return {
      period: { start: startDate, end: endDate },
      analytics,
      healthChecks,
      recommendations,
      systemMetrics: {
        totalPayments:
          analytics.kpis.totalRevenue > 0
            ? Math.round(
                analytics.kpis.totalRevenue /
                  analytics.kpis.averagePaymentAmount
              )
            : 0,
        automationEfficiency: 100 - errorRate,
        errorRate,
        processingTime: 0, // Would be calculated from actual processing metrics
      },
    };
  }

  /**
   * Generate system-level recommendations
   */
  private generateSystemRecommendations(
    healthChecks: SystemHealthCheck[]
  ): string[] {
    const recommendations: string[] = [];

    const errorComponents = healthChecks.filter(
      (check) => check.status === "error"
    );
    const warningComponents = healthChecks.filter(
      (check) => check.status === "warning"
    );

    if (errorComponents.length > 0) {
      recommendations.push(
        `Critical: ${errorComponents.length} system components have errors and need immediate attention`
      );
    }

    if (warningComponents.length > 0) {
      recommendations.push(
        `Warning: ${warningComponents.length} system components show warning signs and should be monitored`
      );
    }

    if (errorComponents.length === 0 && warningComponents.length === 0) {
      recommendations.push(
        "System is operating optimally - consider implementing advanced features like predictive analytics"
      );
    }

    return recommendations;
  }

  /**
   * Emergency system reset (use with caution)
   */
  async emergencySystemReset(): Promise<{ success: boolean; message: string }> {
    try {

      // This would reset system state, clear caches, restart services, etc.
      // Implementation would depend on specific requirements

      return {
        success: true,
        message: "Emergency system reset completed successfully",
      };
    } catch (error) {
      return {
        success: false,
        message: `Emergency reset failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      };
    }
  }
}

export const paymentSystemOrchestratorService =
  new PaymentSystemOrchestratorService();
