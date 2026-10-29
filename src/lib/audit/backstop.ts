import "server-only";

/**
 * PropertyPro - One entry for every action, whether the route recorded it or not
 *
 * Of 227 write handlers, 35 wrote an activity entry; the rest — editing a
 * contract, deleting an installment, the whole permission page — left no
 * trace. Rather than trust every route (and every future route) to remember,
 * the API wrapper runs each handler inside an audit scope and, when a write
 * succeeds without recording anything of its own, records one basic entry:
 * who, the action the method and path name, the record's type and id (from
 * the path, or from the record the handler answered with), and its name when
 * the answer carries one.
 *
 * The same check covers downloads, which are reads: a read that answered
 * with a file (Content-Disposition) is a document handed over, and is logged
 * — a report export is already logged by the export writer itself.
 *
 * A route that records a rich entry — with the before and after — leaves
 * nothing for this to add (see AuditScope.entries), so an action is never
 * logged twice.
 */

import { recordActivity } from "@/lib/audit-service";
import {
  backstopKind,
  dispositionFileName,
  runWithAuditScope,
  scopeForRequest,
  type AuditScope,
} from "./scope";
import {
  AuditAction,
  AuditCategory,
  describeApiRequest,
  pickRecordIdentity,
} from "./vocabulary";

type ScopeUser = Parameters<typeof scopeForRequest>[0];

/** The record a JSON answer names, read from a copy so the answer is untouched. */
async function answeredRecord(
  response: Response,
  recordType: string | null,
): Promise<{ id?: string; name?: string }> {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    return {};
  }
  try {
    const payload = (await response.clone().json()) as { data?: unknown };
    // `{ success, data }` from the response helpers; a few routes answer
    // with the record itself.
    return pickRecordIdentity(
      payload && typeof payload === "object" && "data" in payload
        ? payload.data
        : payload,
      recordType,
    );
  } catch {
    return {};
  }
}

/** Record the basic entry for a request whose handler recorded none. */
export async function recordRequestActivity(
  scope: AuditScope,
  response: Response,
): Promise<void> {
  try {
    const disposition = response.headers.get("content-disposition");
    const kind = backstopKind(scope, response.status, disposition);
    if (!kind) return;

    if (kind === "download") {
      const target = describeApiRequest("GET", scope.pathname);
      const fileName = dispositionFileName(disposition);
      const isExport = /export/.test(scope.pathname);
      await recordActivity(
        {
          action: isExport ? AuditAction.BULK_EXPORT : AuditAction.DOCUMENT_DOWNLOAD,
          category: isExport
            ? AuditCategory.DATA_EXPORT
            : AuditCategory.DOCUMENT_MANAGEMENT,
          recordType: isExport ? "report" : (target?.recordType ?? "document"),
          recordId: target?.recordId ?? null,
          recordName: fileName,
          messageParams: isExport && fileName ? { report: fileName } : undefined,
          details: {
            method: scope.method,
            route: target?.route ?? scope.pathname,
            ...(fileName ? { fileName } : {}),
          },
          tags: ["download"],
        },
        scope,
      );
      return;
    }

    const target = describeApiRequest(scope.method, scope.pathname);
    if (!target) return;
    const answered = await answeredRecord(response, target.recordType);
    await recordActivity(
      {
        action: target.action,
        category: target.category,
        recordType: target.recordType,
        recordId: target.recordId ?? answered.id ?? null,
        recordName: answered.name ?? null,
        details: {
          method: scope.method,
          route: target.route,
          status: response.status,
          ...(target.parentId ? { parentId: target.parentId } : {}),
        },
        tags: ["request"],
      },
      scope,
    );
  } catch (error) {
    console.error("Failed to record request activity:", error);
  }
}

/**
 * Run an authenticated handler inside an audit scope, then record the basic
 * entry if it changed something (or handed over a file) and recorded nothing
 * itself. The response is returned as the handler made it.
 */
export async function runRequestWithAudit<R>(
  user: ScopeUser,
  request: { method: string; headers: Headers; url: string },
  handler: () => R,
): Promise<Awaited<R>> {
  const scope = scopeForRequest(user, request);
  const result = await runWithAuditScope(scope, handler);
  if (result instanceof Response) {
    await recordRequestActivity(scope, result);
  }
  return result;
}
