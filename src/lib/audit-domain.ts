import "server-only";

/**
 * PropertyPro - Domain audit helpers
 *
 * `auditService.logEvent` takes eight fields and a context object, which is
 * why only a handful of routes ever called it. These reduce an audit to one
 * call: the request's scope (opened by the API wrapper) already knows who is
 * acting — their name, email and role, and the support operator viewing as
 * them — so a route says only what happened, to which record, and the values
 * before and after.
 *
 *   recordActivity({ action, recordType, recordId, recordName, before, after })
 *
 * A route that records its entry this way is not given a second, basic one by
 * the wrapper (see lib/audit/backstop). A contract is named by its NUMBER, an
 * installment by its invoice number — the id is kept as well, but it is not
 * what a reader looks for.
 *
 * Deliberately fire-and-forget: an audit write must never turn a completed
 * payment into a failed request. Failures are logged, not thrown.
 */

import type { NextRequest } from "next/server";
import { AuditAction, recordActivity } from "@/lib/audit-service";
import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import {
  fullName,
  noteAuditEntry,
  requestIpAddress,
  type AuditActor,
} from "@/lib/audit/scope";
import type { ActivityParams } from "@/lib/audit/entry";
import { diffSettings, diffSnapshot } from "@/lib/audit/diff";

export { recordActivity };
export { AuditAction };
export { diffSnapshot, pickSnapshot, snapshotValue } from "@/lib/audit/diff";

/** Records whose changes an office may have to justify. */
export type DomainResource =
  | "payment"
  | "invoice"
  | "lease"
  | "tenant"
  | "owner"
  | "property"
  | "unit"
  | "compound"
  | "expense"
  | "deposit"
  | "agreement"
  | "role"
  | "user"
  | "settings";

export interface DomainAuditInput {
  user: AuthenticatedAccessUser;
  request: NextRequest;
  resource: DomainResource;
  action: AuditAction;
  resourceId: string;
  resourceName: string;
  description: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  messageKey?: string;
  messageParams?: ActivityParams;
}

/** The actor as the request resolved them, for a call made outside a scope. */
export function actorOf(user: AuthenticatedAccessUser): AuditActor {
  return {
    id: user.id,
    name: fullName(user.firstName, user.lastName),
    email: user.email,
    role: user.role,
    roleIsGroup: user.isCustomRole,
    isPlatformAdmin: user.isPlatformAdmin,
  };
}

export async function recordDomainAudit(
  input: DomainAuditInput,
): Promise<void> {
  try {
    await recordActivity({
      action: input.action,
      recordType: input.resource,
      recordId: input.resourceId,
      recordName: input.resourceName,
      description: input.description,
      before: input.oldValues ?? null,
      after: input.newValues ?? null,
      messageKey: input.messageKey,
      messageParams: input.messageParams,
      tags: [input.resource, String(input.action)],
      // The wrapper's scope names the actor; these cover a caller outside it.
      actor: actorOf(input.user),
      organizationId: input.user.organizationId ?? undefined,
      impersonator: input.user.impersonatedBy ?? undefined,
      ipAddress: requestIpAddress(input.request.headers),
      userAgent: input.request.headers.get("user-agent"),
    });
  } catch (error) {
    console.error(
      `Failed to audit ${input.resource}.${input.action}:`,
      error,
    );
  }
}

/** Bookkeeping columns no reader asks about. */
const NOISE_FIELDS = new Set([
  "updatedAt",
  "createdAt",
  "version",
  "updatedById",
  // A drawn signature is an image: kept on the contract, not copied here.
  "signatureData",
]);

/**
 * A change to one record, with only the fields that moved on each side.
 * `keys` names the fields to compare (by default every field on either
 * side). Fire-and-forget like every audit write.
 */
export function auditRecordChange(input: {
  action: AuditAction;
  recordType: string;
  recordId: string;
  recordName?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  keys?: readonly string[];
  messageKey?: string;
  messageParams?: ActivityParams;
  details?: Record<string, unknown>;
  /** For a call outside a request (a job, a webhook). */
  organizationId?: string | null;
}): void {
  const keys = (
    input.keys ??
    [...new Set([...Object.keys(input.before ?? {}), ...Object.keys(input.after ?? {})])]
  ).filter((key) => !NOISE_FIELDS.has(key));
  const diff =
    input.before || input.after
      ? diffSnapshot(input.before ?? {}, input.after ?? {}, keys)
      : null;
  void recordActivity({
    action: input.action,
    recordType: input.recordType,
    recordId: input.recordId,
    recordName: input.recordName ?? null,
    before: diff?.before ?? null,
    after: diff?.after ?? null,
    messageKey: input.messageKey,
    messageParams: input.messageParams,
    details: input.details ?? null,
    ...(input.organizationId !== undefined
      ? { organizationId: input.organizationId }
      : {}),
  });
}

/**
 * A save of one settings area — "display", "email", "payment", "messaging",
 * "branding", "profile" — with only the fields that moved. A save that moves
 * nothing records nothing (the preferences drawer saves on every tweak), and
 * says so to the API wrapper so it adds no basic entry either. Fields in
 * `secretKeys` are stored masked, never as typed. Returns whether an entry
 * was written.
 *
 * Read the stored settings BEFORE writing the new ones: `before` is what the
 * entry's reader compares against.
 */
export function auditSettingsChange(input: {
  area: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  keys: readonly string[];
  secretKeys?: readonly string[];
  details?: Record<string, unknown>;
  /** For a call outside a request (a job, a webhook). */
  organizationId?: string | null;
}): boolean {
  const diff = diffSettings(
    input.before,
    input.after,
    input.keys,
    input.secretKeys,
  );
  if (diff.changed.length === 0) {
    noteAuditEntry();
    return false;
  }
  void recordActivity({
    action: AuditAction.SETTINGS_CHANGED,
    recordType: "settings",
    recordId: input.area,
    recordName: input.area,
    messageKey: "admin.audit.msg.settings_area",
    messageParams: { area: input.area },
    before: diff.before,
    after: diff.after,
    details: {
      ...(diff.secretsChanged.length
        ? { secretsChanged: diff.secretsChanged }
        : {}),
      ...(input.details ?? {}),
    },
    ...(input.organizationId !== undefined
      ? { organizationId: input.organizationId }
      : {}),
  });
  return true;
}

/**
 * A contract's status change, with every field written alongside it — the
 * one entry for it (lib/services/lease-lifecycle `changeLeaseStatus`).
 * Named by the contract NUMBER. Terminating and signing read as such; any
 * other move as "from → to".
 */
export function auditLeaseStatusChange(input: {
  lease: Record<string, unknown> & { id: string; status: string };
  to: string;
  data?: Record<string, unknown> | null;
  updated: { contractNumber?: string | null; organizationId: string };
  action?: AuditAction;
  details?: Record<string, unknown>;
}): void {
  const from = input.lease.status;
  const written = Object.keys(input.data ?? {}).filter(
    (key) => !NOISE_FIELDS.has(key),
  );
  const action =
    input.action ??
    (input.to === "terminated"
      ? AuditAction.TERMINATE
      : input.data?.signedDate && input.to === "active" && from !== "active"
        ? AuditAction.SIGN
        : AuditAction.STATUS_CHANGED);
  auditRecordChange({
    action,
    recordType: "lease",
    recordId: input.lease.id,
    recordName: input.updated.contractNumber ?? null,
    before: input.lease,
    after: { ...input.lease, ...(input.data ?? {}), status: input.to },
    keys: ["status", ...written.filter((key) => key !== "status")],
    // The status words are rendered in the reader's language from these.
    messageParams: { from, to: input.to },
    details: input.details,
    organizationId: input.updated.organizationId,
  });
}

/**
 * An account event recorded outside the API wrapper — signing up, asking for
 * a password reset, setting a password from an invitation. Those requests
 * carry no session, so the person they concern is named explicitly.
 */
export async function recordAccountEvent(input: {
  action: AuditAction;
  user: {
    id: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    role?: string | null;
    organizationId?: string | null;
  };
  request: Request;
  recordType?: string;
  recordId?: string;
  recordName?: string;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await recordActivity({
      action: input.action,
      recordType: input.recordType ?? "user",
      recordId: input.recordId ?? input.user.id,
      recordName:
        input.recordName ??
        fullName(input.user.firstName, input.user.lastName) ??
        input.user.email ??
        null,
      details: input.details ?? null,
      actor: {
        id: input.user.id,
        name: fullName(input.user.firstName, input.user.lastName),
        email: input.user.email ?? null,
        role: input.user.role ?? null,
        isPlatformAdmin: false,
      },
      organizationId: input.user.organizationId ?? null,
      impersonator: null,
      ipAddress: requestIpAddress(input.request.headers),
      userAgent: input.request.headers.get("user-agent"),
      source: "web",
    });
  } catch (error) {
    console.error(`Failed to audit ${input.action}:`, error);
  }
}

/** Money amounts, trimmed to what an audit actually needs to show. */
export function moneySnapshot(
  row: Record<string, unknown> | null | undefined,
  keys: string[],
): Record<string, unknown> | undefined {
  if (!row) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (row[key] !== undefined) out[key] = row[key];
  }
  return Object.keys(out).length ? out : undefined;
}
