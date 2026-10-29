/**
 * PropertyPro - Bulk Assign Maintenance Requests API
 * API endpoint for bulk assignment of maintenance requests
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
import { resolveAccessProfile } from "@/lib/server-permissions";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { firstOf, personName } from "@/lib/audit/records/shared";

// Validation schema for bulk assign request
const bulkAssignSchema = z.object({
  requestIds: z.array(z.string()).min(1, "At least one request ID is required"),
  assigneeId: z.string().min(1, "Assignee ID is required"),
  notes: z.string().optional(),
});

// ============================================================================
// POST /api/maintenance/bulk-assign - Bulk assign maintenance requests
// ============================================================================

export const POST = withPermissionAndDB([
  "maintenance_assign",
  "maintenance_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const body = await request.json();
    const validatedData = bulkAssignSchema.parse(body);
    const { requestIds, assigneeId, notes } = validatedData;

    // Validate all request IDs
    const invalidIds = requestIds.filter((id) => !isValidObjectId(id));
    if (invalidIds.length > 0) {
      return createErrorResponse(
        `Invalid request IDs: ${invalidIds.join(", ")}`,
        400
      );
    }

    // Validate assignee ID
    if (!isValidObjectId(assigneeId)) {
      return createErrorResponse("Invalid assignee ID", 400);
    }

    // Check if assignee exists and has appropriate role
    const assignee = await db.user.findFirst({ where: { id: assigneeId } });
    if (!assignee) {
      return createErrorResponse("Assignee not found", 404);
    }

    const assigneeAccess = await resolveAccessProfile(assignee.role);
    if (!assigneeAccess.isCompanyStaff) {
      return createErrorResponse(
        "Assignee must be maintenance staff or manager",
        400
      );
    }

    // Find all requests to be assigned. Scoped, so a request in a building
    // this employee was not given simply does not resolve — and the
    // length check below then refuses the whole batch rather than silently
    // assigning the ones they were allowed to touch.
    const requests = await db.maintenanceRequest.findMany({
      where: {
        id: { in: requestIds },
        deletedAt: null,
        ...maintenanceScope(user),
      },
    });

    if (requests.length === 0) {
      return createErrorResponse("No valid requests found", 404);
    }

    if (requests.length !== requestIds.length) {
      return createErrorResponse("Some requests were not found", 400);
    }

    // Update all requests (append the note to each request's notes when given)
    let modifiedCount = 0;
    if (notes) {
      const noteLine = `[${new Date().toISOString()}] ${notes}`;
      await Promise.all(
        requests.map((req) =>
          db.maintenanceRequest.update({
            where: { id: req.id },
            data: {
              assignedToId: assigneeId,
              status: MaintenanceStatus.ASSIGNED,
              notes: req.notes ? `${req.notes}\n${noteLine}` : noteLine,
            },
          })
        )
      );
      modifiedCount = requests.length;
    } else {
      const result = await db.maintenanceRequest.updateMany({
        // The ids that survived the scoped read above, not the ones the
        // request asked for. Writing `requestIds` here would undo the filter:
        // the read is what proves the caller may touch these rows.
        where: { id: { in: requests.map((request) => request.id) } },
        data: {
          assignedToId: assigneeId,
          status: MaintenanceStatus.ASSIGNED,
        },
      });
      modifiedCount = result.count;
    }

    // One entry for the batch: how many, to whom, and which requests.
    void recordActivity({
      action: AuditAction.BULK_UPDATE,
      recordType: "maintenance",
      messageKey: "admin.audit.msg.maintenance_bulk_assign",
      messageParams: { count: modifiedCount, assignee: personName(assignee) },
      before: {
        rows: requests.slice(0, 50).map((row) => ({
          id: row.id,
          status: row.status,
        })),
      },
      after: {
        status: MaintenanceStatus.ASSIGNED,
        assignedToName: personName(assignee),
      },
      details: {
        count: modifiedCount,
        requests: firstOf(requests, (row) => row.title),
      },
    });

    return createSuccessResponse({
      message: `Successfully assigned ${modifiedCount} requests`,
      assignedCount: modifiedCount,
      assigneeName: `${assignee.firstName} ${assignee.lastName}`,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return createErrorResponse(
        `Validation error: ${error.errors.map((e) => e.message).join(", ")}`,
        400
      );
    }

    return createErrorResponse(
      error instanceof Error ? error.message : "Failed to assign requests",
      500
    );
  }
});
