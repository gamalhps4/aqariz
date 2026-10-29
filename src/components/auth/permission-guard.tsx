"use client";

import React from "react";
import { useSession } from "@/lib/auth-client";
import { UserRole } from "@/types";
import {
  createAccessProfile,
  matchesRequiredRoles,
} from "@/lib/permissions-manager";
import { useRolePermissions } from "@/hooks/useRolePermissions";

interface PermissionGuardProps {
  children: React.ReactNode;
  roles?: string[];
  permissions?: string[];
  requireAll?: boolean;
  fallback?: React.ReactNode;
  showFallback?: boolean;
}

/**
 * Permission Guard Component
 * Conditionally renders children based on user roles and permissions
 * Uses useRolePermissions hook for consistent permission checking
 */
export function PermissionGuard({
  children,
  roles = [],
  permissions: requiredPermissions = [],
  requireAll = false,
  fallback = null,
  showFallback = true,
}: PermissionGuardProps) {
  const { data: session, status } = useSession();
  const {
    permissions: rolePermissions,
    storedGroup,
    hasAnyPermission,
    hasAllPermissions,
    isLoading: permissionsLoading,
  } = useRolePermissions();

  // Show nothing while loading
  if (status === "loading" || permissionsLoading) {
    return null;
  }

  // Show fallback if not authenticated
  if (!session?.user) {
    return showFallback ? fallback : null;
  }

  const accessProfile = createAccessProfile(
    session.user.role,
    rolePermissions,
    null,
    { storedGroup }
  );

  // Check role-based permissions
  const hasRequiredRole = matchesRequiredRoles(accessProfile, roles);

  // Check custom permissions using the hook
  let hasRequiredPermissions = true;
  if (requiredPermissions.length > 0) {
    hasRequiredPermissions = requireAll
      ? hasAllPermissions(requiredPermissions)
      : hasAnyPermission(requiredPermissions);
  }

  // Show children if user has required permissions
  if (hasRequiredRole && hasRequiredPermissions) {
    return <>{children}</>;
  }

  // Show fallback if user doesn't have permissions
  return showFallback ? fallback : null;
}

/**
 * Hook to check user permissions - Enhanced version
 */
export function usePermissions() {
  const { data: session } = useSession();
  const {
    permissions,
    storedGroup,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isLoading,
    error,
  } = useRolePermissions();
  const accessProfile = createAccessProfile(
    session?.user?.role,
    permissions,
    null,
    { storedGroup }
  );

  const checkRole = (roles: string[]): boolean => {
    if (!session?.user?.role) {
      return false;
    }

    return matchesRequiredRoles(accessProfile, roles);
  };

  return {
    user: session?.user,
    userRole: session?.user?.role,
    permissions,
    isLoading,
    error,
    checkPermission: hasPermission,
    checkRole,
    checkMultiplePermissions: (perms: string[], requireAll = false) =>
      requireAll ? hasAllPermissions(perms) : hasAnyPermission(perms),
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    isAdmin: accessProfile.isAdmin,
    canManageProperties:
      accessProfile.isCompanyStaff ||
      hasAnyPermission([
        "property_management",
        "property_create",
        "property_edit",
        "property_delete",
      ]),
    canAccessTenantFeatures:
      accessProfile.isTenant || accessProfile.isCompanyStaff,
  };
}

/**
 * Higher-order component for permission-based rendering
 */
export function withPermissions<P extends object>(
  Component: React.ComponentType<P>,
  requiredRoles: string[] = [],
  requiredPermissions: string[] = [],
  fallback?: React.ComponentType
) {
  return function PermissionWrappedComponent(props: P) {
    const FallbackComponent = fallback;
    return (
      <PermissionGuard
        roles={requiredRoles}
        permissions={requiredPermissions}
        fallback={FallbackComponent ? <FallbackComponent /> : undefined}
      >
        <Component {...props} />
      </PermissionGuard>
    );
  };
}

/**
 * Role-specific components for common use cases
 */
// MANAGER requirement also matches admins via matchesRequiredRoles hierarchy.
const COMPANY_STAFF_ROLES: string[] = [UserRole.MANAGER];

export const AdminOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard roles={[UserRole.ADMIN]} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const ManagerOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard roles={COMPANY_STAFF_ROLES} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const TenantOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard roles={[UserRole.TENANT]} fallback={fallback}>
    {children}
  </PermissionGuard>
);

export const CompanyStaffOnly: React.FC<{
  children: React.ReactNode;
  fallback?: React.ReactNode;
}> = ({ children, fallback }) => (
  <PermissionGuard roles={COMPANY_STAFF_ROLES} fallback={fallback}>
    {children}
  </PermissionGuard>
);
