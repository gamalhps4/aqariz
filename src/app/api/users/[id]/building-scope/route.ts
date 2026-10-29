/**
 * PropertyPro - One employee's building scope
 *
 * Which compounds and buildings an employee may see. Off by default: the
 * office's own staff see the office's own data, and narrowing is the
 * exception an organization opts into — usually for a building supervisor or
 * an agent who covers one compound.
 *
 * GET  → the employee's current assignment, plus everything the *operator*
 *        could assign, so the picker needs no second request, and whether
 *        the operator may change it. An owner or a tenant is refused, as
 *        PUT refuses them: they are not narrowed by this at all, and
 *        answering `restricted: false` for them read as "sees everything".
 * PUT  → replace the assignment. `restricted: false` clears it entirely.
 *
 * The guards mirror the permission-override endpoint next door, for the same
 * reasons — this is the other half of "what may this person reach":
 *   - only a caller with `role_management` may write, and below the
 *     Administrator only for a colleague within their own rights;
 *   - nobody edits their own scope, so an operator cannot widen themselves;
 *   - nobody assigns a building they cannot themselves reach, so a narrowed
 *     manager cannot hand out the rest of the portfolio
 *     (lib/building-assignment.ts, shared with the new-employee form).
 *
 * What is stored is the assignment as a human made it — compounds and
 * buildings. Flattening it to the property ids the query filters use happens
 * per request in lib/db/staff-scope.ts, so a building added to an assigned
 * compound is visible immediately without anyone re-saving the employee.
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
import { resolveStaffPropertyIds } from "@/lib/db/staff-scope";
import {
  canManageRoles,
  canManageTargetUser,
  canViewTargetUser,
} from "@/lib/permissions-manager";
import { resolveManagedTarget } from "@/lib/staff-delegation";
import {
  assignmentRefusal,
  loadAssignable,
  parseBuildingAssignment,
} from "@/lib/building-assignment";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";

type RouteParams = { params: Promise<{ id: string }> };

const NOT_FOR_CLIENTS =
  "Building access applies to employees. Owners and tenants already see only their own records.";

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
// GET /api/users/[id]/building-scope
// ============================================================================

export const GET = withPermissionAndDB([
  "role_management",
  "user_management",
  "user_view",
])(
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

      const targetProfile = await resolveManagedTarget(target);
      if (
        !canViewTargetUser(user, targetProfile, {
          isSelf: target.id === user.id,
        })
      ) {
        return createErrorResponse("Access denied", 403);
      }
      if (targetProfile.isOwner || targetProfile.isTenant) {
        return createErrorResponse(
          NOT_FOR_CLIENTS,
          400,
          undefined,
          "SCOPE_NOT_APPLICABLE",
        );
      }

      const assignable = await loadAssignable(user);

      // What the assignment actually resolves to today — the same function
      // the request pipeline uses, so the screen cannot disagree with the
      // rule it is configuring.
      const resolvedPropertyIds = target.scopeRestricted
        ? await resolveStaffPropertyIds({
            compoundIds: target.scopedCompoundIds,
            propertyIds: target.scopedPropertyIds,
          })
        : [];

      // The rule PUT applies, so the screen offers a save only when it would
      // be accepted.
      const canEdit =
        target.id !== user.id &&
        canManageRoles(user) &&
        canManageTargetUser(user, targetProfile, { withinOwnRights: true });

      return createSuccessResponse(
        {
          userId: target.id,
          role: target.role,
          restricted: target.scopeRestricted,
          compoundIds: target.scopedCompoundIds,
          propertyIds: target.scopedPropertyIds,
          resolvedPropertyCount: resolvedPropertyIds.length,
          canEdit,
          assignable,
        },
        "Building scope retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to load building scope");
    }
  },
);

// ============================================================================
// PUT /api/users/[id]/building-scope
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

      // The one path that could widen the operator's own view with nobody
      // else agreeing to it.
      if (id === user.id) {
        return createErrorResponse(
          "You cannot change your own building access. Ask another administrator.",
          403,
        );
      }

      const target = await loadTarget(id);
      if (!target) {
        return createErrorResponse("User not found", 404);
      }

      const targetProfile = await resolveManagedTarget(target);
      if (
        !canManageTargetUser(user, targetProfile, { withinOwnRights: true })
      ) {
        return createErrorResponse(
          "You cannot change building access for this user",
          403,
        );
      }

      // Owners and tenants are governed by their own, tighter rules; giving
      // them a staff assignment would store a fact nothing reads and imply an
      // access change that never happens.
      if (targetProfile.isOwner || targetProfile.isTenant) {
        return createErrorResponse(
          NOT_FOR_CLIENTS,
          400,
          undefined,
          "SCOPE_NOT_APPLICABLE",
        );
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const parsed = parseBuildingAssignment(body);
      if (!parsed.ok) {
        return createErrorResponse(parsed.message, 400);
      }
      const next = parsed.assignment;

      // No handing out what the operator cannot reach, and no lifting a
      // colleague's limits past the operator's own.
      const refusal = await assignmentRefusal(user, next);
      if (refusal) {
        return createErrorResponse(refusal, 403);
      }

      const updated = await db.user.update({
        where: { id },
        data: {
          scopeRestricted: next.restricted,
          scopedCompoundIds: next.compoundIds,
          scopedPropertyIds: next.propertyIds,
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          scopeRestricted: true,
          scopedCompoundIds: true,
          scopedPropertyIds: true,
        },
      });

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.PERMISSION_GRANTED,
          // Changing what a person can see is what an audit trail is for.
          severity: AuditSeverity.HIGH,
          messageKey: "admin.audit.msg.building_access_changed",
          description: updated.scopeRestricted
            ? `Limited ${updated.firstName} ${updated.lastName} to assigned buildings`
            : `Removed building limits for ${updated.firstName} ${updated.lastName}`,
          resourceType: "user",
          resourceId: updated.id,
          resourceName: `${updated.firstName} ${updated.lastName}`,
          oldValues: {
            restricted: target.scopeRestricted,
            compoundIds: target.scopedCompoundIds,
            propertyIds: target.scopedPropertyIds,
          },
          newValues: {
            restricted: updated.scopeRestricted,
            compoundIds: updated.scopedCompoundIds,
            propertyIds: updated.scopedPropertyIds,
          },
          tags: ["user", "access", "buildings"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      const resolvedPropertyIds = updated.scopeRestricted
        ? await resolveStaffPropertyIds({
            compoundIds: updated.scopedCompoundIds,
            propertyIds: updated.scopedPropertyIds,
          })
        : [];

      return createSuccessResponse(
        {
          userId: updated.id,
          restricted: updated.scopeRestricted,
          compoundIds: updated.scopedCompoundIds,
          propertyIds: updated.scopedPropertyIds,
          resolvedPropertyCount: resolvedPropertyIds.length,
        },
        "Building access updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update building scope");
    }
  },
);
