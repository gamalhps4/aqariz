/**
 * PropertyPro - Individual Role Management API Routes
 * CRUD operations for specific roles
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { IRoleConfig } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  canManageTargetRole,
  createAccessProfile,
} from "@/lib/permissions-manager";
import {
  ROLE_LABEL_ERRORS,
  roleLabelKey,
  roleLabelProblem,
  toRoleConfig,
} from "@/lib/role-names";
import { clearRolePermissionCache } from "@/lib/server-permissions";
import { groupChangeRefusal } from "@/lib/staff-delegation";
import { SYSTEM_PERMISSIONS } from "@/lib/permission-catalog";
import { z } from "zod";
import {
  AuditAction,
  auditRecordChange,
  pickSnapshot,
  recordActivity,
} from "@/lib/audit-domain";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const updateRoleSchema = z.object({
  label: z
    .string()
    .trim()
    .min(1, "Role label is required")
    .max(100, "Role label cannot exceed 100 characters")
    .optional(),
  // Null or empty clears it: the group then goes by its label everywhere.
  labelAr: z
    .string()
    .trim()
    .max(100, "The Arabic name cannot exceed 100 characters")
    .nullish()
    .transform((value) => (value === undefined ? undefined : value || null)),
  description: z
    .string()
    .trim()
    .max(500, "Role description cannot exceed 500 characters")
    .nullish()
    .transform((value) => (value === undefined ? undefined : (value ?? ""))),
  permissions: z
    .array(z.enum(SYSTEM_PERMISSIONS))
    .min(1, "At least one permission is required")
    .optional(),
  color: z.enum(["default", "destructive", "outline", "secondary"]).optional(),
  isActive: z.boolean().optional(),
});

// Find the role by ID (record id) or by name (string). Archived roles are not
// found: one keeps its name, so a lookup by name could otherwise land on the
// archived row instead of the live one.
async function findRoleByIdOrName(id: string) {
  if (isValidObjectId(id)) {
    const byId = await db.role.findFirst({ where: { id, deletedAt: null } });
    if (byId) return byId;
  }
  return db.role.findFirst({ where: { name: id, deletedAt: null } });
}

// A role weighed in this file was loaded from the table and is not a built-in
// one, so it is a group whatever its name spells — see RoleLookup in
// lib/permissions-manager.ts. Weighed as a group in force even while it is
// switched off: what matters here is how much the caller must be allowed in
// order to change it, and switching it off must not lower that.
const STORED_GROUP = { storedGroup: "active" } as const;

// ============================================================================
// GET /api/roles/[id] - Get specific role
// ============================================================================

export const GET = withPermissionAndDB("role_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      const role = await findRoleByIdOrName(id);

      if (!role) {
        return createErrorResponse("Role not found", 404);
      }

      // Get user count for this role
      const userCount = await db.user.count({
        where: {
          role: role.name,
          isActive: true,
        },
      });

      // A built-in role is read like any other, with the rights it really
      // grants; only changing it is refused.
      const roleResponse: IRoleConfig = toRoleConfig(role, userCount, user);

      return createSuccessResponse({ role: roleResponse });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/roles/[id] - Update specific role
// ============================================================================

export const PUT = withPermissionAndDB("role_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = updateRoleSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation failed: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const updateData = validation.data;

      const role = await findRoleByIdOrName(id);

      if (!role) {
        return createErrorResponse("Role not found", 404);
      }

      // Check if role can be edited
      if (role.isSystem) {
        return createErrorResponse("System roles cannot be modified", 403);
      }

      const targetRoleProfile = createAccessProfile(
        role.name,
        updateData.permissions ?? role.permissions,
        null,
        STORED_GROUP
      );
      if (!canManageTargetRole(user, targetRoleProfile)) {
        return createErrorResponse(
          "You do not have permission to update this role",
          403
        );
      }

      const refusal = await groupChangeRefusal(
        user,
        role,
        updateData.permissions
      );
      if (refusal) {
        return createErrorResponse(
          refusal.message,
          refusal.status,
          undefined,
          refusal.code
        );
      }

      // A rename is held to the rules a new group's names are. Only a rename:
      // the screen sends both names with every save, and a group must stay
      // editable under the names it already has. The stored name does not
      // change — it is the key on its members' user rows.
      const nextLabel = updateData.label ?? role.label;
      const nextLabelAr =
        updateData.labelAr === undefined ? role.labelAr : updateData.labelAr;
      if (
        roleLabelKey(nextLabel) !== roleLabelKey(role.label) ||
        roleLabelKey(nextLabelAr ?? "") !== roleLabelKey(role.labelAr ?? "")
      ) {
        const otherRoles = await db.role.findMany({
          where: { deletedAt: null, id: { not: role.id } },
          select: { label: true, labelAr: true },
        });
        const labelProblem = roleLabelProblem(
          { label: nextLabel, labelAr: nextLabelAr },
          otherRoles
        );
        if (labelProblem) {
          const { message, code } = ROLE_LABEL_ERRORS[labelProblem];
          return createErrorResponse(message, 409, undefined, code);
        }
      }

      // Update role
      const updatedRole = await db.role.update({
        where: { id: role.id },
        data: {
          ...updateData,
          updatedById: user.id,
        },
      });

      clearRolePermissionCache(updatedRole.name);

      // The permission page's save: what the group was called and could do,
      // before and after — and which rights it gained and lost.
      const gained = updatedRole.permissions.filter(
        (permission) => !role.permissions.includes(permission),
      );
      const lost = role.permissions.filter(
        (permission) => !updatedRole.permissions.includes(permission),
      );
      auditRecordChange({
        action: gained.length || lost.length
          ? AuditAction.PERMISSION_GRANTED
          : AuditAction.UPDATE,
        recordType: "role",
        recordId: role.id,
        recordName: updatedRole.label,
        before: role as unknown as Record<string, unknown>,
        after: updatedRole as unknown as Record<string, unknown>,
        keys: ["label", "labelAr", "description", "permissions", "isActive", "color"],
        details: {
          ...(gained.length ? { permissionsAdded: gained } : {}),
          ...(lost.length ? { permissionsRemoved: lost } : {}),
        },
      });

      // Get user count for this role
      const userCount = await db.user.count({
        where: {
          role: updatedRole.name,
          isActive: true,
        },
      });

      const roleResponse: IRoleConfig = toRoleConfig(
        updatedRole,
        userCount,
        user
      );

      return createSuccessResponse(
        { role: roleResponse },
        "Role updated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/roles/[id] - Delete specific role
// ============================================================================

export const DELETE = withPermissionAndDB("role_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      const role = await findRoleByIdOrName(id);

      if (!role) {
        return createErrorResponse("Role not found", 404);
      }

      // Check if role can be deleted
      if (role.isSystem) {
        return createErrorResponse("System roles cannot be deleted", 403);
      }

      const targetRoleProfile = createAccessProfile(
        role.name,
        role.permissions,
        null,
        STORED_GROUP
      );
      if (!canManageTargetRole(user, targetRoleProfile)) {
        return createErrorResponse(
          "You do not have permission to delete this role",
          403
        );
      }

      const refusal = await groupChangeRefusal(user, role);
      if (refusal) {
        return createErrorResponse(
          refusal.message,
          refusal.status,
          undefined,
          refusal.code
        );
      }

      // Check if role has assigned users
      const userCount = await db.user.count({
        where: {
          role: role.name,
          isActive: true,
        },
      });

      if (userCount > 0) {
        return createErrorResponse(
          `Cannot delete role with ${userCount} assigned users. Please reassign users first.`,
          409
        );
      }

      // Soft delete the role
      await db.role.update({
        where: { id: role.id },
        data: {
          deletedAt: new Date(),
          updatedById: user.id,
          isActive: false,
        },
      });

      clearRolePermissionCache(role.name);

      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "role",
        recordId: role.id,
        recordName: role.label,
        before: pickSnapshot(role as unknown as Record<string, unknown>, [
          "label",
          "labelAr",
          "permissions",
          "isActive",
        ]),
      });

      return createSuccessResponse(
        { deletedRoleId: role.id },
        "Role deleted successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/roles/[id]/toggle - Toggle role active status
// ============================================================================

export const PATCH = withPermissionAndDB("role_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      const role = await findRoleByIdOrName(id);

      if (!role) {
        return createErrorResponse("Role not found", 404);
      }

      // Check if role can be modified
      if (role.isSystem) {
        return createErrorResponse("System roles cannot be modified", 403);
      }

      const targetRoleProfile = createAccessProfile(
        role.name,
        role.permissions,
        null,
        STORED_GROUP
      );
      if (!canManageTargetRole(user, targetRoleProfile)) {
        return createErrorResponse(
          "You do not have permission to modify this role",
          403
        );
      }

      // Switching a group off takes every right from its members at once,
      // so it asks what changing the group asks.
      const refusal = await groupChangeRefusal(user, role);
      if (refusal) {
        return createErrorResponse(
          refusal.message,
          refusal.status,
          undefined,
          refusal.code
        );
      }

      // Toggle active status
      const updatedRole = await db.role.update({
        where: { id: role.id },
        data: {
          isActive: !role.isActive,
          updatedById: user.id,
        },
      });

      clearRolePermissionCache(updatedRole.name);

      auditRecordChange({
        action: AuditAction.STATUS_CHANGED,
        recordType: "role",
        recordId: role.id,
        recordName: role.label,
        before: { isActive: role.isActive },
        after: { isActive: updatedRole.isActive },
        messageKey: updatedRole.isActive
          ? "admin.audit.msg.role_activated"
          : "admin.audit.msg.role_deactivated",
      });

      return createSuccessResponse(
        {
          roleId: updatedRole.id,
          isActive: updatedRole.isActive,
        },
        `Role ${
          updatedRole.isActive ? "activated" : "deactivated"
        } successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
