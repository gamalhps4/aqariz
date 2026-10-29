/**
 * PropertyPro - Bulk Status Update Maintenance Requests API
 * API endpoint for bulk status updates of maintenance requests
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { maintenanceScope } from "@/lib/db/scopes";
import { MaintenanceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { z } from "zod";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { firstOf } from "@/lib/audit/records/shared";

// Validation schema for bulk status update request
const bulkStatusSchema = z.object({
  requestIds: z.array(z.string()).min(1, "At least one request ID is required"),
  status: z.nativeEnum(MaintenanceStatus),
  notes: z.string().optional(),
});

// ============================================================================
// POST /api/maintenance/bulk-status - Bulk update maintenance request status
// ============================================================================

export const POST = withPermissionAndDB([
  "maintenance_management",
  "maintenance_assign",
  "work_orders",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();
      const validatedData = bulkStatusSchema.parse(body);
      const { requestIds, status, notes } = validatedData;

      // Validate all request IDs
      const invalidIds = requestIds.filter((id) => !isValidObjectId(id));
      if (invalidIds.length > 0) {
        return createErrorResponse(
          `Invalid request IDs: ${invalidIds.join(", ")}`,
          400
        );
      }

      // Role-based access control
      // Single company architecture - Managers can update all maintenance requests

      const requests = await db.maintenanceRequest.findMany({
        // Scoped: a request outside this employee's buildings does not
        // resolve, and the update below already works from what was read.
        where: {
          id: { in: requestIds },
          deletedAt: null,
          ...maintenanceScope(user),
        },
      });

      if (requests.length === 0) {
        return createErrorResponse(
          "No valid requests found or insufficient permissions",
          404
        );
      }

      // Completing a request stamps its completion date (old model rule)
      const completedDate =
        status === MaintenanceStatus.COMPLETED ? new Date() : undefined;

      let modifiedCount = 0;
      if (notes) {
        const noteLine = `[${new Date().toISOString()}] ${notes}`;
        await Promise.all(
          requests.map((req) =>
            db.maintenanceRequest.update({
              where: { id: req.id },
              data: {
                status,
                ...(completedDate ? { completedDate } : {}),
                notes: req.notes ? `${req.notes}\n${noteLine}` : noteLine,
              },
            })
          )
        );
        modifiedCount = requests.length;
      } else {
        const result = await db.maintenanceRequest.updateMany({
          where: { id: { in: requests.map((r) => r.id) } },
          data: {
            status,
            ...(completedDate ? { completedDate } : {}),
          },
        });
        modifiedCount = result.count;
      }

      // Trigger property status synchronization for affected properties
      const affectedProperties = new Set<string>();
      for (const req of requests) {
        if (req.propertyId && req.unitId) {
          affectedProperties.add(req.propertyId);
        }
      }

      let syncWarning: string | null = null;
      if (affectedProperties.size > 0) {
        try {
          const { propertyStatusSynchronizer } = await import(
            "@/lib/services/property-status-sync.service"
          );

          await propertyStatusSynchronizer.syncMultipleProperties(
            Array.from(affectedProperties),
            {
              triggeredBy: `bulk-maintenance-update:${user.id}`,
              logChanges: true,
            }
          );
        } catch (syncError) {
          syncWarning =
            syncError instanceof Error
              ? syncError.message
              : "Property synchronization skipped";
        }
      }

      // One entry for the batch: how many, to what, from what, and which requests.
      void recordActivity({
        action: AuditAction.BULK_UPDATE,
        recordType: "maintenance",
        messageKey: "admin.audit.msg.maintenance_bulk_status",
        messageParams: { count: modifiedCount, to: status },
        before: {
          rows: requests.slice(0, 50).map((row) => ({
            id: row.id,
            status: row.status,
          })),
        },
        after: { status },
        details: {
          count: modifiedCount,
          requests: firstOf(requests, (row) => row.title),
        },
      });

      return createSuccessResponse(
        {
          message: `Successfully updated ${modifiedCount} requests to ${status}`,
          updatedCount: modifiedCount,
          newStatus: status,
          warning: syncWarning || undefined,
        },
        "Bulk maintenance status update completed"
      );
    } catch (error) {
      if (error instanceof z.ZodError) {
        return createErrorResponse(
          `Validation error: ${error.errors.map((e) => e.message).join(", ")}`,
          400
        );
      }

      return createErrorResponse(
        error instanceof Error
          ? error.message
          : "Failed to update request status",
        500
      );
    }
  }
);
