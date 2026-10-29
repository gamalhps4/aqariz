import "server-only";

/**
 * PropertyPro - Reading the activity log
 *
 * Shared by the organization's activity page (/api/audit) and the platform
 * console's (/api/admin/activity): the same filters, the same row shape, the
 * same export. Every query costs a round trip to a database ~0.7 s away, so
 * rows carry what they need as stored snapshots (the actor's name, email and
 * role; the record's name) and the readers add a lookup only for entries
 * written before those snapshots existed.
 */

import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db/prisma";
import {
  auditColumnsAvailable,
  isMissingColumnError,
  noteAuditColumnsMissing,
} from "@/lib/audit-service";
import { roleDisplayName } from "@/lib/role-display";
import type { ReportSheet } from "@/lib/reports/export";
import type { ReportLanguage } from "@/lib/reports/labels";
import { catalogTranslator } from "./catalog";
import {
  auditModuleLabel,
  auditRecordName,
  auditTypeLabel,
  changedFields,
  auditFieldLabel,
  formatAuditValue,
  renderActivityMessage,
  type AuditTranslate,
} from "./render";
import { auditDateRange, formatAuditExportTimestamp } from "./time";
import { PLATFORM_AUDIT_ACTIONS } from "./vocabulary";
import type { ActivityActor, ActivityRow } from "./types";

export type { ActivityActor, ActivityRow };

export const ACTIVITY_PAGE_SIZES = [10, 20, 50, 100];
export const DEFAULT_ACTIVITY_PAGE_SIZE = 20;

/** Page and page size from a query, kept to the sizes the table offers. */
export function activityPaging(params: URLSearchParams): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Number.parseInt(params.get("page") || "1", 10) || 1);
  const asked = Number.parseInt(
    params.get("pageSize") || params.get("limit") || String(DEFAULT_ACTIVITY_PAGE_SIZE),
    10,
  );
  return {
    page,
    pageSize: ACTIVITY_PAGE_SIZES.includes(asked)
      ? asked
      : DEFAULT_ACTIVITY_PAGE_SIZE,
  };
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A date filter. A plain day ("2026-10-31") is a whole Riyadh day and the
 * last one counts in full; a full timestamp (what the user page's activity
 * card sends) is taken as the instant it names.
 */
export function activityTimeWhere(
  startDate: string | null,
  endDate: string | null,
): { gte?: Date; lt?: Date; lte?: Date } | undefined {
  const where: { gte?: Date; lt?: Date; lte?: Date } = {};
  const dayRange = auditDateRange(
    startDate && ISO_DAY.test(startDate) ? startDate : null,
    endDate && ISO_DAY.test(endDate) ? endDate : null,
  );
  if (dayRange.gte) where.gte = dayRange.gte;
  if (dayRange.lt) where.lt = dayRange.lt;
  if (startDate && !ISO_DAY.test(startDate)) {
    const instant = new Date(startDate);
    if (!Number.isNaN(instant.getTime())) where.gte = instant;
  }
  if (endDate && !ISO_DAY.test(endDate)) {
    const instant = new Date(endDate);
    if (!Number.isNaN(instant.getTime())) where.lte = instant;
  }
  return Object.keys(where).length ? where : undefined;
}

/**
 * Run a read that names the new columns, again without them when the
 * database has not had the activity-log migration yet.
 */
export async function withAuditColumns<T>(
  read: (withNewColumns: boolean) => Promise<T>,
): Promise<T> {
  if (!auditColumnsAvailable()) return read(false);
  try {
    return await read(true);
  } catch (error) {
    if (!isMissingColumnError(error)) throw error;
    noteAuditColumnsMissing();
    return read(false);
  }
}

/** The organization log's columns a list needs. */
export function auditLogSelect(withNewColumns: boolean) {
  return {
    id: true,
    organizationId: true,
    timestamp: true,
    category: true,
    action: true,
    severity: true,
    description: true,
    resourceType: true,
    resourceId: true,
    resourceName: true,
    userId: true,
    userEmail: true,
    userRole: true,
    impersonatedBy: true,
    ipAddress: true,
    userAgent: true,
    oldValues: true,
    newValues: true,
    details: true,
    tags: true,
    ...(withNewColumns
      ? { userName: true, messageKey: true, messageParams: true }
      : {}),
  } satisfies Prisma.AuditLogSelect;
}

/** Filters both activity screens share, as an organization-log `where`. */
export function auditLogWhere(
  params: URLSearchParams,
  withNewColumns: boolean,
  options: { defaultDays?: number } = {},
): Prisma.AuditLogWhereInput {
  const and: Prisma.AuditLogWhereInput[] = [];
  const value = (key: string) => {
    const raw = params.get(key)?.trim();
    return raw && raw !== "all" ? raw : null;
  };

  const organizationId = value("organizationId");
  if (organizationId) and.push({ organizationId });
  const userId = value("userId");
  if (userId) and.push({ userId });
  const action = value("action");
  if (action) and.push({ action });
  const category = value("category") ?? value("module");
  if (category) and.push({ category });
  const resourceType = value("resourceType");
  if (resourceType) and.push({ resourceType });
  const resourceId = value("resourceId");
  if (resourceId) and.push({ resourceId });
  const severity = value("severity");
  if (severity) and.push({ severity });
  const tags = value("tags")?.split(",").filter(Boolean);
  if (tags?.length) and.push({ tags: { hasSome: tags } });
  // The security view: what an office checks after a scare.
  if (params.get("view") === "security") {
    and.push({
      OR: [
        { category: "security" },
        {
          action: {
            in: [
              "login_failed",
              "unauthorized_access",
              "suspicious_activity",
              "impersonation_started",
              "impersonation_ended",
              "password_reset",
              "password_reset_requested",
            ],
          },
        },
        { severity: { in: ["high", "critical"] } },
      ],
    });
  }

  let timestamp = activityTimeWhere(params.get("startDate"), params.get("endDate"));
  if (!timestamp && options.defaultDays) {
    timestamp = {
      gte: new Date(Date.now() - options.defaultDays * 24 * 60 * 60 * 1000),
    };
  }
  if (timestamp) and.push({ timestamp });

  const search = params.get("search")?.trim();
  if (search) {
    const contains = { contains: search, mode: "insensitive" as const };
    and.push({
      OR: [
        ...(withNewColumns ? [{ userName: contains }] : []),
        { userEmail: contains },
        { resourceName: contains },
        { description: contains },
        { resourceId: search },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

type AuditLogListRow = Prisma.AuditLogGetPayload<{
  select: ReturnType<typeof auditLogSelect>;
}> & {
  userName?: string | null;
  messageKey?: string | null;
  messageParams?: Prisma.JsonValue | null;
};

const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

/**
 * Turn organization-log rows into screen rows, adding — in at most one query
 * each — the names of users on entries written before the name was kept, and
 * the numbers of contracts named only by their id.
 */
export async function toActivityRows(
  logs: AuditLogListRow[],
  organizationNames?: Map<string, string>,
): Promise<ActivityRow[]> {
  const unnamedUsers = [
    ...new Set(
      logs
        .filter((log) => !log.userName && log.userId)
        .map((log) => log.userId as string),
    ),
  ];
  const contractIds = new Set<string>();
  for (const log of logs) {
    const params = asObject(log.messageParams);
    if (log.resourceType === "lease" && log.resourceId && !text(log.resourceName)) {
      contractIds.add(log.resourceId);
    }
    if (log.resourceType === "lease" && log.resourceId && log.resourceName === log.resourceId) {
      contractIds.add(log.resourceId);
    }
    const leaseId = text(params?.leaseId) ?? text(asObject(log.details)?.leaseId);
    if (leaseId && !text(params?.contractNumber)) contractIds.add(leaseId);
  }

  const [users, leases] = await Promise.all([
    unnamedUsers.length
      ? db.user.findMany({
          where: { id: { in: unnamedUsers }, deletedAt: undefined },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    contractIds.size
      ? db.lease.findMany({
          where: { id: { in: [...contractIds] }, deletedAt: undefined },
          select: { id: true, contractNumber: true },
        })
      : Promise.resolve([]),
  ]);
  const userName = new Map(
    users.map((user) => [
      user.id,
      [user.firstName, user.lastName].filter(Boolean).join(" ") || null,
    ]),
  );
  const contractNumber = new Map(
    leases.map((lease) => [lease.id, lease.contractNumber ?? null]),
  );

  return logs.map((log) => {
    const details = asObject(log.details);
    const params = asObject(log.messageParams);
    const impersonatorDetail = asObject(details?.impersonator);
    const leaseId =
      log.resourceType === "lease"
        ? log.resourceId
        : (text(params?.leaseId) ?? text(details?.leaseId));
    const number =
      text(params?.contractNumber) ??
      text(details?.contractNumber) ??
      (leaseId ? (contractNumber.get(leaseId) ?? null) : null);
    const resourceName =
      log.resourceType === "lease" &&
      (!text(log.resourceName) || log.resourceName === log.resourceId)
        ? (number ?? log.resourceName ?? null)
        : (log.resourceName ?? null);

    return {
      id: log.id,
      source: "organization" as const,
      timestamp: log.timestamp.toISOString(),
      organizationId: log.organizationId,
      organizationName: organizationNames?.get(log.organizationId) ?? null,
      category: log.category,
      action: log.action,
      severity: log.severity,
      description: log.description,
      messageKey: log.messageKey ?? null,
      messageParams: params,
      resourceType: log.resourceType,
      resourceId: log.resourceId,
      resourceName,
      contractNumber: number,
      actor: {
        id: log.userId,
        name:
          log.userName ??
          (log.userId ? (userName.get(log.userId) ?? null) : null),
        email: log.userEmail,
        role: log.userRole,
        roleLabel: text(details?.actorRoleLabel),
        roleLabelAr: text(details?.actorRoleLabelAr),
      },
      impersonator: log.impersonatedBy
        ? {
            id: log.impersonatedBy,
            email: text(impersonatorDetail?.email),
          }
        : null,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      before: asObject(log.oldValues),
      after: asObject(log.newValues),
      details,
    };
  });
}

/** The platform log's columns a list needs. */
export function platformLogSelect(withNewColumns: boolean) {
  return {
    id: true,
    actorId: true,
    actorEmail: true,
    action: true,
    targetType: true,
    targetId: true,
    targetName: true,
    organizationId: true,
    summary: true,
    metadata: true,
    createdAt: true,
    ...(withNewColumns
      ? { actorName: true, ipAddress: true, userAgent: true }
      : {}),
  } satisfies Prisma.PlatformAuditLogSelect;
}

type PlatformLogListRow = Prisma.PlatformAuditLogGetPayload<{
  select: ReturnType<typeof platformLogSelect>;
}> & {
  actorName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/** The platform log's filters, as a `where`. */
export function platformLogWhere(
  params: URLSearchParams,
  withNewColumns: boolean,
  options: { defaultDays?: number } = {},
): Prisma.PlatformAuditLogWhereInput {
  const and: Prisma.PlatformAuditLogWhereInput[] = [];
  const value = (key: string) => {
    const raw = params.get(key)?.trim();
    return raw && raw !== "all" ? raw : null;
  };
  const organizationId = value("organizationId");
  if (organizationId) and.push({ organizationId });
  const actorId = value("actorId") ?? value("userId");
  if (actorId) and.push({ actorId });
  const actorEmail = value("actorEmail");
  if (actorEmail) and.push({ actorEmail });
  const action = value("action");
  if (action) and.push({ action });
  const targetType = value("targetType") ?? value("resourceType");
  if (targetType) and.push({ targetType });

  let createdAt = activityTimeWhere(params.get("startDate"), params.get("endDate"));
  if (!createdAt && options.defaultDays) {
    createdAt = {
      gte: new Date(Date.now() - options.defaultDays * 24 * 60 * 60 * 1000),
    };
  }
  if (createdAt) and.push({ createdAt });

  const search = params.get("search")?.trim();
  if (search) {
    const contains = { contains: search, mode: "insensitive" as const };
    and.push({
      OR: [
        ...(withNewColumns ? [{ actorName: contains }] : []),
        { actorEmail: contains },
        { targetName: contains },
        { summary: contains },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

export function toPlatformActivityRows(
  logs: PlatformLogListRow[],
  organizationNames?: Map<string, string>,
): ActivityRow[] {
  return logs.map((log) => {
    const metadata = asObject(log.metadata) ?? {};
    const { previous, current, params, messageKey, actorRole, ...rest } =
      metadata;
    // The console's own actions have their own sentences; what the API
    // wrapper and the sign-in hooks record for an operator is rendered from
    // the organization log's sentence it was written with.
    const sentenceKey = (PLATFORM_AUDIT_ACTIONS as readonly string[]).includes(log.action)
      ? `platform.activity.action.${log.action}`
      : (text(messageKey) ?? `platform.activity.action.${log.action}`);
    return {
      id: log.id,
      source: "platform" as const,
      timestamp: log.createdAt.toISOString(),
      organizationId: log.organizationId,
      organizationName: log.organizationId
        ? (organizationNames?.get(log.organizationId) ?? null)
        : null,
      category: "platform",
      action: log.action,
      severity: "low",
      description: log.summary,
      messageKey: sentenceKey,
      messageParams: asObject(params),
      resourceType: log.targetType,
      resourceId: log.targetId,
      resourceName: log.targetName,
      contractNumber: null,
      actor: {
        id: log.actorId,
        name: log.actorName ?? null,
        email: log.actorEmail,
        role: text(actorRole),
        roleLabel: null,
        roleLabelAr: null,
      },
      impersonator: null,
      ipAddress: log.ipAddress ?? null,
      userAgent: log.userAgent ?? null,
      // One-dimensional control changes store `previous`/`current` as plain
      // values; a table of them reads as "value".
      before:
        previous === undefined
          ? null
          : (asObject(previous) ?? { value: previous }),
      after:
        current === undefined ? null : (asObject(current) ?? { value: current }),
      details: Object.keys(rest).length ? rest : null,
    };
  });
}

/** "Ahmed Ali · ahmed@office.sa · Property Manager", for an export cell. */
function actorCell(
  actor: ActivityActor,
  language: ReportLanguage,
  t: AuditTranslate,
): { name: string; email: string; role: string } {
  return {
    name:
      actor.name ??
      (actor.id === "system" ? t("admin.audit.system", { defaultValue: "System" }) : ""),
    email: actor.email ?? "",
    role: actor.role
      ? roleDisplayName(actor.role, {
          group: actor.roleLabel
            ? { label: actor.roleLabel, labelAr: actor.roleLabelAr }
            : null,
          language,
          t,
        })
      : "",
  };
}

function changeCell(
  side: Record<string, unknown> | null,
  recordType: string | null,
  t: AuditTranslate,
): string {
  if (!side) return "";
  return Object.keys(side)
    .map(
      (key) =>
        `${auditFieldLabel(key, t)}: ${formatAuditValue(key, side[key], { t, recordType })}`,
    )
    .join(" · ");
}

/**
 * The export of a filtered list, in the reader's language: times in Riyadh
 * time with seconds (and the heading says so), the employee by name, email
 * and role, the sentence rendered from its key, the before and after.
 */
export function activityExportSheet(
  rows: ActivityRow[],
  options: {
    language: ReportLanguage;
    title: string;
    includeOrganization: boolean;
    truncatedAt?: number;
    total?: number;
    period?: string | null;
  },
): ReportSheet<ActivityRow> {
  const t = catalogTranslator(options.language);
  const h = (key: string, fallback: string) =>
    t(`admin.audit.export.${key}`, { defaultValue: fallback });

  const columns: ReportSheet<ActivityRow>["columns"] = [
    {
      header: h("time", "Date & time (Riyadh)"),
      value: (row) => formatAuditExportTimestamp(row.timestamp),
    },
    ...(options.includeOrganization
      ? [
          {
            header: h("organization", "Organization"),
            value: (row: ActivityRow) => row.organizationName ?? row.organizationId ?? "",
          },
        ]
      : []),
    {
      header: h("employee", "Employee"),
      value: (row) => actorCell(row.actor, options.language, t).name,
    },
    {
      header: h("email", "Email"),
      value: (row) => actorCell(row.actor, options.language, t).email,
    },
    {
      header: h("role", "Role"),
      value: (row) => actorCell(row.actor, options.language, t).role,
    },
    {
      header: h("action", "Action"),
      value: (row) => renderActivityMessage(row, t),
    },
    {
      header: h("module", "Module"),
      value: (row) =>
        row.source === "platform" ? "" : auditModuleLabel(row.category, t),
    },
    {
      header: h("recordType", "Record type"),
      value: (row) => auditTypeLabel(row.resourceType, t),
    },
    {
      header: h("record", "Record"),
      value: (row) =>
        [
          auditRecordName(row, t),
          row.contractNumber && row.contractNumber !== row.resourceName
            ? row.contractNumber
            : null,
        ]
          .filter(Boolean)
          .join(" · "),
    },
    {
      header: h("before", "Before"),
      value: (row) => changeCell(row.before, row.resourceType, t),
    },
    {
      header: h("after", "After"),
      value: (row) => changeCell(row.after, row.resourceType, t),
    },
    { header: h("ip", "IP address"), value: (row) => row.ipAddress ?? "" },
    {
      header: h("viewedBy", "Viewed by support"),
      value: (row) => row.impersonator?.email ?? row.impersonator?.id ?? "",
    },
  ];

  const summary: Array<[string, string | number]> = [];
  if (options.period) summary.push([h("period", "Period"), options.period]);
  summary.push([h("entries", "Entries"), rows.length]);
  if (options.truncatedAt && options.total && options.total > rows.length) {
    summary.push([
      h("note", "Note"),
      t("admin.audit.export.truncated", {
        defaultValue: "Only the newest {count} entries — narrow the filters for the rest",
        values: { count: options.truncatedAt },
      }),
    ]);
  }

  return { title: options.title, columns, rows, summary };
}

/** Keys on either side of a change, for callers that list them. */
export { changedFields };
