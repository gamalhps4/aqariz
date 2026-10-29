import "server-only";

import { db } from "@/lib/db/prisma";

/**
 * PropertyPro - Resolving an employee's assigned buildings
 *
 * An organization may narrow a member of staff to particular compounds and
 * buildings (see `User.scopeRestricted`). Those assignments are stored the way
 * a human makes them — "this compound, plus that one building" — but every
 * rule in `./scopes.ts` keys on a flat list of property ids, because that is
 * the one column every scoped model carries. This module is the translation
 * between the two, and the only place that knows a compound implies its
 * buildings.
 *
 * Resolved per request rather than stored: a building added to an assigned
 * compound must be visible immediately, without anyone remembering to re-save
 * the employee. One query, which matters — this runs on every authenticated
 * request for a restricted user.
 */

export interface StaffScopeAssignment {
  compoundIds: readonly string[];
  propertyIds: readonly string[];
}

/**
 * The buildings a restricted employee may see.
 *
 * Returns a plain array, possibly empty. Empty is a real answer — an employee
 * marked restricted but assigned nothing sees nothing — and callers must not
 * translate it into "unrestricted". The distinction lives in whether this
 * function was called at all.
 */
export async function resolveStaffPropertyIds(
  assignment: StaffScopeAssignment,
): Promise<string[]> {
  const compoundIds = [...new Set(assignment.compoundIds)].filter(Boolean);
  const propertyIds = [...new Set(assignment.propertyIds)].filter(Boolean);

  if (compoundIds.length === 0 && propertyIds.length === 0) {
    return [];
  }

  // OR rather than two queries: a building may be reached either because it
  // was assigned directly or because its compound was, and the union is what
  // the caller wants. Soft-deleted buildings are excluded here so a restored
  // one does not need the assignment touched.
  const rows = await db.property.findMany({
    where: {
      deletedAt: null,
      OR: [
        ...(propertyIds.length > 0 ? [{ id: { in: propertyIds } }] : []),
        ...(compoundIds.length > 0
          ? [{ compoundId: { in: compoundIds } }]
          : []),
      ],
    },
    select: { id: true },
  });

  return rows.map((row) => row.id);
}
