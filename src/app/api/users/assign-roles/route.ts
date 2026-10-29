/**
 * PropertyPro - User Role Assignment API Routes
 * Bulk role assignment with validation and audit logging
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { canManageTargetUser } from "@/lib/permissions-manager";
import { checkRoleAssignment } from "@/lib/role-assignment";
import { PlanLimitError } from "@/lib/billing/entitlements";
import {
  enforceSeatLimitForRoleChange,
  roleConsumesSeat,
} from "@/lib/billing/seat-guard";
import {
  MANAGED_TARGET_SELECT,
  resolveManagedTarget,
} from "@/lib/staff-delegation";
import { z } from "zod";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const assignRolesSchema = z.object({
  userIds: z
    .array(z.string())
    .min(1, "At least one user ID is required")
    .max(100, "Cannot assign roles to more than 100 users at once"),
  targetRole: z.string().min(1, "Target role is required"),
  reason: z.string().max(500, "Reason cannot exceed 500 characters").optional(),
  notifyUsers: z.boolean().default(false),
});

/** Whether `actor` may not move this person into another role. */
function isRefused(
  actor: AuthenticatedAccessUser,
  targetId: string,
  target: Awaited<ReturnType<typeof resolveManagedTarget>>
): boolean {
  const isSelf = targetId === actor.id;
  if (isSelf && !actor.isAdmin) return true;
  return !canManageTargetUser(actor, target, {
    isSelf,
    withinOwnRights: true,
  });
}

// ============================================================================
// POST /api/users/assign-roles - Bulk assign roles to users
// ============================================================================

export const POST = withPermissionAndDB("role_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = assignRolesSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation failed: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const { userIds, targetRole, reason, notifyUsers } = validation.data;

      // Validate user IDs
      const invalidUserIds = userIds.filter((id) => !isValidObjectId(id));
      if (invalidUserIds.length > 0) {
        return createErrorResponse(
          `Invalid user IDs: ${invalidUserIds.join(", ")}`,
          400
        );
      }

      // One rule for every path that hands out a role — see role-assignment.ts.
      // It rejects the platform role outright and resolves custom roles inside
      // the caller's organization.
      const decision = await checkRoleAssignment(user, targetRole);
      if (decision.error) {
        return createErrorResponse(decision.error, decision.status);
      }

      // Get users to be updated
      const usersToUpdate = await db.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          ...MANAGED_TARGET_SELECT,
        },
      });

      if (usersToUpdate.length === 0) {
        return createErrorResponse("No valid users found", 404);
      }

      if (usersToUpdate.length !== userIds.length) {
        const foundIds = usersToUpdate.map((u) => u.id);
        const notFoundIds = userIds.filter((id) => !foundIds.includes(id));
        return createErrorResponse(
          `Users not found: ${notFoundIds.join(", ")}`,
          404
        );
      }

      // Each person weighed with their own grants and buildings: below the
      // Administrator, a member of staff is moved into a group only by
      // someone whose rights cover theirs — and nobody below it moves
      // themselves.
      const targetUserAccessEntries = await Promise.all(
        usersToUpdate.map(async (targetUser) => ({
          targetUser,
          accessProfile: await resolveManagedTarget(targetUser),
        }))
      );

      const blockedTarget = targetUserAccessEntries.find(
        ({ targetUser, accessProfile }) =>
          isRefused(user, targetUser.id, accessProfile)
      );

      if (blockedTarget) {
        return createErrorResponse(
          "You do not have permission to change one or more selected users",
          403
        );
      }

      // Seats: this endpoint moves up to 100 accounts at once, so promoting a
      // batch of tenants into staff roles was the widest way past the plan's
      // seat limit. Counted across the whole batch, before any write.
      const promotions = usersToUpdate.filter(
        (targetUser) =>
          roleConsumesSeat(targetRole) && !roleConsumesSeat(targetUser.role),
      ).length;
      try {
        await enforceSeatLimitForRoleChange(user.organizationId!, promotions);
      } catch (seatError) {
        if (seatError instanceof PlanLimitError) {
          return createErrorResponse(seatError.message, seatError.statusCode);
        }
        throw seatError;
      }

      // Track role changes for audit
      const roleChanges = usersToUpdate.map((u) => ({
        userId: u.id,
        userEmail: u.email,
        userName: `${u.firstName} ${u.lastName}`,
        previousRole: u.role,
        newRole: targetRole,
        changedBy: user.id,
        changedAt: new Date(),
        reason: reason || "Bulk role assignment",
      }));

      // Update user roles. (Role user counts are computed live from the users
      // table now, so there is no per-role counter to maintain.)
      const updateResult = await db.user.updateMany({
        where: { id: { in: userIds }, isActive: true },
        data: { role: targetRole },
      });
      const matchedCount = updateResult.count;
      const modifiedCount = updateResult.count;

      // One entry for the assignment: each person's role before, the role
      // after, and the reason given.
      void recordActivity({
        action: AuditAction.ROLE_ASSIGNED,
        recordType: "user",
        recordId: roleChanges.length === 1 ? roleChanges[0].userId : null,
        recordName:
          roleChanges.length === 1
            ? roleChanges[0].userName
            : roleChanges.map((change) => change.userName).slice(0, 5).join(", "),
        before: {
          rows: roleChanges.map((change) => ({
            id: change.userEmail ?? change.userId,
            role: change.previousRole,
          })),
        },
        after: { role: targetRole },
        details: { users: roleChanges.length, ...(reason ? { reason } : {}) },
      });

      // TODO: Send notifications if requested
      if (notifyUsers) {

        // Implement email notifications here
      }

      // Prepare response with detailed information
      const response = {
        matchedCount,
        modifiedCount,
        targetRole,
        affectedUsers: roleChanges.map((change) => ({
          userId: change.userId,
          userName: change.userName,
          email: change.userEmail,
          previousRole: change.previousRole,
          newRole: change.newRole,
        })),
        summary: {
          totalUsers: userIds.length,
          successfulUpdates: modifiedCount,
          failedUpdates: userIds.length - modifiedCount,
        },
      };

      return createSuccessResponse(
        response,
        `Successfully assigned ${modifiedCount} users to ${targetRole} role`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// GET /api/users/assign-roles/preview - Preview role assignment changes
// ============================================================================

export const GET = withPermissionAndDB("role_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const userIdsParam = searchParams.get("userIds");
      const targetRole = searchParams.get("targetRole");

      if (!userIdsParam || !targetRole) {
        return createErrorResponse(
          "userIds and targetRole parameters are required",
          400
        );
      }

      const userIds = userIdsParam.split(",").filter((id) => id.trim());

      if (userIds.length === 0) {
        return createErrorResponse("At least one user ID is required", 400);
      }

      // Validate user IDs
      const invalidUserIds = userIds.filter((id) => !isValidObjectId(id));
      if (invalidUserIds.length > 0) {
        return createErrorResponse(
          `Invalid user IDs: ${invalidUserIds.join(", ")}`,
          400
        );
      }

      // Same gate as the POST above: a preview must never describe an
      // assignment the caller could not actually perform.
      const decision = await checkRoleAssignment(user, targetRole);
      if (decision.error) {
        return createErrorResponse(decision.error, decision.status);
      }
      const customRole = decision.customRole ?? null;

      // Get users and their current roles
      const users = await db.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          ...MANAGED_TARGET_SELECT,
        },
      });

      const targetUserAccessEntries = await Promise.all(
        users.map(async (targetUser) => ({
          targetUser,
          accessProfile: await resolveManagedTarget(targetUser),
        }))
      );

      const blockedTarget = targetUserAccessEntries.find(
        ({ targetUser, accessProfile }) =>
          isRefused(user, targetUser.id, accessProfile)
      );

      if (blockedTarget) {
        return createErrorResponse(
          "You do not have permission to change one or more selected users",
          403
        );
      }

      const preview = users.map((u) => ({
        userId: u.id,
        userName: `${u.firstName} ${u.lastName}`,
        email: u.email,
        currentRole: u.role,
        newRole: targetRole,
        willChange: u.role !== targetRole,
      }));

      const summary = {
        totalUsers: users.length,
        usersToChange: preview.filter((p) => p.willChange).length,
        usersAlreadyInRole: preview.filter((p) => !p.willChange).length,
        notFoundUsers: userIds.length - users.length,
      };

      return createSuccessResponse({
        preview,
        summary,
        targetRole,
        roleInfo: customRole
          ? {
              name: customRole.name,
              label: customRole.label,
              description: customRole.description,
              isCustomRole: true,
            }
          : {
              name: targetRole,
              label: targetRole.charAt(0).toUpperCase() + targetRole.slice(1),
              description: `System role: ${targetRole}`,
              isCustomRole: false,
            },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
