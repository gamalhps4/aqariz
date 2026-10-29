/**
 * PropertyPro - Maintenance Request Status Update API
 * Handle status changes for maintenance requests with role-based permissions
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
} from "@/lib/api-utils";
import { hasAnyPermission } from "@/lib/role-utils";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { auditRecordChange } from "@/lib/audit-domain";
import {
  maintenanceEntry,
  maintenanceName,
} from "@/lib/audit/records/maintenance";

const MAINTENANCE_STATUS_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "maintenance_view",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const MAINTENANCE_STATUS_WRITE_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: ["maintenance_management", "maintenance_assign", "work_orders"],
  match: "any" as const,
};

const MAINTENANCE_HANDLER_PERMISSIONS = [
  "maintenance_management",
  "maintenance_assign",
  "work_orders",
];

function canHandleMaintenance(profile: { isCompanyStaff: boolean; permissions: string[] }) {
  return (
    profile.isCompanyStaff &&
    hasAnyPermission(profile.permissions, MAINTENANCE_HANDLER_PERMISSIONS)
  );
}

const PROPERTY_NAME_ADDRESS_SELECT = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

const TENANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatar: true,
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

// ============================================================================
// PATCH /api/maintenance/[id]/status - Update maintenance request status
// ============================================================================

export const PATCH = withAccessAndDB(MAINTENANCE_STATUS_WRITE_ACCESS)(
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

      const { action, assignedTo, actualCost, notes } = body;

      if (!action) {
        return createErrorResponse("Action is required", 400);
      }

      const maintenanceRequest = await db.maintenanceRequest.findFirst({
        where: { id, ...maintenanceScope(user) },
        // The person it is assigned to, so the entry can name them.
        include: { assignedTo: { select: { firstName: true, lastName: true } } },
      });

      if (!maintenanceRequest) {
        return createErrorResponse("Maintenance request not found", 404);
      }

      const canManage =
        user.isCompanyStaff &&
        hasAnyPermission(user.permissions, [
          "maintenance_management",
          "maintenance_assign",
        ]);
      const canWork = canHandleMaintenance(user);
      const isAssignedToUser = maintenanceRequest.assignedToId === user.id;
      const isRequestOwner =
        user.isTenant && maintenanceRequest.tenantId === user.id;

      const oldStatus = maintenanceRequest.status;
      const update: Prisma.MaintenanceRequestUpdateInput = {};
      // The person an assignment hands the request to, for the entry.
      let assignee: { firstName: string | null; lastName: string | null } | null =
        null;

      switch (action) {
        case "assign":
        case "reassign":
          if (!canManage) {
            return createErrorResponse(
              "Only authorized staff can assign maintenance requests",
              403
            );
          }
          if (!assignedTo) {
            return createErrorResponse("Assigned user ID is required", 400);
          }
          if (!isValidObjectId(assignedTo)) {
            return createErrorResponse("Invalid assigned user ID", 400);
          }

          const assignedUser = await db.user.findFirst({
            where: { id: assignedTo },
          });
          if (!assignedUser || !assignedUser.isActive) {
            return createErrorResponse("Assigned user not found", 404);
          }

          const assignedUserAccess = await resolveAccessProfile(assignedUser.role);
          if (!canHandleMaintenance(assignedUserAccess)) {
            return createErrorResponse(
              "Can only assign to active maintenance staff",
              400
            );
          }

          (update as Record<string, unknown>).assignedToId = assignedTo;
          update.status = MaintenanceStatus.ASSIGNED;
          assignee = assignedUser;
          break;

        case "start":
          if (!canWork || (!isAssignedToUser && !canManage)) {
            return createErrorResponse(
              "You can only start work on requests assigned to you",
              403
            );
          }
          if (maintenanceRequest.status !== MaintenanceStatus.ASSIGNED) {
            return createErrorResponse(
              "Can only start work on assigned requests",
              400
            );
          }
          update.status = MaintenanceStatus.IN_PROGRESS;
          break;

        case "complete":
          if (!canWork || (!isAssignedToUser && !canManage)) {
            return createErrorResponse(
              "You can only complete requests assigned to you",
              403
            );
          }
          if (maintenanceRequest.status !== MaintenanceStatus.IN_PROGRESS) {
            return createErrorResponse(
              "Can only complete requests that are in progress",
              400
            );
          }
          update.status = MaintenanceStatus.COMPLETED;
          update.completedDate = new Date();

          if (actualCost !== undefined) {
            const cost = parseFloat(actualCost);
            if (isNaN(cost) || cost < 0) {
              return createErrorResponse("Invalid actual cost", 400);
            }
            update.actualCost = cost;
          }

          if (notes) {
            const timestamp = new Date().toISOString();
            const userName = `${user.firstName || "User"} ${
              user.lastName || ""
            }`.trim();
            const completionNote = `[${timestamp}] ${userName} (Completion): ${notes}`;

            update.notes = maintenanceRequest.notes
              ? `${maintenanceRequest.notes}\n${completionNote}`
              : completionNote;
          }
          break;

        case "cancel":
          if (!canManage && !isRequestOwner) {
            return createErrorResponse(
              "Only authorized staff or request owners can cancel requests",
              403
            );
          }
          if (maintenanceRequest.status === MaintenanceStatus.COMPLETED) {
            return createErrorResponse("Cannot cancel completed requests", 400);
          }
          update.status = MaintenanceStatus.CANCELLED;
          break;

        default:
          return createErrorResponse("Invalid action specified", 400);
      }

      const saved = await db.maintenanceRequest.update({
        where: { id },
        data: update,
      });
      // The tenant hears by SMS/WhatsApp where the office sends that
      // (Settings → Messaging) — not when the tenant made the change.
      if (saved.status !== oldStatus && user.role !== UserRole.TENANT) {
        void import("@/lib/messaging/events").then(
          ({ notifyMaintenanceStatus }) =>
            notifyMaintenanceStatus(saved.id, saved.status),
        );
      }

      let syncWarning: string | null = null;
      if (saved.propertyId && saved.unitId) {
        try {
          const { propertyStatusSynchronizer } = await import(
            "@/lib/services/property-status-sync.service"
          );

          await propertyStatusSynchronizer.syncAfterMaintenanceStatusChange(
            saved.propertyId,
            saved.id,
            saved.unitId,
            oldStatus,
            saved.status,
            {
              triggeredBy: `maintenance-api:${user.id}`,
              logChanges: true,
            }
          );
        } catch (syncError) {
          syncWarning =
            syncError instanceof Error
              ? syncError.message
              : "Property status synchronization failed";
        }
      }

      const updatedRequest = await db.maintenanceRequest.findFirst({
        where: { id, ...maintenanceScope(user) },
        include: {
          property: { select: { ...PROPERTY_NAME_ADDRESS_SELECT, type: true } },
          tenant: { select: TENANT_SELECT },
          assignedTo: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
      });

      // Assigning, starting, completing and cancelling are each one move of
      // the request: its status from → to, and who has it.
      const entry = maintenanceEntry({
        before: maintenanceRequest,
        after: updatedRequest ?? {
          ...saved,
          assignedTo: assignee ?? maintenanceRequest.assignedTo,
        },
        assignment: action === "assign" || action === "reassign",
      });
      auditRecordChange({
        action: entry.action,
        recordType: "maintenance",
        recordId: id,
        recordName: maintenanceName(saved),
        before: entry.before,
        after: entry.after,
        keys: entry.keys,
        messageKey: entry.messageKey,
        messageParams: entry.messageParams,
      });

      return createSuccessResponse(
        {
          data: updatedRequest ? toPopulatedShape(updatedRequest) : null,
          warning: syncWarning || undefined,
        },
        `Maintenance request ${action} completed successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// GET /api/maintenance/[id]/status - Get status history (future enhancement)
// ============================================================================

export const GET = withAccessAndDB(MAINTENANCE_STATUS_READ_ACCESS)(
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
          assignedTo: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
          tenant: { select: TENANT_SELECT },
          property: { select: PROPERTY_NAME_ADDRESS_SELECT },
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

      const assignedToName =
        `${maintenanceRequest.assignedTo?.firstName || ""} ${
          maintenanceRequest.assignedTo?.lastName || ""
        }`.trim() || "Unknown";

      const statusHistory = [
        {
          status: MaintenanceStatus.SUBMITTED,
          timestamp: maintenanceRequest.createdAt,
          user: "System",
          action: "Request submitted",
        },
      ];

      if (maintenanceRequest.assignedTo) {
        statusHistory.push({
          status: MaintenanceStatus.ASSIGNED,
          timestamp: maintenanceRequest.updatedAt,
          user: assignedToName,
          action: "Request assigned",
        });
      }

      if (maintenanceRequest.status === MaintenanceStatus.IN_PROGRESS) {
        statusHistory.push({
          status: MaintenanceStatus.IN_PROGRESS,
          timestamp: maintenanceRequest.updatedAt,
          user: assignedToName,
          action: "Work started",
        });
      }

      if (
        maintenanceRequest.status === MaintenanceStatus.COMPLETED &&
        maintenanceRequest.completedDate
      ) {
        statusHistory.push({
          status: MaintenanceStatus.COMPLETED,
          timestamp: maintenanceRequest.completedDate,
          user: assignedToName,
          action: "Work completed",
        });
      }

      if (maintenanceRequest.status === MaintenanceStatus.CANCELLED) {
        statusHistory.push({
          status: MaintenanceStatus.CANCELLED,
          timestamp: maintenanceRequest.updatedAt,
          user: "System",
          action: "Request cancelled",
        });
      }

      return createSuccessResponse({
        request: toPopulatedShape(maintenanceRequest),
        statusHistory,
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
