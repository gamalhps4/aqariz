/**
 * PropertyPro - Role Permissions Hook
 * Enhanced permission management supporting both system and custom roles
 */

"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "@/lib/auth-client";
import { UserRole, IRoleConfig } from "@/types";
import {
  SYSTEM_ROLE_PERMISSIONS,
  formatRoleLabel,
  isBuiltInRoleName,
  normalizeRoleName,
  resolveSystemRole,
  type StoredGroupState,
} from "@/lib/role-utils";

// ============================================================================
// TYPES
// ============================================================================

interface RolePermissionsData {
  permissions: string[];
  roleInfo: IRoleConfig | null;
  /**
   * What the organization stores under this role name, to be passed on to
   * createAccessProfile — see RoleLookup in lib/permissions-manager.ts.
   * Undefined when the question could not be put to the server.
   */
  storedGroup: StoredGroupState | undefined;
  isLoading: boolean;
  error: string | null;
}

/** What the hook holds: an answer, and the role it is the answer for. */
interface ResolvedPermissions extends RolePermissionsData {
  role: string | undefined;
}

interface UseRolePermissionsReturn extends RolePermissionsData {
  hasPermission: (permission: string) => boolean;
  hasAnyPermission: (permissions: string[]) => boolean;
  hasAllPermissions: (permissions: string[]) => boolean;
  refreshPermissions: () => Promise<void>;
  isSystemRole: boolean;
  isCustomRole: boolean;
}

// ============================================================================
// PERMISSION CACHE
// ============================================================================

/** What the server holds under a role name; `role` is the group in force. */
interface StoredRole {
  role: IRoleConfig | null;
  state: StoredGroupState;
}

// A miss is cached too, so a legacy alias is not asked about on every mount.
const permissionCache = new Map<string, StoredRole & { timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Lookups on their way. The sidebar, the page and each guard on it mount
// their own copy of the hook, and with a cold cache every one of them asked
// the server the same question at the same moment.
const pendingLookups = new Map<string, Promise<StoredRole>>();

/** One empty list for every "nothing yet", so memoised callers stay still. */
const NO_PERMISSIONS: string[] = [];

/**
 * What the organization stores under exactly this name.
 *
 * Asked by name, not through the role screen's search. `?search=…&limit=1`
 * matches label, description and name by substring and returns the newest
 * hit, so for anyone allowed to search, "accounts" could come back as
 * "accounts_senior" — or as any group whose description mentions accounts.
 *
 * Switched-off and archived groups are asked for as well. One of those still
 * owns its name, and has to be told apart from a name nothing was ever stored
 * under, which may be a legacy alias of a built-in role.
 */
async function fetchStoredRole(roleName: string): Promise<StoredRole> {
  const cached = permissionCache.get(roleName);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return cached;
  }

  const pending = pendingLookups.get(roleName);
  if (pending) {
    return pending;
  }

  const lookup = (async () => {
    const response = await fetch(
      `/api/roles?name=${encodeURIComponent(roleName)}&includeInactive=true`
    );
    if (!response.ok) {
      throw new Error(
        `Failed to fetch role permissions: ${response.statusText}`
      );
    }

    const data = await response.json();
    const roles: IRoleConfig[] = data?.data?.roles ?? data?.roles ?? [];
    const stored = roles.filter((r) => normalizeRoleName(r.name) === roleName);
    const role = stored.find((r) => r.isActive) ?? null;
    const found: StoredRole = {
      role,
      state: role ? "active" : stored.length > 0 ? "inactive" : "none",
    };

    permissionCache.set(roleName, { ...found, timestamp: Date.now() });

    return found;
  })().finally(() => pendingLookups.delete(roleName));

  pendingLookups.set(roleName, lookup);
  return lookup;
}

/** What a built-in role — or a legacy alias of one — comes to. */
function describeSystemRole(
  userRole: string,
  systemRole: UserRole
): { permissions: string[]; roleInfo: IRoleConfig } {
  const permissions: string[] = [
    ...(SYSTEM_ROLE_PERMISSIONS[systemRole] || []),
  ];
  const normalizedUserRole = normalizeRoleName(userRole);
  const roleLabel = formatRoleLabel(userRole);

  return {
    permissions,
    roleInfo: {
      name: userRole,
      label: roleLabel,
      description:
        normalizedUserRole === systemRole
          ? `System role: ${systemRole}`
          : `${roleLabel} uses ${systemRole} access rules`,
      permissions,
      isSystem: normalizedUserRole === systemRole,
      isActive: true,
      color:
        systemRole === UserRole.ADMIN
          ? "destructive"
          : systemRole === UserRole.MANAGER
          ? "default"
          : "outline",
      userCount: 0,
      canEdit: false,
      canDelete: false,
    },
  };
}

// ============================================================================
// HOOK IMPLEMENTATION
// ============================================================================

export function useRolePermissions(
  targetRole?: string
): UseRolePermissionsReturn {
  const { data: session } = useSession();
  const userRole = targetRole || session?.user?.role;

  const [resolved, setResolved] = useState<ResolvedPermissions>({
    role: undefined,
    permissions: NO_PERMISSIONS,
    roleInfo: null,
    storedGroup: undefined,
    isLoading: true,
    error: null,
  });

  // The state is one effect behind the session. When the session arrives
  // there is a render in which it still describes "no role" — not loading,
  // no permissions — and a screen that acted on that turned a permission
  // group away before its permissions had been asked for. Until what is held
  // is this role's answer, the answer is "loading", and the role is taken to
  // be a group with nothing ticked yet: believing an alias before the server
  // has answered would show the members of a group stored under one the
  // built-in role's screens for as long as the answer takes.
  const settled = resolved.role === userRole;
  const permissionsData: RolePermissionsData = settled
    ? {
        permissions: resolved.permissions,
        roleInfo: resolved.roleInfo,
        storedGroup: resolved.storedGroup,
        isLoading: resolved.isLoading,
        error: resolved.error,
      }
    : {
        permissions: NO_PERMISSIONS,
        roleInfo: null,
        storedGroup: "active",
        isLoading: true,
        error: null,
      };

  // A role is a system role when it is one of the five built-in names, or an
  // alias of one that the organization has not stored a group under.
  const isSystemRole =
    isBuiltInRoleName(userRole) ||
    (Boolean(resolveSystemRole(userRole)) &&
      permissionsData.storedGroup !== "active" &&
      permissionsData.storedGroup !== "inactive");
  const isCustomRole = userRole ? !isSystemRole : false;

  // The role the newest load was started for, so that an answer arriving
  // late for an earlier role is dropped rather than shown.
  const latestRole = useRef(userRole);

  // Load permissions
  const loadPermissions = useCallback(async () => {
    latestRole.current = userRole;
    const settle = (answer: Omit<RolePermissionsData, "isLoading">) => {
      if (latestRole.current === userRole) {
        setResolved({ ...answer, role: userRole, isLoading: false });
      }
    };

    if (!userRole) {
      settle({
        permissions: NO_PERMISSIONS,
        roleInfo: null,
        storedGroup: undefined,
        error: "No role specified",
      });
      return;
    }

    setResolved((prev) => ({ ...prev, isLoading: true, error: null }));

    const roleName = normalizeRoleName(userRole) ?? userRole;

    // Only the five built-in names are settled without asking. Any other —
    // an alias such as "administrator" included — may be a group the
    // organization stored, and a stored group is a group: see RoleLookup.
    if (isBuiltInRoleName(roleName)) {
      settle({
        ...describeSystemRole(userRole, roleName as UserRole),
        storedGroup: "none",
        error: null,
      });
      return;
    }

    const aliasedRole = resolveSystemRole(roleName);
    let storedGroup: StoredGroupState | undefined;

    try {
      const stored = await fetchStoredRole(roleName);
      storedGroup = stored.state;

      if (stored.role) {
        settle({
          permissions: stored.role.permissions,
          roleInfo: stored.role,
          storedGroup,
          error: null,
        });
        return;
      }

      // Nothing in force under the name. Only a name nothing was ever stored
      // under may still be a legacy alias.
      if (!aliasedRole || storedGroup === "inactive") {
        throw new Error(`Role '${roleName}' not found`);
      }
    } catch (error) {
      if (!aliasedRole || storedGroup === "inactive") {
        console.error("Error fetching custom role permissions:", error);
        settle({
          permissions: NO_PERMISSIONS,
          roleInfo: null,
          storedGroup,
          error:
            error instanceof Error
              ? error.message
              : "Failed to load permissions",
        });
        return;
      }
    }

    // A legacy alias with no group ever stored under it — or one the lookup
    // could not be put for — still means its built-in role.
    settle({
      ...describeSystemRole(userRole, aliasedRole),
      storedGroup,
      error: null,
    });
  }, [userRole]);

  // Refresh permissions (clears cache)
  const refreshPermissions = useCallback(async () => {
    if (userRole) {
      permissionCache.delete(normalizeRoleName(userRole) ?? userRole);
    }
    await loadPermissions();
  }, [userRole, loadPermissions]);

  // Permission checking functions
  const hasPermission = useCallback(
    (permission: string): boolean => {
      return permissionsData.permissions.includes(permission);
    },
    [permissionsData.permissions]
  );

  const hasAnyPermission = useCallback(
    (permissions: string[]): boolean => {
      return permissions.some((permission) =>
        permissionsData.permissions.includes(permission)
      );
    },
    [permissionsData.permissions]
  );

  const hasAllPermissions = useCallback(
    (permissions: string[]): boolean => {
      return permissions.every((permission) =>
        permissionsData.permissions.includes(permission)
      );
    },
    [permissionsData.permissions]
  );

  // Load permissions on mount and when role changes
  useEffect(() => {
    loadPermissions();
  }, [loadPermissions]);

  return {
    ...permissionsData,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    refreshPermissions,
    isSystemRole,
    isCustomRole,
  };
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get permissions for a role (cached version)
 */
export async function getRolePermissions(roleName: string): Promise<string[]> {
  const normalizedRoleName = normalizeRoleName(roleName) ?? roleName;

  if (isBuiltInRoleName(normalizedRoleName)) {
    return [...(SYSTEM_ROLE_PERMISSIONS[normalizedRoleName as UserRole] || [])];
  }

  const aliasedRole = resolveSystemRole(normalizedRoleName);

  try {
    const stored = await fetchStoredRole(normalizedRoleName);
    if (stored.role) {
      return stored.role.permissions;
    }
    if (stored.state === "inactive") {
      return [];
    }
  } catch (error) {
    console.error("Error fetching role permissions:", error);
  }

  return aliasedRole ? [...(SYSTEM_ROLE_PERMISSIONS[aliasedRole] || [])] : [];
}

/**
 * Clear permission cache for a specific role or all roles
 */
export function clearPermissionCache(roleName?: string): void {
  if (roleName) {
    permissionCache.delete(normalizeRoleName(roleName) ?? roleName);
  } else {
    permissionCache.clear();
  }
}

// ============================================================================
// AVAILABLE ROLES HOOK (UNION: SYSTEM + CUSTOM)
// ============================================================================

export function useAvailableRoles() {
  const [roles, setRoles] = useState<IRoleConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRoles = async () => {
      try {
        setIsLoading(true);
        setError(null);
        const res = await fetch("/api/roles?includeSystem=true");
        if (!res.ok) {
          throw new Error(`Failed to load roles: ${res.statusText}`);
        }
        const data = await res.json();
        const rolesRaw: IRoleConfig[] = data?.data?.roles ?? data?.roles ?? [];
        // Sort: system roles first, then custom alphabetically
        const sorted = rolesRaw
          .filter((r) => r?.isActive)
          .sort((a, b) => {
            if (a.isSystem && !b.isSystem) return -1;
            if (!a.isSystem && b.isSystem) return 1;
            return a.label.localeCompare(b.label);
          });
        setRoles(sorted);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load roles");
        setRoles([]);
      } finally {
        setIsLoading(false);
      }
    };
    loadRoles();
  }, []);

  return { roles, isLoading, error };
}
