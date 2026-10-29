import "server-only";

import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AccessProfile,
  createAccessProfile,
  getSystemRolePermissions,
  isBuiltInRoleName,
  normalizeRoleName,
  resolveSystemRole,
  type PermissionOverrides,
  type StoredGroupState,
} from "./permissions-manager";
import { getOrgContext } from "./tenancy/context";

/** What the organization stores under a role name, and what it grants. */
interface StoredGroup {
  state: StoredGroupState;
  permissions: string[];
}

// Custom roles are org-scoped documents, so the cache must be namespaced by
// organization: two orgs can each define a role with the same name but
// different permissions. A miss is cached as well, so that a name nothing is
// stored under is not asked about again on every request.
const ROLE_PERMISSION_CACHE = new Map<
  string,
  StoredGroup & { timestamp: number }
>();
const ROLE_PERMISSION_CACHE_TTL = 5 * 60 * 1000;

function roleCacheKey(organizationId: string, role: string): string {
  return `${organizationId}:${role}`;
}

/**
 * The group this organization stores under the name: in force with the
 * permissions ticked for it, switched off or archived, or not there at all.
 *
 * Every row under the name is read, not only the live one. A group that was
 * switched off or archived must still be known to be the organization's:
 * were it simply "not found", a name that doubles as an alias would fall back
 * to the built-in role, and switching off a group stored as "administrator"
 * would make administrators of its members.
 */
async function loadStoredGroup(normalizedRole: string): Promise<StoredGroup> {
  const orgContext = getOrgContext();
  const organizationId =
    !orgContext?.bypass && orgContext?.organizationId
      ? orgContext.organizationId
      : null;

  const cacheKey = organizationId
    ? roleCacheKey(organizationId, normalizedRole)
    : null;

  if (cacheKey) {
    const cached = ROLE_PERMISSION_CACHE.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < ROLE_PERMISSION_CACHE_TTL) {
      return cached;
    }
  }

  const rows = await db.role.findMany({
    where: { name: normalizedRole },
    select: { permissions: true, isActive: true, deletedAt: true },
  });

  const live = rows.find((row) => row.isActive && !row.deletedAt);
  const stored: StoredGroup = live
    ? { state: "active", permissions: live.permissions }
    : { state: rows.length > 0 ? "inactive" : "none", permissions: [] };

  // Only cache lookups bound to a single organization; bypass/platform-level
  // resolutions are not org-specific and must never be served to org members.
  if (cacheKey) {
    ROLE_PERMISSION_CACHE.set(cacheKey, { ...stored, timestamp: Date.now() });
  }

  return stored;
}

/**
 * What a role name means in this organization.
 *
 * Only the five built-in names are answered without asking the database.
 * Every other name — an alias such as "administrator" included — is first
 * looked for among the organization's own groups, and a stored group is a
 * group: its members get the permissions ticked for it. The alias table used
 * to be consulted first, so a group stored as `administrator` gave its
 * members the built-in Administrator's rights and its ticks were never read.
 */
async function resolveRole(
  role: string | null | undefined
): Promise<{ permissions: string[]; storedGroup: StoredGroupState }> {
  const normalizedRole = normalizeRoleName(role) ?? UserRole.TENANT;

  if (isBuiltInRoleName(normalizedRole)) {
    return {
      permissions: getSystemRolePermissions(normalizedRole as UserRole),
      storedGroup: "none",
    };
  }

  const stored = await loadStoredGroup(normalizedRole);
  if (stored.state !== "none") {
    return { permissions: stored.permissions, storedGroup: stored.state };
  }

  // Nothing was ever stored under the name. A legacy alias on a user row
  // still means its built-in role; any other name resolves to no permissions.
  const aliasedRole = resolveSystemRole(normalizedRole);
  return {
    permissions: aliasedRole ? getSystemRolePermissions(aliasedRole) : [],
    storedGroup: "none",
  };
}

export async function resolveRolePermissions(
  role: string | null | undefined
): Promise<string[]> {
  return (await resolveRole(role)).permissions;
}

export async function resolveAccessProfile(
  role: string | null | undefined,
  overrides?: PermissionOverrides | null
): Promise<AccessProfile> {
  const { permissions, storedGroup } = await resolveRole(role);
  return createAccessProfile(role, permissions, overrides, { storedGroup });
}

/**
 * Read one user's permission overrides.
 *
 * Deliberately NOT cached with the role permissions above: that cache is
 * shared by everyone holding a role, while these are one person's, and a
 * revoked capability has to take effect on their next request rather than up
 * to five minutes later.
 */
export async function loadPermissionOverrides(
  userId: string
): Promise<PermissionOverrides | null> {
  return (await loadUserAccessRow(userId)).overrides;
}

/**
 * One person's per-user access facts, in a single read.
 *
 * Overrides and building assignments are separate features that happen to
 * live on the same row and are needed on the same request. Fetching them
 * together is not tidiness — against a database several hundred milliseconds
 * away, a second round trip here is paid by every authenticated request.
 */
export interface UserAccessRow {
  overrides: PermissionOverrides | null;
  /**
   * Null when this person's view is not narrowed to particular buildings.
   * Non-null — possibly with two empty lists — when it is. The caller must
   * keep that difference: see `User.scopeRestricted`.
   */
  buildingScope: { compoundIds: string[]; propertyIds: string[] } | null;
}

export async function loadUserAccessRow(
  userId: string
): Promise<UserAccessRow> {
  const empty: UserAccessRow = { overrides: null, buildingScope: null };
  if (!userId) return empty;

  const user = await db.user.findFirst({
    where: { id: userId },
    select: {
      permissionGrants: true,
      permissionDenials: true,
      scopeRestricted: true,
      scopedCompoundIds: true,
      scopedPropertyIds: true,
    },
  });
  if (!user) return empty;

  // Nothing set is the overwhelmingly common case; skip the object so callers
  // take the plain role path.
  const overrides =
    user.permissionGrants.length === 0 && user.permissionDenials.length === 0
      ? null
      : { grants: user.permissionGrants, denials: user.permissionDenials };

  return {
    overrides,
    buildingScope: user.scopeRestricted
      ? {
          compoundIds: user.scopedCompoundIds,
          propertyIds: user.scopedPropertyIds,
        }
      : null,
  };
}

export function clearRolePermissionCache(role?: string): void {
  if (role) {
    const normalizedRole = normalizeRoleName(role);
    if (!normalizedRole) {
      return;
    }

    const orgContext = getOrgContext();
    if (!orgContext?.bypass && orgContext?.organizationId) {
      ROLE_PERMISSION_CACHE.delete(
        roleCacheKey(orgContext.organizationId, normalizedRole)
      );
      return;
    }

    // No single-org context (platform admin / scripts): clear this role name
    // across every organization.
    for (const key of ROLE_PERMISSION_CACHE.keys()) {
      if (key.endsWith(`:${normalizedRole}`)) {
        ROLE_PERMISSION_CACHE.delete(key);
      }
    }
    return;
  }

  ROLE_PERMISSION_CACHE.clear();
}
