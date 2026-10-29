/**
 * PropertyPro - What one activity entry holds
 *
 * Every writer — a route's rich entry, the API wrapper's basic entry, the
 * sign-in hooks, an export — describes the action the same way (`ActivityInput`)
 * and this decides the row: who acted (a snapshot of their name, email and
 * role, so the entry still names them after they are renamed or deleted), on
 * whose behalf (a support operator's "view as"), in which organization, the
 * catalogue key that renders the sentence in the reader's language, and the
 * values before and after a sensitive change.
 *
 * An actor with no organization — a platform operator, or a sign-in attempt on
 * an address that matches no account — has no organization's log to go in.
 * Those used to be dropped; they now go to the platform's own log.
 *
 * Pure: no database, nothing server-only. The writer in lib/audit-service
 * inserts what this returns; the tests read it directly.
 */

import { catalogTranslator } from "./catalog";
import { renderActivityMessage } from "./render";
import {
  getAuditScope,
  type AuditActor,
  type AuditImpersonator,
  type AuditScope,
} from "./scope";
import {
  AuditAction,
  AuditSeverity,
  auditMessageKey,
  categoryFor,
  severityFor,
} from "./vocabulary";

export type ActivityParams = Record<
  string,
  string | number | boolean | null | undefined
>;

export interface ActivityInput {
  action: AuditAction | string;
  /** The module; derived from the action and record type when omitted. */
  category?: string;
  severity?: AuditSeverity | string;
  recordType?: string | null;
  recordId?: string | null;
  /** What a reader recognises the record by — a contract NUMBER, not its id. */
  recordName?: string | null;
  /** Defaults to the action's own sentence (`admin.audit.msg.<action>`). */
  messageKey?: string | null;
  messageParams?: ActivityParams;
  /** English fallback; rendered from the key when omitted. */
  description?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  details?: Record<string, unknown> | null;
  tags?: string[];
  complianceFlags?: string[];
  /**
   * For writers outside an authenticated request (sign-in hooks, scheduled
   * jobs, webhooks). `undefined` means "the request's"; `null` means none.
   */
  organizationId?: string | null;
  actor?: AuditActor | null;
  impersonator?: AuditImpersonator | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  sessionId?: string | null;
  source?: string;
}

/** An organization log row (audit_logs), as the writer inserts it. */
export interface OrgActivityRow {
  organizationId: string;
  category: string;
  action: string;
  severity: string;
  description: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceName: string | null;
  details: Record<string, unknown> | null;
  oldValues: Record<string, unknown> | null;
  newValues: Record<string, unknown> | null;
  userId: string | null;
  userEmail: string | null;
  userRole: string | null;
  userName: string | null;
  impersonatedBy: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  sessionId: string | null;
  source: string;
  tags: string[];
  complianceFlags: string[];
  messageKey: string;
  messageParams: Record<string, string | number | boolean | null> | null;
}

/** A platform log row (platform_audit_logs), as the writer inserts it. */
export interface PlatformActivityRow {
  actorId: string;
  actorEmail: string;
  actorName: string | null;
  action: string;
  targetType: string;
  targetId: string;
  targetName: string;
  organizationId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  userAgent: string | null;
}

export type ResolvedActivity =
  | { kind: "org"; row: OrgActivityRow }
  | { kind: "platform"; row: PlatformActivityRow };

/** Automated work with no person behind it. */
export const SYSTEM_ACTOR_ID = "system";
export const SYSTEM_ACTOR_EMAIL = "system@propertypro";
/** A sign-in attempt on an address that matches no account. */
export const ANONYMOUS_ACTOR_ID = "anonymous";

const AUTH_ACTIONS = new Set<string>([
  AuditAction.LOGIN,
  AuditAction.LOGOUT,
  AuditAction.LOGIN_FAILED,
  AuditAction.PASSWORD_CHANGED,
  AuditAction.PASSWORD_RESET,
  AuditAction.PASSWORD_RESET_REQUESTED,
  AuditAction.PASSWORD_SETUP,
]);

const PAST_TENSE: Record<string, string> = {
  [AuditAction.CREATE]: "created",
  [AuditAction.UPDATE]: "updated",
  [AuditAction.DELETE]: "deleted",
  [AuditAction.SETTINGS_CHANGED]: "updated",
  [AuditAction.BULK_UPDATE]: "updated",
  [AuditAction.BULK_CREATE]: "created",
  [AuditAction.BULK_DELETE]: "deleted",
};

/**
 * The platform log's action name for an entry made by an operator: the
 * sign-in events under `auth.`, an export as `data.exported`, anything else
 * as `<record>.<verb>` in the platform log's own past-tense style.
 */
export function platformActionName(
  action: string,
  recordType?: string | null,
): string {
  if (AUTH_ACTIONS.has(action)) return `auth.${action}`;
  if (action === AuditAction.BULK_EXPORT) return "data.exported";
  return `${recordType || "console"}.${PAST_TENSE[action] ?? action}`;
}

function cleanParams(
  params: ActivityParams | undefined,
): Record<string, string | number | boolean | null> | null {
  if (!params) return null;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) out[key] = value;
  }
  return Object.keys(out).length ? out : null;
}

function nonEmpty(
  values: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  return values && Object.keys(values).length ? values : null;
}

const english = catalogTranslator("en");

/**
 * The row an activity becomes: who, where, what, and to which record.
 * Request details the input leaves out come from the request's scope.
 */
export function resolveActivity(
  input: ActivityInput,
  scope: AuditScope | undefined = getAuditScope(),
): ResolvedActivity {
  const actor =
    input.actor !== undefined ? input.actor : (scope?.actor ?? null);
  const organizationId =
    input.organizationId !== undefined
      ? input.organizationId
      : (scope?.organizationId ?? null);
  const impersonator =
    input.impersonator !== undefined
      ? input.impersonator
      : (scope?.impersonator ?? null);
  const ipAddress =
    input.ipAddress !== undefined ? input.ipAddress : (scope?.ipAddress ?? null);
  const userAgent =
    input.userAgent !== undefined ? input.userAgent : (scope?.userAgent ?? null);

  const action = String(input.action);
  const recordType = input.recordType ?? null;
  const messageKey = input.messageKey || auditMessageKey(action);
  const messageParams = cleanParams(input.messageParams);
  const description =
    input.description?.trim() ||
    renderActivityMessage(
      { action, messageKey, messageParams, resourceType: recordType },
      english,
    );
  const severity = String(input.severity ?? severityFor(action));

  const details: Record<string, unknown> = { ...(input.details ?? {}) };
  if (impersonator) {
    details.impersonator = { id: impersonator.id, email: impersonator.email };
  }
  if (actor?.roleIsGroup) details.actorRoleIsGroup = true;

  if (organizationId) {
    const tags = [...new Set([
      ...(recordType ? [recordType] : []),
      action,
      ...(input.tags ?? []),
      ...(severity === AuditSeverity.HIGH || severity === AuditSeverity.CRITICAL
        ? ["high_priority"]
        : []),
    ])];
    const complianceFlags = [...new Set([
      ...(input.complianceFlags ?? []),
      ...(severity === AuditSeverity.CRITICAL ? ["high_priority"] : []),
    ])];
    return {
      kind: "org",
      row: {
        organizationId,
        category: input.category ?? categoryFor(action, recordType),
        action,
        severity,
        description,
        resourceType: recordType,
        resourceId: input.recordId ?? null,
        resourceName: input.recordName ?? null,
        details: nonEmpty(details),
        oldValues: nonEmpty(input.before ?? null),
        newValues: nonEmpty(input.after ?? null),
        userId: actor?.id && actor.id !== SYSTEM_ACTOR_ID ? actor.id : null,
        userEmail: actor?.email ?? null,
        userRole: actor?.role ?? null,
        userName: actor?.name ?? null,
        impersonatedBy: impersonator?.id ?? null,
        ipAddress,
        userAgent,
        requestId:
          input.requestId !== undefined
            ? input.requestId
            : (scope?.requestId ?? null),
        sessionId:
          input.sessionId !== undefined
            ? input.sessionId
            : (scope?.sessionId ?? null),
        source: input.source ?? (actor ? "web" : "system"),
        tags,
        complianceFlags,
        messageKey,
        messageParams,
      },
    };
  }

  const metadata: Record<string, unknown> = { ...details };
  if (input.before && Object.keys(input.before).length) {
    metadata.previous = input.before;
  }
  if (input.after && Object.keys(input.after).length) {
    metadata.current = input.after;
  }
  if (messageParams) metadata.params = messageParams;
  metadata.messageKey = messageKey;
  if (actor?.role) metadata.actorRole = actor.role;

  // No id but an address: someone tried to sign in as an account that does
  // not exist. The address is all there is to name them by.
  const actorId =
    actor?.id || (actor?.email ? ANONYMOUS_ACTOR_ID : SYSTEM_ACTOR_ID);
  return {
    kind: "platform",
    row: {
      actorId,
      actorEmail: actor?.email ?? SYSTEM_ACTOR_EMAIL,
      actorName: actor?.name ?? null,
      action: platformActionName(action, recordType),
      targetType: recordType ?? (AUTH_ACTIONS.has(action) ? "auth" : "console"),
      targetId: input.recordId || actorId,
      targetName:
        input.recordName || actor?.name || actor?.email || SYSTEM_ACTOR_EMAIL,
      // A console action on one organization is filed under it, so the
      // organization's own trail shows it.
      organizationId:
        recordType === "organization" && input.recordId ? input.recordId : null,
      summary: description,
      metadata,
      ipAddress,
      userAgent,
    },
  };
}
