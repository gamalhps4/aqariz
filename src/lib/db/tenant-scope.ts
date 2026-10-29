import "server-only";

import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import { tenantRecordScope, withScope, type ScopeActor } from "./scopes";

/**
 * PropertyPro - Reaching one tenant, or several
 *
 * The tenant routes used to load the tenant and then ask `tenantRecordAllows`
 * whether the caller might see the row. That question cannot be answered from
 * a user row for an employee narrowed to some buildings — their entitlement
 * runs through a contract, which the row does not carry — so it answered no,
 * and every tenant page gave restricted staff a 403 for tenants in their own
 * buildings. The routes that changed a tenant (delete, patch, status, bulk)
 * asked nothing at all, and acted on any tenant in the organization.
 *
 * Both are one query here: the id the request named, AND-ed with the caller's
 * tenant scope. A tenant outside it does not resolve, and the route answers
 * 404 — the same answer as a tenant that does not exist.
 */

/**
 * The tenant's user row, if this caller may reach it.
 *
 * `filter` narrows further — by default to the tenant role. The status route
 * passes `{}` and judges the role itself.
 */
export async function findTenantInScope(
  actor: ScopeActor,
  id: string,
  filter: Prisma.UserWhereInput = { role: UserRole.TENANT },
) {
  return db.user.findFirst({
    where: withScope({ ...filter, id }, tenantRecordScope(actor)),
  });
}

/** The ids among `ids` that name a tenant this caller may reach. */
export async function tenantIdsInScope(
  actor: ScopeActor,
  ids: readonly string[],
): Promise<string[]> {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return [];
  const rows = await db.user.findMany({
    where: withScope(
      { id: { in: wanted }, role: UserRole.TENANT },
      tenantRecordScope(actor),
    ),
    select: { id: true },
  });
  return rows.map((row) => row.id);
}
