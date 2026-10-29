import "server-only";

import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  ASSIGNABLE_ORG_ROLES,
  canManageRoles,
  canManageTargetRole,
  createAccessProfile,
  type AccessProfile,
} from "@/lib/permissions-manager";

/**
 * PropertyPro - Who may hand out which role
 *
 * Four endpoints put a role name on a user: create, invite, assign-roles, and
 * the bulk PUT on /api/roles. Only the invitation route ever refused
 * `super_admin`; the other three accepted it because
 * `Object.values(UserRole).includes(role)` treats the platform role as just
 * another system role, and `canManageTargetRole` short-circuited on
 * `actor.isAdmin`. An organization admin could therefore promote one of their
 * own users to the platform role.
 *
 * The tier split in permissions-manager now blocks that structurally, but the
 * check stays explicit here for two reasons: it names the rule where the role
 * is accepted, and it returns a message rather than a silent rank comparison.
 * Every one of the four paths goes through this function.
 */

const ASSIGNABLE_ORG_ROLE_NAMES: readonly string[] = ASSIGNABLE_ORG_ROLES;

/** True when `role` is a system role an organization is allowed to hand out. */
export function isAssignableOrgRole(role: string): boolean {
  return ASSIGNABLE_ORG_ROLE_NAMES.includes(role);
}

export interface RoleAssignmentDecision {
  /** Null when the assignment is allowed; otherwise the reason to return. */
  error: string | null;
  /** 400 for a role that does not exist, 403 for one the caller may not give. */
  status: number;
  /** The resolved profile of the role being handed out, when allowed. */
  targetRoleProfile?: AccessProfile;
  /** The custom-role row, when the assigned role is not a system role. */
  customRole?: { name: string; label: string; description: string; permissions: string[] } | null;
}

/**
 * Confirm `actor` may put `role` on a user in their organization.
 *
 * Resolves custom roles against the caller's organization (RLS scopes the
 * lookup), so a role name that exists in another organization is as invalid
 * here as one that exists nowhere.
 */
export async function checkRoleAssignment(
  actor: AccessProfile,
  role: string,
): Promise<RoleAssignmentDecision> {
  const isSystemRole = (Object.values(UserRole) as string[]).includes(role);

  if (isSystemRole) {
    if (!isAssignableOrgRole(role)) {
      // Platform admins are provisioned by the bootstrap script, never
      // assigned, invited or promoted into an organization.
      return { error: "Invalid role specified", status: 400 };
    }

    const targetRoleProfile = createAccessProfile(role);
    if (!canManageRoles(actor) || !canManageTargetRole(actor, targetRoleProfile)) {
      return {
        error: "You do not have permission to assign this role",
        status: 403,
      };
    }
    return { error: null, status: 200, targetRoleProfile, customRole: null };
  }

  const customRole = await db.role.findFirst({
    where: { name: role, isActive: true, deletedAt: null },
  });
  if (!customRole) {
    return { error: "Invalid role specified", status: 400 };
  }

  // A stored group, so a group — even one whose name spells a built-in role.
  // Left to the name, a group stored as "administrator" was weighed here as
  // the Administrator role and then handed out as a custom one.
  const targetRoleProfile = createAccessProfile(
    customRole.name,
    customRole.permissions,
    null,
    { storedGroup: "active" },
  );
  if (!canManageRoles(actor) || !canManageTargetRole(actor, targetRoleProfile)) {
    return {
      error: "You do not have permission to assign this role",
      status: 403,
    };
  }
  return { error: null, status: 200, targetRoleProfile, customRole };
}

/**
 * Same rule as checkRoleAssignment, reduced to the error string the older call
 * sites already expect (null = allowed).
 */
export async function assertCanAssignRole(
  actor: AccessProfile,
  role: string,
): Promise<string | null> {
  const { error } = await checkRoleAssignment(actor, role);
  return error;
}
