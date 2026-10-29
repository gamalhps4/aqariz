/**
 * PropertyPro - How the maintenance list is filtered, ordered and aged
 *
 * The maintenance screen filters its requests in the browser: by priority,
 * status, category, the day it was raised, whether it is assigned, whether it
 * is overdue or urgent. A file cut from that screen has to apply the same
 * rules, so they are written once, here, and read by both — the page and the
 * route that makes the file.
 *
 * Pure: no database, no clock unless the caller leaves `now` out.
 */

import {
  businessDay,
  businessDaysBetween,
  businessToday,
} from "@/lib/dates/business-day";
import { MaintenancePriority, MaintenanceStatus } from "@/types";

/**
 * How many days a request of each priority may stay open before it counts as
 * overdue: an emergency a day, the rest by how patient the priority is.
 */
export const MAINTENANCE_SLA_DAYS: Readonly<Record<string, number>> = {
  [MaintenancePriority.EMERGENCY]: 1,
  [MaintenancePriority.HIGH]: 3,
  [MaintenancePriority.MEDIUM]: 7,
  [MaintenancePriority.LOW]: 14,
};

/** The requests nobody has finished with. */
const CLOSED_STATUSES: readonly string[] = [
  MaintenanceStatus.COMPLETED,
  MaintenanceStatus.CANCELLED,
];

/** What "urgent" means: a high or emergency request that is still open. */
export const URGENT_PRIORITIES: readonly string[] = [
  MaintenancePriority.HIGH,
  MaintenancePriority.EMERGENCY,
];
export const URGENT_STATUSES: readonly string[] = [
  MaintenanceStatus.SUBMITTED,
  MaintenanceStatus.ASSIGNED,
  MaintenanceStatus.IN_PROGRESS,
];

/**
 * How many days past its allowance an open request is: 0 while it is within
 * it, and for one that is completed or cancelled. Counted in calendar days on
 * the office's calendar, not in 24-hour blocks from the minute it was raised.
 */
export function maintenanceDaysOverdue(
  request: {
    createdAt: Date | string | null | undefined;
    priority: string | null | undefined;
    status: string | null | undefined;
  },
  now: Date | number = new Date(),
): number {
  const { createdAt, priority, status } = request;
  if (!createdAt || !priority || !status) return 0;
  if (CLOSED_STATUSES.includes(status)) return 0;
  const raised = businessDay(createdAt);
  if (!raised) return 0;
  const open = businessDaysBetween(raised, businessToday(now));
  return Math.max(0, open - (MAINTENANCE_SLA_DAYS[priority] ?? 0));
}

/** Whether a request is high or emergency and still open. */
export function isUrgentRequest(request: {
  priority: string | null | undefined;
  status: string | null | undefined;
}): boolean {
  return (
    URGENT_PRIORITIES.includes(request.priority ?? "") &&
    URGENT_STATUSES.includes(request.status ?? "")
  );
}

const PRIORITY_RANK: Readonly<Record<string, number>> = {
  [MaintenancePriority.EMERGENCY]: 4,
  [MaintenancePriority.HIGH]: 3,
  [MaintenancePriority.MEDIUM]: 2,
  [MaintenancePriority.LOW]: 1,
};

export interface SortableRequest {
  id?: string;
  title: string;
  priority: string;
  status: string;
  createdAt: Date | string;
  estimatedCost?: number | string | null;
  actualCost?: number | string | null;
}

/**
 * The requests in the order the screen's sort puts them: by title, priority
 * (emergency first when descending), status, the day raised, or cost — the
 * estimate, or the actual when there is none. Ties keep the newest first.
 */
export function sortMaintenance<T extends SortableRequest>(
  rows: readonly T[],
  sortBy: string | null | undefined,
  sortOrder: string | null | undefined,
): T[] {
  const direction = sortOrder === "asc" ? 1 : -1;
  const time = (row: T) => new Date(row.createdAt).getTime();
  const key = (row: T): string | number => {
    switch (sortBy) {
      case "title":
        return (row.title ?? "").toLowerCase();
      case "priority":
        return PRIORITY_RANK[row.priority] ?? 0;
      case "status":
        return row.status ?? "";
      case "cost":
        return Number(row.estimatedCost ?? row.actualCost ?? 0);
      default:
        return time(row);
    }
  };

  return [...rows].sort((a, b) => {
    const left = key(a);
    const right = key(b);
    if (left !== right) {
      const compared =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left).localeCompare(String(right));
      if (compared !== 0) return compared * direction;
    }
    return time(b) - time(a) || String(a.id ?? "").localeCompare(String(b.id ?? ""));
  });
}
