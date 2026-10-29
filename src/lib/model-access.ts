import { AccessProfile, hasAnyPermission } from "./permissions-manager";
import { resolveAccessProfile } from "./server-permissions";

const STAFF_VALIDATION_PERMISSIONS = [
  "property_management",
  "property_view",
  "tenant_management",
  "lease_management",
  "lease_view",
  "maintenance_management",
  "maintenance_assign",
  "financial_management",
  "payment_processing",
  "document_management",
  "company_settings",
  "user_management",
  "role_management",
  "system_settings",
] as const;

const MAINTENANCE_ASSIGNABLE_PERMISSIONS = [
  "maintenance_management",
  "maintenance_assign",
  "maintenance_view",
  "work_orders",
] as const;

// One resolution for every caller. This used to carry its own copy of the
// role lookup, and a second copy is a second place for a stored group to be
// mistaken for the built-in role its name spells.
export async function resolveAccessProfileForValidation(
  role?: string | null
): Promise<AccessProfile> {
  return resolveAccessProfile(role);
}

export async function isTenantAccessRole(
  role?: string | null
): Promise<boolean> {
  const profile = await resolveAccessProfileForValidation(role);
  return profile.isTenant;
}

export async function isCompanyStaffAccessRole(
  role?: string | null
): Promise<boolean> {
  const profile = await resolveAccessProfileForValidation(role);
  return (
    profile.isCompanyStaff ||
    hasAnyPermission(profile.permissions, STAFF_VALIDATION_PERMISSIONS)
  );
}

export async function isMaintenanceAssignableRole(
  role?: string | null
): Promise<boolean> {
  const profile = await resolveAccessProfileForValidation(role);
  return (
    profile.isCompanyStaff &&
    hasAnyPermission(profile.permissions, MAINTENANCE_ASSIGNABLE_PERMISSIONS)
  );
}
