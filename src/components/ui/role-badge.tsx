/**
 * PropertyPro - Role Badge Component
 * Consistent role display with proper styling and colors
 */

"use client";

import React from "react";
import { Badge } from "@/components/ui/badge";
import { UserRole } from "@/types";
import { cn } from "@/lib/utils";
import { useLocalizationContext } from "@/components/providers/LocalizationProvider";

type Translate = (key: string, options?: { defaultValue?: string }) => string;

interface RoleBadgeProps {
  role: string;
  /**
   * What a permission group is called, where the caller knows it. Ignored
   * for built-in roles, which are named in the reader's language.
   */
  label?: string;
  className?: string;
  variant?: "default" | "secondary" | "destructive" | "outline";
  size?: "sm" | "default" | "lg";
}

// Role configuration with colors and labels - Updated for simplified role system
// Partial: roles without an entry (e.g. SUPER_ADMIN) fall back to the generic
// formatted-label rendering below.
const roleConfig: Partial<
  Record<UserRole, { label: string; color: string; description: string }>
> = {
  [UserRole.ADMIN]: {
    label: "Property Administrator",
    color:
      "bg-red-100 text-red-800 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800",
    description: "Full system access and control",
  },
  [UserRole.MANAGER]: {
    label: "Property Manager",
    color:
      "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800",
    description: "Manages properties and operations",
  },
  [UserRole.OWNER]: {
    label: "Property Owner",
    color:
      "bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800",
    description: "Owns buildings; reads only their own portfolio",
  },
  [UserRole.TENANT]: {
    label: "Tenant",
    color:
      "bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800",
    description: "Property tenant with basic access",
  },
};

export function RoleBadge({
  role,
  label: groupLabel,
  className,
  variant,
  size = "default",
}: RoleBadgeProps) {
  const { t } = useLocalizationContext();
  const systemRole = (Object.values(UserRole) as string[]).includes(role)
    ? (role as UserRole)
    : undefined;
  const config = systemRole ? roleConfig[systemRole] : undefined;
  const label = (!systemRole && groupLabel) || getRoleLabel(role, t);

  if (!config) {
    return <Badge variant="outline" className={className}>{label}</Badge>;
  }

  // Use custom colors if no variant is specified
  if (!variant) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          config.color,
          {
            "px-2 py-0.5 text-xs": size === "sm",
            "px-2.5 py-0.5 text-xs": size === "default",
            "px-3 py-1 text-sm": size === "lg",
          },
          className
        )}
      >
        {label}
      </span>
    );
  }

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

// Helper function to get role configuration
export function getRoleConfig(role: string) {
  const systemRole = (Object.values(UserRole) as string[]).includes(role)
    ? (role as UserRole)
    : undefined;
  return (
    (systemRole && roleConfig[systemRole]) || {
      label: role
        .replace(/_/g, " ")
        .replace(/\b\w/g, (l) => l.toUpperCase()),
      color: "bg-gray-100 text-gray-800 border-gray-200",
      description: role,
    }
  );
}

// Helper function to get role label. Pass `t` for the reader's language; a
// custom role keeps the name the office gave it.
export function getRoleLabel(role: string, t?: Translate): string {
  const systemRole = (Object.values(UserRole) as string[]).includes(role)
    ? (role as UserRole)
    : undefined;
  const english = systemRole && roleConfig[systemRole]?.label;
  if (english) {
    return t
      ? t(`admin.roles.defaultRoles.${systemRole}.label`, { defaultValue: english })
      : english;
  }
  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

// Helper function to get role description
export function getRoleDescription(role: string, t?: Translate): string {
  const systemRole = (Object.values(UserRole) as string[]).includes(role)
    ? (role as UserRole)
    : undefined;
  const english = systemRole && roleConfig[systemRole]?.description;
  if (!english) return role;
  return t
    ? t(`admin.roles.defaultRoles.${systemRole}.description`, { defaultValue: english })
    : english;
}

// Role selector component for forms
interface RoleSelectorProps {
  value: string;
  onChange: (role: string) => void;
  allowedRoles?: string[];
  disabled?: boolean;
  className?: string;
}

export function RoleSelector({
  value,
  onChange,
  allowedRoles,
  disabled = false,
  className,
}: RoleSelectorProps) {
  const { t } = useLocalizationContext();
  const roles =
    allowedRoles || (Object.values(UserRole) as string[]);

  return (
    <div className={cn("space-y-2", className)}>
      {roles.map((role) => {
        const systemRole = (Object.values(UserRole) as string[]).includes(role)
          ? (role as UserRole)
          : undefined;
        const config = systemRole ? roleConfig[systemRole] : undefined;
        return (
          <label
            key={role}
            className={cn(
              "flex items-center space-x-3 rounded-lg border p-3 cursor-pointer transition-colors",
              value === role
                ? "border-primary bg-primary/5"
                : "border-border hover:bg-muted/50",
              disabled && "opacity-50 cursor-not-allowed"
            )}
          >
            <input
              type="radio"
              name="role"
              value={role}
              checked={value === role}
              onChange={(e) => onChange(e.target.value)}
              disabled={disabled}
              className="sr-only"
            />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <span className="font-medium">{getRoleLabel(role, t)}</span>
                <RoleBadge role={role} size="sm" />
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                {config ? getRoleDescription(role, t) : role}
              </p>
            </div>
          </label>
        );
      })}
    </div>
  );
}

// Role comparison utilities
export function isHigherRole(role1: string, role2: string): boolean {
  const hierarchy: string[] = [UserRole.TENANT, UserRole.MANAGER, UserRole.ADMIN];

  return hierarchy.indexOf(role1) > hierarchy.indexOf(role2);
}

export function canManageRole(
  managerRole: string,
  targetRole: string
): boolean {
  // Admins can manage all roles
  if (managerRole === UserRole.ADMIN) {
    return true;
  }

  // Managers can manage tenants only
  if (managerRole === UserRole.MANAGER) {
    return targetRole === UserRole.TENANT;
  }

  return false;
}
