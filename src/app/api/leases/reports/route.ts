/**
 * PropertyPro - Leasing reports API
 *
 * The contract registers: active · expiring soon · approaching expiry ·
 * renewed · expired · cancelled. Each takes the owner, compound, building,
 * unit, tenant, contract and date filters the review asks of every leasing
 * report; `?format=` returns the same rows as a download.
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
  getLeaseReport,
  isLeaseReportType,
  type LeaseReportRow,
  type LeaseReportType,
} from "@/lib/services/lease-reports.service";
import { readFilterIds } from "@/lib/report-filters/params";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { businessDay, businessToday } from "@/lib/dates/business-day";
import {
  buildReportResponse,
  capExportRows,
  EXPORT_ROW_LIMIT,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";

const TITLES: Record<LeaseReportType, string> = {
  active: "Active Contracts",
  "expiring-soon": "Contracts Expiring Soon",
  expiring: "Contracts Approaching Expiry",
  renewed: "Renewed Contracts",
  expired: "Expired Contracts",
  terminated: "Cancelled Contracts",
};

export const GET = withPermissionAndDB([
  "lease_management",
  "lease_view",
  "financial_reports",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;

    const type = searchParams.get("type") ?? "active";
    if (!isLeaseReportType(type)) {
      return createErrorResponse(`Unknown report type "${type}"`, 400);
    }

    const rawFormat = searchParams.get("format");
    // Export is its own permission, not a by-product of being able to
    // read the list — see canExport.
    if (rawFormat && !canExport(user, "lease_export", "lease_management")) {
      return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
    }
    if (rawFormat && !isReportFormat(rawFormat)) {
      return createErrorResponse(
        `Unsupported export format "${rawFormat}"`,
        400,
      );
    }
    const format: ReportFormat | null = rawFormat
      ? (rawFormat as ReportFormat)
      : null;

    // Owner, compound, building, unit, tenant and contract — each narrows
    // the register, and the caller's own scope still applies beneath them.
    const named = readFilterIds(searchParams, [
      "ownerId",
      "compoundId",
      "propertyId",
      "unitId",
      "tenantId",
      "leaseId",
    ]);
    if (!named.ok) {
      return createErrorResponse(`Invalid ${named.key} filter`, 400);
    }
    // Only meaningful for `expiring`; the service ignores it elsewhere.
    const rawWithin = Number(searchParams.get("withinDays"));
    const withinDays =
      Number.isFinite(rawWithin) && rawWithin > 0 ? rawWithin : undefined;

    // The date filter — see getLeaseReport for which date each register
    // reads. Absent means the register's own default.
    const parseDay = (value: string | null) => {
      if (!value) return undefined;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };
    const from = parseDay(searchParams.get("startDate"));
    const to = parseDay(searchParams.get("endDate"));
    if (from && to && to < from) {
      return createErrorResponse("End date must be after the start date", 400);
    }

    const report = await getLeaseReport(type, {
      ...named.ids,
      withinDays,
      from,
      to,
      actor: user,
    });

    if (!format) {
      return createSuccessResponse(report, "Report generated successfully");
    }

    const { rows: listed, truncated } = capExportRows(report.rows);
    const sheet: ReportSheet<LeaseReportRow> = {
      title: TITLES[type],
      columns: [
        { header: "Contract number", value: (row) => row.contractNumber },
        { header: "Tenant", value: (row) => row.tenantName },
        { header: "Email", value: (row) => row.tenantEmail },
        { header: "Property", value: (row) => row.propertyName },
        { header: "Unit", value: (row) => row.unitNumber },
        { header: "Start", value: (row) => businessDay(row.startDate) },
        { header: "End", value: (row) => businessDay(row.endDate) },
        { header: "Frequency", value: (row) => row.frequencyLabel },
        { header: "Rent per installment", value: (row) => row.rentAmount },
        { header: "Annual value", value: (row) => row.annualValue },
        { header: "Currency", value: (row) => row.currency },
        { header: "Tax %", value: (row) => (row.taxEnabled ? row.taxRate : 0) },
        { header: "Status", value: (row) => row.status },
        ...(type === "terminated"
          ? [
              {
                header: "Terminated on",
                value: (row: LeaseReportRow) =>
                  row.terminatedDate ? businessDay(row.terminatedDate) : "",
              },
              {
                header: "Reason",
                value: (row: LeaseReportRow) => row.terminationReason,
              },
            ]
          : type === "renewed"
          ? [
              // When the renewal was made, and the contract that took over.
              // A count of days from the old end date went negative for
              // every contract renewed before its term was out.
              {
                header: "Renewed on",
                value: (row: LeaseReportRow) =>
                  row.renewal ? businessDay(row.renewal.renewedOn) : "",
              },
              {
                header: "New contract",
                value: (row: LeaseReportRow) =>
                  row.renewal?.contractNumber ?? "",
              },
              {
                header: "New contract start",
                value: (row: LeaseReportRow) =>
                  row.renewal ? businessDay(row.renewal.startDate) : "",
              },
              {
                header: "New contract end",
                value: (row: LeaseReportRow) =>
                  row.renewal ? businessDay(row.renewal.endDate) : "",
              },
            ]
          : [
              // Running registers count down to the end; the others count
              // from it. The expiry registers were counting the wrong way.
              type === "active" || type === "expiring" || type === "expiring-soon"
                ? {
                    header: "Days remaining",
                    value: (row: LeaseReportRow) => row.daysRemaining,
                  }
                : {
                    header: "Days since end",
                    value: (row: LeaseReportRow) => -row.daysRemaining,
                  },
            ]),
      ],
      rows: listed,
      filtersSummary: {
        // The register's own dates when it was given a window; otherwise it
        // is the list as it stands today.
        ...(from || to
          ? {
              period: {
                from: from ? businessDay(from) : null,
                to: to ? businessDay(to) : null,
              },
            }
          : { asAt: businessToday() }),
        filters: [
          ...(await describeAppliedFilters(user, named.ids)),
          [
            "Expiring within (days)",
            type === "expiring" ? withinDays : undefined,
          ],
        ],
        limit: EXPORT_ROW_LIMIT,
        truncated,
      },
      summary: [
        ["Contracts", report.summary.contractCount],
        ["Tenants", report.summary.tenantCount],
        ["Properties", report.summary.propertyCount],
        ["Rent per installment", report.summary.totalRentPerInstallment],
        ["Annualised value", report.summary.totalAnnualValue],
        ["With a contract number", report.summary.withContractNumber],
        ...(type === "active"
          ? ([["Ending within 60 days", report.summary.endingSoon]] as Array<
              [string, number]
            >)
          : []),
        ...(report.summary.awaitingStatusSweep > 0
          ? ([
              [
                "Past end date, awaiting nightly status update",
                report.summary.awaitingStatusSweep,
              ],
            ] as Array<[string, number]>)
          : []),
      ],
    };

    return buildReportResponse(sheet, {
      format,
      rtl: isRtlReportRequest(searchParams),
      lang: reportLanguage(searchParams),
      fileName: TITLES[type],
      dateStamp: businessToday(),
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate report");
  }
});
