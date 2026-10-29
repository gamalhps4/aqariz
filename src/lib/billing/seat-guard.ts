/**
 * PropertyPro SaaS - Seat guard for role changes
 *
 * Creating a staff account checks the plan's seat limit; PROMOTING one did
 * not. Tenants and property owners are free and unlimited, so turning a tenant
 * into a manager was a supported way past the cap — on the bulk endpoint, a
 * hundred at a time.
 *
 * Both role-change paths call this, and it deliberately mirrors the create
 * path: same limit key, same counter (`staffSeatWhere`), same error type.
 */

import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import { enforcePlanLimit } from "./entitlements";
import { countStaffSeats } from "./usage";

/** Roles that do not consume a billed seat. */
const UNBILLED_ROLES: readonly string[] = [UserRole.TENANT, UserRole.OWNER];

export function roleConsumesSeat(role: string | null | undefined): boolean {
  return Boolean(role) && !UNBILLED_ROLES.includes(role as string);
}

/**
 * Refuse a role change that would put the organization over its seat limit.
 *
 * `promotions` is how many accounts are moving from an unbilled role to a
 * billed one in this request. Demotions and same-side moves cost nothing and
 * are never blocked, so an organization over its cap can always downgrade its
 * way back under it.
 */
export async function enforceSeatLimitForRoleChange(
  organizationId: string,
  promotions: number,
): Promise<void> {
  if (promotions <= 0) return;
  await enforcePlanLimit(
    organizationId,
    "members",
    await countStaffSeats(),
    promotions,
  );
}

/** How many of `userIds` would newly consume a seat by moving to `targetRole`. */
export async function countSeatPromotions(
  userIds: string[],
  targetRole: string,
): Promise<number> {
  if (!roleConsumesSeat(targetRole) || userIds.length === 0) return 0;
  return db.user.count({
    where: {
      id: { in: userIds },
      role: { in: [...UNBILLED_ROLES] },
      deletedAt: null,
    },
  });
}
