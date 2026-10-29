import type { AuthenticatedAccessUser } from "@/lib/api-utils";
import { writePlatformActivity } from "@/lib/audit-service";
import { getAuditScope, noteAuditEntry, fullName } from "@/lib/audit/scope";
import type { PLATFORM_AUDIT_ACTIONS } from "@/lib/audit/vocabulary";

/**
 * Control actions captured in the platform (super-admin) audit trail. The
 * named ones are the console's own; `<record>.<verb>` covers what the API
 * wrapper and the sign-in hooks record for an operator (see
 * lib/audit/entry#platformActionName).
 */
export type PlatformAuditAction =
  | (typeof PLATFORM_AUDIT_ACTIONS)[number]
  | `${string}.${string}`;

/** Automated jobs (cron sweeps, webhook handlers) act with no signed-in user.
 * They still belong in the platform trail, recorded against this sentinel so
 * the console can tell an operator action from a scheduled one. */
export const SYSTEM_ACTOR = "system" as const;

interface RecordPlatformAuditInput {
  actor: AuthenticatedAccessUser | typeof SYSTEM_ACTOR;
  action: PlatformAuditAction;
  targetType:
    | "organization"
    | "user"
    | "billing"
    | "plan"
    | "landing"
    | "blog_post"
    | "settings"
    | "announcement"
    | "contact_message"
    | "auth"
    | "report"
    | "console";
  targetId: string;
  targetName: string;
  organizationId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
  /** For a route outside the API wrapper; otherwise read from the request. */
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Audit logging must never turn a successful control action into a failure.
 *
 * Counts against the request at once, so the API wrapper does not add a
 * second, basic entry for the same action; the actor's name, address and
 * browser are taken from the request.
 */
export async function recordPlatformAudit(
  input: RecordPlatformAuditInput,
): Promise<void> {
  const scope = getAuditScope();
  noteAuditEntry(scope);
  try {
    const actor = input.actor === SYSTEM_ACTOR ? null : input.actor;
    await writePlatformActivity({
      actorId: actor ? actor.id : SYSTEM_ACTOR,
      actorEmail: actor ? actor.email : "system@propertypro",
      actorName: actor
        ? fullName(actor.firstName, actor.lastName) ??
          (scope?.actor?.id === actor.id ? scope.actor.name : null)
        : null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      targetName: input.targetName,
      organizationId: input.organizationId ?? null,
      summary: input.summary,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? scope?.ipAddress ?? null,
      userAgent: input.userAgent ?? scope?.userAgent ?? null,
    });
  } catch (error) {
    console.error("Failed to record platform audit event", error);
  }
}
