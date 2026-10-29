import "server-only";

import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { loadUserAccessRow } from "@/lib/server-permissions";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";

/**
 * PropertyPro - Handing an employee their compounds and buildings
 *
 * One set of rules for both places an assignment is made — the Access tab of
 * an existing employee (/api/users/[id]/building-scope) and the new-employee
 * form (POST /api/users) — so an employee cannot be created with access the
 * tab would have refused them.
 *
 *   - Nobody hands out a building they cannot reach themselves.
 *   - A compound carries its buildings, those added later included, so an
 *     operator who is narrowed hands out only a compound assigned to them as
 *     a compound. Holding one of its buildings is not holding the compound:
 *     assigning it would give the colleague the rest.
 *   - An operator who is narrowed cannot lift a colleague's narrowing, or
 *     create a colleague who sees everything: both would widen past them.
 */

export interface BuildingAssignment {
  restricted: boolean;
  compoundIds: string[];
  propertyIds: string[];
}

/** Unique, trimmed ids in a stable order, or null when it is not a list. */
export function normalizeIds(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const id = entry.trim();
    if (id) seen.add(id);
  }
  return [...seen].sort();
}

/** Read an assignment from a request body, or say what is wrong with it. */
export function parseBuildingAssignment(
  value: unknown,
): { ok: true; assignment: BuildingAssignment } | { ok: false; message: string } {
  const payload = (value ?? {}) as {
    restricted?: unknown;
    compoundIds?: unknown;
    propertyIds?: unknown;
  };
  if (typeof payload.restricted !== "boolean") {
    return { ok: false, message: "`restricted` must be true or false" };
  }
  const compoundIds = normalizeIds(payload.compoundIds);
  const propertyIds = normalizeIds(payload.propertyIds);
  if (!compoundIds || !propertyIds) {
    return {
      ok: false,
      message: "compoundIds and propertyIds must each be a list of ids",
    };
  }
  // Turning the restriction off clears the lists rather than keeping them
  // dormant: a stored assignment that nothing reads is a trap for whoever
  // turns the flag back on months later.
  return {
    ok: true,
    assignment: payload.restricted
      ? { restricted: true, compoundIds, propertyIds }
      : { restricted: false, compoundIds: [], propertyIds: [] },
  };
}

/**
 * What this operator is able to hand out.
 *
 * Scoped to the operator, not to the organization. For an operator who sees
 * everything that is the whole portfolio, less compounds with no building
 * in them, which would resolve to nothing.
 */
export async function loadAssignable(actor: AuthenticatedAccessUser) {
  const narrowed = actor.scopedPropertyIds !== undefined;

  const [properties, compounds, ownRow] = await Promise.all([
    db.property.findMany({
      where: withScope({ deletedAt: null }, propertyScope(actor)),
      select: {
        id: true,
        name: true,
        addressCity: true,
        addressDistrict: true,
        compoundId: true,
        totalUnits: true,
      },
      orderBy: { name: "asc" },
    }),
    db.compound.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, addressCity: true },
      orderBy: { name: "asc" },
    }),
    narrowed ? loadUserAccessRow(actor.id) : Promise.resolve(null),
  ]);

  const reachable = narrowed
    ? new Set(ownRow?.buildingScope?.compoundIds ?? [])
    : new Set(
        properties
          .map((property) => property.compoundId)
          .filter((id): id is string => Boolean(id)),
      );

  return {
    properties,
    compounds: compounds.filter((compound) => reachable.has(compound.id)),
  };
}

/** Why `actor` may not make this assignment, or null when they may. */
export async function assignmentRefusal(
  actor: AuthenticatedAccessUser,
  assignment: BuildingAssignment,
): Promise<string | null> {
  if (!assignment.restricted) {
    return actor.scopedPropertyIds === undefined
      ? null
      : "You are limited to some buildings yourself, so the people you manage must be limited to buildings you are assigned.";
  }

  const assignable = await loadAssignable(actor);
  const okProperties = new Set(assignable.properties.map((entry) => entry.id));
  const okCompounds = new Set(assignable.compounds.map((entry) => entry.id));
  const stray =
    assignment.propertyIds.some((id) => !okProperties.has(id)) ||
    assignment.compoundIds.some((id) => !okCompounds.has(id));
  return stray
    ? "You can only assign compounds and buildings you can reach yourself."
    : null;
}
