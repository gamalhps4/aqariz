/**
 * PropertyPro - An activity entry as the screens receive it
 *
 * Both activity APIs answer with this shape (lib/audit/read builds it), and
 * both screens render it (components/audit/activity-parts). Types only.
 */

export interface ActivityActor {
  id: string | null;
  name: string | null;
  email: string | null;
  /** The role key as stored ("manager", or a permission group's key). */
  role: string | null;
  /** A permission group's names, kept when the entry was written. */
  roleLabel: string | null;
  roleLabelAr: string | null;
}

export interface ActivityRow {
  id: string;
  /** Which log it came from: an organization's own, or the platform's. */
  source: "organization" | "platform";
  timestamp: string;
  organizationId: string | null;
  organizationName: string | null;
  category: string;
  action: string;
  severity: string;
  /** English, as written; the fallback when the key does not render. */
  description: string;
  messageKey: string | null;
  messageParams: Record<string, unknown> | null;
  resourceType: string | null;
  resourceId: string | null;
  resourceName: string | null;
  /** The contract the entry concerns, by number. */
  contractNumber: string | null;
  actor: ActivityActor;
  /** The support operator viewing the app as the actor, if one was. */
  impersonator: { id: string; email: string | null } | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  details: Record<string, unknown> | null;
}
