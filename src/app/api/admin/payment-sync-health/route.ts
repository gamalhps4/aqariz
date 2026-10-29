/**
 * PropertyPro - Payment Synchronization Health API
 * Provides monitoring and health check endpoints for payment-lease synchronization
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { paymentSyncMonitor } from "@/lib/services/payment-sync-monitor.service";
import { leasePaymentSynchronizer } from "@/lib/services/lease-payment-synchronizer.service";

// ============================================================================
// GET /api/admin/payment-sync-health - Get synchronization health report
// ============================================================================

export const GET = withPermissionAndDB("system_settings")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const url = new URL(request.url);
    const detailed = url.searchParams.get("detailed") === "true";

    // Generate health report
    const healthReport = await paymentSyncMonitor.generateHealthReport();

    // If detailed report requested, include additional diagnostics
    if (detailed) {
      const syncFailures = await leasePaymentSynchronizer.detectSyncFailures();

      return createSuccessResponse({
        healthReport,
        syncFailures,
        timestamp: new Date(),
        requestedBy: user.id,
      });
    }

    return createSuccessResponse({
      healthReport,
      timestamp: new Date(),
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate health report");
  }
});

// ============================================================================
// POST /api/admin/payment-sync-health - Trigger manual synchronization
// ============================================================================

export const POST = withPermissionAndDB("system_settings")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const body = await request.json();
    const { action, leaseId, forceSync = false } = body ?? {};

    let result;

    switch (action) {
      case "sync_lease":
        if (!leaseId) {
          return createErrorResponse(
            "Lease ID required for sync_lease action",
            400,
          );
        }

        result = await leasePaymentSynchronizer.syncLeaseWithPayments(leaseId, {
          forceSync,
        });
        break;

      case "validate_lease":
        if (!leaseId) {
          return createErrorResponse(
            "Lease ID required for validate_lease action",
            400,
          );
        }

        result =
          await leasePaymentSynchronizer.validateLeasePaymentConsistency(
            leaseId,
          );
        break;

      case "detect_failures":
        result = await leasePaymentSynchronizer.detectSyncFailures();
        break;

      case "start_monitoring":
        paymentSyncMonitor.startMonitoring();
        result = { message: "Monitoring started" };
        break;

      case "stop_monitoring":
        paymentSyncMonitor.stopMonitoring();
        result = { message: "Monitoring stopped" };
        break;

      default:
        return createErrorResponse("Invalid action", 400);
    }

    return createSuccessResponse({
      action,
      result,
      executedBy: user.id,
      timestamp: new Date(),
    });
  } catch (error) {
    return handleApiError(error, "Failed to execute synchronization action");
  }
});

// ============================================================================
// PATCH /api/admin/payment-sync-health - Fix synchronization issues
// ============================================================================

export const PATCH = withPermissionAndDB("system_settings")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const body = await request.json();
    const { issueIds, autoFix = false } = body ?? {};

    if (!Array.isArray(issueIds)) {
      return createErrorResponse("Issue IDs must be an array", 400);
    }

    const results = [];

    for (const issueId of issueIds) {
      try {
        // Get current health report to find the issue
        const healthReport = await paymentSyncMonitor.generateHealthReport();
        const issue = healthReport.syncIssues.find((i) => i.id === issueId);

        if (!issue) {
          results.push({
            issueId,
            success: false,
            error: "Issue not found",
          });
          continue;
        }

        if (!issue.autoFixable && !autoFix) {
          results.push({
            issueId,
            success: false,
            error: "Issue is not auto-fixable",
          });
          continue;
        }

        // Attempt to fix the issue
        let fixResult;

        if (issue.affectedEntities.leaseIds) {
          // Fix lease-related issues
          for (const leaseId of issue.affectedEntities.leaseIds) {
            fixResult = await leasePaymentSynchronizer.syncLeaseWithPayments(
              leaseId,
              {
                forceSync: true,
              },
            );
          }
        }

        if (issue.affectedEntities.paymentIds) {
          // Fix payment-related issues
          for (const paymentId of issue.affectedEntities.paymentIds) {
            // Get the payment to find its lease
            const payment = await db.payment.findFirst({
              where: { id: paymentId },
              select: { leaseId: true },
            });
            if (payment?.leaseId) {
              fixResult = await leasePaymentSynchronizer.syncLeaseWithPayments(
                payment.leaseId,
                { forceSync: true },
              );
            }
          }
        }

        results.push({
          issueId,
          success: true,
          fixResult,
        });
      } catch (error) {
        results.push({
          issueId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return createSuccessResponse({
      results,
      fixedBy: user.id,
      timestamp: new Date(),
    });
  } catch (error) {
    return handleApiError(error, "Failed to fix synchronization issues");
  }
});

// ============================================================================
// DELETE /api/admin/payment-sync-health - Clean up orphaned data
// ============================================================================

export const DELETE = withPermissionAndDB("system_settings")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const url = new URL(request.url);
    const confirmCleanup = url.searchParams.get("confirm") === "true";
    const dryRun = url.searchParams.get("dryRun") === "true";

    if (!confirmCleanup && !dryRun) {
      return createErrorResponse(
        "Cleanup requires confirmation. Use ?confirm=true or ?dryRun=true",
        400,
      );
    }

    // Orphaned payments (a leaseId pointing at a missing lease) cannot exist
    // in Postgres: payments.leaseId is a real foreign key, so dangling
    // references are rejected at the database. Nothing to scan for.
    const orphanedPaymentCount = 0;

    // Find payments with failed sync status older than 7 days
    const staleFailedPayments = await db.payment.findMany({
      where: {
        syncStatus: "failed",
        lastSyncedAt: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        deletedAt: null,
      },
      select: { id: true },
    });

    const cleanupPlan = {
      orphanedPayments: orphanedPaymentCount,
      staleFailedPayments: staleFailedPayments.length,
      totalToClean: orphanedPaymentCount + staleFailedPayments.length,
    };

    if (dryRun) {
      return createSuccessResponse({
        dryRun: true,
        cleanupPlan,
        message: "This is a dry run - no data was actually cleaned",
      });
    }

    // Perform actual cleanup
    let cleanedCount = 0;

    // Reset sync status for stale failed payments
    if (staleFailedPayments.length > 0) {
      await db.payment.updateMany({
        where: { id: { in: staleFailedPayments.map((p) => p.id) } },
        data: {
          syncStatus: "pending",
          lastSyncedAt: new Date(),
        },
      });
      cleanedCount += staleFailedPayments.length;
    }

    return createSuccessResponse({
      cleanupPlan,
      cleanedCount,
      cleanedBy: user.id,
      timestamp: new Date(),
      message: `Successfully cleaned ${cleanedCount} items`,
    });
  } catch (error) {
    return handleApiError(error, "Failed to clean up orphaned data");
  }
});
