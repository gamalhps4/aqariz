/**
 * PropertyPro - The request an activity entry belongs to
 *
 * The API wrapper opens one scope per authenticated request and every audit
 * write inside it reads who is acting, from where, and on whose behalf from
 * here — so a route's audit call is one line and still records the person's
 * name, email and role as they were at the time.
 *
 * The scope also counts the entries written while the request runs. That
 * count is what keeps the log to one entry per action: a handler that records
 * its own rich entry (with the before and after) leaves the wrapper nothing to
 * add, and a handler that records nothing still gets one basic entry from the
 * wrapper once it has succeeded.
 *
 * No database here, and nothing marked server-only: the export writer and the
 * tests import it.
 */

import { AsyncLocalStorage } from "node:async_hooks";

/** Who acted — copied onto the entry, so it outlives a renamed or deleted user. */
export interface AuditActor {
  id: string;
  name: string | null;
  email: string | null;
  /** The role key as stored ("manager", or a permission group's key). */
  role: string | null;
  /** A permission group's key says nothing ("group_2"); this is its name. */
  roleIsGroup?: boolean;
  isPlatformAdmin: boolean;
}

/** A platform operator viewing the app as the actor (read-only support view). */
export interface AuditImpersonator {
  id: string;
  email: string;
}

export interface AuditScope {
  actor: AuditActor | null;
  /** The organization the request acts in; null for a platform operator. */
  organizationId: string | null;
  impersonator: AuditImpersonator | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  sessionId: string | null;
  method: string;
  pathname: string;
  /** The query string, e.g. the filters an export was made with. */
  search: string;
  /** Entries recorded while this request ran. */
  entries: number;
  /**
   * The records already given an entry in this request ("payment:<id>"). A
   * service and the route that called it may both record the same action —
   * the first, richer entry (the service's, with the before and after) is
   * kept and the second dropped.
   */
  recorded: Set<string>;
}

// Kept on globalThis for the same reason as the organization context: a dev
// hot reload must not leave the wrapper and the writers on two different
// storages.
const globalForAuditScope = globalThis as typeof globalThis & {
  __propertyProAuditScope?: AsyncLocalStorage<AuditScope>;
};
const storage =
  globalForAuditScope.__propertyProAuditScope ??
  new AsyncLocalStorage<AuditScope>();
globalForAuditScope.__propertyProAuditScope = storage;

export function runWithAuditScope<T>(
  scope: AuditScope,
  fn: () => T,
): Promise<Awaited<T>> {
  return storage.run(scope, async () => await fn()) as Promise<Awaited<T>>;
}

export function getAuditScope(): AuditScope | undefined {
  return storage.getStore();
}

/**
 * Count an entry against the current request. Called synchronously when a
 * write is *started*, so a handler that fires its audit call without awaiting
 * it still counts — the wrapper reads the count the moment the handler
 * returns.
 */
export function noteAuditEntry(scope: AuditScope | undefined = getAuditScope()): void {
  if (scope) scope.entries += 1;
}

/**
 * Claim the one entry a record gets in this request. False when it already
 * has one — the caller then writes nothing. Records named by neither type
 * nor id (a sign-in, an export) are never claimed.
 */
export function claimAuditRecord(
  scope: AuditScope | undefined,
  recordType: string | null | undefined,
  recordId: string | null | undefined,
): boolean {
  if (!scope || !recordType || !recordId) return true;
  const key = `${recordType}:${recordId}`;
  if (scope.recorded.has(key)) return false;
  scope.recorded.add(key);
  return true;
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** True for methods that change nothing. */
export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method.toUpperCase());
}

/**
 * Whether the wrapper has to write the basic entry for this request, and
 * which: a write that succeeded and recorded nothing of its own, or a read
 * that handed over a file (a document, a receipt, a PDF — a download is
 * logged, owner's decision). A refused or failed request changed nothing,
 * and any other read is a page view, which is not logged.
 */
export function backstopKind(
  scope: AuditScope,
  status: number,
  contentDisposition?: string | null,
): "write" | "download" | null {
  if (status < 200 || status >= 300) return null;
  if (scope.entries > 0) return null;
  if (!isReadMethod(scope.method)) return "write";
  return contentDisposition && /filename/i.test(contentDisposition)
    ? "download"
    : null;
}

/** The file name a Content-Disposition header gives — RFC 6266's `filename*` first. */
export function dispositionFileName(
  contentDisposition: string | null | undefined,
): string | null {
  if (!contentDisposition) return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(contentDisposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      // Fall through to the plain form.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(contentDisposition);
  return plain ? plain[1].trim() : null;
}

/** First address in X-Forwarded-For, else X-Real-IP. */
export function requestIpAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  const first = forwarded?.split(",")[0]?.trim();
  return first || headers.get("x-real-ip")?.trim() || null;
}

/** "Ahmed Ali", or null when neither part is set. */
export function fullName(
  firstName?: string | null,
  lastName?: string | null,
): string | null {
  const name = [firstName, lastName]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
  return name || null;
}

/** The scope for one authenticated request, from what the wrapper resolved. */
export function scopeForRequest(
  user: {
    id: string;
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    role?: string | null;
    isCustomRole?: boolean;
    isPlatformAdmin?: boolean;
    organizationId?: string | null;
    sessionId?: string;
    impersonatedBy?: { id: string; email: string } | null;
  },
  request: { method: string; headers: Headers; url: string },
): AuditScope {
  const url = new URL(request.url);
  return {
    actor: {
      id: user.id,
      name: fullName(user.firstName, user.lastName),
      email: user.email ?? null,
      role: user.role ?? null,
      roleIsGroup: user.isCustomRole === true,
      isPlatformAdmin: user.isPlatformAdmin === true,
    },
    organizationId: user.organizationId ?? null,
    impersonator: user.impersonatedBy ?? null,
    ipAddress: requestIpAddress(request.headers),
    userAgent: request.headers.get("user-agent"),
    requestId: request.headers.get("x-request-id"),
    sessionId: user.sessionId ?? null,
    method: request.method.toUpperCase(),
    pathname: url.pathname,
    search: url.search,
    entries: 0,
    recorded: new Set(),
  };
}
