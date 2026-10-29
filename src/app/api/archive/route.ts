/**
 * PropertyPro - Archive API
 * Counts per category, and the archived records within one.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  archiveCounts,
  isArchiveCategory,
  listArchived,
} from "@/lib/services/archive.service";
import { canPermanentlyDelete } from "@/lib/archive-access";
import { hasAnyPermission } from "@/lib/permissions-manager";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportSheet,
} from "@/lib/reports/export";
import type { ArchiveCategory, ArchivedRecord } from "@/lib/services/archive.service";
import { businessDay, businessToday } from "@/lib/dates/business-day";

/** The export's title for each category — translated like any other label. */
const ARCHIVE_TITLES: Record<ArchiveCategory, string> = {
  owners: "Archived owners",
  clients: "Archived clients",
  compounds: "Archived compounds",
  buildings: "Archived buildings",
  units: "Archived units",
  management_agreements: "Archived management agreements",
  investment_agreements: "Archived investment agreements",
  lease_contracts: "Archived lease contracts",
  invoices: "Archived invoices",
  payments: "Archived payments",
  maintenance: "Archived maintenance requests",
};

/**
 * Whether this caller may put a record back — the rights the restore route
 * (./[category]/[id]) asks for. Sent with the list so the screen offers
 * Restore only to someone the server will let restore; a reader holding
 * `archive_view` alone was shown a button that always answered 403.
 */
function canRestore(user: AuthenticatedAccessUser): boolean {
  return hasAnyPermission(user.permissions, [
    "archive_restore",
    "property_management",
    "tenant_management",
  ]);
}

// `archive_view` is the permission this route is really about; the two module
// permissions stay listed so every role that could already reach the archive
// still can. `withPermissionAndDB` matches ANY of them.
export const GET = withPermissionAndDB([
  "archive_view",
  "property_management",
  "tenant_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const category = searchParams.get("category");

    if (!category) {
      return createSuccessResponse(
        {
          counts: await archiveCounts(user),
          // The UI needs this to decide whether to offer permanent deletion
          // at all, rather than showing a button that always 403s. Both of
          // the purge's gates, not only the role rule: an owner whose role
          // lacks `permanent_delete` is refused too.
          canPurge: canPermanentlyDelete(user),
          canRestore: canRestore(user),
        },
        "Archive summary retrieved successfully",
      );
    }

    if (!isArchiveCategory(category)) {
      return createErrorResponse(`Unknown archive category "${category}"`, 400);
    }

    const format = searchParams.get("format");
    if (format) {
      if (!canExport(user, "archive_export", "archive_view")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (!isReportFormat(format)) {
        return createErrorResponse(`Unsupported export format "${format}"`, 400);
      }
    }

    const records = await listArchived(category, { actor: user,
      search: searchParams.get("search") || undefined,
      // An export is the whole filtered list, as far as the archive reads.
      limit: format ? 500 : Number(searchParams.get("limit")) || undefined,
      // The words in a record's detail line: the download's language, or the
      // screen's (it sends `lang` as the export control does).
      language: reportLanguage(searchParams),
    });

    if (format && isReportFormat(format)) {
      const day = (value: string) => businessDay(value);
      const sheet: ReportSheet<ArchivedRecord> = {
        title: ARCHIVE_TITLES[category],
        columns: [
          { header: "Record", value: (row) => row.label },
          { header: "Details", value: (row) => row.sublabel },
          { header: "Notes", value: (row) => row.detail ?? "" },
          { header: "Archived on", value: (row) => day(row.deletedAt) },
          { header: "Created on", value: (row) => day(row.createdAt) },
        ],
        rows: records,
        summary: [["Total", records.length]],
      };
      return buildReportResponse(sheet, {
        format,
        fileName: ARCHIVE_TITLES[category],
        dateStamp: businessToday(),
        rtl: isRtlReportRequest(searchParams),
        lang: reportLanguage(searchParams),
      });
    }

    return createSuccessResponse(
      {
        category,
        records,
        canPurge: canPermanentlyDelete(user),
        canRestore: canRestore(user),
      },
      "Archived records retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error, "Failed to read the archive");
  }
});
