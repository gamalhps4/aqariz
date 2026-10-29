/**
 * PropertyPro - Tenant Status Management API
 * Dedicated endpoints for tenant status workflow management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { findTenantInScope } from "@/lib/db/tenant-scope";
import type { ScopeActor } from "@/lib/db/scopes";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { resolveAccessProfile } from "@/lib/server-permissions";
import {
  changeTenantStatus,
  getAvailableTenantTransitions,
  populateStatusHistory,
  tenantDisplayStatus,
  tenantStatusColor,
} from "@/lib/tenant-status";

/**
 * The tenant, if this caller may reach them (lib/db/tenant-scope.ts). The
 * change of status used to find any tenant in the organization; the reading
 * of it asked `tenantRecordAllows`, which refuses every employee narrowed to
 * some buildings, their own included.
 */
async function findTenantStatusUser(actor: ScopeActor, id: string) {
  const tenant = await findTenantInScope(actor, id, {});

  if (!tenant) {
    return null;
  }

  const tenantAccess = await resolveAccessProfile(tenant.role);
  if (!tenantAccess.isTenant) {
    return null;
  }

  return tenant;
}

/** Populate statusHistory.changedBy and the current lease (was Mongoose populate). */
async function buildStatusRelations(tenant: {
  statusHistory: unknown;
  currentLeaseId: string | null;
}) {
  const statusHistory = await populateStatusHistory(
    (tenant.statusHistory as unknown[]) ?? []
  );

  const currentLease = tenant.currentLeaseId
    ? await db.lease.findFirst({
        where: { id: tenant.currentLeaseId },
        select: {
          id: true,
          propertyId: true,
          startDate: true,
          endDate: true,
          status: true,
        },
      })
    : null;

  return { statusHistory, currentLease };
}

// ============================================================================
// GET /api/tenants/[id]/status - Get tenant status history and current status
// ============================================================================

// The module's umbrella right as well as the narrow one, as on every other
// tenant route: a group given "Tenants: manage" was refused its own tenants'
// status here.
export const GET = withAccessAndDB({
  roles: [UserRole.TENANT],
  permissions: ["tenant_view", "tenant_management"],
  match: "any",
})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid tenant ID", 400);
      }

      // Find the tenant user, within the caller's reach
      const tenant = await findTenantStatusUser(user, id);

      if (!tenant) {
        return createErrorResponse("Tenant not found", 404);
      }

      const { statusHistory, currentLease } = await buildStatusRelations(
        tenant
      );

      const statusInfo = {
        currentStatus: tenant.tenantStatus,
        displayStatus: tenantDisplayStatus(tenant),
        statusColor: tenantStatusColor(tenant),
        lastStatusUpdate: tenant.lastStatusUpdate,
        backgroundCheckStatus: tenant.backgroundCheckStatus,
        backgroundCheckCompletedAt: tenant.backgroundCheckCompletedAt,
        applicationDate: tenant.applicationDate,
        moveInDate: tenant.moveInDate,
        moveOutDate: tenant.moveOutDate,
        currentLease,
        statusHistory: statusHistory || [],
        availableTransitions: getAvailableTenantTransitions(
          tenant.tenantStatus
        ),
      };

      return createSuccessResponse(
        statusInfo,
        "Tenant status retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/tenants/[id]/status - Change tenant status with validation
// ============================================================================

export const POST = withPermissionAndDB(["tenant_edit", "tenant_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid tenant ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { newStatus, reason, notes, moveDate } = body;

      if (!newStatus) {
        return createErrorResponse("New status is required", 400);
      }

      // Provide default reason if not provided
      const statusReason = reason?.trim() || "Status updated by admin";

      // Validate move date for specific statuses
      if ((newStatus === "active" || newStatus === "moved_out") && !moveDate) {
        return createErrorResponse(
          `${
            newStatus === "active" ? "Move-in" : "Move-out"
          } date is required for ${newStatus} status`,
          400
        );
      }

      // Find the tenant user, within the caller's reach
      const tenant = await findTenantStatusUser(user, id);
      if (!tenant) {
        return createErrorResponse("Tenant not found", 404);
      }

      // Validate the status transition
      const availableTransitions = getAvailableTenantTransitions(
        tenant.tenantStatus
      );
      if (!availableTransitions.includes(newStatus)) {
        return createErrorResponse(
          `Invalid status transition from ${
            tenant.tenantStatus
          } to ${newStatus}. Available transitions: ${availableTransitions.join(
            ", "
          )}`,
          400
        );
      }

      // Change the status (validates the transition, appends to
      // statusHistory, applies background-check/move-date side effects)
      await changeTenantStatus(tenant, {
        newStatus,
        changedBy: user.id,
        reason: statusReason,
        notes,
        moveDate: moveDate ? new Date(moveDate) : undefined,
      });

      // Get updated tenant with populated fields
      const updatedTenant = await db.user.findFirst({ where: { id } });
      if (!updatedTenant) {
        return createErrorResponse("Tenant not found", 404);
      }

      const { statusHistory } = await buildStatusRelations(updatedTenant);

      const statusInfo = {
        currentStatus: updatedTenant.tenantStatus,
        displayStatus: tenantDisplayStatus(updatedTenant),
        statusColor: tenantStatusColor(updatedTenant),
        lastStatusUpdate: updatedTenant.lastStatusUpdate,
        backgroundCheckStatus: updatedTenant.backgroundCheckStatus,
        backgroundCheckCompletedAt: updatedTenant.backgroundCheckCompletedAt,
        statusHistory: statusHistory || [],
        availableTransitions: getAvailableTenantTransitions(
          updatedTenant.tenantStatus
        ),
      };

      return createSuccessResponse(
        statusInfo,
        `Tenant status changed to ${newStatus} successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
