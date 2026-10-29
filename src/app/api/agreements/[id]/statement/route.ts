/**
 * PropertyPro - Management agreement statement API
 *
 * One agreement's statement for a period: the owner's statement read over the
 * buildings this agreement covers (see agreement-statement.service), with the
 * office's letterhead the screen shows above it. With `?format=` it downloads
 * as the client's sample lays it out — details, the summary, every payment,
 * the expenses; `&table=contracts` downloads the rent roll instead.
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
import { getAgreementStatement } from "@/lib/services/agreement-statement.service";
import type { StatementContractRow } from "@/lib/services/owner-statement.service";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportColumn,
  canExport,
  canExportOwnReport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { getStatementLetterhead } from "@/lib/reports/letterhead";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import type { LineTranslate } from "@/lib/statements/line-text";
import { feeDetailText } from "@/lib/statements/document";
import {
  commissionBaseDetail,
  statementPeriod,
  statementSheet,
  statementSheetWith,
  type StatementDetails,
} from "@/lib/statements/statement-sheet";
import { businessDay } from "@/lib/dates/business-day";
import { readReportWindow } from "@/lib/report-filters/params";

export const GET = withAccessAndDB({
  // An owner reads the statements of their own agreements; the check below
  // is what keeps one owner out of another's.
  roles: [UserRole.OWNER],
  permissions: [
    "agreement_view",
    "agreement_management",
    "financial_reports",
    "financial_management",
  ],
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
        return createErrorResponse("Invalid agreement ID", 400);
      }

      const { searchParams } = request.nextUrl;
      const rawFormat = searchParams.get("format");
      // An owner downloads the statement of their own agreement; whether it
      // is theirs is checked below, once it is read.
      if (
        rawFormat &&
        !canExport(user, "agreement_export", "agreement_management") &&
        !canExportOwnReport(user)
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

      // Default window: the year to date, as on the owner's statement.
      const range = readReportWindow(searchParams);
      if (!range.ok) return createErrorResponse(range.message, 400);
      const { startDate, endDate } = range;

      const [result, letterhead] = await Promise.all([
        getAgreementStatement(id, {
          actor: user,
          startDate,
          endDate,
          currentUserId: user.id,
        }),
        // An export draws its own letterhead; only the screen needs this.
        format ? Promise.resolve(null) : getStatementLetterhead(),
      ]);
      if (!result || (user.isOwner && result.agreement.ownerId !== user.id)) {
        return createErrorResponse("Agreement not found", 404);
      }

      if (!format) {
        return createSuccessResponse(
          { ...result, letterhead },
          "Statement generated successfully",
        );
      }

      const { agreement, statement } = result;
      const lang = reportLanguage(searchParams);
      // Worded from the catalogue the screen reads, so the download and the
      // screen say the same thing in the same words.
      const tr: LineTranslate = (key, english, values) =>
        pdfLabel(lang, key, english, values);

      const investment = agreement.kind === "investment";
      // Whose agreement, over what, on what terms, for which period — the
      // details the client asked to see clearly at the top. The fee is
      // stated here in full; the summary's commission label repeats only the
      // rate, and no row below carries it.
      const details: StatementDetails = [
        [
          tr("clients.statement.details.agreement", "Agreement"),
          agreement.agreementNumber ?? "—",
        ],
        ...(investment
          ? ([
              [
                tr("clients.statement.details.type", "Agreement type"),
                tr("agreements.kind.investment", "Investment agreement"),
              ],
            ] as StatementDetails)
          : []),
        [tr("clients.statement.details.owner", "Owner"), agreement.ownerName],
        [
          tr("clients.statement.details.covers", "Covers"),
          agreement.scopeName ??
            (agreement.scopeType === "portfolio"
              ? tr("agreements.scope.portfolio", "Whole portfolio")
              : "—"),
        ],
        [
          investment
            ? tr("agreements.investment.rent", "Rent paid to the owner")
            : tr("clients.statement.details.fee", "Management fee"),
          feeDetailText(agreement.fee, agreement.commissionBasis, tr),
        ],
        [tr("clients.statement.details.period", "Period"), statementPeriod(statement)],
        ...commissionBaseDetail(statement, tr),
      ];
      const title = tr(
        "clients.statement.document.agreementTitle",
        "Management agreement statement",
      );

      const name = agreement.agreementNumber
        ? `${agreement.agreementNumber} ${agreement.ownerName}`
        : agreement.ownerName;
      // The period the statement covers — the agreement's own part of the
      // dates asked for — as its details line prints it.
      const dateStamp = `${businessDay(statement.period.startDate)}_${businessDay(statement.period.endDate)}`;
      const rtl = isRtlReportRequest(searchParams);

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
          statementSheetWith(statement, {
            title,
            details,
            tr,
            columns,
            rows: statement.contracts,
          }),
          {
            format,
            fileName: `Management Agreement Contracts ${name}`,
            dateStamp,
            rtl,
            lang,
          },
        );
      }

      return buildReportResponse(statementSheet(statement, { title, details, tr }), {
        format,
        fileName: `Management Agreement Statement ${name}`,
        dateStamp,
        rtl,
        lang,
      });
    } catch (error) {
      return handleApiError(error, "Failed to generate the statement");
    }
  },
);
