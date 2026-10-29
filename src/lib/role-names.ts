import type { Prisma } from "@/generated/prisma/client";
import { UserRole, type IRoleConfig } from "@/types";
import {
  canManageTargetRole,
  createAccessProfile,
  isBuiltInRoleName,
  isReservedRoleName,
  normalizeRoleName,
  type AccessProfile,
} from "./permissions-manager";
import { SYSTEM_ROLE_PERMISSIONS } from "./permission-catalog";

/**
 * PropertyPro - What a permission group is called, and how one is found
 *
 * A group has two names. The *label* is what the office typed and what every
 * screen shows: any language, any punctuation. The *name* is the key stored on
 * each member's user row and compared on every request, so it stays lowercase
 * ASCII and is made here rather than typed.
 *
 * The two used to be one. The screen lowercased the label, swapped its spaces
 * for underscores and sent that as the name, which the server held to
 * ^[a-z0-9_]+$ — so "المحاسبون" and "Sales & Marketing" could not be created
 * at all, while "Administrator" could, under the key `administrator`, which
 * is an alias of the built-in role.
 *
 * No database here: the routes read the organization's roles and hand them
 * in, which is what lets the rules be tested.
 */

/** What a label with no Latin letter or digit in it is keyed as. */
const ROLE_NAME_FALLBACK = "group";

/**
 * How much of a label goes into its name. Names have always been held to 50
 * characters; this leaves room under that for the fallback prefix and a
 * counter, either of which may be added.
 */
const ROLE_NAME_BASE_LENGTH = 36;

/**
 * The name a label would be stored under, before it is made unique.
 *
 * Latin letters and digits carry over ("Sales & Marketing" → sales_marketing,
 * "Gérance" → gerance), so a member's role still reads as the group wherever
 * only the name is to hand. A label with none — an Arabic one — has nothing
 * to carry over and is keyed `group`; its label is what gets shown.
 *
 * Never a built-in role's name or alias: a label such as "مدير admin" is not
 * reserved itself, but the `admin` it would reduce to is.
 */
export function roleNameFromLabel(label: string): string {
  const slug = label
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, ROLE_NAME_BASE_LENGTH)
    .replace(/_+$/, "");

  if (!slug) {
    return ROLE_NAME_FALLBACK;
  }

  return isReservedRoleName(slug) ? `${ROLE_NAME_FALLBACK}_${slug}` : slug;
}

/**
 * `base`, or the first of base_2, base_3… that nothing holds.
 *
 * `taken` must include the names of archived groups. A member's user row
 * keeps the name after the group is archived, so handing the name to a new
 * group would quietly enrol them in it.
 */
export function uniqueRoleName(
  base: string,
  taken: ReadonlySet<string>,
): string {
  if (!taken.has(base)) {
    return base;
  }

  let counter = 2;
  while (taken.has(`${base}_${counter}`)) {
    counter += 1;
  }
  return `${base}_${counter}`;
}

/**
 * A label as a person reads it: case, width and spacing aside, and without
 * the characters that take up no room on a screen.
 */
export function roleLabelKey(label: string): string {
  return label
    .normalize("NFKC")
    .replace(/\p{Cf}+/gu, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export type RoleLabelProblem = "reserved" | "taken";

/**
 * What a group is called: its label, which every screen falls back to, and
 * the Arabic name an Arabic screen shows in its place when there is one.
 */
export interface RoleNames {
  label: string;
  labelAr?: string | null;
}

/** Both of a group's names, as they are compared: the ones that were given. */
function givenNames(names: RoleNames): string[] {
  return [names.label, names.labelAr ?? ""]
    .map(roleLabelKey)
    .filter(Boolean);
}

/**
 * Why a label cannot be given to a group, or null when it can.
 *
 * `others` is every other role the organization still has. With the name no
 * longer derived from the label, nothing else stops two groups being called
 * the same thing, and on a screen that is all that tells them apart.
 *
 * A group has two names, and a reader sees one of them depending on the
 * language of their screen, so each is held to both of every other group's:
 * "المحاسبون" typed as one group's Arabic name is taken by another group
 * whose label it already is.
 */
export function roleLabelProblem(
  names: RoleNames | string,
  others: ReadonlyArray<RoleNames>,
): RoleLabelProblem | null {
  const candidate: RoleNames =
    typeof names === "string" ? { label: names } : names;

  if (
    isReservedRoleName(candidate.label) ||
    (candidate.labelAr ? isReservedRoleName(candidate.labelAr) : false)
  ) {
    return "reserved";
  }

  const keys = new Set(givenNames(candidate));
  return others.some((other) =>
    givenNames(other).some((key) => keys.has(key)),
  )
    ? "taken"
    : null;
}

/**
 * What the API answers for each problem. The code is what the role screen
 * translates; the message is for any caller that does not.
 */
export const ROLE_LABEL_ERRORS: Record<
  RoleLabelProblem,
  { message: string; code: string }
> = {
  reserved: {
    message: "That name belongs to a built-in role. Choose a different name.",
    code: "ROLE_NAME_RESERVED",
  },
  taken: {
    message: "A role with this name already exists. Choose a different name.",
    code: "ROLE_NAME_TAKEN",
  },
};

export interface RoleListRequest {
  /** One group, by its exact stored name. */
  name?: string | null;
  /** Free text over label, description and name: the role screen's search. */
  search?: string | null;
  includeSystem?: boolean;
  includeInactive?: boolean;
}

/**
 * The `where` for GET /api/roles, or null when the caller may not ask.
 *
 * Two different questions arrive there. The role screen *searches*: free
 * text, matched by substring. The permission hook *looks up*: it needs the
 * one group a user belongs to, and no other row will do. The hook used to ask
 * through the search — `?search=accounts&limit=1` — and take the one row
 * back. For a caller allowed to search, that row is the newest group with
 * "accounts" anywhere in its label, description or name. `name` is the
 * lookup: equality on the stored name, never a substring.
 *
 * Without role_management a caller reads exactly one group, their own,
 * whichever way they ask.
 */
export function roleListFilter(
  caller: { canManageRoles: boolean; roleName: string | null },
  request: RoleListRequest,
): Prisma.RoleWhereInput | null {
  const name = normalizeRoleName(request.name);

  let ownName: string | null = null;
  if (!caller.canManageRoles) {
    const asked = name ?? normalizeRoleName(request.search);
    if (!caller.roleName || asked !== caller.roleName) {
      return null;
    }
    ownName = caller.roleName;
  }

  const where: Prisma.RoleWhereInput = {};

  if (!request.includeInactive) {
    where.isActive = true;
    where.deletedAt = null;
  }

  if (!request.includeSystem) {
    where.isSystem = false;
  }

  if (ownName) {
    where.name = ownName;
    where.isSystem = false;
  } else if (name) {
    where.name = name;
  } else if (request.search) {
    where.OR = [
      { label: { contains: request.search, mode: "insensitive" } },
      { labelAr: { contains: request.search, mode: "insensitive" } },
      { description: { contains: request.search, mode: "insensitive" } },
      { name: { contains: request.search, mode: "insensitive" } },
    ];
  }

  return where;
}

/** A stored role row, as far as the role screen needs it. */
export interface StoredRoleRow {
  id: string;
  name: string;
  label: string;
  labelAr: string | null;
  description: string;
  permissions: string[];
  isSystem: boolean;
  isActive: boolean;
  color: string;
  createdById: string | null;
  updatedById: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * What a role grants. A built-in role's row is a copy taken when the
 * organization was set up, and the catalogue has grown since, so its rights
 * are read from the catalogue — which is also what the server enforces.
 */
export function effectiveRolePermissions(role: {
  name: string;
  isSystem: boolean;
  permissions: string[];
}): string[] {
  if (role.isSystem && isBuiltInRoleName(role.name)) {
    return [...(SYSTEM_ROLE_PERMISSIONS[role.name as UserRole] ?? [])];
  }
  return role.permissions;
}

/**
 * Whether `caller` may change this group: the rule the write routes apply,
 * short of the members' buildings, which only a write looks up.
 */
export function callerMayChangeGroup(
  caller: AccessProfile & { originalRole: string },
  role: { name: string; isSystem: boolean; permissions: string[] },
): boolean {
  if (role.isSystem) return false;
  if (caller.isAdmin) return true;
  if (normalizeRoleName(caller.originalRole) === role.name) return false;
  return canManageTargetRole(
    caller,
    createAccessProfile(role.name, role.permissions, null, {
      storedGroup: "active",
    }),
  );
}

/** A role as the role screen reads it. */
export function toRoleConfig(
  role: StoredRoleRow,
  userCount: number,
  caller: AccessProfile & { originalRole: string },
): IRoleConfig {
  const canEdit = callerMayChangeGroup(caller, role);
  return {
    _id: role.id,
    name: role.name,
    label: role.label,
    labelAr: role.labelAr,
    description: role.description,
    permissions: effectiveRolePermissions(role),
    isSystem: role.isSystem,
    isActive: role.isActive,
    color: role.color as IRoleConfig["color"],
    userCount,
    canEdit,
    canDelete: canEdit && userCount === 0,
    createdBy: role.createdById ?? undefined,
    updatedBy: role.updatedById ?? undefined,
    createdAt: role.createdAt,
    updatedAt: role.updatedAt,
  };
}
