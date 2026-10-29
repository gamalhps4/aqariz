/**
 * PropertyPro - Maintenance register
 *
 * What was raised, what is still open, how long it took and what it cost —
 * for one owner, one compound, one building or all of them, over a period.
 *
 * Two things this deliberately does not do.
 *
 * It does not report "average time to resolve" over requests that are still
 * open. A request raised three weeks ago and not yet touched has no
 * resolution time; including it as zero flatters the number and excluding it
 * silently hides the backlog. So the average covers completed work, and the
 * open ones are counted and aged separately.
 *
 * And it prefers actual cost over estimated, per request, rather than summing
 * one column. An office wants to know what it spent, which is the actual
 * where there is one and the estimate where the work is not finished — and
 * how far the two diverged, which is its own figure.
 */

import "server-only";

import { db } from "@/lib/db/prisma";
import { MaintenanceStatus } from "@/types";
import {
  compoundScope,
  maintenanceScope,
  propertyScope,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { maintenanceReportWhere } from "@/lib/reports/report-where";

/** Requests nobody has finished or called off. */
const OPEN_STATUSES = [
  MaintenanceStatus.SUBMITTED,
  MaintenanceStatus.ASSIGNED,
  MaintenanceStatus.IN_PROGRESS,
] as const;

export interface MaintenanceReportRow {
  requestId: string;
  title: string;
  category: string;
  priority: string;
  status: string;
  propertyName: string;
  compoundName: string | null;
  unitId: string | null;
  /** The unit the request was raised for; null for the building's own. */
  unitNumber: string | null;
  tenantName: string;
  assigneeName: string | null;
  raisedOn: string;
  completedOn: string | null;
  /** Days from raised to completed, or to now while it is still open. */
  ageDays: number;
  open: boolean;
  estimatedCost: number | null;
  actualCost: number | null;
}

export interface MaintenanceReportSummary {
  from: string;
  to: string;
  totalRequests: number;
  openRequests: number;
  completedRequests: number;
  cancelledRequests: number;
  emergencyOpen: number;
  /** Mean days to completion, over completed work only. */
  averageResolutionDays: number | null;
  /** The oldest thing still waiting — the number that embarrasses an office. */
  oldestOpenDays: number | null;
  estimatedTotal: number;
  actualTotal: number;
  /** Actual minus estimated, over requests that have both. */
  costVariance: number;
  byCategory: Array<{ category: string; count: number; actualCost: number }>;
  byPriority: Array<{ priority: string; count: number; open: number }>;
}

/**
 * The filters the report was run with, by name — an export has to say which
 * owner, compound and building it covers. Null where no filter was set, or
 * where the one asked for is not the reader's to name.
 */
export interface MaintenanceReportFilters {
  ownerName: string | null;
  compoundName: string | null;
  propertyName: string | null;
}

export interface MaintenanceReport {
  summary: MaintenanceReportSummary;
  filters: MaintenanceReportFilters;
  rows: MaintenanceReportRow[];
}

export interface MaintenanceReportOptions {
  /** Who is asking — required, as on the other registers. */
  actor: ScopeActor;
  startDate: Date;
  endDate: Date;
  propertyId?: string;
  compoundId?: string;
  ownerId?: string;
  now?: Date;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 86_400_000));
}

export async function getMaintenanceReport(
  options: MaintenanceReportOptions,
): Promise<MaintenanceReport> {
  const now = options.now ?? new Date();

  // The period and the filters asked for, narrowed to what this reader may
  // see. A `propertyId` from the query string used to replace the reader's
  // scope here rather than narrow it — see lib/reports/report-where.ts.
  const where = maintenanceReportWhere(
    options,
    maintenanceScope(options.actor),
  );

  const { actor } = options;
  const [requests, owner, compound, property] = await Promise.all([
    db.maintenanceRequest.findMany({
      where,
      select: {
        id: true,
        title: true,
        category: true,
        priority: true,
        status: true,
        unitId: true,
        estimatedCost: true,
        actualCost: true,
        createdAt: true,
        completedDate: true,
        property: {
          select: { name: true, compound: { select: { name: true } } },
        },
        tenant: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ createdAt: "desc" }],
    }),
    // The filters by name, each read as the reader may read it: an owner of
    // a building they hold, a compound or building they were given.
    options.ownerId
      ? db.user.findFirst({
          where: {
            id: options.ownerId,
            propertiesOwned: { some: propertyScope(actor) },
          },
          select: { firstName: true, lastName: true },
        })
      : Promise.resolve(null),
    options.compoundId
      ? db.compound.findFirst({
          where: withScope({ id: options.compoundId }, compoundScope(actor)),
          select: { name: true, code: true },
        })
      : Promise.resolve(null),
    options.propertyId
      ? db.property.findFirst({
          where: withScope({ id: options.propertyId }, propertyScope(actor)),
          select: { name: true },
        })
      : Promise.resolve(null),
  ]);

  // A request names a unit by id only; the numbers are read in one go.
  const unitIds = [
    ...new Set(
      requests
        .map((request) => request.unitId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const unitNumbers = new Map(
    (unitIds.length
      ? await db.unit.findMany({
          where: { id: { in: unitIds } },
          select: { id: true, unitNumber: true },
        })
      : []
    ).map((unit) => [unit.id, unit.unitNumber]),
  );

  const openSet = new Set<string>(OPEN_STATUSES);

  let openRequests = 0;
  let completedRequests = 0;
  let cancelledRequests = 0;
  let emergencyOpen = 0;
  let resolutionDaysTotal = 0;
  let resolvedCount = 0;
  let oldestOpenDays: number | null = null;
  let estimatedTotal = 0;
  let actualTotal = 0;
  let varianceTotal = 0;

  const byCategory = new Map<string, { count: number; actualCost: number }>();
  const byPriority = new Map<string, { count: number; open: number }>();

  const rows: MaintenanceReportRow[] = requests.map((request) => {
    const open = openSet.has(request.status as MaintenanceStatus);
    const completed = request.status === MaintenanceStatus.COMPLETED;
    const estimated =
      request.estimatedCost === null ? null : Number(request.estimatedCost);
    const actual =
      request.actualCost === null ? null : Number(request.actualCost);

    if (open) openRequests += 1;
    else if (completed) completedRequests += 1;
    else if (request.status === MaintenanceStatus.CANCELLED)
      cancelledRequests += 1;

    if (open && request.priority === "emergency") emergencyOpen += 1;

    const endedAt = request.completedDate ?? null;
    const ageDays = daysBetween(request.createdAt, endedAt ?? now);

    if (completed && endedAt) {
      resolutionDaysTotal += ageDays;
      resolvedCount += 1;
    }
    if (open && (oldestOpenDays === null || ageDays > oldestOpenDays)) {
      oldestOpenDays = ageDays;
    }

    if (estimated !== null) estimatedTotal += estimated;
    if (actual !== null) actualTotal += actual;
    if (estimated !== null && actual !== null) {
      varianceTotal += actual - estimated;
    }

    const categoryBucket = byCategory.get(request.category) ?? {
      count: 0,
      actualCost: 0,
    };
    categoryBucket.count += 1;
    categoryBucket.actualCost += actual ?? 0;
    byCategory.set(request.category, categoryBucket);

    const priorityBucket = byPriority.get(request.priority) ?? {
      count: 0,
      open: 0,
    };
    priorityBucket.count += 1;
    if (open) priorityBucket.open += 1;
    byPriority.set(request.priority, priorityBucket);

    return {
      requestId: request.id,
      title: request.title,
      category: request.category,
      priority: request.priority,
      status: request.status,
      propertyName: request.property?.name ?? "",
      compoundName: request.property?.compound?.name ?? null,
      unitId: request.unitId,
      unitNumber: request.unitId
        ? (unitNumbers.get(request.unitId) ?? null)
        : null,
      tenantName:
        `${request.tenant?.firstName ?? ""} ${request.tenant?.lastName ?? ""}`.trim(),
      assigneeName: request.assignedTo
        ? `${request.assignedTo.firstName} ${request.assignedTo.lastName}`.trim()
        : null,
      raisedOn: request.createdAt.toISOString(),
      completedOn: endedAt ? endedAt.toISOString() : null,
      ageDays,
      open,
      estimatedCost: estimated,
      actualCost: actual,
    };
  });

  return {
    filters: {
      ownerName: owner
        ? `${owner.firstName ?? ""} ${owner.lastName ?? ""}`.trim() || null
        : null,
      compoundName: compound
        ? compound.code
          ? `${compound.name} (${compound.code})`
          : compound.name
        : null,
      propertyName: property?.name ?? null,
    },
    summary: {
      from: options.startDate.toISOString(),
      to: options.endDate.toISOString(),
      totalRequests: rows.length,
      openRequests,
      completedRequests,
      cancelledRequests,
      emergencyOpen,
      averageResolutionDays:
        resolvedCount === 0
          ? null
          : round(resolutionDaysTotal / resolvedCount),
      oldestOpenDays,
      estimatedTotal: round(estimatedTotal),
      actualTotal: round(actualTotal),
      costVariance: round(varianceTotal),
      byCategory: [...byCategory.entries()]
        .map(([category, bucket]) => ({
          category,
          count: bucket.count,
          actualCost: round(bucket.actualCost),
        }))
        .sort((a, b) => b.count - a.count),
      byPriority: [...byPriority.entries()]
        .map(([priority, bucket]) => ({
          priority,
          count: bucket.count,
          open: bucket.open,
        }))
        .sort((a, b) => b.count - a.count),
    },
    rows,
  };
}
