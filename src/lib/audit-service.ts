/**
 * PropertyPro - Audit Service (PostgreSQL edition)
 *
 * One choke point for writing activity entries. Every entry is described the
 * same way (lib/audit/entry: who, on whose behalf, which organization, the
 * action, the record, the catalogue key for the sentence, the values before
 * and after) and lands in one of two logs:
 *
 *   audit_logs           — an organization's own activity, read by the
 *                          organization and by the platform console.
 *   platform_audit_logs  — actors with no organization: platform operators
 *                          (their sign-ins, their console actions) and
 *                          sign-in attempts on addresses with no account.
 *                          Those used to be dropped with a console.info.
 *
 * Writes go through the bypass client with an EXPLICIT organizationId, so
 * auditing works the same from org-scoped handlers, the Better Auth hooks
 * (which run before any org context exists) and scheduled jobs. Inside a
 * request the insert runs after the response has been sent (`after`), so an
 * audit write never slows the action it records; outside one (scripts) it
 * runs inline. Either way a failure is logged, never thrown — an audit write
 * must not turn a completed action into a failed request.
 *
 * The category/action/severity enums live in lib/audit/vocabulary (no
 * database there, so the screens can import them) and are re-exported here
 * for the routes that already import them from this module.
 */

import { after, type NextRequest } from "next/server";
import { authDb, basePrisma } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import type { Prisma } from "@/generated/prisma/client";
import {
  resolveActivity,
  type ActivityInput,
  type OrgActivityRow,
  type PlatformActivityRow,
} from "@/lib/audit/entry";
import {
  claimAuditRecord,
  getAuditScope,
  noteAuditEntry,
  requestIpAddress,
  type AuditActor,
  type AuditScope,
} from "@/lib/audit/scope";
import {
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit/vocabulary";

export { AuditAction, AuditCategory, AuditSeverity };
export type { ActivityInput };

const RETENTION_DAYS = 365 * 7; // 7 years, matching the Mongo-era default

export interface AuditContext {
  userId?: string;
  userEmail?: string;
  userRole?: string;
  /** The actor's name as it reads today — kept on the entry. */
  userName?: string;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  sessionId?: string;
  source?: "web" | "api" | "system" | "mobile";
  impersonatedBy?: string;
  /** Explicit owner org — used by callers running outside org context
   * (Better Auth hooks, webhooks). Falls back to the request's context. */
  organizationId?: string;
}

export interface AuditEvent {
  category: AuditCategory;
  action: AuditAction;
  severity?: AuditSeverity;
  description: string;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  details?: Record<string, any>;
  oldValues?: Record<string, any>;
  newValues?: Record<string, any>;
  tags?: string[];
  complianceFlags?: string[];
  /** Catalogue key the sentence is rendered from, in the reader's language. */
  messageKey?: string;
  messageParams?: Record<string, string | number | boolean | null | undefined>;
}

// ============================================================================
// Writing
// ============================================================================

/**
 * Run `task` once the response has gone out, or now when there is no request
 * to wait for (a script, a test). `after` throws outside a request scope.
 */
function scheduleAuditWrite(task: () => Promise<void>): Promise<void> {
  try {
    after(task);
    return Promise.resolve();
  } catch {
    return task();
  }
}

/**
 * The columns this release added (userName, messageKey, messageParams, and
 * the platform log's actorName, ipAddress, userAgent). Until the migration
 * that adds them is applied, an insert naming them fails with P2022; the
 * writer then writes without them and stops asking for a while, so the
 * activity log keeps working on a database one migration behind.
 */
const RECHECK_MS = 10 * 60 * 1000;
let newColumnsMissingSince = 0;

export function auditColumnsAvailable(): boolean {
  return (
    newColumnsMissingSince === 0 ||
    Date.now() - newColumnsMissingSince > RECHECK_MS
  );
}

export function isMissingColumnError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2022") return true;
  const message = String((error as { message?: string } | null)?.message ?? "");
  return /column .* does not exist/i.test(message);
}

export function noteAuditColumnsMissing(): void {
  newColumnsMissingSince = Date.now();
}

/** P2028 and dropped sockets pass on a retry against the remote database. */
function isTransientError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "P2028" || code === "P1001" || code === "P1008" || code === "P1017") {
    return true;
  }
  return /unable to start a transaction|connection terminated|ECONNRESET/i.test(
    String((error as { message?: string } | null)?.message ?? ""),
  );
}

const roleLabelCache = new Map<
  string,
  { label: string; labelAr: string | null; at: number }
>();

/**
 * A permission group's name for the snapshot. Its stored key ("group_2")
 * means nothing to a reader, and the group may be renamed or deleted later.
 */
async function groupLabel(
  organizationId: string,
  role: string,
): Promise<{ label: string; labelAr: string | null } | null> {
  const key = `${organizationId}:${role}`;
  const cached = roleLabelCache.get(key);
  if (cached && Date.now() - cached.at < RECHECK_MS) return cached;
  try {
    const row = await authDb.role.findFirst({
      where: { organizationId, name: role, deletedAt: null },
      select: { label: true, labelAr: true },
    });
    if (!row) return null;
    const value = { label: row.label, labelAr: row.labelAr ?? null, at: Date.now() };
    roleLabelCache.set(key, value);
    return value;
  } catch {
    return null;
  }
}

function json(value: unknown): Prisma.InputJsonValue | undefined {
  return value === null || value === undefined
    ? undefined
    : (value as Prisma.InputJsonValue);
}

async function insertOrgActivity(row: OrgActivityRow): Promise<void> {
  let details = row.details;
  if (details?.actorRoleIsGroup && row.userRole) {
    const group = await groupLabel(row.organizationId, row.userRole);
    if (group) {
      details = {
        ...details,
        actorRoleLabel: group.label,
        ...(group.labelAr ? { actorRoleLabelAr: group.labelAr } : {}),
      };
    }
  }

  let userId = row.userId;
  let withNewColumns = auditColumnsAvailable();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const data: Prisma.AuditLogUncheckedCreateInput = {
      organizationId: row.organizationId,
      category: row.category,
      action: row.action,
      severity: row.severity,
      description: row.description,
      resourceType: row.resourceType ?? undefined,
      resourceId: row.resourceId ?? undefined,
      resourceName: row.resourceName ?? undefined,
      details: json(details),
      oldValues: json(row.oldValues),
      newValues: json(row.newValues),
      userId: userId ?? undefined,
      userEmail: row.userEmail ?? undefined,
      userRole: row.userRole ?? undefined,
      impersonatedBy: row.impersonatedBy ?? undefined,
      ipAddress: row.ipAddress ?? undefined,
      userAgent: row.userAgent ?? undefined,
      requestId: row.requestId ?? undefined,
      sessionId: row.sessionId ?? undefined,
      source: row.source,
      tags: row.tags,
      complianceFlags: row.complianceFlags,
      timestamp: new Date(),
      retentionDate: new Date(Date.now() + RETENTION_DAYS * 24 * 60 * 60 * 1000),
      ...(withNewColumns
        ? {
            userName: row.userName ?? undefined,
            messageKey: row.messageKey,
            messageParams: json(row.messageParams),
          }
        : {}),
    };
    try {
      await authDb.auditLog.create({ data, select: { id: true } });
      return;
    } catch (error) {
      if (withNewColumns && isMissingColumnError(error)) {
        noteAuditColumnsMissing();
        withNewColumns = false;
        continue;
      }
      // The actor's own row is gone (deleted along with the data they just
      // removed): the entry still names them by the snapshot.
      if ((error as { code?: string }).code === "P2003" && userId) {
        userId = null;
        continue;
      }
      if (attempt === 0 && isTransientError(error)) continue;
      throw error;
    }
  }
}

async function insertPlatformActivity(row: PlatformActivityRow): Promise<void> {
  let withNewColumns = auditColumnsAvailable();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await authDb.platformAuditLog.create({
        data: {
          actorId: row.actorId,
          actorEmail: row.actorEmail,
          action: row.action,
          targetType: row.targetType,
          targetId: row.targetId,
          targetName: row.targetName,
          organizationId: row.organizationId,
          summary: row.summary,
          metadata: row.metadata as Prisma.InputJsonValue,
          ...(withNewColumns
            ? {
                actorName: row.actorName,
                ipAddress: row.ipAddress,
                userAgent: row.userAgent,
              }
            : {}),
        },
        select: { id: true },
      });
      return;
    } catch (error) {
      if (withNewColumns && isMissingColumnError(error)) {
        noteAuditColumnsMissing();
        withNewColumns = false;
        continue;
      }
      if (attempt === 0 && isTransientError(error)) continue;
      throw error;
    }
  }
}

/** Insert a platform-log row (used by lib/platform/audit as well). */
export function writePlatformActivity(row: PlatformActivityRow): Promise<void> {
  return scheduleAuditWrite(async () => {
    try {
      await insertPlatformActivity(row);
    } catch (error) {
      console.error("Failed to record platform audit event", error);
    }
  });
}

/**
 * Record one activity entry.
 *
 * Counts against the request at once (before anything is awaited), which is
 * what tells the API wrapper not to add its own basic entry — see
 * lib/audit/scope. Resolves once the write is scheduled; never throws.
 */
export function recordActivity(
  input: ActivityInput,
  /** The request this belongs to, when called after its scope has closed. */
  scopeOverride?: AuditScope,
): Promise<void> {
  const scope = scopeOverride ?? getAuditScope();
  noteAuditEntry(scope);
  // One entry per record per request: a route that records what the service
  // it called has already recorded adds nothing.
  if (!claimAuditRecord(scope, input.recordType, input.recordId)) {
    return Promise.resolve();
  }
  let resolved: ReturnType<typeof resolveActivity>;
  try {
    resolved = resolveActivity(input, scope);
  } catch (error) {
    console.error("Failed to build audit entry:", error);
    return Promise.resolve();
  }

  return scheduleAuditWrite(async () => {
    try {
      if (resolved.kind === "org") {
        const { severity, category, action } = resolved.row;
        if (severity === AuditSeverity.CRITICAL || severity === AuditSeverity.HIGH) {
          console.warn(`HIGH SEVERITY AUDIT EVENT: ${category} - ${action}`, {
            userId: resolved.row.userId,
            description: resolved.row.description,
          });
        }
        await insertOrgActivity(resolved.row);
      } else {
        await insertPlatformActivity(resolved.row);
      }
    } catch (error) {
      // Auditing must never break the operation being audited.
      console.error("Failed to log audit event:", error);
    }
  });
}

export class AuditService {
  /**
   * The original entry point, kept for the routes that call it. The context
   * names the actor; anything it leaves out (their name, the support operator
   * viewing as them) comes from the request's scope.
   */
  async logEvent(event: AuditEvent, context: AuditContext = {}): Promise<null> {
    const scope = getAuditScope();
    const scopeActor = scope?.actor ?? null;
    const namesUser = Boolean(context.userId || context.userEmail);
    const sameAsScope =
      scopeActor !== null &&
      ((context.userId && scopeActor.id === context.userId) ||
        (!context.userId &&
          context.userEmail &&
          scopeActor.email === context.userEmail));

    const actor: AuditActor | null | undefined = namesUser
      ? {
          id: context.userId ?? "",
          name: context.userName ?? (sameAsScope ? scopeActor!.name : null),
          email: context.userEmail ?? null,
          role: context.userRole ?? (sameAsScope ? scopeActor!.role : null),
          roleIsGroup: sameAsScope ? scopeActor!.roleIsGroup : undefined,
          isPlatformAdmin: sameAsScope ? scopeActor!.isPlatformAdmin : false,
        }
      : undefined;

    const organizationId =
      context.organizationId ??
      getOrgContext()?.organizationId ??
      scope?.organizationId ??
      null;

    await recordActivity({
      action: event.action,
      category: event.category,
      severity: event.severity,
      description: event.description,
      recordType: event.resourceType ?? null,
      recordId: event.resourceId ?? null,
      recordName: event.resourceName ?? null,
      details: event.details ?? null,
      before: event.oldValues ?? null,
      after: event.newValues ?? null,
      tags: event.tags,
      complianceFlags: event.complianceFlags,
      messageKey: event.messageKey ?? null,
      messageParams: event.messageParams,
      organizationId,
      actor,
      impersonator: context.impersonatedBy
        ? {
            id: context.impersonatedBy,
            email: scope?.impersonator?.email ?? "",
          }
        : undefined,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId: context.requestId,
      sessionId: context.sessionId,
      source: context.source,
    });
    return null;
  }

  extractContextFromRequest(request: NextRequest, user?: any): AuditContext {
    const scope = getAuditScope();
    const name = [user?.firstName, user?.lastName]
      .filter((part) => typeof part === "string" && part.trim())
      .join(" ");
    return {
      userId: user?.id,
      userEmail: user?.email,
      userRole: user?.role,
      userName: name || (scope?.actor?.id === user?.id ? scope?.actor?.name ?? undefined : undefined),
      organizationId: user?.organizationId ?? undefined,
      ipAddress: requestIpAddress(request.headers) ?? "unknown",
      userAgent: request.headers.get("user-agent") || "unknown",
      requestId: request.headers.get("x-request-id") || undefined,
      impersonatedBy: user?.impersonatedBy?.id ?? undefined,
      source: this.detectSource(request),
    };
  }

  private detectSource(request: NextRequest): "web" | "api" | "mobile" {
    const userAgent = request.headers.get("user-agent")?.toLowerCase() || "";
    const path = request.nextUrl.pathname;

    if (path.startsWith("/api/")) return "api";
    if (
      userAgent.includes("mobile") ||
      userAgent.includes("android") ||
      userAgent.includes("iphone")
    ) {
      return "mobile";
    }
    return "web";
  }

  // ---- sign-in events (the Better Auth hooks call these) --------------------

  async logLogin(userId: string, context: AuditContext) {
    return this.logEvent(
      {
        category: AuditCategory.AUTHENTICATION,
        action: AuditAction.LOGIN,
        severity: AuditSeverity.LOW,
        description: `User logged in successfully`,
        tags: ["authentication", "login"],
      },
      { ...context, userId: context.userId ?? userId }
    );
  }

  async logLoginFailed(email: string, reason: string, context: AuditContext) {
    return this.logEvent(
      {
        category: AuditCategory.AUTHENTICATION,
        action: AuditAction.LOGIN_FAILED,
        severity: AuditSeverity.MEDIUM,
        description: `Login failed for ${email}: ${reason}`,
        details: { email, reason },
        tags: ["authentication", "security", "failed_login"],
        messageParams: { email },
      },
      { ...context, userEmail: email }
    );
  }

  async logLogout(userId: string, context: AuditContext) {
    return this.logEvent(
      {
        category: AuditCategory.AUTHENTICATION,
        action: AuditAction.LOGOUT,
        severity: AuditSeverity.LOW,
        description: `User logged out`,
        tags: ["authentication", "logout"],
      },
      { ...context, userId: context.userId ?? userId }
    );
  }

  /**
   * Delete organization entries past their retention date (seven years).
   *
   * The activity tables refuse UPDATE and DELETE (see the activity-log
   * migration's append-only trigger); the retention cleanup is the one
   * deleter, and it says so with a transaction-local setting the trigger
   * checks. Platform entries are kept (owner's decision).
   */
  async cleanupExpiredLogs(): Promise<number> {
    const now = new Date();
    const [, deleted] = await basePrisma.$transaction([
      basePrisma.$executeRaw`SELECT set_config('app.bypass_rls', 'on', TRUE), set_config('app.audit_retention', 'on', TRUE)`,
      basePrisma.auditLog.deleteMany({
        where: { retentionDate: { lte: now } },
      }),
    ]);
    return deleted.count;
  }
}

export const auditService = new AuditService();
