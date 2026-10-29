/**
 * PropertyPro - Which calendar events an employee limited to some buildings sees
 *
 * The staff calendar listed every event in the organization to every member
 * of staff, restricted or not, under a TODO saying buildings would be
 * filtered one day. An event names at most one building, so the rule is the
 * building rule every other model follows — with one addition, because a
 * calendar is also where people are invited: an employee always sees the
 * events they organize or are asked to, whatever building those are on.
 *
 * An event on no building that they are not part of — an office meeting of
 * other people's — falls outside their buildings, as an expense on no
 * building falls outside every portfolio (lib/db/scopes.ts).
 *
 * Tenants keep the rule the calendar route already gives them (their own
 * invitations); owners do not reach the calendar at all. Kept apart from
 * ./scopes.ts, which is server-only, so the rule can be tested alone.
 */

import type { Prisma } from "@/generated/prisma/client";

export interface EventActor {
  id: string;
  isTenant: boolean;
  isOwner?: boolean;
  /** As on ScopeActor: undefined is not narrowed, an array is exactly these. */
  scopedPropertyIds?: readonly string[];
}

export interface EventRowFacts {
  propertyId?: string | null;
  organizerId?: string | null;
  attendeeIds?: readonly string[] | null;
}

function narrowedStaff(actor: EventActor): readonly string[] | null {
  if (actor.isTenant || actor.isOwner) return null;
  return actor.scopedPropertyIds ?? null;
}

/** The rule as a `where` to AND onto an event query; `{}` when not narrowed. */
export function eventScope(actor: EventActor): Prisma.EventWhereInput {
  const buildings = narrowedStaff(actor);
  if (!buildings) return {};
  return {
    OR: [
      { propertyId: { in: [...buildings] } },
      { organizerId: actor.id },
      { attendeeIds: { has: actor.id } },
    ],
  };
}

/** The same rule against an event already loaded. */
export function eventAllows(actor: EventActor, event: EventRowFacts): boolean {
  const buildings = narrowedStaff(actor);
  if (!buildings) return true;
  if (event.propertyId && buildings.includes(event.propertyId)) return true;
  if (event.organizerId === actor.id) return true;
  return (event.attendeeIds ?? []).includes(actor.id);
}
