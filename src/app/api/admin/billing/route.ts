/**
 * PropertyPro SaaS - Platform admin: billing metrics
 *
 * Super-admin only. Returns cross-organization MRR / subscription metrics for
 * the platform console. Scoping is disabled (withPlatformAdminAndDB), so the
 * aggregation spans every organization.
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
  getPlatformBillingMetrics,
  type OrgBillingRow,
} from "@/lib/billing/metrics";
import {
  buildReportResponse,
  isReportFormat,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { getPlatformLetterhead } from "@/lib/reports/letterhead";
import { businessDay, businessToday } from "@/lib/dates/business-day";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const metrics = await getPlatformBillingMetrics();

      // The subscription book, with the headline figures in the summary
      // block. This is the export an accountant asks for at quarter end, and
      // the one the console could not produce at all.
      const rawFormat = request.nextUrl.searchParams.get("format");
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }

        const day = (value: string | null) => (value ? businessDay(value) : "");

        const sheet: ReportSheet<OrgBillingRow> = {
          title: "Subscriptions",
          columns: [
            { header: "Organization", value: (row) => row.name },
            { header: "Slug", value: (row) => row.slug },
            { header: "Plan", value: (row) => row.plan },
            { header: "Account status", value: (row) => row.status },
            {
              header: "Subscription",
              value: (row) => row.subscriptionStatus ?? "",
            },
            // Monthly-normalised, so an annual plan sits beside a monthly one.
            { header: "Monthly value", value: (row) => row.monthlyValue },
            {
              header: "Renews",
              value: (row) => day(row.currentPeriodEnd),
            },
            { header: "Trial ends", value: (row) => day(row.trialEndsAt) },
            {
              header: "Cancelling",
              value: (row) => (row.cancelAtPeriodEnd ? "yes" : "no"),
            },
          ],
          rows: metrics.organizations,
          summary: [
            ["Currency", metrics.currency],
            ["MRR", metrics.mrr],
            ["ARR", metrics.arr],
            ["At-risk MRR", metrics.atRiskMrr],
            ["Organizations", metrics.counts.total],
            ["Paying", metrics.counts.paying],
            ["Trialing", metrics.counts.trialing],
            ["Past due", metrics.counts.pastDue],
            ["Cancelled", metrics.counts.canceled],
            // Named rather than silently dropped: these subscriptions are
            // real money the totals above deliberately exclude.
            [
              "Excluded (other currency)",
              metrics.excludedOtherCurrency,
            ],
          ],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          fileName: "Subscriptions",
          dateStamp: businessToday(),
          letterhead: await getPlatformLetterhead(),
        });
      }

      return createSuccessResponse(metrics, "Billing metrics retrieved");
    } catch (error) {
      return handleApiError(error);
    }
  },
);
