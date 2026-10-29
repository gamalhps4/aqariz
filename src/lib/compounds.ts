/**
 * PropertyPro - Compound (residential complex) helpers
 *
 * A compound groups related properties without owning them. Every rollup here
 * is computed from the child properties' own units/leases/payments, so the
 * numbers a compound reports and the numbers each property reports on its own
 * page can never drift apart.
 */

import { db } from "@/lib/db/prisma";
import { propertyScope, withScope, type ScopeActor } from "@/lib/db/scopes";
import { InvoiceStatus, LeaseStatus, PropertyStatus } from "@/types";

type AnyRecord = Record<string, any>;

export const COMPOUND_OWNER_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

/** Reshape flat address columns into the nested shape the UI expects. */
export function presentCompound(compound: AnyRecord): AnyRecord {
  const { properties, ...rest } = compound;

  const presented: AnyRecord = {
    ...rest,
    address: {
      street: compound.addressStreet,
      city: compound.addressCity,
      district: compound.addressDistrict,
      state: compound.addressState,
      zipCode: compound.addressZipCode,
      country: compound.addressCountry,
    },
  };

  if (Array.isArray(properties)) {
    presented.properties = properties;
    presented.propertyCount = properties.length;
  }

  return presented;
}

export interface CompoundStats {
  propertyCount: number;
  unitCount: number;
  occupiedUnits: number;
  availableUnits: number;
  occupancyRate: number;
  activeLeases: number;
  monthlyRent: number;
  outstandingBalance: number;
}

/**
 * Portfolio rollup for one compound.
 *
 * `monthlyRent` comes from active leases rather than unit list prices: the
 * contract is the authoritative rent source, and unit pricing is no longer the
 * primary lease price.
 *
 * Rolled up over the buildings the reader holds, which is why the actor is
 * required. A compound is reachable through one building in it, and the
 * rollup used to cover all of them: an owner whose building shared a compound
 * with someone else's was shown that compound's whole rent and arrears.
 */
export async function getCompoundStats(
  compoundId: string,
  actor: ScopeActor,
): Promise<CompoundStats> {
  const properties = await db.property.findMany({
    where: withScope({ compoundId, deletedAt: null }, propertyScope(actor)),
    select: { id: true },
  });
  const propertyIds = properties.map((property) => property.id);

  if (propertyIds.length === 0) {
    return {
      propertyCount: 0,
      unitCount: 0,
      occupiedUnits: 0,
      availableUnits: 0,
      occupancyRate: 0,
      activeLeases: 0,
      monthlyRent: 0,
      outstandingBalance: 0,
    };
  }

  const [unitCount, occupiedUnits, availableUnits, activeLeases, rentAgg, dueAgg] =
    await Promise.all([
      db.unit.count({
        where: { propertyId: { in: propertyIds }, deletedAt: null },
      }),
      db.unit.count({
        where: {
          propertyId: { in: propertyIds },
          status: PropertyStatus.OCCUPIED,
          deletedAt: null,
        },
      }),
      db.unit.count({
        where: {
          propertyId: { in: propertyIds },
          status: PropertyStatus.AVAILABLE,
          deletedAt: null,
        },
      }),
      db.lease.count({
        where: {
          propertyId: { in: propertyIds },
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
      }),
      db.lease.aggregate({
        where: {
          propertyId: { in: propertyIds },
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
        _sum: { rentAmount: true },
      }),
      // Everything still owed: every invoice state except paid and cancelled.
      db.invoice.aggregate({
        where: {
          propertyId: { in: propertyIds },
          status: {
            in: [
              InvoiceStatus.SCHEDULED,
              InvoiceStatus.ISSUED,
              InvoiceStatus.PARTIAL,
              InvoiceStatus.OVERDUE,
            ],
          },
          deletedAt: null,
        },
        _sum: { balanceRemaining: true },
      }),
    ]);

  return {
    propertyCount: propertyIds.length,
    unitCount,
    occupiedUnits,
    availableUnits,
    occupancyRate:
      unitCount > 0 ? Math.round((occupiedUnits / unitCount) * 1000) / 10 : 0,
    activeLeases,
    monthlyRent: Number(rentAgg._sum.rentAmount ?? 0),
    outstandingBalance: Number(dueAgg._sum.balanceRemaining ?? 0),
  };
}

/**
 * Rollups for many compounds in a fixed number of queries — the list page
 * needs a stat line per row and must not fan out one query set per compound.
 * Over the reader's own buildings, as above.
 */
export async function getCompoundStatsBatch(
  compoundIds: readonly string[],
  actor: ScopeActor,
): Promise<Map<string, CompoundStats>> {
  const result = new Map<string, CompoundStats>();
  for (const id of compoundIds) {
    result.set(id, {
      propertyCount: 0,
      unitCount: 0,
      occupiedUnits: 0,
      availableUnits: 0,
      occupancyRate: 0,
      activeLeases: 0,
      monthlyRent: 0,
      outstandingBalance: 0,
    });
  }
  if (compoundIds.length === 0) return result;

  const properties = await db.property.findMany({
    where: withScope(
      { compoundId: { in: [...compoundIds] }, deletedAt: null },
      propertyScope(actor),
    ),
    select: { id: true, compoundId: true },
  });
  if (properties.length === 0) return result;

  const compoundByProperty = new Map(
    properties.map((property) => [property.id, property.compoundId as string]),
  );
  const propertyIds = properties.map((property) => property.id);

  for (const property of properties) {
    const stats = result.get(property.compoundId as string);
    if (stats) stats.propertyCount += 1;
  }

  const [unitGroups, leaseGroups] = await Promise.all([
    db.unit.groupBy({
      by: ["propertyId", "status"],
      where: { propertyId: { in: propertyIds }, deletedAt: null },
      _count: { _all: true },
    }),
    db.lease.groupBy({
      by: ["propertyId"],
      where: {
        propertyId: { in: propertyIds },
        status: LeaseStatus.ACTIVE,
        deletedAt: null,
      },
      _count: { _all: true },
      _sum: { rentAmount: true },
    }),
  ]);

  for (const group of unitGroups) {
    const compoundId = compoundByProperty.get(group.propertyId);
    const stats = compoundId ? result.get(compoundId) : undefined;
    if (!stats) continue;
    const count = group._count._all;
    stats.unitCount += count;
    if (group.status === PropertyStatus.OCCUPIED) stats.occupiedUnits += count;
    if (group.status === PropertyStatus.AVAILABLE) stats.availableUnits += count;
  }

  for (const group of leaseGroups) {
    const compoundId = compoundByProperty.get(group.propertyId);
    const stats = compoundId ? result.get(compoundId) : undefined;
    if (!stats) continue;
    stats.activeLeases += group._count._all;
    stats.monthlyRent += Number(group._sum.rentAmount ?? 0);
  }

  for (const stats of result.values()) {
    stats.occupancyRate =
      stats.unitCount > 0
        ? Math.round((stats.occupiedUnits / stats.unitCount) * 1000) / 10
        : 0;
  }

  return result;
}
