/**
 * PropertyPro - Marketing: the office's property listings
 *
 * GET lists them (searchable, filterable, paged, and — for those who may
 * carry data out — downloadable as the same list); POST starts one for a
 * vacant unit, or for a property not in the system (`standalone: true`). Publishing, editing and archiving are on the listing's own
 * routes, each behind its own right (lib/listings/permissions.ts).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createPaginationInfo,
  createSuccessResponse,
  parseRequestBody,
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
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { compact } from "@/lib/audit/records/shared";
import { listingName, listingSnapshot } from "@/lib/audit/records/listing";
import { listingFailure, pageParams, queryText } from "@/lib/listings/api";
import { accessList } from "@/lib/listings/permissions";
import { issueLines, listingCreateSchema } from "@/lib/listings/schemas";
import {
  createListing,
  listListings,
  listListingsForExport,
  type ListFilters,
} from "@/lib/listings/service";
import type { ListingDto } from "@/lib/listings/types";
import { absoluteUrl } from "@/lib/listings/urls";
import { businessToday } from "@/lib/dates/business-day";

function filtersFrom(searchParams: URLSearchParams): Omit<ListFilters, "page" | "limit"> {
  return {
    search: queryText(searchParams, "search"),
    status: queryText(searchParams, "status"),
    type: queryText(searchParams, "type"),
    propertyId: queryText(searchParams, "propertyId"),
    attention: searchParams.get("attention") === "1",
  };
}

export const GET = withPermissionAndDB(accessList("view"))(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = request.nextUrl;
      const { page, limit } = pageParams(searchParams);
      const filters = filtersFrom(searchParams);
      const exportAllowed = canExport(user, "listing_export", "listing_management");

      // The same list, as a file: what the screen filtered to, not the one
      // page of it that happened to be visible.
      const rawFormat = searchParams.get("format");
      if (rawFormat) {
        if (!exportAllowed) {
          return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
        }
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(`Unsupported export format "${rawFormat}"`, 400);
        }

        const lang = reportLanguage(searchParams);
        const rows = await listListingsForExport(user, filters, EXPORT_ROW_LIMIT);
        const title = (row: ListingDto) =>
          lang === "ar"
            ? row.titleAr || row.titleEn
            : row.titleEn || row.titleAr;

        const sheet: ReportSheet<ListingDto> = {
          title: "Property listings",
          columns: [
            { header: "Listing", value: title },
            { header: "Type", value: (row) => row.type },
            // A listing for a property not in the system has neither; its
            // address line says which property it is.
            { header: "Building", value: (row) => row.property?.name ?? "" },
            { header: "Unit", value: (row) => row.unit?.unitNumber ?? "" },
            { header: "Address", value: (row) => row.addressLine ?? "" },
            { header: "Price", value: (row) => row.price },
            { header: "Period", value: (row) => row.pricePeriod },
            { header: "City", value: (row) => row.city ?? "" },
            { header: "District", value: (row) => row.district ?? "" },
            { header: "Licence number", value: (row) => row.adLicenceNumber ?? "" },
            { header: "Licence expiry", value: (row) => row.adLicenceExpiry ?? "" },
            { header: "Status", value: (row) => row.status },
            { header: "Inquiries", value: (row) => row.inquiries.total },
            {
              header: "Public link",
              value: (row) =>
                row.status === "published" ? absoluteUrl(row.publicPath) : "",
            },
          ],
          rows,
          summary: [["Listings", rows.length]],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: "Property listings",
          dateStamp: businessToday(),
        });
      }

      const { rows, total, summary } = await listListings(
        user,
        { page, limit, ...filters },
        exportAllowed,
      );
      return createSuccessResponse(
        rows,
        "Listings retrieved successfully",
        createPaginationInfo(page, limit, total),
        { ...summary },
      );
    } catch (error) {
      return listingFailure(error, "Failed to retrieve the listings");
    }
  },
);

export const POST = withPermissionAndDB(accessList("create"))(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body } = await parseRequestBody(request);
      if (!success) return createErrorResponse("Invalid request body", 400);

      const parsed = listingCreateSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          issueLines(parsed.error).join(", "),
          400,
          undefined,
          "VALIDATION_ERROR",
        );
      }

      const created = await createListing(user, parsed.data);
      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "listing",
        recordId: created.id,
        recordName: listingName(created),
        after: compact(listingSnapshot(created)),
      });
      return createSuccessResponse(created, "Listing created successfully");
    } catch (error) {
      return listingFailure(error, "Failed to create the listing");
    }
  },
);
