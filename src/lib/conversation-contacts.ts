/**
 * PropertyPro - Who a caller may list as a conversation contact
 *
 * `GET /api/conversations/contacts` used to take `?roles=` straight from the
 * query string, so a tenant could ask for `roles=tenant,owner` and read the
 * name and email of every tenant and owner in the office. The roles a caller
 * asks for are now cut down to the roles they may see, and an employee
 * limited to some buildings sees only the tenants of those buildings.
 *
 * Pure: the route passes in the tenant scope (lib/db/scopes.ts), so the rule
 * is tested without a database.
 */

import { UserRole } from "@/types";

export interface ContactCaller {
  isTenant: boolean;
  isOwner?: boolean;
}

/**
 * The roles a caller may see. A tenant or an owner reaches the office's
 * staff; staff (permission groups included) reach staff and tenants.
 */
export function visibleContactRoles(caller: ContactCaller): UserRole[] {
  if (caller.isTenant || caller.isOwner) {
    return [UserRole.ADMIN, UserRole.MANAGER];
  }
  return [UserRole.ADMIN, UserRole.MANAGER, UserRole.TENANT];
}

/** "a, b,,c" → ["a", "b", "c"]; null when the parameter names no role. */
export function roleList(value: string | null | undefined): string[] | null {
  const roles = (value ?? "")
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
  return roles.length > 0 ? roles : null;
}

/**
 * The role clause of the contacts query, to AND onto it.
 *
 * `requested` narrows what the caller may see and never widens it; a role
 * outside it is dropped, and asking only for such roles matches no one.
 * `tenantScope` is the caller's tenant scope (`tenantRecordScope`), put on
 * the tenant rows only: `{}` for unrestricted staff.
 */
export function contactRoleWhere(input: {
  visible: readonly string[];
  requested: readonly string[] | null;
  excluded: readonly string[] | null;
  tenantScope: object;
}): Record<string, unknown> {
  const excluded = new Set(input.excluded ?? []);
  const roles = (input.requested ?? input.visible).filter(
    (role, index, all) =>
      input.visible.includes(role) &&
      !excluded.has(role) &&
      all.indexOf(role) === index,
  );
  if (roles.length === 0) return { id: { in: [] } };

  const tenants = roles.includes(UserRole.TENANT);
  if (!tenants || Object.keys(input.tenantScope).length === 0) {
    return { role: { in: roles } };
  }
  const others = roles.filter((role) => role !== UserRole.TENANT);
  return {
    OR: [
      ...(others.length > 0 ? [{ role: { in: others } }] : []),
      { AND: [{ role: UserRole.TENANT }, input.tenantScope] },
    ],
  };
}
