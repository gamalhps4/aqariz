/**
 * PropertyPro - Occupancy register
 *
 * Which units are let and which are standing empty, as at a date.
 *
 * Occupancy is DERIVED from contracts rather than read from `Unit.status`.
 * That column is maintained by the write paths and a nightly sweep, so a unit
 * whose contract ended this morning still reads "occupied" until something
 * touches it — and an occupancy report that is a day behind is a report
 * nobody can act on. The same reasoning already governs "expired" in the
 * leasing register and "overdue" in the installment schedule.
 *
 * The stored status is still reported, and where the two disagree the row
 * says so. An occupancy report that quietly contradicts the units list is
 * worse than one that points at the contradiction: somebody has to go and
 * fix the unit, and they cannot if nothing tells them.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { propertyScope, type ScopeActor } from "@/lib/db/scopes";
import { leaseRentAmount } from "@/lib/lease-money";
import {
  buildingsWhere,
  coveringLeaseWhere,
  occupancyDay,
  type OccupancyDay,
} from "@/lib/reports/report-where";

export type UnitOccupancy = "leased" | "vacant" | "maintenance";

export const UNIT_OCCUPANCIES: readonly UnitOccupancy[] = [
  "leased",
  "vacant",
  "maintenance",
];

export function isUnitOccupancy(value: unknown): value is UnitOccupancy {
  return UNIT_OCCUPANCIES.includes(value as UnitOccupancy);
}

export interface OccupancyRow {
  unitId: string;
  unitNumber: string;
  unitType: string;
  bedrooms: number;
  squareFootage: number;
  propertyId: string;
  propertyName: string;
  compoundName: string | null;
  district: string | null;
  city: string;
  ownerName: string;
  occupancy: UnitOccupancy;
  /** The stored `Unit.status`, for the mismatch column. */
  storedStatus: string;
  /**
   * True when the stored status and the contracts disagree. Only ever for
   * today: the stored status is today's, and says nothing about a past date.
   */
  statusMismatch: boolean;
  tenantName: string | null;
  contractNumber: string | null;
  contractStart: string | null;
  contractEnd: string | null;
  /** Rent on the covering contract, or the unit's asking rent when vacant. */
  rentAmount: number;
  currency: string;
}

export interface OccupancySummary {
  asOf: string;
  totalUnits: number;
  leasedUnits: number;
  vacantUnits: number;
  maintenanceUnits: number;
  /** Percentage, one decimal. Zero units reads as 0 rather than NaN. */
  occupancyRate: number;
  /** Rent actually contracted on the let units. */
  contractedRent: number;
  /** What the empty units are advertised at — the gap, not a promise. */
  vacantAskingRent: number;
  currency: string;
  /** Units whose stored status disagrees with their contracts. */
  mismatchCount: number;
  /**
   * Whether the units' stored status was compared at all — only when the
   * report is read for today.
   */
  statusCompared: boolean;
}

export interface OccupancyReport {
  summary: OccupancySummary;
  rows: OccupancyRow[];
}

export interface OccupancyOptions {
  /**
   * Who is asking. Required, so a new caller cannot leave it out — see the
   * leasing register for what an optional one cost.
   */
  actor: ScopeActor;
  propertyId?: string;
  compoundId?: string;
  ownerId?: string;
  /**
   * The day occupancy is read for (see occupancyDay); today by default. A
   * whole day, so a contract on its last day still holds its unit.
   */
  day?: OccupancyDay;
  /**
   * Only the units in this state — the review's "Vacant units" and "Leased
   * units" lists. The summary still describes every unit in scope, so the
   * rate beside a vacant list is the real one.
   */
  occupancy?: UnitOccupancy;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export async function getOccupancyReport(
  options: OccupancyOptions,
): Promise<OccupancyReport> {
  const day = options.day ?? occupancyDay(null)!;

  // The buildings asked for, narrowed to the ones this reader holds. A
  // `propertyId` from the query string used to replace the reader's scope
  // here rather than narrow it — see lib/reports/report-where.ts.
  const propertyWhere = buildingsWhere(options, propertyScope(options.actor));

  const units = await db.unit.findMany({
    where: { deletedAt: null, property: propertyWhere },
    select: {
      id: true,
      unitNumber: true,
      unitType: true,
      bedrooms: true,
      squareFootage: true,
      rentAmount: true,
      status: true,
      property: {
        select: {
          id: true,
          name: true,
          addressCity: true,
          addressDistrict: true,
          compound: { select: { name: true } },
          owner: { select: { firstName: true, lastName: true } },
        },
      },
      // The contract covering the day, if there is one — see
      // coveringLeaseWhere for which count. Ordered by start date so that a
      // unit with a renewal chain reports the one that was running, not
      // whichever the database returned first.
      leases: {
        where: coveringLeaseWhere(day, { past: day.past }),
        orderBy: { startDate: "desc" },
        take: 1,
        select: {
          contractNumber: true,
          startDate: true,
          endDate: true,
          // Rent is read through `leaseRentAmount`, which prefers the column
          // and falls back to the `terms` mirror — so both the rows the
          // columns were backfilled into and the ones written by paths that
          // only maintain the mirror report the same number.
          rentAmount: true,
          terms: true,
          currency: true,
          tenant: { select: { firstName: true, lastName: true } },
        },
      },
    },
    orderBy: [{ property: { name: "asc" } }, { unitNumber: "asc" }],
  });

  let leasedUnits = 0;
  let vacantUnits = 0;
  let maintenanceUnits = 0;
  let contractedRent = 0;
  let vacantAskingRent = 0;
  let mismatchCount = 0;
  let currency = "";

  const rows: OccupancyRow[] = units.map((unit) => {
    const lease = unit.leases[0] ?? null;

    // Order matters: a unit with a live contract is let, whatever its stored
    // status says. Maintenance only describes a unit nobody is in.
    const occupancy: UnitOccupancy = lease
      ? "leased"
      : unit.status === "maintenance"
        ? "maintenance"
        : "vacant";

    // The stored status is today's. Held against a past date's contracts it
    // flagged every unit let then and empty now — or the other way round —
    // as needing correction when nothing was wrong with it.
    const storedSaysOccupied = unit.status === "occupied";
    const statusMismatch = day.today && storedSaysOccupied !== Boolean(lease);
    if (statusMismatch) mismatchCount += 1;

    const rent = lease ? leaseRentAmount(lease) : Number(unit.rentAmount);
    if (occupancy === "leased") {
      leasedUnits += 1;
      contractedRent += rent;
    } else if (occupancy === "maintenance") {
      maintenanceUnits += 1;
    } else {
      vacantUnits += 1;
      vacantAskingRent += rent;
    }

    if (!currency && lease?.currency) currency = lease.currency;

    const owner = unit.property.owner;
    return {
      unitId: unit.id,
      unitNumber: unit.unitNumber,
      unitType: unit.unitType,
      bedrooms: unit.bedrooms,
      squareFootage: unit.squareFootage,
      propertyId: unit.property.id,
      propertyName: unit.property.name,
      compoundName: unit.property.compound?.name ?? null,
      district: unit.property.addressDistrict,
      city: unit.property.addressCity,
      ownerName: owner ? `${owner.firstName} ${owner.lastName}`.trim() : "",
      occupancy,
      storedStatus: unit.status,
      statusMismatch,
      tenantName: lease?.tenant
        ? `${lease.tenant.firstName} ${lease.tenant.lastName}`.trim()
        : null,
      contractNumber: lease?.contractNumber ?? null,
      contractStart: lease ? lease.startDate.toISOString() : null,
      contractEnd: lease ? lease.endDate.toISOString() : null,
      rentAmount: round(rent),
      currency: lease?.currency ?? "",
    };
  });

  const totalUnits = rows.length;
  // Units out of service are excluded from the denominator: an office is not
  // failing to let a unit it has deliberately taken off the market, and
  // counting them as vacant makes the rate say something nobody meant.
  const lettable = leasedUnits + vacantUnits;

  return {
    summary: {
      asOf: day.end.toISOString(),
      totalUnits,
      leasedUnits,
      vacantUnits,
      maintenanceUnits,
      occupancyRate:
        lettable === 0 ? 0 : round((leasedUnits / lettable) * 100),
      contractedRent: round(contractedRent),
      vacantAskingRent: round(vacantAskingRent),
      currency,
      mismatchCount,
      statusCompared: day.today,
    },
    rows: options.occupancy
      ? rows.filter((row) => row.occupancy === options.occupancy)
      : rows,
  };
}

export interface OccupancyCounts {
  totalUnits: number;
  leasedUnits: number;
  vacantUnits: number;
  maintenanceUnits: number;
  occupancyRate: number;
}

/**
 * The report's counts alone — what the dashboard's unit cards show — from
 * the same buildings and the same contract rule, so a card and the list it
 * opens cannot disagree. Counted in the database rather than by reading every
 * unit and its contract.
 */
export async function getOccupancyCounts(options: {
  actor: ScopeActor;
  day?: OccupancyDay;
}): Promise<OccupancyCounts> {
  const day = options.day ?? occupancyDay(null)!;
  const property = buildingsWhere({}, propertyScope(options.actor));
  const covering = coveringLeaseWhere(day, { past: day.past });

  const [totalUnits, leasedUnits, maintenanceUnits] = await Promise.all([
    db.unit.count({ where: { deletedAt: null, property } }),
    db.unit.count({
      where: { deletedAt: null, property, leases: { some: covering } },
    }),
    // As in the report: out of service only when nobody is in it.
    db.unit.count({
      where: {
        deletedAt: null,
        property,
        status: "maintenance",
        leases: { none: covering },
      },
    }),
  ]);

  const vacantUnits = Math.max(totalUnits - leasedUnits - maintenanceUnits, 0);
  const lettable = leasedUnits + vacantUnits;
  return {
    totalUnits,
    leasedUnits,
    vacantUnits,
    maintenanceUnits,
    occupancyRate: lettable === 0 ? 0 : round((leasedUnits / lettable) * 100),
  };
}
