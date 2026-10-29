/**
 * PropertyPro - Who may destroy archived records
 *
 * The scope is explicit: "Only the System Owner or Super Admin may permanently
 * delete archived records. Regular subscribers must not have permanent
 * deletion rights."
 *
 * That is a role rule, not a permission rule — so it deliberately does NOT go
 * through the permission catalogue, where an organization admin could grant
 * themselves anything. Restoring is unrestricted by comparison, because it
 * destroys nothing.
 */

import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { hasPermission } from "@/lib/permissions-manager";

/** The platform Super Admin, or the owner of this SaaS account. */
export function canPurgeArchive(
  user: Pick<AuthenticatedAccessUser, "isPlatformAdmin" | "isOrganizationOwner">,
): boolean {
  return Boolean(user.isPlatformAdmin || user.isOrganizationOwner);
}

/**
 * Whether this caller may destroy a record for good — the whole rule, which
 * is TWO gates, and both must hold.
 *
 * The role rule above is the floor. `permanent_delete` sits on top of it and
 * can only narrow: it is how an account owner withholds irreversible deletion
 * from someone who would otherwise qualify. Everything that answers "may this
 * caller destroy records?" asks here — the purge itself, and the flag that
 * tells the archive screen whether to offer it. When the flag asked only the
 * role rule, a caller without the permission was shown a delete button that
 * answered 403.
 */
export function canPermanentlyDelete(
  user: Pick<
    AuthenticatedAccessUser,
    "isPlatformAdmin" | "isOrganizationOwner" | "permissions"
  >,
): boolean {
  return (
    canPurgeArchive(user) && hasPermission(user.permissions, "permanent_delete")
  );
}

export const PURGE_DENIED_MESSAGE =
  "Only the account owner or a platform super admin can permanently delete an archived record. You can restore it, or leave it archived.";
