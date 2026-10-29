/**
 * PropertyPro - Properties & operations reports
 *
 * Occupancy today; the compound, property and unit statements the review also
 * asks for belong here beside it rather than in routes of their own, so the
 * filters and the export behave identically across the set.
 *
 * `?format=` returns the same rows as a download — see lib/reports/export.ts.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
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
import {
  getOccupancyReport,
  isUnitOccupancy,
  type OccupancyRow,
} from "@/lib/services/occupancy-report.service";
import { occupancyDay } from "@/lib/reports/report-where";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import {
  addBusinessMonths,
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessToday,
  parseBusinessDay,
} from "@/lib/dates/business-day";
import {
  getMaintenanceReport,
  type MaintenanceReportRow,
} from "@/lib/services/maintenance-report.service";
import {
  getEntityStatement,
  isStatementSubjectKind,
  type StatementSubjectKind,
} from "@/lib/services/entity-statement.service";
import { getStatementLetterhead } from "@/lib/reports/letterhead";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import type { LineTranslate } from "@/lib/statements/line-text";
import { statementDay } from "@/lib/statements/document";
import {
  entityStatementDetails,
  entityStatementTitle,
} from "@/lib/statements/entity-details";
import {
  breakdownStatementSheet,
  unitStatementSheet,
} from "@/lib/statements/entity-sheet";
import {
  maintenanceCategoryText,
  maintenancePriorityText,
  maintenanceStatusText,
} from "@/lib/maintenance-labels";
import { readReportWindow } from "@/lib/report-filters/params";

const REPORT_TYPES = [
  "occupancy",
  "maintenance",
  // The review's three statements. They share this route so that the filters
  // and the export behave identically across the whole set.
  "compound-statement",
  "property-statement",
  "unit-statement",
] as const;
type PropertyReportType = (typeof REPORT_TYPES)[number];

function isReportType(value: string): value is PropertyReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

export const GET = withPermissionAndDB([
  "property_view",
  "property_management",
  "financial_reports",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;

    const type = searchParams.get("type") ?? "occupancy";
    if (!isReportType(type)) {
      return createErrorResponse(`Unknown report type "${type}"`, 400);
    }

    const rawFormat = searchParams.get("format");
    // Export is its own permission, not a by-product of being able to
    // read the list — see canExport.
    if (rawFormat && !canExport(user, "property_export", "property_management")) {
      return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
    }
    if (rawFormat && !isReportFormat(rawFormat)) {
      return createErrorResponse(
        `Unsupported export format "${rawFormat}"`,
        400,
      );
    }

    // A date with no time means the whole of that day, so occupancy "as at
    // the 31st" includes a contract that ran to the 31st — and so does
    // today's, where a contract on its last day used to read as ended.
    const day = occupancyDay(searchParams.get("asOf"));
    if (!day) {
      return createErrorResponse("Invalid date", 400);
    }

    if (type === "maintenance") {
      // A maintenance register is read over a period; occupancy is read at a
      // moment. Defaulting to the last twelve months rather than to "all
      // time" keeps the first view useful on an old portfolio.
      // The days are the office's (Riyadh): the window opens at the start of
      // the first and closes at the last instant of the last.
      const today = businessToday();
      const endParam = searchParams.get("endDate");
      const startParam = searchParams.get("startDate");
      const endDay = endParam ? parseBusinessDay(endParam) : today;
      const startDay = startParam
        ? parseBusinessDay(startParam)
        : addBusinessMonths(today, -12);
      if (!startDay || !endDay) {
        return createErrorResponse("Invalid date range", 400);
      }
      const startDate = businessDayStart(startDay);
      const endDate = businessDayEnd(endDay);

      const maintenance = await getMaintenanceReport({
        actor: user,
        startDate,
        endDate,
        propertyId: searchParams.get("propertyId") || undefined,
        compoundId: searchParams.get("compoundId") || undefined,
        ownerId: searchParams.get("ownerId") || undefined,
      });

      if (!rawFormat) {
        return createSuccessResponse(
          maintenance,
          "Report generated successfully",
        );
      }

      // Category, priority and status in the words the screen uses.
      const lang = reportLanguage(searchParams);
      const tr: LineTranslate = (key, english, values) =>
        pdfLabel(lang, key, english, values);

      // Which owner, compound and building the file covers, and over which
      // dates — the filters the report was run with, by name.
      const { rows: maintenanceRows, truncated: maintenanceCut } = capExportRows(
        maintenance.rows,
      );
      const maintenanceFilters = await describeAppliedFilters(user, {
        ownerId: searchParams.get("ownerId"),
        compoundId: searchParams.get("compoundId"),
        propertyId: searchParams.get("propertyId"),
      });

      const maintenanceSheet: ReportSheet<MaintenanceReportRow> = {
        title: tr("maintenanceReport.document.title", "Maintenance report"),
        columns: [
          { header: "Raised", value: (row) => businessDay(row.raisedOn) },
          { header: "Compound", value: (row) => row.compoundName ?? "" },
          { header: "Building", value: (row) => row.propertyName },
          { header: "Unit", value: (row) => row.unitNumber ?? "" },
          { header: "Request", value: (row) => row.title },
          {
            header: "Category",
            value: (row) => maintenanceCategoryText(row.category, tr),
          },
          {
            header: "Priority",
            value: (row) => maintenancePriorityText(row.priority, tr),
          },
          {
            header: "Status",
            value: (row) => maintenanceStatusText(row.status, tr),
          },
          { header: "Tenant", value: (row) => row.tenantName },
          { header: "Assigned to", value: (row) => row.assigneeName ?? "" },
          {
            header: "Completed",
            value: (row) => (row.completedOn ? businessDay(row.completedOn) : ""),
          },
          // Headed "age" rather than "days to resolve": for an open request
          // it is how long it has been waiting, which is a different thing.
          { header: "Age (days)", value: (row) => row.ageDays },
          { header: "Estimated", value: (row) => row.estimatedCost ?? "" },
          { header: "Actual", value: (row) => row.actualCost ?? "" },
        ],
        rows: maintenanceRows,
        filtersSummary: {
          period: {
            from: businessDay(maintenance.summary.from),
            to: businessDay(maintenance.summary.to),
          },
          filters: maintenanceFilters,
          limit: EXPORT_ROW_LIMIT,
          truncated: maintenanceCut,
        },
        summary: [
          ["Requests", maintenance.summary.totalRequests],
          ["Open", maintenance.summary.openRequests],
          ["Completed", maintenance.summary.completedRequests],
          ["Cancelled", maintenance.summary.cancelledRequests],
          ["Emergencies still open", maintenance.summary.emergencyOpen],
          [
            "Average days to resolve",
            maintenance.summary.averageResolutionDays ?? "—",
          ],
          ["Oldest open (days)", maintenance.summary.oldestOpenDays ?? "—"],
          ["Estimated total", maintenance.summary.estimatedTotal],
          ["Actual total", maintenance.summary.actualTotal],
          ["Cost variance", maintenance.summary.costVariance],
        ],
      };

      return buildReportResponse(maintenanceSheet, {
        format: rawFormat as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang,
        fileName: "Maintenance",
        dateStamp: `${businessDay(maintenance.summary.from)}_${businessDay(maintenance.summary.to)}`,
      });
    }

    if (type.endsWith("-statement")) {
      const kind = type.replace("-statement", "");
      if (!isStatementSubjectKind(kind)) {
        return createErrorResponse(`Unknown statement "${type}"`, 400);
      }

      const subjectId = searchParams.get("subjectId");
      if (!subjectId) {
        return createErrorResponse(
          `A ${kind} must be chosen before its statement can be produced.`,
          400,
        );
      }

      // Year to date, the window an office asks for by default.
      const range = readReportWindow(searchParams);
      if (!range.ok) return createErrorResponse(range.message, 400);
      const { startDate, endDate } = range;

      const [statement, letterhead] = await Promise.all([
        getEntityStatement(kind as StatementSubjectKind, subjectId, {
          actor: user,
          startDate,
          endDate,
        }),
        // An export draws its own letterhead; only the screen needs this.
        rawFormat ? Promise.resolve(null) : getStatementLetterhead(),
      ]);

      // Missing and out-of-scope are one answer, so a statement URL cannot be
      // used to probe for buildings outside an employee's assignment.
      if (!statement) {
        return createErrorResponse("Statement not found", 404);
      }

      if (!rawFormat) {
        return createSuccessResponse(
          { ...statement, letterhead },
          "Statement generated successfully",
        );
      }

      // Worded from the catalogue the screen reads, in the reader's language.
      const lang = reportLanguage(searchParams);
      const tr: LineTranslate = (key, english, values) =>
        pdfLabel(lang, key, english, values);
      const sheetOptions = {
        title: entityStatementTitle(statement.subject.kind, tr),
        // "Statements clearly identify the selected owner/property/compound/
        // unit and the period" — the details under the title say it.
        details: entityStatementDetails(statement, tr, {
          period: `${statementDay(statement.period.startDate)} to ${statementDay(statement.period.endDate)}`,
          money: (amount) => amount,
        }),
        tr,
      };

      const subjectLabel =
        kind === "unit"
          ? `${statement.subject.parentName ?? ""} ${statement.subject.name}`.trim()
          : statement.subject.name;
      const fileOptions = {
        format: rawFormat as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang,
        fileName: `${
          kind === "compound"
            ? "Compound Statement"
            : kind === "property"
              ? "Property Statement"
              : "Unit Statement"
        } ${subjectLabel}`.trim(),
        dateStamp: `${businessDay(startDate)}_${businessDay(endDate)}`,
      };

      // A compound's buildings, or a building's units, lead; a unit's
      // statement leads with its payments.
      return statement.breakdownKind === "none"
        ? buildReportResponse(unitStatementSheet(statement, sheetOptions), fileOptions)
        : buildReportResponse(
            breakdownStatementSheet(statement, sheetOptions),
            fileOptions,
          );
    }

    const occupancyParam = searchParams.get("occupancy");
    if (occupancyParam && !isUnitOccupancy(occupancyParam)) {
      return createErrorResponse(
        `Unknown occupancy "${occupancyParam}"`,
        400,
      );
    }
    const occupancy = occupancyParam && isUnitOccupancy(occupancyParam)
      ? occupancyParam
      : undefined;

    const report = await getOccupancyReport({
      actor: user,
      day,
      propertyId: searchParams.get("propertyId") || undefined,
      compoundId: searchParams.get("compoundId") || undefined,
      ownerId: searchParams.get("ownerId") || undefined,
      occupancy,
    });

    if (!rawFormat) {
      return createSuccessResponse(report, "Report generated successfully");
    }

    const { rows: occupancyRows, truncated } = capExportRows(report.rows);
    // A filtered list is titled for what it holds.
    const occupancyTitle =
      occupancy === "vacant"
        ? "Vacant units"
        : occupancy === "leased"
          ? "Leased units"
          : occupancy === "maintenance"
            ? "Units out of service"
            : "Occupancy";

    const sheet: ReportSheet<OccupancyRow> = {
      title: occupancyTitle,
      columns: [
        { header: "Compound", value: (row) => row.compoundName ?? "" },
        { header: "Building", value: (row) => row.propertyName },
        { header: "District", value: (row) => row.district ?? "" },
        { header: "City", value: (row) => row.city },
        { header: "Unit", value: (row) => row.unitNumber },
        { header: "Type", value: (row) => row.unitType },
        { header: "Bedrooms", value: (row) => row.bedrooms },
        { header: "Owner", value: (row) => row.ownerName },
        { header: "Occupancy", value: (row) => row.occupancy },
        { header: "Tenant", value: (row) => row.tenantName ?? "" },
        { header: "Contract", value: (row) => row.contractNumber ?? "" },
        {
          header: "Contract start",
          value: (row) =>
            row.contractStart ? businessDay(row.contractStart) : "",
        },
        {
          header: "Contract end",
          value: (row) => (row.contractEnd ? businessDay(row.contractEnd) : ""),
        },
        { header: "Rent", value: (row) => row.rentAmount },
        // Carried into the file too: whoever reconciles the spreadsheet is
        // often the person who can go and correct the unit.
        {
          header: "Status mismatch",
          value: (row) => (row.statusMismatch ? row.storedStatus : ""),
        },
      ],
      rows: occupancyRows,
      filtersSummary: {
        asAt: businessDay(report.summary.asOf),
        filters: [
          ...(await describeAppliedFilters(user, {
            ownerId: searchParams.get("ownerId"),
            compoundId: searchParams.get("compoundId"),
            propertyId: searchParams.get("propertyId"),
          })),
          ["Occupancy", occupancy],
        ],
        limit: EXPORT_ROW_LIMIT,
        truncated,
      },
      summary: [
        ["Units", report.summary.totalUnits],
        ["Leased", report.summary.leasedUnits],
        ["Vacant", report.summary.vacantUnits],
        ["Under maintenance", report.summary.maintenanceUnits],
        ["Occupancy rate %", report.summary.occupancyRate],
        ["Contracted rent", report.summary.contractedRent],
        ["Vacant asking rent", report.summary.vacantAskingRent],
        ...(report.summary.mismatchCount > 0
          ? ([
              ["Units with a stale status", report.summary.mismatchCount],
            ] as Array<[string, number]>)
          : []),
      ],
    };

    return buildReportResponse(sheet, {
      format: rawFormat as ReportFormat,
      rtl: isRtlReportRequest(searchParams),
      lang: reportLanguage(searchParams),
      fileName: occupancyTitle,
      dateStamp: businessDay(report.summary.asOf),
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate report");
  }
});
