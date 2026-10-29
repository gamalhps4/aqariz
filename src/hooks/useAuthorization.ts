"use client";

import { useMemo } from "react";
import { useSession } from "@/lib/auth-client";
import {
  canAccessRoleConfiguration,
  canCreateUsers,
  canDeleteUsers,
  canEditUsers,
  canManageRoles,
  canManageUsers,
  canViewUsers,
  createAccessProfile,
  hasAnyPermission,
  hasPermission,
} from "@/lib/permissions-manager";
import { useRolePermissions } from "./useRolePermissions";

export function useAuthorization() {
  const { data: session, status } = useSession();
  const role = session?.user?.role;
  const {
    permissions,
    storedGroup,
    isLoading: permissionsLoading,
    error,
    refreshPermissions,
  } = useRolePermissions();

  const accessProfile = useMemo(
    () => createAccessProfile(role, permissions, null, { storedGroup }),
    [role, permissions, storedGroup]
  );

  return {
    accessProfile,
    permissions,
    isLoading: status === "loading" || permissionsLoading,
    error,
    refreshPermissions,
    canViewUsers: canViewUsers(accessProfile),
    canManageUsers: canManageUsers(accessProfile),
    // The employee actions one at a time, as the routes ask for them: a
    // group may be given Add without Delete. `canManageUsers` is all five.
    canCreateUsers: canCreateUsers(accessProfile),
    canEditUsers: canEditUsers(accessProfile),
    canDeleteUsers: canDeleteUsers(accessProfile),
    canExportUsers: hasAnyPermission(accessProfile.permissions, [
      "user_export",
      "user_management",
      "data_export",
    ]),
    canManageRoles: canManageRoles(accessProfile),
    canAccessRoleConfiguration: canAccessRoleConfiguration(accessProfile),
    // Display & branding, email and payment-gateway settings. The permission
    // the settings API asks for, so that a permission group ticked "System
    // settings" is let in by the screens as well as by the server.
    canManageSystemSettings: hasPermission(
      accessProfile.permissions,
      "system_settings"
    ),
    accessLevel: accessProfile.accessLevel,
    isAdmin: accessProfile.isAdmin,
    isManager: accessProfile.isManager,
    isOwner: accessProfile.isOwner,
    isTenant: accessProfile.isTenant,
    isCompanyStaff: accessProfile.isCompanyStaff,
  };
}
