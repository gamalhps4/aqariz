/**
 * PropertyPro - A maintenance request as an activity entry holds it
 *
 * A request has no number; it is named by its title. The entry keeps what an
 * office is asked about — what is wrong, how urgent, where it stands, who has
 * it and what it cost — with the person it is assigned to, the building and
 * the tenant as names. The tenant's contact phone and the photos stay out.
 *
 * Pure: no database, nothing server-only.
 */

import { AuditAction } from "@/lib/audit/vocabulary";
import {
  clip,
  dateOf,
  numberOf,
  personName,
  statusMove,
  type Row,
} from "./shared";

/**
 * The fields compared when a request is edited, moved or assigned. The
 * building and tenant never change on those routes, so they are not here;
 * they are in the snapshot of a request that is created or deleted.
 */
export const MAINTENANCE_CHANGE_KEYS = [
  "title",
  "description",
  "priority",
  "category",
  "status",
  "assignedToName",
  "scheduledDate",
  "completedDate",
  "estimatedCost",
  "actualCost",
] as const;

function textOf(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function buildingName(row: Row): string | null {
  const building = row.property ?? row.propertyId;
  if (building && typeof building === "object") {
    return textOf((building as { name?: unknown }).name);
  }
  return null;
}

/**
 * The request as an entry stores it. The row may carry its assignee, building
 * and tenant (read with them); a name the row does not carry is null. Every
 * field is always present, so a before and an after built the same way compare
 * field for field.
 */
export function maintenanceSnapshot(row: Row | null | undefined): Row {
  if (!row) return {};
  const tenant = row.tenant ?? (typeof row.tenantId === "object" ? row.tenantId : null);
  return {
    title: clip(row.title, 200),
    description: clip(row.description, 300),
    priority: textOf(row.priority),
    category: textOf(row.category),
    status: textOf(row.status),
    assignedToName: personName(row.assignedTo),
    propertyName: buildingName(row),
    tenantName: personName(tenant),
    scheduledDate: dateOf(row.scheduledDate),
    completedDate: dateOf(row.completedDate),
    estimatedCost: numberOf(row.estimatedCost),
    actualCost: numberOf(row.actualCost),
  };
}

/** What a reader knows a request by: its title. */
export function maintenanceName(row: Row | null | undefined): string | null {
  return row ? clip(row.title, 120) : null;
}

/**
 * The words a note adds, without the timestamp and name the route prefixes it
 * with — what an entry for "added a note" shows.
 */
export function noteText(note: unknown): string | null {
  return clip(note, 300);
}

/** What one change to a request is recorded as. */
export interface MaintenanceEntry {
  action: AuditAction;
  messageKey?: string;
  messageParams?: Record<string, string>;
  before: Row;
  after: Row;
  keys: string[];
}

/**
 * How a change to a request reads in the log, from its row before and after
 * (each read with its assignee). An assignment says to whom; any other move of
 * the status reads "from → to"; everything else is an update whose values show
 * what moved.
 */
export function maintenanceEntry(input: {
  before: Row;
  after: Row;
  /**
   * True for an assign or reassign — the entry then names the person. By
   * default an entry names them whenever the person it is assigned to changed.
   */
  assignment?: boolean;
}): MaintenanceEntry {
  const before = maintenanceSnapshot(input.before);
  const after = maintenanceSnapshot(input.after);
  const keys = [...MAINTENANCE_CHANGE_KEYS];
  const assignee = typeof after.assignedToName === "string" ? after.assignedToName : null;
  const assignment =
    input.assignment ?? before.assignedToName !== after.assignedToName;
  if (assignment && assignee) {
    return {
      action: AuditAction.UPDATE,
      messageKey: "admin.audit.msg.maintenance_assigned",
      messageParams: { assignee },
      before,
      after,
      keys,
    };
  }
  const move = statusMove(before, after);
  return move
    ? {
        action: AuditAction.STATUS_CHANGED,
        messageParams: { from: move.from, to: move.to },
        before,
        after,
        keys,
      }
    : { action: AuditAction.UPDATE, before, after, keys };
}
