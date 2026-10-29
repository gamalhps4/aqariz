import "server-only";

/**
 * PropertyPro - Entries for a person's own account
 *
 * Changing a name, a password, an email address or a photo is the person
 * acting on their own account: the record is the account ("Own account"),
 * named by the person's full name (their email when they have none), with the
 * fields that moved. Nothing secret is ever passed here — a password change is
 * the event alone, with no values.
 *
 * Inside an authenticated request the scope names the actor. A link the
 * person follows from their inbox (confirming an email address) carries no
 * session, so the caller passes the request and the person is named
 * explicitly, as the sign-in hooks do (`recordAccountEvent`).
 *
 * Fire-and-forget like every audit write: nothing here awaits or throws.
 */

import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { diffSettings, type Snapshot } from "@/lib/audit/diff";
import { fullName, noteAuditEntry, requestIpAddress } from "@/lib/audit/scope";

export interface AccountPerson {
  id: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  role?: string | null;
  organizationId?: string | null;
}

/** "Sara Hassan", or the email when the person has no name. */
export function accountName(person: AccountPerson): string | null {
  return fullName(person.firstName, person.lastName) ?? person.email ?? null;
}

/**
 * One entry for the person's own account.
 *
 * With `keys`, only the fields that moved are recorded and a save that moves
 * nothing records nothing (and tells the API wrapper to add no basic entry);
 * `secretKeys` are compared and stored as "set". Without `keys`, `before` and
 * `after` are written as given. Returns whether an entry was written.
 */
export function auditOwnAccount(input: {
  person: AccountPerson;
  /** The person's name when it should be the one after the change. */
  named?: AccountPerson;
  action?: AuditAction;
  before?: Snapshot | null;
  after?: Snapshot | null;
  keys?: readonly string[];
  secretKeys?: readonly string[];
  messageKey?: string;
  details?: Record<string, unknown>;
  /** Pass the request for a call outside the API wrapper (a token link). */
  request?: Request;
}): boolean {
  let before = input.before ?? null;
  let after = input.after ?? null;
  let details = input.details;
  if (input.keys) {
    const diff = diffSettings(before, after, input.keys, input.secretKeys);
    if (diff.changed.length === 0) {
      noteAuditEntry();
      return false;
    }
    before = diff.before;
    after = diff.after;
    if (diff.secretsChanged.length) {
      details = { ...details, secretsChanged: diff.secretsChanged };
    }
  }

  const { person, request } = input;
  void recordActivity({
    action: input.action ?? AuditAction.UPDATE,
    recordType: "account",
    recordId: person.id,
    recordName: accountName(input.named ?? person),
    before,
    after,
    messageKey: input.messageKey,
    details: details ?? null,
    ...(request
      ? {
          actor: {
            id: person.id,
            name: fullName(person.firstName, person.lastName),
            email: person.email ?? null,
            role: person.role ?? null,
            isPlatformAdmin: false,
          },
          organizationId: person.organizationId ?? null,
          impersonator: null,
          ipAddress: requestIpAddress(request.headers),
          userAgent: request.headers.get("user-agent"),
          source: "web",
        }
      : {}),
  });
  return true;
}
