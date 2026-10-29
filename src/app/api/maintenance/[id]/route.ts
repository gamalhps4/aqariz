/**
 * PropertyPro - Individual Maintenance Request API Routes
 * CRUD operations for individual maintenance requests
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { maintenanceAllows, maintenanceScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, MaintenanceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  isValidObjectId,
  withAccessAndDB,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { maintenanceRequestSchema, validateSchema } from "@/lib/validations";
import { isMaintenanceAssignableRole } from "@/lib/model-access";
import {
  AuditAction,
  auditRecordChange,
  recordActivity,
} from "@/lib/audit-domain";
import {
  maintenanceEntry,
  maintenanceName,
  maintenanceSnapshot,
  noteText,
} from "@/lib/audit/records/maintenance";
import { compact } from "@/lib/audit/records/shared";

/** Read with the person it is assigned to, so an entry can name them. */
const WITH_ASSIGNEE = {
  assignedTo: { select: { firstName: true, lastName: true } },
} as const;

const MAINTENANCE_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "maintenance_view",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

// Changing an existing request. Raising one (`maintenance_create`) no longer
// implies editing everyone else's: that is `maintenance_edit`, so the two can
// be granted separately. Technicians keep what their work needs.
const MAINTENANCE_WRITE_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: [
    "maintenance_edit",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const PROPERTY_SELECT = {
  id: true,
  name: true,
  type: true,
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

// ============================================================================
// GET /api/maintenance/[id] - Get a specific maintenance request
// ============================================================================

export const GET = withAccessAndDB(MAINTENANCE_READ_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid maintenance request ID", 400);
      }

      const maintenanceRequest = await db.maintenanceRequest.findFirst({
        where: { id, ...maintenanceScope(user) },
        include: {
          property: {
            select: {
              ...PROPERTY_SELECT,
              ownerId: true,
              managerId: true,
              isMultiUnit: true,
              units: true,
            },
          },
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              avatar: true,
            },
          },
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              avatar: true,
            },
          },
        },
      });

      if (!maintenanceRequest) {
        return createErrorResponse("Maintenance request not found", 404);
      }

      // See lib/db/scopes.ts.
      if (!maintenanceAllows(user, maintenanceRequest)) {
        return createErrorResponse(
          "You can only view your own maintenance requests",
          403
        );
      }

      const property = withAddress(maintenanceRequest.property as never) as
        | (Record<string, unknown> & { units?: Array<{ id: string }> })
        | null;

      let unit: unknown = null;
      if (maintenanceRequest.unitId && property?.units) {
        unit =
          property.units.find(
            (embeddedUnit) => embeddedUnit.id === maintenanceRequest.unitId
          ) ?? null;
      }

      return createSuccessResponse(
        {
          ...maintenanceRequest,
          propertyId: property ?? maintenanceRequest.propertyId,
          tenantId: maintenanceRequest.tenant ?? maintenanceRequest.tenantId,
          assignedTo: maintenanceRequest.assignedTo ?? null,
          property,
          unit,
          tenant: maintenanceRequest.tenant
            ? {
                user: maintenanceRequest.tenant,
              }
            : null,
        },
        "Maintenance request retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/maintenance/[id] - Update a maintenance request
// ============================================================================

export const PUT = withAccessAndDB(MAINTENANCE_WRITE_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid maintenance request ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const maintenanceRequest = await db.maintenanceRequest.findFirst({
        where: { id, ...maintenanceScope(user) },
        include: WITH_ASSIGNEE,
      });
      if (!maintenanceRequest) {
        return createErrorResponse("Maintenance request not found", 404);
      }

      if (user.isTenant) {
        if (!maintenanceAllows(user, maintenanceRequest)) {
          return createErrorResponse(
            "You can only update your own maintenance requests",
            403
          );
        }

        if (maintenanceRequest.status === MaintenanceStatus.COMPLETED) {
          return createErrorResponse(
            "Cannot update completed maintenance request",
            400
          );
        }
      } else if (user.isManager && !user.isAdmin) {
        if (
          maintenanceRequest.assignedToId &&
          maintenanceRequest.assignedToId !== user.id
        ) {
          return createErrorResponse(
            "You can only update requests assigned to you",
            403
          );
        }
      }

      const updateSchema = maintenanceRequestSchema.partial();
      const validation = validateSchema(updateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const updateData = validation.data;

      if (user.isTenant) {
        const restrictedFields = [
          "assignedTo",
          "status",
          "estimatedCost",
          "actualCost",
          "scheduledDate",
          "completedDate",
        ] as const;

        restrictedFields.forEach((field) => {
          delete (updateData as Record<string, unknown>)[field];
        });
      }

      if (user.isManager && !user.isAdmin) {
        delete updateData.propertyId;
        delete updateData.tenantId;
        delete updateData.priority;
      }

      // Replaces the old pre-save hook check: assignees must hold a
      // maintenance-assignable role.
      if (updateData.assignedTo) {
        const assignedUser = await db.user.findFirst({
          where: { id: updateData.assignedTo },
        });
        if (!assignedUser) {
          return createErrorResponse("Assigned user not found", 404);
        }
        if (!(await isMaintenanceAssignableRole(assignedUser.role))) {
          return createErrorResponse(
            "User cannot be assigned maintenance requests",
            400
          );
        }
      }

      const { assignedTo, ...restUpdate } = updateData as Record<
        string,
        unknown
      > & { assignedTo?: string };

      const data: Prisma.MaintenanceRequestUpdateInput = {
        ...(restUpdate as Prisma.MaintenanceRequestUpdateInput),
      };
      if (assignedTo !== undefined) {
        (data as Record<string, unknown>).assignedToId = assignedTo;
      }

      const updated = await db.maintenanceRequest.update({
        where: { id },
        data,
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
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      });

      const entry = maintenanceEntry({ before: maintenanceRequest, after: updated });
      auditRecordChange({
        action: entry.action,
        recordType: "maintenance",
        recordId: id,
        recordName: maintenanceName(updated),
        before: entry.before,
        after: entry.after,
        keys: entry.keys,
        messageKey: entry.messageKey,
        messageParams: entry.messageParams,
      });

      const property = withAddress(updated.property as never);

      return createSuccessResponse(
        {
          ...updated,
          propertyId: property ?? updated.propertyId,
          tenantId: updated.tenant ?? updated.tenantId,
          assignedTo: updated.assignedTo ?? null,
          property,
          tenant: {
            user: updated.tenant || {},
          },
        },
        "Maintenance request updated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/maintenance/[id] - Delete a maintenance request (soft delete)
// ============================================================================

export const DELETE = withPermissionAndDB([
  // Its own right: assigning or working a request is not deleting it.
  "maintenance_delete",
  "maintenance_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid maintenance request ID", 400);
      }

      const maintenanceRequest = await db.maintenanceRequest.findFirst({
        where: { id, ...maintenanceScope(user) },
        include: WITH_ASSIGNEE,
      });
      if (!maintenanceRequest) {
        return createErrorResponse("Maintenance request not found", 404);
      }

      if (maintenanceRequest.status === MaintenanceStatus.COMPLETED) {
        return createErrorResponse(
          "Cannot delete completed maintenance request.",
          409
        );
      }

      await db.maintenanceRequest.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "maintenance",
        recordId: id,
        recordName: maintenanceName(maintenanceRequest),
        before: compact(maintenanceSnapshot(maintenanceRequest)),
      });

      return createSuccessResponse(
        { id: maintenanceRequest.id },
        "Maintenance request deleted successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/maintenance/[id] - Partial update (status change, assignment, etc.)
// ============================================================================

export const PATCH = withAccessAndDB(MAINTENANCE_WRITE_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid maintenance request ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const maintenanceRequest = await db.maintenanceRequest.findFirst({
        where: { id, ...maintenanceScope(user) },
        include: WITH_ASSIGNEE,
      });
      if (!maintenanceRequest) {
        return createErrorResponse("Maintenance request not found", 404);
      }

      // See lib/db/scopes.ts.
      if (!maintenanceAllows(user, maintenanceRequest)) {
        return createErrorResponse(
          "You can only modify your own maintenance requests",
          403
        );
      }

      const { action, ...data } = body;
      const update: Prisma.MaintenanceRequestUpdateInput = {};
      // The person an assignment hands the request to, for the entry.
      let assignee: { firstName: string | null; lastName: string | null } | null =
        null;

      switch (action) {
        case "assign": {
          if (user.isTenant) {
            return createErrorResponse(
              "Tenants cannot assign maintenance requests",
              403
            );
          }
          if (!data.assignedTo) {
            return createErrorResponse("Assigned user ID is required", 400);
          }

          const assignedUser = await db.user.findFirst({
            where: { id: data.assignedTo },
          });
          if (!assignedUser) {
            return createErrorResponse("Assigned user not found", 404);
          }

          // Replaces the old pre-save hook check: assignees must hold a
          // maintenance-assignable role.
          if (!(await isMaintenanceAssignableRole(assignedUser.role))) {
            return createErrorResponse(
              "User cannot be assigned maintenance requests",
              400
            );
          }

          (update as Record<string, unknown>).assignedToId = data.assignedTo;
          update.status = MaintenanceStatus.ASSIGNED;
          assignee = assignedUser;
          break;
        }

        case "startWork":
          if (user.isTenant) {
            return createErrorResponse(
              "Tenants cannot start work on maintenance requests",
              403
            );
          }
          update.status = MaintenanceStatus.IN_PROGRESS;
          break;

        case "complete":
          if (user.isTenant) {
            return createErrorResponse(
              "Tenants cannot complete maintenance requests",
              403
            );
          }
          update.status = MaintenanceStatus.COMPLETED;
          update.completedDate = new Date();
          if (data.actualCost) {
            update.actualCost = data.actualCost;
          }
          break;

        case "addNote": {
          if (!data.note) {
            return createErrorResponse("Note content is required", 400);
          }

          const currentNotes = maintenanceRequest.notes || "";
          const timestamp = new Date().toISOString();
          const userName = `${user.firstName || "User"} ${
            user.lastName || ""
          }`.trim();
          const newNote = `[${timestamp}] ${userName}: ${data.note}`;

          update.notes = currentNotes
            ? `${currentNotes}\n${newNote}`
            : newNote;
          break;
        }

        default:
          return createErrorResponse("Invalid action specified", 400);
      }

      const updated = await db.maintenanceRequest.update({
        where: { id },
        data: update,
      });

      if (action === "addNote") {
        // The words of the note alone, not the whole log it is appended to.
        void recordActivity({
          action: AuditAction.UPDATE,
          recordType: "maintenance",
          recordId: id,
          recordName: maintenanceName(updated),
          messageKey: "admin.audit.msg.maintenance_note_added",
          after: compact({ note: noteText(data.note) }),
        });
      } else {
        const entry = maintenanceEntry({
          before: maintenanceRequest,
          // The update returns the bare row: the assignee is the one the
          // action chose, else the one the request already had.
          after: {
            ...updated,
            assignedTo: assignee ?? maintenanceRequest.assignedTo,
          },
          assignment: action === "assign",
        });
        auditRecordChange({
          action: entry.action,
          recordType: "maintenance",
          recordId: id,
          recordName: maintenanceName(updated),
          before: entry.before,
          after: entry.after,
          keys: entry.keys,
          messageKey: entry.messageKey,
          messageParams: entry.messageParams,
        });
      }

      return createSuccessResponse(
        updated,
        `Maintenance request ${action} completed successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
