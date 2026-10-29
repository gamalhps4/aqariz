/**
 * PropertyPro - Individual User API Routes
 * Handle operations for specific users
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { PlanLimitError } from "@/lib/billing/entitlements";
import {
  enforceSeatLimitForRoleChange,
  roleConsumesSeat,
} from "@/lib/billing/seat-guard";
import {
  LeaseStatus,
  UserRole,
  MaintenanceStatus,
  WorkOrderStatus,
  TicketStatus,
} from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  isValidObjectId,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";
import {
  USER_DELETE_PERMISSIONS,
  USER_EDIT_PERMISSIONS,
  canManageRoles,
  canManageTargetRole,
  canManageTargetUser,
  canViewTargetUser,
} from "@/lib/permissions-manager";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { resolveManagedTarget } from "@/lib/staff-delegation";
import {
  USER_RESPONSE_SELECT,
  loadGroupNames,
  withRoleNames,
} from "@/lib/user-response";

/**
 * Fields a user_management caller may edit directly. Everything else — 2FA
 * flags, SSN (written only through its encrypted flow), Stripe/billing
 * identity, email verification, login/lockout counters — changes only
 * through its dedicated flow. (This used to accept EVERY User column via
 * UserScalarFieldEnum, so a manager could silently disable a target's 2FA,
 * write a plaintext SSN, or repoint stripeCustomerId.)
 */
const EDITABLE_USER_FIELDS = new Set<string>([
  "firstName",
  "lastName",
  "email",
  "phone",
  "avatar",
  "bio",
  "location",
  "city",
  "website",
  "address",
  "role",
  "isActive",
  "isLocked",
  "lockedUntil",
  "failedLoginAttempts", // set only by the lock flow above
  "dateOfBirth",
  "emergencyContacts",
  "tenantStatus",
  "applicationNotes",
  "preferredContactMethod",
  "notificationPreferences",
]);

// The columns returned live in lib/user-response.ts, shared with the list.

// ============================================================================
// GET /api/users/[id] - Get a specific user
// ============================================================================

export const GET = withPermissionAndDB(["user_view", "user_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      // Projected: the full row includes the SSN envelope, integrations
      // JSON, and Stripe identity — none of which belong in this response.
      const targetUser = await db.user.findFirst({
        where: { id },
        select: USER_RESPONSE_SELECT,
      });

      if (!targetUser) {
        return createErrorResponse("User not found", 404);
      }

      const targetAccess = await resolveAccessProfile(targetUser.role);
      if (
        !canViewTargetUser(user, targetAccess, {
          isSelf: targetUser.id === user.id,
        })
      ) {
        return createErrorResponse("Access denied", 403);
      }

      return createSuccessResponse(
        withRoleNames(targetUser, await loadGroupNames())
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/users/[id] - Update a specific user
// ============================================================================

export const PUT = withPermissionAndDB([...USER_EDIT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      const body = await request.json();
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        return createErrorResponse("Invalid request body", 400);
      }

      const hasLockChange = Object.prototype.hasOwnProperty.call(
        body,
        "isLocked"
      );

      const targetUser = await db.user.findFirst({ where: { id } });
      if (!targetUser) {
        return createErrorResponse("User not found", 404);
      }

      // Weighed with their own grants and buildings: below the Administrator
      // a member of staff is edited only by someone whose rights cover theirs.
      const isSelf = targetUser.id === user.id;
      const targetAccess = await resolveManagedTarget(targetUser);
      if (
        !canManageTargetUser(user, targetAccess, {
          isSelf,
          withinOwnRights: true,
        })
      ) {
        return createErrorResponse("Access denied", 403);
      }

      if (body.role && body.role !== targetUser.role) {
        // Moving yourself to another group is the Administrator's alone:
        // below it, nobody manages their own access.
        if (isSelf && !user.isAdmin) {
          return createErrorResponse(
            "You cannot change your own role. Ask an administrator.",
            403
          );
        }
        const targetRoleAccess = await resolveAccessProfile(body.role);
        if (!canManageRoles(user) || !canManageTargetRole(user, targetRoleAccess)) {
          return createErrorResponse("You cannot change user roles", 403);
        }

        // Promoting an unbilled account (tenant, property owner) into a staff
        // role consumes a seat, so it has to face the same plan limit the
        // create and invite paths do.
        if (
          roleConsumesSeat(body.role) &&
          !roleConsumesSeat(targetUser.role)
        ) {
          try {
            await enforceSeatLimitForRoleChange(user.organizationId!, 1);
          } catch (seatError) {
            if (seatError instanceof PlanLimitError) {
              return createErrorResponse(seatError.message, seatError.statusCode);
            }
            throw seatError;
          }
        }
      }

      if (hasLockChange) {
        if (typeof body.isLocked !== "boolean") {
          return createErrorResponse("Account lock state must be boolean", 400);
        }

        if (body.isLocked && id === user.id) {
          return createErrorResponse("You cannot block your own account", 400);
        }

        if (body.isLocked) {
          body.lockedUntil = body.lockedUntil
            ? new Date(body.lockedUntil)
            : null;
        } else {
          body.lockedUntil = null;
          body.failedLoginAttempts = 0;
        }
      } else {
        delete body.lockedUntil;
        delete body.failedLoginAttempts;
      }

      // Keep only explicitly editable columns — see EDITABLE_USER_FIELDS.
      const data: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(body)) {
        if (EDITABLE_USER_FIELDS.has(key)) {
          data[key] = value;
        }
      }

      // Derived columns previously maintained by Mongoose hooks
      if (data.firstName !== undefined || data.lastName !== undefined) {
        const first = (data.firstName ?? targetUser.firstName) as string;
        const last = (data.lastName ?? targetUser.lastName) as string;
        data.name = [first, last].filter(Boolean).join(" ");
      }

    const oldData = {
      firstName: targetUser.firstName,
      lastName: targetUser.lastName,
      email: targetUser.email,
      role: targetUser.role,
      phone: targetUser.phone,
      avatar: targetUser.avatar,
      isActive: targetUser.isActive,
      emailVerified: targetUser.emailVerified,
      failedLoginAttempts: targetUser.failedLoginAttempts ?? 0,
      isLocked: targetUser.isLocked,
      lockedUntil: targetUser.lockedUntil,
    };

    const updatedUser = await db.user.update({
      where: { id },
      data,
    });

    const newData = {
      firstName: updatedUser.firstName,
      lastName: updatedUser.lastName,
      email: updatedUser.email,
      role: updatedUser.role,
      phone: updatedUser.phone,
      avatar: updatedUser.avatar,
      isActive: updatedUser.isActive,
      emailVerified: updatedUser.emailVerified,
      failedLoginAttempts: updatedUser.failedLoginAttempts ?? 0,
      isLocked: updatedUser.isLocked,
      lockedUntil: updatedUser.lockedUntil,
    };

      const context = auditService.extractContextFromRequest(request, user);

    await auditService.logEvent(
      {
        category: AuditCategory.USER_MANAGEMENT,
        action: AuditAction.UPDATE,
        severity: AuditSeverity.LOW,
        description: `Updated user: ${updatedUser.firstName} ${updatedUser.lastName}`,
        resourceType: "user",
        resourceId: id,
        resourceName: `${updatedUser.firstName} ${updatedUser.lastName}`,
        oldValues: oldData,
        newValues: newData,
        tags: ["user", "update"],
      },
      context
    );

    if (hasLockChange) {
      const lockAction = updatedUser.isLocked ? "Blocked" : "Unblocked";

      await auditService.logEvent(
        {
          category: AuditCategory.SECURITY,
          action: AuditAction.UPDATE,
          severity: AuditSeverity.MEDIUM,
          description: `${lockAction} user account: ${updatedUser.firstName} ${updatedUser.lastName}`,
          resourceType: "user",
          resourceId: id,
          resourceName: `${updatedUser.firstName} ${updatedUser.lastName}`,
          oldValues: {
            failedLoginAttempts: targetUser.failedLoginAttempts ?? 0,
            isLocked: targetUser.isLocked,
            lockedUntil: targetUser.lockedUntil,
          },
          newValues: {
            failedLoginAttempts: updatedUser.failedLoginAttempts ?? 0,
            isLocked: updatedUser.isLocked,
            lockedUntil: updatedUser.lockedUntil,
          },
          tags: [
            "user",
            "account_lock",
            updatedUser.isLocked ? "block" : "unblock",
          ],
        },
        context
      );
    }

    if (body.role && body.role !== targetUser.role) {
      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.ROLE_ASSIGNED,
          severity: AuditSeverity.MEDIUM,
          description: `Changed role for ${updatedUser.firstName} ${updatedUser.lastName}`,
          resourceType: "user",
          resourceId: id,
          resourceName: `${updatedUser.firstName} ${updatedUser.lastName}`,
          details: { oldRole: targetUser.role, newRole: body.role },
          tags: ["user", "role"],
        },
        context
      );
    }

      return createSuccessResponse(updatedUser, "User updated successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/users/[id] - Deactivate a specific user
// ============================================================================

export const DELETE = withPermissionAndDB([...USER_DELETE_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      // When `permanent=true`, the user is soft-deleted (removed from listings)
      // rather than just deactivated. References are preserved for data integrity.
      const permanent =
        request.nextUrl.searchParams.get("permanent") === "true";
      const verb = permanent ? "delete" : "deactivate";

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      if (id === user.id) {
        return createErrorResponse(`You cannot ${verb} yourself`, 400);
      }

      const targetUser = await db.user.findFirst({
        where: { id },
        select: {
          id: true,
          role: true,
          firstName: true,
          lastName: true,
          permissionGrants: true,
          permissionDenials: true,
          scopeRestricted: true,
          scopedCompoundIds: true,
          scopedPropertyIds: true,
        },
      });
      if (!targetUser) {
        return createErrorResponse("User not found", 404);
      }

      const targetAccess = await resolveManagedTarget(targetUser);
      if (
        !canManageTargetUser(user, targetAccess, { withinOwnRights: true })
      ) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      if (targetUser.role === UserRole.TENANT) {
        const activeLease = await db.lease.count({
          where: {
            tenantId: id,
            status: LeaseStatus.ACTIVE,
            deletedAt: null,
          },
        });

        if (activeLease > 0) {
          return createErrorResponse(
            `Cannot ${verb} tenant with an active lease. Please terminate the lease first.`,
            409
          );
        }
      }

      // Permanent deletion: block while the user is still assigned to anything.
      // The admin must unassign these first to keep records consistent.
      if (permanent) {
        const activeMaintenanceStatuses = [
          MaintenanceStatus.SUBMITTED,
          MaintenanceStatus.ASSIGNED,
          MaintenanceStatus.IN_PROGRESS,
        ];
        const activeWorkOrderStatuses = [
          WorkOrderStatus.PENDING,
          WorkOrderStatus.ASSIGNED,
          WorkOrderStatus.IN_PROGRESS,
        ];
        const openTicketStatuses = [TicketStatus.OPEN, TicketStatus.IN_PROGRESS];

        const [
          ownedProperties,
          managedProperties,
          maintenanceCount,
          workOrderCount,
          ticketCount,
        ] = await Promise.all([
          db.property.count({ where: { ownerId: id, deletedAt: null } }),
          db.property.count({ where: { managerId: id, deletedAt: null } }),
          db.maintenanceRequest.count({
            where: {
              assignedToId: id,
              status: { in: activeMaintenanceStatuses },
            },
          }),
          db.workOrder.count({
            where: {
              assignedToId: id,
              status: { in: activeWorkOrderStatuses },
              deletedAt: null,
            },
          }),
          db.ticket.count({
            where: {
              assignedToId: id,
              status: { in: openTicketStatuses },
            },
          }),
        ]);

        const plural = (n: number, singular: string) =>
          `${n} ${singular}${n === 1 ? "" : "s"}`;

        const blockers: string[] = [];
        const propertyCount = ownedProperties + managedProperties;
        if (propertyCount > 0)
          blockers.push(
            `${propertyCount} ${propertyCount === 1 ? "property" : "properties"}`
          );
        if (maintenanceCount > 0)
          blockers.push(plural(maintenanceCount, "active maintenance request"));
        if (workOrderCount > 0)
          blockers.push(plural(workOrderCount, "open work order"));
        if (ticketCount > 0) blockers.push(plural(ticketCount, "open ticket"));

        if (blockers.length > 0) {
          return createErrorResponse(
            `This user is still assigned to ${blockers.join(
              ", "
            )}. Please unassign them first, then try to delete.`,
            409
          );
        }
      }

      const context = auditService.extractContextFromRequest(request, user);

      const updatedUser = await db.user.update({
        where: { id },
        data: permanent
          ? { isActive: false, deletedAt: new Date() }
          : { isActive: false },
      });

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.DELETE,
          severity: AuditSeverity.HIGH,
          description: `${permanent ? "Deleted" : "Deactivated"} user: ${updatedUser.firstName} ${updatedUser.lastName}`,
          resourceType: "user",
          resourceId: id,
          resourceName: `${updatedUser.firstName} ${updatedUser.lastName}`,
          oldValues: { isActive: true, deletedAt: null },
          newValues: permanent
            ? { isActive: false, deletedAt: updatedUser.deletedAt }
            : { isActive: false },
          tags: ["user", verb],
        },
        context
      );

      return createSuccessResponse(
        updatedUser,
        permanent ? "User deleted successfully" : "User deactivated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
