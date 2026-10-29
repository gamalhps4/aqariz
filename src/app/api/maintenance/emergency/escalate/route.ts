/**
 * PropertyPro - Emergency Escalation API Route
 * Handle escalation of emergency maintenance requests
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
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import { hasAnyPermission } from "@/lib/role-utils";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { z } from "zod";
import { AuditAction, diffSnapshot, recordActivity } from "@/lib/audit-domain";
import {
  MAINTENANCE_CHANGE_KEYS,
  maintenanceName,
  maintenanceSnapshot,
} from "@/lib/audit/records/maintenance";

// ============================================================================
// POST /api/maintenance/emergency/escalate - Escalate emergency request
// ============================================================================

const escalationSchema = z.object({
  requestId: z.string().min(1, "Request ID is required"),
  escalationReason: z.string().optional(),
  escalateTo: z.string().optional(), // Specific user to escalate to
  urgencyLevel: z.enum(["high", "critical"]).default("high"),
  notes: z.string().optional(),
});

const EMERGENCY_STAFF_PERMISSIONS = [
  "maintenance_management",
  "maintenance_assign",
  "work_orders",
];

function canReceiveEmergencyAssignment(profile: {
  isCompanyStaff: boolean;
  permissions: string[];
}) {
  return (
    profile.isCompanyStaff &&
    hasAnyPermission(profile.permissions, EMERGENCY_STAFF_PERMISSIONS)
  );
}

const PROPERTY_SELECT = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

function withAddress(property: Record<string, unknown> | null | undefined) {
  if (!property) return null;
  return {
    ...property,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
      country: property.addressCountry,
    },
  };
}

function toPopulatedShape(row: {
  property?: Record<string, unknown> | null;
  tenant?: Record<string, unknown> | null;
  assignedTo?: Record<string, unknown> | null;
  propertyId: string;
  tenantId: string;
  [key: string]: unknown;
}) {
  const property = withAddress(row.property);
  return {
    ...row,
    propertyId: property ?? row.propertyId,
    tenantId: row.tenant ?? row.tenantId,
    assignedTo: row.assignedTo ?? null,
    property: undefined,
    tenant: undefined,
  };
}

export const POST = withPermissionAndDB("maintenance_management")(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    // Validate request body
    const validation = escalationSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        validation.error.errors.map((e) => e.message).join(", "),
        400
      );
    }

    const { requestId, escalationReason, escalateTo, urgencyLevel, notes } =
      validation.data;

    // Find the emergency request
    // Scoped: an emergency in a building this caller was not given does not
    // resolve, and the 404 below answers.
    const emergencyRequest = await db.maintenanceRequest.findFirst({
      where: { id: requestId, ...maintenanceScope(user) },
      // Who has it now, so the entry can say who it was escalated from.
      include: { assignedTo: { select: { firstName: true, lastName: true } } },
    });
    if (!emergencyRequest) {
      return createErrorResponse("Emergency request not found", 404);
    }

    // Verify it's an emergency request
    if (emergencyRequest.priority !== "emergency") {
      return createErrorResponse("Request is not an emergency", 400);
    }

    let escalationTarget:
      | { id: string; role: string | null; isActive?: boolean }
      | null
      | undefined;
    if (escalateTo) {
      escalationTarget = await db.user.findFirst({ where: { id: escalateTo } });
      if (!escalationTarget || !escalationTarget.isActive) {
        return createErrorResponse("Escalation target user not found", 404);
      }

      const targetAccessProfile = await resolveAccessProfile(escalationTarget.role);
      if (!canReceiveEmergencyAssignment(targetAccessProfile)) {
        return createErrorResponse(
          "Escalation target must be active maintenance staff",
          400
        );
      }
    } else {
      const staffCandidates = await db.user.findMany({
        where: { isActive: true },
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          email: true,
          createdAt: true,
        },
        orderBy: { createdAt: "asc" },
      });

      for (const candidate of staffCandidates) {
        const candidateAccessProfile = await resolveAccessProfile(candidate.role);
        if (!canReceiveEmergencyAssignment(candidateAccessProfile)) {
          continue;
        }

        if (!candidateAccessProfile.isAdmin) {
          escalationTarget = candidate;
          break;
        }

        escalationTarget ??= candidate;
      }
    }

    if (!escalationTarget) {
      return createErrorResponse("No available escalation target found", 404);
    }

    // Check current escalation level and increment (no escalation level is
    // persisted on the row — same as the legacy schema — so this starts at 0)
    const currentEscalationLevel = 0;
    const newEscalationLevel = Math.min(currentEscalationLevel + 1, 3); // Max level 3

    // Update the request with escalation info
    let escalatedNotes = emergencyRequest.notes;
    if (notes || escalationReason) {
      const escalationNote = `ESCALATED to Level ${newEscalationLevel}${
        escalationReason ? `: ${escalationReason}` : ""
      }${notes ? `\nNotes: ${notes}` : ""}`;
      escalatedNotes = escalatedNotes
        ? `${escalatedNotes}\n${escalationNote}`
        : escalationNote;
    }

    await db.maintenanceRequest.update({
      where: { id: requestId },
      data: {
        assignedToId: escalationTarget.id,
        status: MaintenanceStatus.ASSIGNED,
        ...(escalatedNotes !== emergencyRequest.notes
          ? { notes: escalatedNotes }
          : {}),
      },
    });

    // Create escalation log entry (this could be a separate collection in a real app)
    const escalationLog = {
      requestId: emergencyRequest.id,
      escalatedBy: user.id,
      escalatedTo: escalationTarget.id,
      reason: escalationReason,
      urgencyLevel,
      notes,
      timestamp: new Date(),
    };

    // Populate the updated request for response
    const populated = await db.maintenanceRequest.findFirst({
      where: { id: emergencyRequest.id },
      include: {
        property: { select: PROPERTY_SELECT },
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    // The escalation: who has the request now (from → to), how urgent, and why.
    const moved = diffSnapshot(
      maintenanceSnapshot(emergencyRequest),
      maintenanceSnapshot(populated ?? emergencyRequest),
      MAINTENANCE_CHANGE_KEYS,
    );
    void recordActivity({
      action: AuditAction.UPDATE,
      recordType: "maintenance",
      recordId: emergencyRequest.id,
      recordName: maintenanceName(emergencyRequest),
      messageKey: "admin.audit.msg.maintenance_escalated",
      before: moved.before,
      after: { ...moved.after, urgencyLevel },
      details: escalationReason ? { reason: escalationReason } : undefined,
    });

    // TODO: Send escalation notifications
    // - Email to escalation target
    // - SMS if critical
    // - Push notification
    // - Update dashboard alerts

    return createSuccessResponse(
      {
        request: populated ? toPopulatedShape(populated) : null,
        escalation: escalationLog,
      },
      "Emergency request escalated successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// GET /api/maintenance/emergency/escalate - Get escalation history
// ============================================================================

export const GET = withPermissionAndDB("maintenance_management")(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const requestId = searchParams.get("requestId");
    const limit = parseInt(searchParams.get("limit") || "12");

    // In a real application, this would query an escalation log collection
    // For now, we'll return escalation info from maintenance request notes
    const escalatedRequests = await db.maintenanceRequest.findMany({
      where: {
        ...maintenanceScope(user),
        priority: "emergency",
        notes: { contains: "ESCALATED:", mode: "insensitive" },
        deletedAt: null,
        ...(requestId ? { id: requestId } : {}),
      },
      include: {
        property: { select: PROPERTY_SELECT },
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    // Extract escalation info from notes (simplified approach)
    const escalations = escalatedRequests.map((req) => {
      const escalationMatch = req.notes?.match(/ESCALATED: (.+?)(?:\n|$)/);
      return {
        requestId: req.id,
        request: {
          title: req.title,
          status: req.status,
          createdAt: req.createdAt,
          property: withAddress(req.property as never),
          tenant: req.tenant,
          assignedTo: req.assignedTo,
        },
        escalationReason: escalationMatch ? escalationMatch[1] : "Unknown",
        timestamp: req.updatedAt,
      };
    });

    return createSuccessResponse(
      escalations,
      "Escalation history retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});
