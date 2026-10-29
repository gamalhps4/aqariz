/**
 * PropertyPro - Feedback API (platform side)
 *
 * Every customer organization's feedback in one place, for the operator who
 * decides what gets built. This is the half that did not exist: an org member
 * could write feedback, but nothing carried it out of their organization, so
 * it was addressed to a reader with no screen to read it on.
 *
 * withPlatformAdminAndDB runs the handler with org scoping disabled, which is
 * how one query spans every organization. There is no weaker RLS policy for
 * the platform — the same org_isolation policy is simply bypassed by a caller
 * the wrapper has already proved is a platform super-admin.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  isFeedbackCategory,
  isFeedbackPriority,
  isFeedbackStatus,
  listFeedback,
  summarizeFeedback,
} from "@/lib/services/feedback.service";
import {
  buildReportResponse,
  isReportFormat,
  EXPORT_ROW_LIMIT,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { getPlatformLetterhead } from "@/lib/reports/letterhead";
import type { FeedbackEntry } from "@/lib/services/feedback.service";
import { businessDay, businessToday } from "@/lib/dates/business-day";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const category = searchParams.get("category");
      const status = searchParams.get("status");
      const priority = searchParams.get("priority");
      const organizationId = searchParams.get("organizationId");
      const search = searchParams.get("search");

      if (category && !isFeedbackCategory(category)) {
        return createErrorResponse("Unknown feedback category", 400);
      }
      if (status && !isFeedbackStatus(status)) {
        return createErrorResponse("Unknown feedback status", 400);
      }
      if (priority && !isFeedbackPriority(priority)) {
        return createErrorResponse("Unknown feedback priority", 400);
      }

      const options = {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        ...(priority ? { priority } : {}),
        ...(organizationId ? { organizationId } : {}),
        ...(search ? { search } : {}),
        limit: Number(searchParams.get("limit") ?? 100),
        offset: Number(searchParams.get("offset") ?? 0),
      };

      const [page, summary] = await Promise.all([
        // The customer's name travels with each row here and nowhere else:
        // inside an organization it is noise, in the console it is the point.
        listFeedback(options, true),
        summarizeFeedback(options),
      ]);

      // Same filters — the file carries the filtered set, not the page of it
      // on screen, so `limit` is raised to the export cap.
      const rawFormat = searchParams.get("format");
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }

        const all = await listFeedback(
          { ...options, limit: EXPORT_ROW_LIMIT, offset: 0 },
          true,
        );

        const day = (value: string | null) =>
          value ? businessDay(value) : "";

        const sheet: ReportSheet<FeedbackEntry> = {
          title: "Product feedback",
          columns: [
            { header: "Raised", value: (row) => day(row.createdAt) },
            {
              header: "Organization",
              value: (row) => row.organizationName ?? "",
            },
            { header: "From", value: (row) => row.authorName ?? "" },
            { header: "Role", value: (row) => row.userRole },
            { header: "Category", value: (row) => row.category },
            { header: "Priority", value: (row) => row.priority },
            { header: "Status", value: (row) => row.status },
            { header: "Rating", value: (row) => row.rating },
            { header: "Title", value: (row) => row.title },
            { header: "Detail", value: (row) => row.description },
            { header: "Feature", value: (row) => row.feature ?? "" },
            { header: "Reply", value: (row) => row.adminResponse ?? "" },
            { header: "Resolved", value: (row) => day(row.resolvedAt) },
          ],
          rows: all.entries,
          summary: [["Feedback items", all.entries.length]],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          fileName: "Product feedback",
          dateStamp: businessToday(),
          letterhead: await getPlatformLetterhead(),
        });
      }

      return createSuccessResponse(
        { feedback: page.entries, total: page.total, summary },
        "Feedback retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve feedback");
    }
  },
);
