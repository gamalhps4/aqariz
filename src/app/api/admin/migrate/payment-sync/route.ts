/**
 * PropertyPro - Payment Sync Migration API
 *
 * Executes / validates the payment-synchronisation repair pass. Running a
 * migration (and the `down` rollback) is a platform-operator action, not a
 * tenant one, so every handler here is gated on `withPlatformAdminAndDB` —
 * which also runs them with org scoping disabled so the sweep can cover every
 * organization.
 */

import { NextRequest } from "next/server";
import {
  type AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  up,
  down,
  isNeeded,
  getStatus,
} from "@/lib/migrations/payment-sync-enhancement.migration";

// ============================================================================
// GET /api/admin/migrate/payment-sync - Check migration status
// ============================================================================

export const GET = withPlatformAdminAndDB()(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const url = new URL(request.url);
    const detailed = url.searchParams.get("detailed") === "true";

    const needed = await isNeeded();
    const status = await getStatus();

    const response = {
      migrationNeeded: needed,
      status,
      timestamp: new Date(),
      checkedBy: user.id,
    };

    if (detailed) {
      // Add more detailed information
      return createSuccessResponse({
        ...response,
        recommendations: needed
          ? [
              "Migration is required to enable enhanced payment synchronization",
              "Backup your database before running the migration",
              "Run migration during low-traffic hours",
              "Monitor the migration progress and logs",
            ]
          : [
              "No migration needed - system is up to date",
              "Enhanced payment synchronization is active",
            ],
      });
    }

    return createSuccessResponse(response);
  } catch (error) {
    return handleApiError(error, "Failed to check migration status");
  }
});

// ============================================================================
// POST /api/admin/migrate/payment-sync - Run migration
// ============================================================================

export const POST = withPlatformAdminAndDB()(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const body = await request.json();
    const { action = "up", confirm = false } = body ?? {};

    if (!confirm) {
      return createErrorResponse(
        "Migration requires explicit confirmation. Set confirm: true in request body.",
        400,
      );
    }

    let result;
    let actionDescription;

    switch (action) {
      case "up":
        actionDescription = "Running payment sync enhancement migration";
        result = await up();
        break;

      case "down":
        actionDescription = "Rolling back payment sync enhancement migration";
        result = await down();
        break;

      default:
        return createErrorResponse(
          "Invalid action. Use 'up' to run migration or 'down' to rollback.",
          400,
        );
    }

    // Log the result
    if (result.success) {
      // Migration completed successfully
    } else {
      console.error(`❌ Migration ${action} failed:`, result.message);
    }

    return createSuccessResponse({
      action,
      actionDescription,
      result,
      executedBy: user.id,
      executedAt: new Date(),
    });
  } catch (error) {
    return handleApiError(error, "Failed to execute migration");
  }
});

// ============================================================================
// PATCH /api/admin/migrate/payment-sync - Validate migration results
// ============================================================================

export const PATCH = withPlatformAdminAndDB()(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const body = await request.json();
    const { validateOnly = true, fixIssues = false } = body ?? {};

    // Import the synchronizer for validation
    const { leasePaymentSynchronizer } =
      await import("@/lib/services/lease-payment-synchronizer.service");

    // Get all leases to validate
    const { db } = await import("@/lib/db/prisma");
    const leases = await db.lease.findMany({
      where: { deletedAt: null },
      select: { id: true },
      take: 100, // Limit for performance
    });

    const validationResults = [];
    let totalIssues = 0;
    let fixedIssues = 0;

    for (const lease of leases) {
      try {
        const validation =
          await leasePaymentSynchronizer.validateLeasePaymentConsistency(
            lease.id,
          );

        if (!validation.isValid) {
          totalIssues += validation.errors.length;

          validationResults.push({
            leaseId: lease.id,
            isValid: false,
            errors: validation.errors,
            warnings: validation.warnings,
          });

          // Attempt to fix if requested
          if (fixIssues && !validateOnly) {
            try {
              const syncResult =
                await leasePaymentSynchronizer.syncLeaseWithPayments(
                  lease.id,
                  { forceSync: true },
                );

              if (syncResult.success) {
                fixedIssues++;
              }
            } catch (fixError) {
              console.error(`Failed to fix lease ${lease.id}:`, fixError);
            }
          }
        } else {
          validationResults.push({
            leaseId: lease.id,
            isValid: true,
            errors: [],
            warnings: validation.warnings,
          });
        }
      } catch (error) {
        validationResults.push({
          leaseId: lease.id,
          isValid: false,
          errors: [
            `Validation failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`,
          ],
          warnings: [],
        });
      }
    }

    const summary = {
      totalLeasesChecked: leases.length,
      validLeases: validationResults.filter((r) => r.isValid).length,
      invalidLeases: validationResults.filter((r) => !r.isValid).length,
      totalIssues,
      fixedIssues,
      validationResults: validateOnly
        ? validationResults.filter((r) => !r.isValid)
        : validationResults,
    };

    return createSuccessResponse({
      summary,
      validateOnly,
      fixIssues,
      validatedBy: user.id,
      validatedAt: new Date(),
      recommendations:
        summary.invalidLeases > 0
          ? [
              `Found ${summary.invalidLeases} leases with synchronization issues`,
              "Consider running with fixIssues: true to attempt automatic fixes",
              "Review validation errors for manual intervention needs",
            ]
          : [
              "All validated leases are synchronized correctly",
              "Payment synchronization system is working properly",
            ],
    });
  } catch (error) {
    return handleApiError(error, "Failed to validate migration results");
  }
});
