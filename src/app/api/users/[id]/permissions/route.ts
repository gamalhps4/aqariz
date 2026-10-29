/**
 * PropertyPro - One employee's permission overrides
 *
 * Roles remain how access is normally granted. This is the exception an office
 * actually has: the assistant who also reconciles payments, the agent who must
 * not delete contracts. Without it every such case needs a role of its own,
 * and the role list stops describing the organization.
 *
 * GET  → what this employee's role gives them, and what has been added or
 *        taken away on top.
 * PUT  → replace both override lists.
 *
 * Three rules the endpoint enforces, all of them about not letting the feature
 * become a way around the role system:
 *   - only a caller with `role_management` may use it at all;
 *   - nobody can grant a permission they do not themselves hold, so this
 *     cannot be used to climb;
 *   - nobody edits their own overrides, so an administrator cannot quietly
 *     widen their own access.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  SYSTEM_PERMISSIONS,
  type SystemPermission,
} from "@/lib/permission-catalog";
import {
  canManageTargetUser,
  hasPermission,
} from "@/lib/permissions-manager";
import {
  clearRolePermissionCache,
  resolveAccessProfile,
} from "@/lib/server-permissions";
import { resolveManagedTarget } from "@/lib/staff-delegation";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";

type RouteParams = { params: Promise<{ id: string }> };

const KNOWN_PERMISSIONS = new Set<string>(SYSTEM_PERMISSIONS);

/**
 * Clean one submitted list: unique, known, and in catalogue order so two
 * equivalent requests store the same array and audit diffs stay readable.
 */
function normalizeList(value: unknown): {
  ok: boolean;
  list: string[];
  unknown: string[];
} {
  if (value === undefined || value === null) {
    return { ok: true, list: [], unknown: [] };
  }
  if (!Array.isArray(value)) {
    return { ok: false, list: [], unknown: [] };
  }

  const seen = new Set<string>();
  const unknownNames: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const name = entry.trim();
    if (!name) continue;
    if (!KNOWN_PERMISSIONS.has(name)) {
      unknownNames.push(name);
      continue;
    }
    seen.add(name);
  }

  const ordered = SYSTEM_PERMISSIONS.filter((permission) =>
    seen.has(permission),
  );
  return { ok: true, list: [...ordered], unknown: unknownNames };
}

async function loadTarget(id: string) {
  return db.user.findFirst({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      role: true,
      permissionGrants: true,
      permissionDenials: true,
      scopeRestricted: true,
      scopedCompoundIds: true,
      scopedPropertyIds: true,
    },
  });
}

// ============================================================================
// GET /api/users/[id]/permissions
// ============================================================================

export const GET = withPermissionAndDB(["role_management", "user_management"])(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: RouteParams,
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      const target = await loadTarget(id);
      if (!target) {
        return createErrorResponse("User not found", 404);
      }

      // The role's own permissions, with no overrides applied — the baseline
      // the UI shows as already-granted so an operator is not asked to grant
      // something twice.
      const roleProfile = await resolveAccessProfile(target.role);
      // What the person actually ends up with, which is what the UI has to
      // show as the outcome.
      const effective = await resolveAccessProfile(target.role, {
        grants: target.permissionGrants,
        denials: target.permissionDenials,
      });

      return createSuccessResponse(
        {
          userId: target.id,
          role: target.role,
          rolePermissions: roleProfile.permissions,
          grants: target.permissionGrants,
          denials: target.permissionDenials,
          effectivePermissions: effective.permissions,
          /** Everything assignable, so the UI needs no second request. */
          catalog: SYSTEM_PERMISSIONS,
        },
        "Permission overrides retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to load permission overrides");
    }
  },
);

// ============================================================================
// PUT /api/users/[id]/permissions
// ============================================================================

export const PUT = withPermissionAndDB("role_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: RouteParams,
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      // Editing your own overrides is the one path that could widen your own
      // access without anybody else agreeing to it.
      if (id === user.id) {
        return createErrorResponse(
          "You cannot change your own permissions. Ask another administrator.",
          403,
        );
      }

      const target = await loadTarget(id);
      if (!target) {
        return createErrorResponse("User not found", 404);
      }

      // Weighed with the grants they already hold and their buildings: below
      // the Administrator, a colleague's exceptions are changed only by
      // someone whose own rights cover them.
      const targetProfile = await resolveManagedTarget(target);
      if (
        !canManageTargetUser(user, targetProfile, { withinOwnRights: true })
      ) {
        return createErrorResponse(
          "You cannot change permissions for this user",
          403,
        );
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const payload = body as { grants?: unknown; denials?: unknown };
      const grants = normalizeList(payload.grants);
      const denials = normalizeList(payload.denials);

      if (!grants.ok || !denials.ok) {
        return createErrorResponse(
          "grants and denials must each be a list of permission names",
          400,
        );
      }

      const unknownNames = [...grants.unknown, ...denials.unknown];
      if (unknownNames.length > 0) {
        return createErrorResponse(
          `Unknown permission(s): ${unknownNames.join(", ")}`,
          400,
        );
      }

      // No climbing: an operator can only hand out what they hold themselves.
      // Denials are exempt — taking access away is never an escalation.
      const cannotGrant = grants.list.filter(
        (permission) =>
          !hasPermission(user.permissions, permission as SystemPermission),
      );
      if (cannotGrant.length > 0) {
        return createErrorResponse(
          `You cannot grant permission(s) you do not hold: ${cannotGrant.join(", ")}`,
          403,
        );
      }

      const updated = await db.user.update({
        where: { id },
        data: {
          permissionGrants: grants.list,
          permissionDenials: denials.list,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          permissionGrants: true,
          permissionDenials: true,
        },
      });

      // The role cache is keyed by role, not by user, so it holds nothing
      // that just changed — but a role edit and an override edit arrive
      // through the same screen, and leaving a stale entry behind after one of
      // them is the kind of difference nobody remembers later.
      clearRolePermissionCache(updated.role);

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.PERMISSION_GRANTED,
          // Changing what a person may do is exactly what an audit trail is
          // for, so it is never logged as routine.
          severity: AuditSeverity.HIGH,
          description: `Updated permission overrides for ${updated.firstName} ${updated.lastName}`,
          messageKey: "admin.audit.msg.permissions_changed",
          resourceType: "user",
          resourceId: updated.id,
          resourceName: `${updated.firstName} ${updated.lastName}`,
          oldValues: {
            grants: target.permissionGrants,
            denials: target.permissionDenials,
          },
          newValues: {
            grants: updated.permissionGrants,
            denials: updated.permissionDenials,
          },
          tags: ["user", "permissions", "override"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      const effective = await resolveAccessProfile(updated.role, {
        grants: updated.permissionGrants,
        denials: updated.permissionDenials,
      });

      return createSuccessResponse(
        {
          userId: updated.id,
          grants: updated.permissionGrants,
          denials: updated.permissionDenials,
          effectivePermissions: effective.permissions,
        },
        "Permission overrides updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update permission overrides");
    }
  },
);
