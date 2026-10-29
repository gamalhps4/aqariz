/**
 * PropertyPro - Marketing: the listing inquiries inbox
 *
 * What strangers wrote on the public pages, for the people who hold the
 * Handle-inquiries right: searchable, filterable by status and assignee,
 * paged, and downloadable as the same list.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createPaginationInfo,
  createSuccessResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  EXPORT_DENIED_MESSAGE,
  EXPORT_ROW_LIMIT,
  buildReportResponse,
  canExport,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { listingFailure, pageParams, queryText } from "@/lib/listings/api";
import {
  listInquiries,
  listInquiriesForExport,
  type InquiryFilters,
} from "@/lib/listings/inquiries.service";
import { accessList } from "@/lib/listings/permissions";
import type { InquiryDto } from "@/lib/listings/types";
import { businessDay, businessToday } from "@/lib/dates/business-day";

function filtersFrom(
  searchParams: URLSearchParams,
): Omit<InquiryFilters, "page" | "limit"> {
  return {
    search: queryText(searchParams, "search"),
    status: queryText(searchParams, "status"),
    assignee: queryText(searchParams, "assignee"),
    listingId: queryText(searchParams, "listingId"),
  };
}

export const GET = withPermissionAndDB(accessList("inquiries"))(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = request.nextUrl;
      const { page, limit } = pageParams(searchParams, 20);
      const filters = filtersFrom(searchParams);
      const exportAllowed = canExport(user, "listing_export", "listing_management");

      const rawFormat = searchParams.get("format");
      if (rawFormat) {
        if (!exportAllowed) {
          return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
        }
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(`Unsupported export format "${rawFormat}"`, 400);
        }

        const lang = reportLanguage(searchParams);
        const rows = await listInquiriesForExport(user, filters, EXPORT_ROW_LIMIT);
        const listingTitle = (row: InquiryDto) =>
          lang === "ar"
            ? row.listing.titleAr || row.listing.titleEn
            : row.listing.titleEn || row.listing.titleAr;

        const sheet: ReportSheet<InquiryDto> = {
          title: "Listing inquiries",
          columns: [
            {
              header: "Received",
              value: (row) => businessDay(row.createdAt),
            },
            { header: "Name", value: (row) => row.name },
            { header: "Phone", value: (row) => row.phone },
            { header: "Email", value: (row) => row.email ?? "" },
            { header: "Listing", value: listingTitle },
            { header: "Message", value: (row) => row.message ?? "" },
            { header: "Status", value: (row) => row.status },
            { header: "Assignee", value: (row) => row.assignee?.name ?? "" },
            { header: "Notes", value: (row) => row.notes ?? "" },
          ],
          rows,
          summary: [["Inquiries", rows.length]],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: "Listing inquiries",
          dateStamp: businessToday(),
        });
      }

      const { rows, total, summary } = await listInquiries(
        user,
        { page, limit, ...filters },
        exportAllowed,
      );
      return createSuccessResponse(
        rows,
        "Inquiries retrieved successfully",
        createPaginationInfo(page, limit, total),
        { ...summary },
      );
    } catch (error) {
      return listingFailure(error, "Failed to retrieve the inquiries");
    }
  },
);
