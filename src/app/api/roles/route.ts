/**
 * PropertyPro - Role Management API Routes
 * CRUD operations for custom roles and permissions
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Role } from "@/generated/prisma/client";
import { IRoleConfig } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  createPaginationInfo,
  parseRequestBody,
  isValidObjectId,
  withAccessAndDB,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  canManageRoles as canManageRolesPermission,
  canManageTargetRole,
  canManageTargetUser,
  createAccessProfile,
  normalizeRoleName,
} from "@/lib/permissions-manager";
import { checkRoleAssignment } from "@/lib/role-assignment";
import {
  ROLE_LABEL_ERRORS,
  roleLabelProblem,
  roleListFilter,
  roleNameFromLabel,
  toRoleConfig,
  uniqueRoleName,
} from "@/lib/role-names";
import { clearRolePermissionCache } from "@/lib/server-permissions";
import {
  MANAGED_TARGET_SELECT,
  resolveManagedTarget,
} from "@/lib/staff-delegation";
import { PlanLimitError } from "@/lib/billing/entitlements";
import {
  enforceSeatLimitForRoleChange,
  roleConsumesSeat,
} from "@/lib/billing/seat-guard";
import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";
import { z } from "zod";
import { AuditAction, pickSnapshot, recordActivity } from "@/lib/audit-domain";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

// No `name`: the key a group is stored under is made from its label on the
// server (lib/role-names.ts), so the label can be in any language.
const createRoleSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Role label is required")
    .max(100, "Role label cannot exceed 100 characters"),
  // The name an Arabic screen shows. Left empty, the group goes by its label
  // in every language.
  labelAr: z
    .string()
    .trim()
    .max(100, "The Arabic name cannot exceed 100 characters")
    .nullish()
    .transform((value) => value || null),
  // Optional, as on the client's page: a group's name and its ticks say what
  // it is, and a required description only collected filler.
  description: z
    .string()
    .trim()
    .max(500, "Role description cannot exceed 500 characters")
    .nullish()
    .transform((value) => value ?? ""),
  permissions: z
    .array(z.enum(SYSTEM_PERMISSIONS))
    .min(1, "At least one permission is required"),
  color: z
    .enum(["default", "destructive", "outline", "secondary"])
    .default("outline"),
  isActive: z.boolean().default(true),
});

/** How many times a create is retried when another request takes its name. */
const NAME_ATTEMPTS = 3;

// ============================================================================
// GET /api/roles - List all roles
// ============================================================================

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const currentRole = normalizeRoleName(user.originalRole);
      if (!currentRole) {
        return createErrorResponse("Invalid session", 401);
      }

      const canManageRoles = canManageRolesPermission(user);

      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = parseInt(searchParams.get("limit") || "50");
      const includeSystem = searchParams.get("includeSystem") === "true";
      const includeInactive = searchParams.get("includeInactive") === "true";
      const search = searchParams.get("search") || "";

      // `name` is the exact lookup, `search` the role screen's free text —
      // see roleListFilter for why the two must not be the same question.
      const where = roleListFilter(
        { canManageRoles, roleName: currentRole },
        {
          name: searchParams.get("name"),
          search,
          includeSystem,
          includeInactive,
        }
      );
      if (!where) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const effectivePage = canManageRoles ? page : 1;
      const effectiveLimit = canManageRoles ? limit : 1;
      const skip = (effectivePage - 1) * effectiveLimit;

      const [roles, total] = await Promise.all([
        db.role.findMany({
          where,
          orderBy: [{ isSystem: "desc" }, { createdAt: "desc" }],
          skip,
          take: effectiveLimit,
        }),
        db.role.count({ where }),
      ]);

      const roleNames = roles.map((role) => role.name);
      const userCounts = await db.user.groupBy({
        by: ["role"],
        where: { role: { in: roleNames }, isActive: true },
        _count: { _all: true },
      });

      const userCountMap = userCounts.reduce((acc, item) => {
        acc[item.role] = item._count._all;
        return acc;
      }, {} as Record<string, number>);

      // Whether each can be changed is the caller's to know: below the
      // Administrator a group changes only groups within its own rights.
      const transformedRoles: IRoleConfig[] = roles.map((role) =>
        toRoleConfig(role, userCountMap[role.name] || 0, user)
      );

      // No synthetic roles. An organization's roles are the three seeded by
      // provision-organization.ts plus whatever it defines itself; inventing a
      // `super_admin` card here put a platform role on every organization's
      // screen, and — because super_admin used to alias onto admin — it
      // overwrote the org's real Administrator entry on the way past.

      const pagination = createPaginationInfo(effectivePage, effectiveLimit, total);

      return createSuccessResponse({
        roles: transformedRoles,
        pagination,
        total,
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/roles - Create a new role
// ============================================================================

export const POST = withPermissionAndDB("role_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = createRoleSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation failed: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const roleData = validation.data;
      const baseName = roleNameFromLabel(roleData.label);

      // A stored group is a group whatever it is called, so its name plays no
      // part in what the caller must be allowed to do to create it.
      const targetRoleProfile = createAccessProfile(
        baseName,
        roleData.permissions,
        null,
        { storedGroup: "active" }
      );
      if (!canManageTargetRole(user, targetRoleProfile)) {
        return createErrorResponse(
          "You do not have permission to create a role with these permissions",
          403
        );
      }

      let savedRole: Role | null = null;
      for (let attempt = 0; attempt < NAME_ATTEMPTS && !savedRole; attempt += 1) {
        // Every role the organization has had. The names still in use, in
        // both languages, are what the new one must not repeat; the keys —
        // archived groups' included — are what its own must not be.
        const existingRoles = await db.role.findMany({
          select: { name: true, label: true, labelAr: true, deletedAt: true },
        });

        const labelProblem = roleLabelProblem(
          { label: roleData.label, labelAr: roleData.labelAr },
          existingRoles.filter((role) => !role.deletedAt)
        );
        if (labelProblem) {
          const { message, code } = ROLE_LABEL_ERRORS[labelProblem];
          return createErrorResponse(message, 409, undefined, code);
        }

        try {
          savedRole = await db.role.create({
            data: {
              ...roleData,
              name: uniqueRoleName(
                baseName,
                new Set(existingRoles.map((role) => role.name))
              ),
              organizationId: user.organizationId!,
              createdById: user.id,
              updatedById: user.id,
            },
          });
        } catch (saveError) {
          // Partial unique index on (org, name) among non-deleted roles:
          // another request took the name between the read above and this
          // write. Read again and take the next one.
          if ((saveError as { code?: string } | null)?.code !== "P2002") {
            throw saveError;
          }
        }
      }

      if (!savedRole) {
        return createErrorResponse(
          "The role could not be saved. Please try again.",
          409
        );
      }

      const roleResponse: IRoleConfig = toRoleConfig(savedRole, 0, user);

      clearRolePermissionCache(savedRole.name);

      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "role",
        recordId: savedRole.id,
        recordName: savedRole.label,
        after: pickSnapshot(savedRole as unknown as Record<string, unknown>, [
          "label",
          "labelAr",
          "description",
          "permissions",
          "isActive",
        ]),
      });

      return createSuccessResponse(
        { role: roleResponse },
        "Role created successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/roles - Bulk update roles (for role assignment)
// ============================================================================

export const PUT = withPermissionAndDB("role_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { userIds, targetRole } = body;

      if (
        !userIds ||
        !Array.isArray(userIds) ||
        userIds.length === 0 ||
        userIds.some((id) => typeof id !== "string")
      ) {
        return createErrorResponse("User IDs are required", 400);
      }

      if (!targetRole) {
        return createErrorResponse("Target role is required", 400);
      }

      // One rule for every path that hands out a role — see role-assignment.ts.
      const decision = await checkRoleAssignment(user, targetRole);
      if (decision.error) {
        return createErrorResponse(decision.error, decision.status);
      }

      const invalidUserIds = userIds.filter((id) => !isValidObjectId(id));
      if (invalidUserIds.length > 0) {
        return createErrorResponse(
          `Invalid user IDs: ${invalidUserIds.join(", ")}`,
          400
        );
      }

      const usersToUpdate = await db.user.findMany({
        where: { id: { in: userIds }, isActive: true },
        select: { id: true, ...MANAGED_TARGET_SELECT },
      });

      if (usersToUpdate.length !== userIds.length) {
        const foundIds = new Set(usersToUpdate.map((entry) => entry.id));
        const notFoundIds = userIds.filter((id) => !foundIds.has(id));
        return createErrorResponse(
          `Users not found or inactive: ${notFoundIds.join(", ")}`,
          404
        );
      }

      // Each person weighed with their own grants and buildings: below the
      // Administrator, a member of staff is moved only by someone whose
      // rights cover theirs — and nobody below it moves themselves.
      const targetUserAccessEntries = await Promise.all(
        usersToUpdate.map(async (targetUser) => ({
          targetUser,
          accessProfile: await resolveManagedTarget(targetUser),
        }))
      );

      const blockedTarget = targetUserAccessEntries.find(
        ({ targetUser, accessProfile }) => {
          const isSelf = targetUser.id === user.id;
          if (isSelf && !user.isAdmin) return true;
          return !canManageTargetUser(user, accessProfile, {
            isSelf,
            withinOwnRights: true,
          });
        }
      );

      if (blockedTarget) {
        return createErrorResponse(
          "You do not have permission to change one or more selected users",
          403
        );
      }

      // The same seat rule as /api/users/assign-roles: moving clients into a
      // staff role takes seats, counted across the batch before any write.
      const promotions = usersToUpdate.filter(
        (targetUser) =>
          roleConsumesSeat(targetRole) && !roleConsumesSeat(targetUser.role)
      ).length;
      try {
        await enforceSeatLimitForRoleChange(user.organizationId!, promotions);
      } catch (seatError) {
        if (seatError instanceof PlanLimitError) {
          return createErrorResponse(seatError.message, seatError.statusCode);
        }
        throw seatError;
      }

      // Update users
      const result = await db.user.updateMany({
        where: { id: { in: userIds }, isActive: true },
        data: { role: targetRole },
      });

      // One entry for the batch: each person's role before, the role after.
      void recordActivity({
        action: AuditAction.ROLE_ASSIGNED,
        recordType: "user",
        recordId: usersToUpdate.length === 1 ? usersToUpdate[0].id : null,
        recordName: null,
        before: {
          rows: usersToUpdate.map((entry) => ({ id: entry.id, role: entry.role })),
        },
        after: { role: targetRole },
        details: { users: usersToUpdate.length },
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
          targetRole,
        },
        `Successfully assigned ${result.count} users to ${targetRole} role`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
