import { UserRole } from "@/types";
import { SYSTEM_ROLE_PERMISSIONS } from "./permission-catalog";

export { SYSTEM_ROLE_PERMISSIONS } from "./permission-catalog";

/**
 * Access tiers, lowest to highest.
 *
 * "platform" is the super-admin tier that operates above every organization.
 * It used to be folded into "admin" by the alias table below, which meant an
 * organization admin and the platform owner ranked identically — and every
 * `if (actor.isAdmin) return true` shortcut let an org admin hand out, view and
 * manage the platform role. Splitting the tier is what closes that.
 *
 * A tier belongs to a role, never to what the role has been ticked. A
 * permission group an organization defines is office staff and sits on
 * "manager"; "admin" is the built-in Administrator and nothing else.
 */
export type AccessLevel =
  | "tenant"
  | "owner"
  | "manager"
  | "admin"
  | "platform";

export interface AccessProfile {
  role: string;
  originalRole: string;
  normalizedRole: string;
  systemRole: UserRole | null;
  permissions: string[];
  accessLevel: AccessLevel;
  isSystemRole: boolean;
  /**
   * Not a built-in role: a permission group the organization defined, or a
   * name that resolves to nothing at all.
   */
  isCustomRole: boolean;
  /** The platform super-admin tier, and nothing else. */
  isPlatform: boolean;
  /** A property owner: a client of the office, scoped to their own buildings. */
  isOwner: boolean;
  /**
   * Admin tier *or above* — so the platform tier answers true here too. Never
   * a permission group: where a group should be able to do something, ask for
   * the permission that names it.
   */
  isAdmin: boolean;
  /** The built-in Manager and every permission group: the office's staff. */
  isManager: boolean;
  isTenant: boolean;
  isCompanyStaff: boolean;
}

const BASELINE_AUTHENTICATED_PERMISSIONS = ["profile_management"] as const;

/**
 * The roles an organization may hand out.
 *
 * SUPER_ADMIN is deliberately absent: platform admins are provisioned by the
 * bootstrap script and hold no organizationId, so an organization assigning
 * that name would only be minting a user whose role string lies about what it
 * is. Use this instead of `Object.values(UserRole)` anywhere a role is offered
 * or accepted inside an organization.
 */
export const ASSIGNABLE_ORG_ROLES: readonly UserRole[] = [
  UserRole.ADMIN,
  UserRole.MANAGER,
  UserRole.OWNER,
  UserRole.TENANT,
];

/**
 * Legacy and human-written role names mapped onto the system roles.
 *
 * owner / property_owner / landlord used to resolve to MANAGER, which silently
 * granted a property owner every manager permission — including sight of every
 * *other* owner's portfolio. They now resolve to UserRole.OWNER, which reads
 * only its own buildings.
 *
 * Every key here is also a name no permission group may take — see
 * isReservedRoleName.
 */
const ROLE_ALIAS_LOOKUP: Record<string, UserRole> = {
  [UserRole.SUPER_ADMIN]: UserRole.SUPER_ADMIN,
  [UserRole.ADMIN]: UserRole.ADMIN,
  administrator: UserRole.ADMIN,
  "property administrator": UserRole.ADMIN,
  property_administrator: UserRole.ADMIN,
  [UserRole.MANAGER]: UserRole.MANAGER,
  "property manager": UserRole.MANAGER,
  property_manager: UserRole.MANAGER,
  [UserRole.OWNER]: UserRole.OWNER,
  "property owner": UserRole.OWNER,
  property_owner: UserRole.OWNER,
  landlord: UserRole.OWNER,
  "maintenance staff": UserRole.MANAGER,
  maintenance_staff: UserRole.MANAGER,
  "leasing agent": UserRole.MANAGER,
  leasing_agent: UserRole.MANAGER,
  [UserRole.TENANT]: UserRole.TENANT,
  renter: UserRole.TENANT,
  resident: UserRole.TENANT,
};

const BUILT_IN_ROLE_NAMES: ReadonlySet<string> = new Set(
  Object.values(UserRole)
);

/**
 * A name reduced to what makes it the same name: case, spacing and
 * punctuation dropped, so "Property-Manager", "property  manager" and
 * "PROPERTY_MANAGER" are one. Accents and characters that take up no room
 * are dropped too — "Ádmin", and "Admin" with a zero-width space in it, read
 * as Admin on a screen.
 */
function roleNameKey(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\p{M}\p{Cf}]+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "_")
    .replace(/^_+|_+$/g, "");
}

const RESERVED_ROLE_KEYS: ReadonlySet<string> = new Set(
  Object.keys(ROLE_ALIAS_LOOKUP).map(roleNameKey)
);

export function normalizeRoleName(role?: string | null): string | null {
  const value = role?.trim();
  return value ? value.toLowerCase() : null;
}

/**
 * The built-in role a name spells, by the alias table alone.
 *
 * This knows nothing of what an organization has stored. Where a name may be
 * one of its permission groups, the stored row decides — see RoleLookup.
 */
export function resolveSystemRole(role?: string | null): UserRole | null {
  const normalizedRole = normalizeRoleName(role);
  // Own keys only: read straight off the object, "constructor" comes back as
  // a function and the name passes for a system role.
  return normalizedRole &&
    Object.prototype.hasOwnProperty.call(ROLE_ALIAS_LOOKUP, normalizedRole)
    ? ROLE_ALIAS_LOOKUP[normalizedRole]
    : null;
}

/**
 * True for the five names the system itself defines, and only those.
 *
 * Narrower than resolveSystemRole on purpose: "administrator" and "landlord"
 * are aliases, and an alias is a name an organization may already hold a
 * group under. These five it cannot.
 */
export function isBuiltInRoleName(role?: string | null): boolean {
  const normalizedRole = normalizeRoleName(role);
  return normalizedRole ? BUILT_IN_ROLE_NAMES.has(normalizedRole) : false;
}

/**
 * True when a name is a built-in role's or one of its aliases, however it is
 * spaced, cased or punctuated — the names no permission group may be given.
 *
 * A group called "Administrator" reads as the built-in role to everyone who
 * sees it on a screen, and under its old name-derived key it resolved to that
 * role too: its members got the Administrator's rights and the permissions
 * ticked for the group were never looked at.
 */
export function isReservedRoleName(value?: string | null): boolean {
  return value ? RESERVED_ROLE_KEYS.has(roleNameKey(value)) : false;
}

/**
 * What the organization's stored roles say about a name, when the caller has
 * looked.
 *
 * The alias table is names the system accepts for its own roles; a permission
 * group is a row an organization made. Where the two collide the row wins:
 * the office ticked permissions for that group and its members get exactly
 * those, not the built-in role the name happens to spell.
 */
export interface RoleLookup {
  /**
   * "active" — a permission group is stored under this name and in force. It
   * is a group whatever the name spells.
   *
   * "inactive" — one is stored but switched off or archived. The name is
   * still the organization's, so it is no alias, and it grants nothing: the
   * least access there is. Falling back to the alias here would promote the
   * members of a group stored as "administrator" on the day it was switched
   * off.
   *
   * "none" — nothing is stored under it. An alias still means its built-in
   * role; any other name is unknown and gets the least access there is.
   *
   * Left out — nobody has looked. An alias means its built-in role, and any
   * other name is taken to be a group.
   */
  storedGroup?: StoredGroupState;
}

/** What the organization's stored roles hold under a name. */
export type StoredGroupState = "active" | "inactive" | "none";

type RoleKind = "system" | "group" | "unknown";

function classifyRole(
  normalizedRole: string,
  lookup?: RoleLookup | null
): { kind: RoleKind; systemRole: UserRole | null } {
  // The five built-in names are the system's; nothing stored can take them.
  if (BUILT_IN_ROLE_NAMES.has(normalizedRole)) {
    return { kind: "system", systemRole: normalizedRole as UserRole };
  }

  if (lookup?.storedGroup === "active") {
    return { kind: "group", systemRole: null };
  }

  // Before the alias table: a group that is switched off still owns its name.
  if (lookup?.storedGroup === "inactive") {
    return { kind: "unknown", systemRole: null };
  }

  const aliasedRole = resolveSystemRole(normalizedRole);
  if (aliasedRole) {
    return { kind: "system", systemRole: aliasedRole };
  }

  return {
    kind: lookup?.storedGroup === "none" ? "unknown" : "group",
    systemRole: null,
  };
}

export function getSystemRolePermissions(role: UserRole): string[] {
  return Array.from(SYSTEM_ROLE_PERMISSIONS[role] ?? []);
}

export function getUniquePermissions(permissions: readonly string[]): string[] {
  return [...new Set(permissions.filter(Boolean).map((permission) => permission.trim()))];
}

export function hasPermission(
  permissions: readonly string[],
  permission: string
): boolean {
  return permissions.includes(permission);
}

export function hasAnyPermission(
  permissions: readonly string[],
  requiredPermissions: readonly string[]
): boolean {
  return requiredPermissions.some((permission) => permissions.includes(permission));
}

export function hasAllPermissions(
  permissions: readonly string[],
  requiredPermissions: readonly string[]
): boolean {
  return requiredPermissions.every((permission) => permissions.includes(permission));
}

export function hasRequiredRole(
  userRole: string | null | undefined,
  requiredRoles: readonly string[]
): boolean {
  const normalizedUserRole = normalizeRoleName(userRole);
  const resolvedUserRole = resolveSystemRole(userRole);

  if (!normalizedUserRole) {
    return false;
  }

  return requiredRoles.some((requiredRole) => {
    const normalizedRequiredRole = normalizeRoleName(requiredRole);
    if (!normalizedRequiredRole) {
      return false;
    }

    if (normalizedUserRole === normalizedRequiredRole) {
      return true;
    }

    const resolvedRequiredRole = resolveSystemRole(requiredRole);
    if (!resolvedUserRole || !resolvedRequiredRole) {
      return false;
    }

    if (resolvedUserRole === resolvedRequiredRole) {
      return true;
    }

    // A platform super-admin satisfies an admin requirement: before the tier
    // split it resolved *to* the admin role, and the dashboard nav still keys
    // off that. No other cross-role match is allowed.
    return (
      resolvedUserRole === UserRole.SUPER_ADMIN &&
      resolvedRequiredRole === UserRole.ADMIN
    );
  });
}

export function matchesRequiredRoles(
  profile: AccessProfile,
  requiredRoles: readonly string[]
): boolean {
  if (requiredRoles.length === 0) {
    return true;
  }

  // A permission group is matched on its tier alone. Comparing names would
  // let one stored as "administrator" pass for the role it is named after.
  if (
    !profile.isCustomRole &&
    hasRequiredRole(profile.originalRole, requiredRoles)
  ) {
    return true;
  }

  const resolvedRequiredRoles = requiredRoles
    .map((requiredRole) => resolveSystemRole(requiredRole))
    .filter((role): role is UserRole => Boolean(role));

  if (resolvedRequiredRoles.length === 0) {
    return false;
  }

  return resolvedRequiredRoles.some((requiredRole) => {
    switch (requiredRole) {
      case UserRole.SUPER_ADMIN:
        return profile.isPlatform;
      case UserRole.ADMIN:
        return profile.isAdmin;
      case UserRole.MANAGER:
        return profile.isManager || profile.isAdmin;
      case UserRole.OWNER:
        return profile.isOwner;
      case UserRole.TENANT:
        return profile.isTenant;
      default:
        return false;
    }
  });
}

/** What a menu entry asks of whoever opens it. */
export interface NavAccessRule {
  roles: readonly string[];
  /** For permission groups: at least one of these is required. */
  requiredPermissions?: readonly string[];
}

/**
 * Whether a menu entry is open to this profile.
 *
 * A built-in role is decided by the roles the entry lists. A permission group
 * is decided by what it has been ticked: it is office staff, so the entry has
 * to be a staff one, and where the entry names permissions the group needs one
 * of them. That holds for the entries otherwise reserved for the
 * Administrator too — it is how a group ticked "View users" reaches the
 * employee list without being an administrator. An entry that names no
 * permission stays with the roles it lists, so an Administrator-only one
 * stays the Administrator's.
 */
export function canAccessNavItem(
  profile: AccessProfile,
  item: NavAccessRule
): boolean {
  if (!profile.isCustomRole) {
    return matchesRequiredRoles(profile, item.roles);
  }

  const requiredPermissions = item.requiredPermissions ?? [];
  if (requiredPermissions.length === 0) {
    return matchesRequiredRoles(profile, item.roles);
  }

  const isStaffEntry = item.roles.some((role) => {
    const systemRole = resolveSystemRole(role);
    return systemRole === UserRole.ADMIN || systemRole === UserRole.MANAGER;
  });
  const openToTier = profile.isCompanyStaff
    ? isStaffEntry
    : matchesRequiredRoles(profile, item.roles);

  return (
    openToTier && hasAnyPermission(profile.permissions, requiredPermissions)
  );
}

function accessLevelOf(
  kind: RoleKind,
  systemRole: UserRole | null
): AccessLevel {
  // Only the literal super_admin system role reaches the platform tier, and
  // only the built-in Administrator the admin one, so no org-defined group
  // can rank with the organization's own administrator, let alone above it.
  if (systemRole === UserRole.SUPER_ADMIN) {
    return "platform";
  }

  if (systemRole === UserRole.ADMIN) {
    return "admin";
  }

  if (systemRole === UserRole.MANAGER) {
    return "manager";
  }

  if (systemRole === UserRole.OWNER) {
    return "owner";
  }

  if (systemRole === UserRole.TENANT) {
    return "tenant";
  }

  // A permission group is office staff, whatever it has been ticked.
  //
  // The tier used to be guessed from the ticks, and both guesses were wrong.
  // Export data, Advanced analytics or Audit log made the group an
  // administrator, so every `isAdmin` check passed for it — ending anyone's
  // session among them. And a group holding none of a fixed list of
  // permissions was a tenant: its staff menus went, its rows narrowed to
  // "its own", of which it has none, and it could not be assigned buildings.
  // What a group may do is its permissions; its tier only says which side of
  // the counter it sits on.
  if (kind === "group") {
    return "manager";
  }

  // A name that resolves to nothing gets the least there is.
  return "tenant";
}

export function getAccessLevel(
  role: string | null | undefined,
  lookup?: RoleLookup | null
): AccessLevel {
  const normalizedRole = normalizeRoleName(role) ?? UserRole.TENANT;
  const { kind, systemRole } = classifyRole(normalizedRole, lookup);
  return accessLevelOf(kind, systemRole);
}

/**
 * One employee's departures from what their role grants.
 *
 * Roles stay the normal way to hand out access; this covers the exceptions an
 * office actually has — the assistant who also reconciles payments, the agent
 * who must not delete contracts — without inventing a role per person.
 */
export interface PermissionOverrides {
  grants?: readonly string[] | null;
  denials?: readonly string[] | null;
}

export function createAccessProfile(
  role: string | null | undefined,
  resolvedPermissions: readonly string[] = [],
  overrides?: PermissionOverrides | null,
  lookup?: RoleLookup | null
): AccessProfile {
  const normalizedRole = normalizeRoleName(role) ?? UserRole.TENANT;
  const { kind, systemRole } = classifyRole(normalizedRole, lookup);
  const originalRole = normalizedRole;
  // System roles intentionally stay static. If we ever decide to allow DB
  // extensions for built-in roles, this is the place to merge them in.
  const rolePermissions = systemRole
    ? getSystemRolePermissions(systemRole)
    : Array.from(resolvedPermissions);

  // Denials are applied LAST and win over everything — the role, the baseline,
  // and an explicit grant on the same person. A contradiction resolving to
  // "no" is what makes revoking a capability dependable: it holds even if the
  // employee is later moved to a role that would have granted it.
  const denied = new Set(overrides?.denials ?? []);

  const permissions = getUniquePermissions([
    ...BASELINE_AUTHENTICATED_PERMISSIONS,
    ...rolePermissions,
    ...(overrides?.grants ?? []),
  ]).filter((permission) => !denied.has(permission));
  // From the role alone: a permission granted to one person on top of their
  // role changes what they may do, never which tier they are on.
  const accessLevel = accessLevelOf(kind, systemRole);
  const isPlatform = accessLevel === "platform";

  return {
    role: systemRole ?? normalizedRole,
    originalRole,
    normalizedRole,
    systemRole,
    permissions,
    accessLevel,
    isSystemRole: normalizedRole === systemRole,
    isCustomRole: !systemRole,
    isPlatform,
    // The platform tier is an admin and then some: every isAdmin check that
    // passed for a super-admin before the tier split must keep passing.
    isAdmin: accessLevel === "admin" || isPlatform,
    isManager: accessLevel === "manager",
    isOwner: accessLevel === "owner",
    isTenant: accessLevel === "tenant",
    // Owners and tenants are the office's clients, not its staff.
    isCompanyStaff: accessLevel === "manager" || accessLevel === "admin" || isPlatform,
  };
}

export function getAccessLevelRank(accessLevel: AccessLevel): number {
  switch (accessLevel) {
    case "platform":
      return 4;
    case "admin":
      return 3;
    case "manager":
      return 2;
    // Owner and tenant share the client tier. They rank equally on purpose:
    // neither may act on the other, and both sit below every staff role, so
    // an owner account can be administered by a manager but is not one.
    default:
      return 1;
  }
}

/**
 * True when the target sits on a tier the actor does not hold.
 *
 * Every guard below consults this *before* its `actor.isAdmin` shortcut. That
 * ordering is the whole point: an organization admin may do as they please
 * within their own organization, but the platform tier is not theirs to view,
 * manage, or hand out.
 */
function outranksActor(actor: AccessProfile, target: AccessProfile): boolean {
  return (
    getAccessLevelRank(target.accessLevel) > getAccessLevelRank(actor.accessLevel)
  );
}

/**
 * What one member of staff reaches, for weighing them against another: the
 * permissions they end up with, and the buildings they are narrowed to.
 *
 * `scopedPropertyIds` follows `User.scopeRestricted`: undefined is not
 * narrowed at all, an array — possibly empty — is exactly those buildings.
 * A target read without its buildings is taken to reach everything, which is
 * the direction that refuses a narrowed actor rather than trusting them.
 */
export interface StaffReach {
  permissions: readonly string[];
  scopedPropertyIds?: readonly string[];
}

/**
 * True when everything `target` can do, and everywhere they can do it,
 * `actor` can too.
 *
 * The rule behind letting a permission group manage staff and other groups
 * (the owner's decision of 2026-10-01): nobody hands out, or takes charge of,
 * more than they hold themselves. Permissions are compared whole — a target's
 * per-person grants included — and buildings as sets.
 */
export function isWithinReach(actor: StaffReach, target: StaffReach): boolean {
  const held = new Set(actor.permissions);
  if (!target.permissions.every((permission) => held.has(permission))) {
    return false;
  }
  if (actor.scopedPropertyIds === undefined) return true;
  if (target.scopedPropertyIds === undefined) return false;
  const buildings = new Set(actor.scopedPropertyIds);
  return target.scopedPropertyIds.every((id) => buildings.has(id));
}

/** A profile, and the buildings its holder is narrowed to where known. */
export type ScopedAccessProfile = AccessProfile & {
  scopedPropertyIds?: readonly string[];
};

export interface TargetUserOptions {
  isSelf?: boolean;
  /**
   * Let a member of staff below the Administrator manage another member of
   * staff within their own reach — see isWithinReach. Only for the edits
   * made to one person at a time, whose target has been read with its
   * per-person grants and its buildings (lib/staff-delegation.ts). Bulk
   * actions leave it off, and for staff they stay with the Administrator.
   */
  withinOwnRights?: boolean;
}

export function canViewUsers(profile: AccessProfile): boolean {
  return hasAnyPermission(profile.permissions, ["user_view", "user_management"]);
}

export function canManageUsers(profile: AccessProfile): boolean {
  return hasPermission(profile.permissions, "user_management");
}

/**
 * The permissions each employee route accepts: the action's own right, or
 * `user_management`, which is all five. One list per action so the routes,
 * the screens and the menu cannot come to disagree about which is which.
 */
export const USER_CREATE_PERMISSIONS = ["user_create", "user_management"] as const;
export const USER_EDIT_PERMISSIONS = ["user_edit", "user_management"] as const;
export const USER_DELETE_PERMISSIONS = ["user_delete", "user_management"] as const;

export function canCreateUsers(profile: AccessProfile): boolean {
  return hasAnyPermission(profile.permissions, USER_CREATE_PERMISSIONS);
}

export function canEditUsers(profile: AccessProfile): boolean {
  return hasAnyPermission(profile.permissions, USER_EDIT_PERMISSIONS);
}

export function canDeleteUsers(profile: AccessProfile): boolean {
  return hasAnyPermission(profile.permissions, USER_DELETE_PERMISSIONS);
}

export function canManageRoles(profile: AccessProfile): boolean {
  return hasPermission(profile.permissions, "role_management");
}

export function canAccessRoleConfiguration(profile: AccessProfile): boolean {
  return canManageRoles(profile);
}

export function canViewTargetUser(
  actor: AccessProfile,
  target: AccessProfile,
  options: { isSelf?: boolean } = {}
): boolean {
  const { isSelf = false } = options;

  if (isSelf) {
    return true;
  }

  if (outranksActor(actor, target)) {
    return false;
  }

  if (actor.isAdmin) {
    return true;
  }

  return (
    getAccessLevelRank(actor.accessLevel) >=
    getAccessLevelRank(target.accessLevel)
  );
}

export function canManageTargetUser(
  actor: ScopedAccessProfile,
  target: ScopedAccessProfile,
  options: TargetUserOptions = {}
): boolean {
  const { isSelf = false, withinOwnRights = false } = options;

  if (isSelf) {
    return true;
  }

  if (outranksActor(actor, target)) {
    return false;
  }

  if (actor.isAdmin) {
    return true;
  }

  if (getAccessLevelRank(actor.accessLevel) > getAccessLevelRank(target.accessLevel)) {
    return true;
  }

  // Staff managing staff. The Administrator is never within anyone's reach
  // below it — the tier check above already refused them — and a group's
  // reach is what it holds, where it holds it.
  return (
    withinOwnRights &&
    actor.isCompanyStaff &&
    target.isCompanyStaff &&
    !target.isAdmin &&
    isWithinReach(actor, target)
  );
}

export function canManageTargetRole(
  actor: AccessProfile,
  targetRoleProfile: AccessProfile
): boolean {
  if (!canManageRoles(actor)) {
    return false;
  }

  if (outranksActor(actor, targetRoleProfile)) {
    return false;
  }

  if (actor.isAdmin) {
    return true;
  }

  if (
    getAccessLevelRank(actor.accessLevel) >
    getAccessLevelRank(targetRoleProfile.accessLevel)
  ) {
    return true;
  }

  // A staff role — a permission group, or the built-in Manager — is within
  // reach when every right it grants is one the actor holds. A role carries
  // no buildings; whose buildings its members see is weighed per member.
  return (
    targetRoleProfile.isCompanyStaff &&
    !targetRoleProfile.isAdmin &&
    isWithinReach(
      { permissions: actor.permissions },
      { permissions: targetRoleProfile.permissions }
    )
  );
}

// The helpers below answer from a role *name* and the alias table, so they
// cannot tell a stored permission group from the built-in role its name may
// spell. Where the answer decides access, build an access profile instead.

/** The platform super-admin tier — above every organization. */
export function isPlatformRole(role?: string | null): boolean {
  return resolveSystemRole(role) === UserRole.SUPER_ADMIN;
}

/** Admin tier or above, so a platform super-admin answers true here too. */
export function isAdminRole(role?: string | null): boolean {
  const systemRole = resolveSystemRole(role);
  return systemRole === UserRole.ADMIN || systemRole === UserRole.SUPER_ADMIN;
}

export function isManagerRole(role?: string | null): boolean {
  return resolveSystemRole(role) === UserRole.MANAGER;
}

/** A property owner — a client of the office, scoped to their own buildings. */
export function isOwnerRole(role?: string | null): boolean {
  return resolveSystemRole(role) === UserRole.OWNER;
}

export function isTenantRole(role?: string | null): boolean {
  return resolveSystemRole(role) === UserRole.TENANT;
}

export function canBeAssignedMaintenance(role?: string | null): boolean {
  const systemRole = resolveSystemRole(role);
  return systemRole === UserRole.ADMIN || systemRole === UserRole.MANAGER;
}

export function formatRoleLabel(role?: string | null): string {
  const normalizedRole = normalizeRoleName(role);
  if (!normalizedRole) {
    return "Unknown";
  }

  return normalizedRole.replace(/_/g, " ").replace(/\b\w/g, (char) =>
    char.toUpperCase()
  );
}
