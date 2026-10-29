/**
 * PropertyPro - Owner Statement of Account API
 *
 * The statement, with the office's letterhead the screen shows above it.
 * `?format=` downloads the same statement, produced by the same query — so
 * the printed statement and the screen cannot disagree — laid out as the
 * client's sample: details, the summary, every payment, the expenses.
 * `&table=contracts` downloads the rent roll instead.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  getOwnerStatement,
  type StatementContractRow,
} from "@/lib/services/owner-statement.service";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportColumn,
  type ReportFiltersSummary,
  type ReportFormat,
  canExport,
  canExportOwnReport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { getStatementLetterhead } from "@/lib/reports/letterhead";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { businessDay } from "@/lib/dates/business-day";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import type { LineTranslate } from "@/lib/statements/line-text";
import { statementDay } from "@/lib/statements/document";
import {
  commissionBaseDetail,
  statementSheet,
  statementSheetWith,
  type StatementDetails,
} from "@/lib/statements/statement-sheet";
import { readReportWindow } from "@/lib/report-filters/params";

export const GET = withAccessAndDB({
  // The office runs any owner's statement; an owner runs their own. The self
  // check below is what separates the two — reports_own would otherwise let
  // one owner pull another's rent, commission and payout figures.
  roles: [UserRole.OWNER],
  permissions: ["financial_reports", "financial_management"],
  match: "any",
})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid owner ID", 400);
      }

      if (user.isOwner && id !== user.id) {
        return createErrorResponse("Owner not found", 404);
      }

      const { searchParams } = request.nextUrl;

      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport. An owner downloads their own.
      if (
        rawFormat &&
        !canExport(user, "owner_export", "owner_management") &&
        !(id === user.id && canExportOwnReport(user))
      ) {
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

      // Default window: the year to date, which is what an owner asks for.
      const range = readReportWindow(searchParams);
      if (!range.ok) return createErrorResponse(range.message, 400);
      const { startDate, endDate } = range;

      const [statement, letterhead] = await Promise.all([
        getOwnerStatement(id, {
          startDate,
          endDate,
          propertyId: searchParams.get("propertyId") || undefined,
          currentUserId: user.id,
          actor: user,
        }),
        // An export draws its own letterhead; only the screen needs this.
        format ? Promise.resolve(null) : getStatementLetterhead(),
      ]);

      if (!statement) {
        return createErrorResponse("Owner not found", 404);
      }

      if (!format) {
        return createSuccessResponse(
          { ...statement, letterhead },
          "Statement generated successfully",
        );
      }

      const lang = reportLanguage(searchParams);
      // Worded from the catalogue the screen reads, so the download and the
      // screen say the same thing in the same words.
      const tr: LineTranslate = (key, english, values) =>
        pdfLabel(lang, key, english, values);

      const details: StatementDetails = [
        [tr("clients.statement.details.owner", "Owner"), statement.owner.name],
        ...(statement.owner.companyName
          ? ([
              [
                tr("clients.statement.details.company", "Company"),
                statement.owner.companyName,
              ],
            ] as StatementDetails)
          : []),
        [
          tr("clients.statement.details.properties", "Properties"),
          statement.propertyCount,
        ],
        ...commissionBaseDetail(statement, tr),
      ];
      // The period, and the building when the statement was cut to one, go
      // in the block every export prints under its details; the owner is
      // named in the details already. A statement is never cut at the row
      // limit: its summary adds up every payment, and so must its table.
      const filtersSummary: ReportFiltersSummary = {
        period: {
          from: statementDay(statement.period.startDate),
          to: statementDay(statement.period.endDate),
        },
        filters: await describeAppliedFilters(user, {
          propertyId: searchParams.get("propertyId"),
        }),
      };
      const title = tr(
        "clients.statement.document.ownerTitle",
        "Owner statement of account",
      );
      const dateStamp = `${businessDay(startDate)}_${businessDay(endDate)}`;
      // Every export mirrors for an Arabic reader.
      const rtl = isRtlReportRequest(searchParams);

      // The rent roll — what is let and for how much — still downloads on its
      // own with `?table=contracts`.
      if (searchParams.get("table") === "contracts") {
        const columns: ReportColumn<StatementContractRow>[] = [
          { header: "Date", value: (row) => businessDay(row.date) },
          { header: "Tenant", value: (row) => row.tenantName },
          { header: "Contract", value: (row) => row.contractNumber ?? "" },
          { header: "Building", value: (row) => row.propertyName },
          { header: "Unit", value: (row) => row.unitNumber },
          { header: "Term (months)", value: (row) => row.durationMonths },
          { header: "Contract value", value: (row) => row.contractTotal },
          { header: "Due", value: (row) => row.due },
          { header: "Paid", value: (row) => row.paid },
          { header: "Item", value: (row) => row.item },
          { header: "Notes", value: (row) => row.notes },
        ];
        return buildReportResponse(
          {
            ...statementSheetWith(statement, {
              title,
              details,
              tr,
              columns,
              rows: statement.contracts,
            }),
            filtersSummary,
          },
          {
            format,
            fileName: `Owner Contracts ${statement.owner.name}`,
            dateStamp,
            rtl,
            lang,
          },
        );
      }

      return buildReportResponse(
        { ...statementSheet(statement, { title, details, tr }), filtersSummary },
        {
          format,
          fileName: `Owner Statement ${statement.owner.name}`,
          dateStamp,
          rtl,
          lang,
        },
      );
    } catch (error) {
      return handleApiError(error, "Failed to generate the statement");
    }
  },
);
