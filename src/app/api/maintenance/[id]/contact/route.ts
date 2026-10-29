/**
 * PropertyPro - Maintenance Request Contact Logging API
 * API endpoint for logging contact attempts with tenants
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { maintenanceScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { z } from "zod";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { maintenanceName } from "@/lib/audit/records/maintenance";

// Validation schema for contact logging
const contactLogSchema = z.object({
  method: z.enum(["phone", "email", "sms", "in_person"]),
  contactedAt: z.string().datetime(),
  notes: z.string().optional(),
  successful: z.boolean().default(true),
});

// ============================================================================
// POST /api/maintenance/[id]/contact - Log contact attempt
// ============================================================================

export const POST = withPermissionAndDB("maintenance_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: { id: string } }
  ) => {
    try {
      const { id } = params;

      // Validate request ID
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid request ID", 400);
      }

      const body = await request.json();
      const validatedData = contactLogSchema.parse(body);
      const { method, contactedAt, successful } = validatedData;

      // Role-based access control
      // Single company architecture - Managers can log contact for all maintenance requests

      // Scoped: a request in a building this caller was not given does not
      // resolve, and the 404 below answers.
      const maintenanceRequest = await db.maintenanceRequest.findFirst({
        where: { id, deletedAt: null, ...maintenanceScope(user) },
      });

      if (!maintenanceRequest) {
        return createErrorResponse(
          "Maintenance request not found or insufficient permissions",
          404
        );
      }

      // The maintenance schema keeps no contact-log storage (the old model
      // silently dropped these fields too); touch the row so updatedAt moves,
      // exactly as the legacy $set did.
      await db.maintenanceRequest.update({
        where: { id },
        data: {},
      });

      // The contact log keeps nothing else, so this entry is the record of it.
      void recordActivity({
        action: AuditAction.UPDATE,
        recordType: "maintenance",
        recordId: id,
        recordName: maintenanceName(maintenanceRequest),
        messageKey: "admin.audit.msg.maintenance_contact_logged",
        after: {
          contactMethod: method,
          contactSuccessful: successful,
          contactedAt,
        },
      });

      return createSuccessResponse({
        message: "Contact attempt logged successfully",
        contactLog: {
          method,
          contactedAt,
          contactedBy: `${user.firstName} ${user.lastName}`,
          successful,
        },
      });
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
          : "Failed to log contact attempt",
        500
      );
    }
  }
);
