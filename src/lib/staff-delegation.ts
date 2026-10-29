import "server-only";

import { db } from "@/lib/db/prisma";
import { resolveStaffPropertyIds } from "@/lib/db/staff-scope";
import {
  canManageTargetRole,
  createAccessProfile,
  isWithinReach,
  normalizeRoleName,
  type ScopedAccessProfile,
} from "@/lib/permissions-manager";
import { resolveAccessProfile } from "@/lib/server-permissions";

/**
 * PropertyPro - Staff managing staff, within their own rights
 *
 * The owner decided on 2026-10-01 that a permission group ticked Manage users
 * or Manage roles may manage employees and groups whose rights are within its
 * own — never the Administrator, never itself or its own group. The rule is
 * `isWithinReach` in permissions-manager; this file reads what it compares.
 *
 * A target has to be weighed by what they actually end up with: their role's
 * permissions, the grants and denials made to them personally, and the
 * buildings they see. Weighed by role alone, a clerk given `payment_delete`
 * on top of their group would pass for an ordinary clerk, and a supervisor
 * holding two buildings could take charge of someone who sees all twenty.
 */

/** The columns a target is weighed by. */
export const MANAGED_TARGET_SELECT = {
  role: true,
  permissionGrants: true,
  permissionDenials: true,
  scopeRestricted: true,
  scopedCompoundIds: true,
  scopedPropertyIds: true,
} as const;

export interface ManagedTargetRow {
  role: string;
  permissionGrants: string[];
  permissionDenials: string[];
  scopeRestricted: boolean;
  scopedCompoundIds: string[];
  scopedPropertyIds: string[];
}

/** One person as a manager must weigh them. */
export async function resolveManagedTarget(
  row: ManagedTargetRow,
): Promise<ScopedAccessProfile> {
  const overrides =
    row.permissionGrants.length === 0 && row.permissionDenials.length === 0
      ? null
      : { grants: row.permissionGrants, denials: row.permissionDenials };
  const profile = await resolveAccessProfile(row.role, overrides);

  // The same resolution the request pipeline applies (api-utils): only a
  // restricted employee has buildings; owners and tenants have their own
  // rules and are never weighed by these.
  const scopedPropertyIds =
    row.scopeRestricted && !profile.isOwner && !profile.isTenant
      ? await resolveStaffPropertyIds({
          compoundIds: row.scopedCompoundIds,
          propertyIds: row.scopedPropertyIds,
        })
      : undefined;

  return { ...profile, scopedPropertyIds };
}

/** Read one user and weigh them, or null when there is no such user. */
export async function loadManagedTarget(
  userId: string,
): Promise<(ScopedAccessProfile & { id: string }) | null> {
  const row = await db.user.findFirst({
    where: { id: userId },
    select: { id: true, ...MANAGED_TARGET_SELECT },
  });
  if (!row) return null;
  return { ...(await resolveManagedTarget(row)), id: row.id };
}

export interface GroupChangeRefusal {
  status: number;
  message: string;
  code: string;
}

/** The actor a group change is weighed for. */
interface GroupActor extends ScopedAccessProfile {
  originalRole: string;
}

/**
 * Why `actor` may not change, switch off or delete a stored group, or null.
 *
 * Asked of everyone below the Administrator, and on top of
 * `canManageTargetRole`:
 *
 *   - never their own group — narrowing it would lock them out and widening
 *     it is impossible anyway, so it is the Administrator's;
 *   - the group as it stands and as it would become must both be within the
 *     actor's rights: a group above you is not yours to touch, even to cut;
 *   - an actor narrowed to some buildings changes only a group whose members
 *     all see within those buildings. A group's rights apply wherever its
 *     members work, and granting "Delete tenants" to a group whose members
 *     see every building would be deleting beyond the actor's own.
 */
export async function groupChangeRefusal(
  actor: GroupActor,
  group: { name: string; permissions: readonly string[] },
  nextPermissions?: readonly string[],
): Promise<GroupChangeRefusal | null> {
  if (actor.isAdmin) return null;

  if (normalizeRoleName(actor.originalRole) === group.name) {
    return {
      status: 403,
      message:
        "You cannot change the permission group you belong to. Ask an administrator.",
      code: "ROLE_OWN_GROUP",
    };
  }

  for (const permissions of [group.permissions, nextPermissions ?? []]) {
    const profile = createAccessProfile(group.name, [...permissions], null, {
      storedGroup: "active",
    });
    if (!canManageTargetRole(actor, profile)) {
      return {
        status: 403,
        message:
          "This group holds permissions you do not have, so only someone who holds them can change it.",
        code: "ROLE_BEYOND_REACH",
      };
    }
  }

  if (actor.scopedPropertyIds !== undefined) {
    const members = await db.user.findMany({
      where: { role: group.name, deletedAt: null },
      select: MANAGED_TARGET_SELECT,
    });
    for (const member of members) {
      const reach = await resolveManagedTarget(member);
      const inside = isWithinReach(
        { permissions: [], scopedPropertyIds: actor.scopedPropertyIds },
        { permissions: [], scopedPropertyIds: reach.scopedPropertyIds },
      );
      if (!inside) {
        return {
          status: 403,
          message:
            "Some members of this group work in buildings you are not assigned, so only an administrator can change it.",
          code: "ROLE_MEMBERS_BEYOND_REACH",
        };
      }
    }
  }

  return null;
}
