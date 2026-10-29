/**
 * PropertyPro - Payment Synchronization Initializer
 * Initializes payment synchronization monitoring and performs startup checks
 */

import { paymentSyncMonitor } from "./payment-sync-monitor.service";
import { leasePaymentSynchronizer } from "./lease-payment-synchronizer.service";
import {
  isNeeded,
  getStatus,
} from "../migrations/payment-sync-enhancement.migration";

export interface InitializationResult {
  success: boolean;
  message: string;
  checks: {
    migrationStatus: "needed" | "completed" | "error";
    monitoringStatus: "started" | "failed" | "already_running";
    dataConsistency: "valid" | "issues_found" | "error";
  };
  warnings: string[];
  errors: string[];
}

export class PaymentSyncInitializer {
  private static instance: PaymentSyncInitializer;
  private initialized = false;

  constructor() {
    if (PaymentSyncInitializer.instance) {
      return PaymentSyncInitializer.instance;
    }
    PaymentSyncInitializer.instance = this;
  }

  /**
   * Initialize payment synchronization system
   */
  async initialize(): Promise<InitializationResult> {
    if (this.initialized) {
      return {
        success: true,
        message: "Payment synchronization already initialized",
        checks: {
          migrationStatus: "completed",
          monitoringStatus: "already_running",
          dataConsistency: "valid",
        },
        warnings: [],
        errors: [],
      };
    }

    const result: InitializationResult = {
      success: false,
      message: "",
      checks: {
        migrationStatus: "error",
        monitoringStatus: "failed",
        dataConsistency: "error",
      },
      warnings: [],
      errors: [],
    };


    try {
      // Step 1: Check migration status

      const migrationNeeded = await this.checkMigrationStatus(result);

      // Step 2: Start monitoring (even if migration is needed)

      await this.startMonitoring(result);

      // Step 3: Perform data consistency checks (only if migration is complete)
      if (!migrationNeeded) {

        await this.performConsistencyChecks(result);
      } else {
        result.warnings.push(
          "Skipping consistency checks - migration required"
        );
      }

      // Step 4: Determine overall success
      const hasErrors = result.errors.length > 0;
      const hasCriticalIssues =
        result.checks.migrationStatus === "error" ||
        result.checks.monitoringStatus === "failed";

      result.success = !hasErrors && !hasCriticalIssues;
      result.message = result.success
        ? "Payment synchronization system initialized successfully"
        : "Payment synchronization system initialized with issues";

      if (result.success) {
        this.initialized = true;

      } else {
        console.warn(
          "⚠️ Payment synchronization system initialized with issues"
        );
      }

      // Log summary
      this.logInitializationSummary(result);
    } catch (error) {
      result.success = false;
      result.message = "Failed to initialize payment synchronization system";
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
      console.error("❌ Payment synchronization initialization failed:", error);
    }

    return result;
  }

  /**
   * Check migration status
   */
  private async checkMigrationStatus(
    result: InitializationResult
  ): Promise<boolean> {
    try {
      const migrationNeeded = await isNeeded();
      const status = await getStatus();

      if (migrationNeeded) {
        result.checks.migrationStatus = "needed";
        result.warnings.push(
          `Migration required: ${status.stats.paymentsWithoutSyncFields} payments need sync fields`
        );
        console.warn(
          `⚠️ Migration needed: ${status.stats.paymentsWithoutSyncFields}/${status.stats.totalPayments} payments require sync fields`
        );
        return true;
      } else {
        result.checks.migrationStatus = "completed";

        return false;
      }
    } catch (error) {
      result.checks.migrationStatus = "error";
      result.errors.push(
        `Migration check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      console.error("❌ Migration check failed:", error);
      return false;
    }
  }

  /**
   * Start monitoring service
   */
  private async startMonitoring(result: InitializationResult): Promise<void> {
    try {
      // Start monitoring with 5-minute intervals
      paymentSyncMonitor.startMonitoring(300000);
      result.checks.monitoringStatus = "started";

    } catch (error) {
      result.checks.monitoringStatus = "failed";
      result.errors.push(
        `Monitoring startup failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      console.error("❌ Failed to start monitoring:", error);
    }
  }

  /**
   * Perform initial data consistency checks
   */
  private async performConsistencyChecks(
    result: InitializationResult
  ): Promise<void> {
    try {
      // Get a sample of leases to check
      const { db } = await import("@/lib/db/prisma");
      const sampleLeases = await db.lease.findMany({
        select: { id: true },
        take: 10, // Check first 10 leases for startup validation
      });

      let totalIssues = 0;
      const issueDetails: string[] = [];

      for (const lease of sampleLeases) {
        try {
          const validation =
            await leasePaymentSynchronizer.validateLeasePaymentConsistency(
              lease.id
            );

          if (!validation.isValid) {
            totalIssues += validation.errors.length;
            issueDetails.push(
              `Lease ${lease.id}: ${validation.errors.join(", ")}`
            );
          }
        } catch (error) {
          totalIssues++;
          issueDetails.push(`Lease ${lease.id}: Validation failed`);
        }
      }

      if (totalIssues > 0) {
        result.checks.dataConsistency = "issues_found";
        result.warnings.push(
          `Found ${totalIssues} consistency issues in sample of ${sampleLeases.length} leases`
        );

        // Add first few issue details
        issueDetails.slice(0, 3).forEach((detail) => {
          result.warnings.push(detail);
        });

        if (issueDetails.length > 3) {
          result.warnings.push(
            `... and ${issueDetails.length - 3} more issues`
          );
        }

        console.warn(
          `⚠️ Found ${totalIssues} consistency issues in sample check`
        );
      } else {
        result.checks.dataConsistency = "valid";

      }
    } catch (error) {
      result.checks.dataConsistency = "error";
      result.errors.push(
        `Consistency check failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
      console.error("❌ Consistency check failed:", error);
    }
  }

  /**
   * Log initialization summary
   */
  private logInitializationSummary(result: InitializationResult): void {





    if (result.warnings.length > 0) {

    }

    if (result.errors.length > 0) {

    }


  }

  /**
   * Get status emoji for logging
   */
  private getStatusEmoji(status: string): string {
    switch (status) {
      case "completed":
      case "started":
      case "valid":
      case "already_running":
        return "✅";
      case "needed":
      case "issues_found":
        return "⚠️";
      case "error":
      case "failed":
        return "❌";
      default:
        return "❓";
    }
  }

  /**
   * Shutdown monitoring
   */
  shutdown(): void {
    if (this.initialized) {
      paymentSyncMonitor.stopMonitoring();
      this.initialized = false;

    }
  }

  /**
   * Get current initialization status
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Force re-initialization
   */
  async reinitialize(): Promise<InitializationResult> {
    this.shutdown();
    this.initialized = false;
    return this.initialize();
  }
}

// Export singleton instance
export const paymentSyncInitializer = new PaymentSyncInitializer();

// Auto-initialize in production environments
if (process.env.NODE_ENV === "production" && typeof window === "undefined") {
  // Only auto-initialize on server side in production
  setTimeout(async () => {
    try {
      await paymentSyncInitializer.initialize();
    } catch (error) {
      console.error("Auto-initialization failed:", error);
    }
  }, 5000); // Wait 5 seconds after startup
}
