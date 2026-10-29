import "server-only";

/**
 * PropertyPro - Entries in the platform log for the Super Admin's own changes
 *
 * The console's activity screen reads `metadata.previous` and `metadata.current`
 * as the before and after of an entry (lib/audit/read#toPlatformActivityRows),
 * and `metadata.messageKey` + `metadata.params` for a sentence of the
 * organization log's vocabulary, so these record exactly those, with only the
 * fields that moved. A secret is compared but stored as "set", never as typed
 * or as stored.
 *
 * A save that moves nothing records nothing — and tells the API wrapper to add
 * no basic entry either.
 */

import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { diffSettings, type Snapshot } from "@/lib/audit/diff";
import { fullName, noteAuditEntry } from "@/lib/audit/scope";

/**
 * One `settings.updated` entry with the before and after. Returns whether an
 * entry was written.
 */
export async function recordPlatformSettingsChange(input: {
  actor: AuthenticatedAccessUser;
  /** A stable id for the screen or record: "messaging", "payment-gateway:stripe". */
  targetId: string;
  /** What a reader knows it by: a platform name, a gateway's brand name. */
  targetName: string;
  summary: string;
  before: Snapshot;
  after: Snapshot;
  keys: readonly string[];
  secretKeys?: readonly string[];
  /** Other plain facts to keep beside the change. */
  metadata?: Record<string, unknown>;
}): Promise<boolean> {
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
  await recordPlatformAudit({
    actor: input.actor,
    action: "settings.updated",
    targetType: "settings",
    targetId: input.targetId,
    targetName: input.targetName,
    summary: input.summary,
    metadata: {
      previous: diff.before,
      current: diff.after,
      ...(diff.secretsChanged.length
        ? { secretsChanged: diff.secretsChanged }
        : {}),
      ...(input.metadata ?? {}),
    },
  });
  return true;
}

/** The operator, as a reader knows them: their name, else their address. */
function operatorName(
  actor: AuthenticatedAccessUser,
  named?: { firstName?: string | null; lastName?: string | null } | null,
): string {
  return (
    fullName(named?.firstName, named?.lastName) ??
    fullName(actor.firstName, actor.lastName) ??
    actor.email ??
    actor.id
  );
}

/**
 * The Super Admin changing their own details or photo: "Updated: Own
 * account", named by their name, with the fields that moved. Returns whether
 * an entry was written.
 */
export async function recordOperatorAccountChange(input: {
  actor: AuthenticatedAccessUser;
  /** Their name after the change. */
  named?: { firstName?: string | null; lastName?: string | null } | null;
  before: Snapshot;
  after: Snapshot;
  keys: readonly string[];
}): Promise<boolean> {
  const diff = diffSettings(input.before, input.after, input.keys);
  if (diff.changed.length === 0) {
    noteAuditEntry();
    return false;
  }
  await recordPlatformAudit({
    actor: input.actor,
    action: "account.updated",
    targetType: "user",
    targetId: input.actor.id,
    targetName: operatorName(input.actor, input.named),
    summary: "Updated their own account",
    metadata: {
      previous: diff.before,
      current: diff.after,
      // The organization log's sentence, worded in the reader's language.
      messageKey: "admin.audit.msg.update",
      params: { type: "account" },
    },
  });
  return true;
}

/**
 * The Super Admin changing their own password: the event, never a value.
 * (`auth.password_changed` is one of the console's own actions.)
 */
export async function recordOperatorPasswordChange(
  actor: AuthenticatedAccessUser,
): Promise<void> {
  await recordPlatformAudit({
    actor,
    action: "auth.password_changed",
    targetType: "auth",
    targetId: actor.id,
    targetName: operatorName(actor),
    summary: "Changed their password",
  });
}
