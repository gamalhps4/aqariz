/**
 * PropertyPro - Every report export in the activity log
 *
 * Thirty-odd routes export through one writer (lib/reports/export
 * `buildReportResponse`) and none of them recorded the export. One call
 * there records them all: who exported which report, in which format, how
 * many rows, with which filters — on behalf of whom, when a support operator
 * did it while viewing as a customer.
 *
 * Imported by the export writer, which the tests load without a database: so
 * nothing here reaches one until there is a request to attribute the export
 * to, and the writer is loaded lazily then.
 */

import type { ActivityInput } from "./entry";
import { getAuditScope, noteAuditEntry, type AuditScope } from "./scope";
import { AuditAction, AuditCategory } from "./vocabulary";

/** Query parameters that say how the file is laid out, not what is in it. */
const PRESENTATION_PARAMS = new Set(["format", "lang", "rtl", "page", "limit", "pageSize"]);

/** The filters an export was made with, e.g. "status=overdue&from=2026-09-01". */
export function exportFilters(search: string): string {
  const params = new URLSearchParams(search);
  for (const key of [...params.keys()]) {
    if (PRESENTATION_PARAMS.has(key)) params.delete(key);
  }
  return params.toString();
}

type ExportEntry = ActivityInput;

/** The writer, loaded only when there is an export to record. */
async function writeExportEntry(entry: ExportEntry, scope: AuditScope): Promise<void> {
  const { recordActivity } = await import("@/lib/audit-service");
  await recordActivity(entry, scope);
}

export function noteReportExport(
  info: {
    /** The report's English title, as the route named the file. */
    report: string;
    format: string;
    rows: number;
  },
  write: (entry: ExportEntry, scope: AuditScope) => Promise<void> = writeExportEntry,
): void {
  const scope = getAuditScope();
  // Outside a request (a test, a script) there is nobody to attribute it to.
  if (!scope) return;
  // Counted now, before the writer loads: the request may finish first.
  noteAuditEntry(scope);
  const filters = exportFilters(scope.search);

  void write(
    {
      action: AuditAction.BULK_EXPORT,
      category: AuditCategory.DATA_EXPORT,
      recordType: "report",
      recordName: info.report,
      messageParams: { report: info.report, format: info.format },
      details: {
        format: info.format,
        rows: info.rows,
        route: scope.pathname,
        ...(filters ? { filters } : {}),
      },
      tags: ["export", info.format],
    },
    scope,
  ).catch((error) => {
    console.error("Failed to record report export:", error);
  });
}
