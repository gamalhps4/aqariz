/**
 * PropertyPro - Agreement report API (§3.4.2)
 *
 * Per agreement, for a chosen period: the rent, the management commission and
 * the settlement — and every payment behind them, one row each with its date
 * and note. `?format=` returns the same report as a download.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  getAgreementReport,
  type AgreementReportPayment,
  type AgreementReportRow,
} from "@/lib/services/agreement-reports.service";
import {
  buildReportResponse,
  capExportRows,
  EXPORT_ROW_LIMIT,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  reportSection,
  type ReportColumn,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import type { LineTranslate } from "@/lib/statements/line-text";
import { statementSummaryRows } from "@/lib/statements/summary";
import { statementPaymentColumns } from "@/lib/statements/document";
import { readFilterIds, readReportWindow } from "@/lib/report-filters/params";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { businessDay } from "@/lib/dates/business-day";
import { AGREEMENT_STATUSES } from "@/lib/agreement-math";

export const GET = withPermissionAndDB([
  "financial_reports",
  "financial_management",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;

    const rawFormat = searchParams.get("format");
    // Export is its own permission, not a by-product of being able to
    // read the list — see canExport.
    if (rawFormat && !canExport(user, "owner_export", "agreement_management")) {
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

    // Default window: the year to date, which is how commission is reviewed.
    const range = readReportWindow(searchParams);
    if (!range.ok) return createErrorResponse(range.message, 400);
    const { startDate, endDate } = range;

    // Owner, compound, building and agreement — each narrows the report, and
    // the caller's own scope still applies beneath them.
    const named = readFilterIds(searchParams, [
      "ownerId",
      "compoundId",
      "propertyId",
      "agreementId",
    ]);
    if (!named.ok) {
      return createErrorResponse(`Invalid ${named.key} filter`, 400);
    }
    const status = searchParams.get("status") || undefined;
    if (
      status &&
      !(AGREEMENT_STATUSES as readonly string[]).includes(status)
    ) {
      return createErrorResponse(`Unknown status "${status}"`, 400);
    }

    // A building named in the query string has to be one this caller holds.
    // Checked here, ahead of the report: its own query writes the requested
    // id after the caller's scope in one object literal, where the id
    // replaces the scope instead of narrowing it.
    const propertyId = named.ids.propertyId;
    const scope = propertyScope(user);
    if (propertyId && Object.keys(scope).length > 0) {
      const inScope = await db.property.count({
        where: withScope({ id: propertyId }, scope),
      });
      if (!inScope) {
        return createErrorResponse("Property not found", 404);
      }
    }

    const includeInactive = searchParams.get("includeInactive") === "true";
    const report = await getAgreementReport({
      startDate,
      endDate,
      ownerId: named.ids.ownerId,
      propertyId,
      compoundId: named.ids.compoundId,
      agreementId: named.ids.agreementId,
      status,
      includeInactive,
      actor: user,
    });

    if (!format) {
      return createSuccessResponse(report, "Report generated successfully");
    }

    const lang = reportLanguage(searchParams);
    // The settlement's words come from the catalogue the statements and the
    // screen read, so "مستلمة من قبل المشغل" is the same phrase everywhere.
    const tr: LineTranslate = (key, english, values) =>
      pdfLabel(lang, key, english, values);

    const { summary } = report;
    const totals = statementSummaryRows(
      {
        collected: summary.totalCollected,
        commission: summary.totalCommission,
        commissionTax: summary.totalCommissionTax,
        expenses: summary.totalExpenses,
        investmentRent: summary.totalInvestmentRent,
        collectedByOwner: summary.totalCollectedByOwner,
        collectedByOperator: summary.totalCollectedByOperator,
        dueToOwner: summary.totalDueToOwner,
        dueToOperator: summary.totalDueToOperator,
      },
      // Agreements charge different rates; the percentage belongs on each
      // agreement's own statement, never on a row here.
      null,
      tr,
    );
    const label = (key: (typeof totals)[number]["key"]) =>
      totals.find((row) => row.key === key)?.label ?? key;

    // Each payment behind the figures, under the agreement it counted for.
    const paymentColumns: ReportColumn<AgreementReportPayment>[] = [
      {
        header: tr("clients.statement.details.agreement", "Agreement"),
        value: (row) => row.agreementNumber ?? "",
      },
      ...statementPaymentColumns(tr),
    ];

    // One row per agreement is already a wide table; every column it can do
    // without is one more that prints in full. The kind of agreement only
    // says something when an investment agreement is among them.
    const hasInvestment = report.rows.some((row) => row.kind === "investment");
    const { rows: listed, truncated } = capExportRows(report.rows);

    const sheet: ReportSheet<AgreementReportRow> = {
      title: "Agreement Report",
      columns: [
        { header: "Agreement", value: (row) => row.agreementNumber },
        ...(hasInvestment
          ? [
              {
                header: "Type",
                value: (row: AgreementReportRow) =>
                  row.kind === "investment"
                    ? tr("agreements.kind.investment", "Investment agreement")
                    : tr("agreements.kind.management", "Management agreement"),
              },
            ]
          : []),
        { header: "Owner", value: (row) => row.ownerName },
        { header: "Covers", value: (row) => row.scopeLabel },
        { header: "Properties", value: (row) => row.propertyCount },
        { header: "Total rent", value: (row) => row.totalRent },
        { header: label("collected"), value: (row) => row.rentCollected },
        { header: label("commission"), value: (row) => row.commission },
        { header: label("commissionTax"), value: (row) => row.commissionTax },
        { header: label("expenses"), value: (row) => row.expenses },
        ...(summary.totalInvestmentRent > 0
          ? [
              {
                header: tr(
                  "clients.statement.settlement.investmentRent",
                  "Investment rent owed to the owner",
                ),
                value: (row: AgreementReportRow) => row.investmentRent,
              },
            ]
          : []),
        { header: label("byOwner"), value: (row) => row.collectedByOwner },
        { header: label("byOperator"), value: (row) => row.collectedByOperator },
        { header: label("dueToOwner"), value: (row) => row.dueToOwner },
        { header: label("dueToOperator"), value: (row) => row.dueToOperator },
        { header: "Status", value: (row) => row.status },
        { header: "Start", value: (row) => businessDay(row.startDate) },
        {
          header: "End",
          value: (row) => (row.endDate ? businessDay(row.endDate) : ""),
        },
      ],
      rows: listed,
      filtersSummary: {
        period: { from: businessDay(startDate), to: businessDay(endDate) },
        filters: [
          ...(await describeAppliedFilters(user, { ...named.ids, status })),
          // Written in the screen's words: the toggle has no file heading of
          // its own.
          [
            tr("agreements.report.includeInactive", "Include ended agreements"),
            includeInactive,
          ],
        ],
        limit: EXPORT_ROW_LIMIT,
        truncated,
      },
      summary: [
        ["Agreements", summary.agreementCount],
        ["Owners", summary.ownerCount],
        ["Properties covered", summary.propertyCount],
        ["Total rent", summary.totalRent],
        ...totals.map((row) => [row.label, row.amount] as [string, number]),
        // Stated so the rent total is never mistaken for the whole portfolio.
        ["Properties with no agreement", summary.unmanagedProperties],
        ["Rent outside any agreement", summary.unmanagedRent],
      ],
      document: {
        tableTitle: tr("agreements.report.byAgreement", "By agreement"),
        sections: [
          reportSection(
            tr("clients.statement.payments.title", "Payments"),
            paymentColumns,
            report.payments,
            tr(
              "clients.statement.payments.empty",
              "No payments were received in this period",
            ),
          ),
        ],
      },
    };

    return buildReportResponse(sheet, {
      format,
      rtl: isRtlReportRequest(searchParams),
      lang,
      fileName: "Agreement Report",
      dateStamp: `${businessDay(startDate)}_${businessDay(endDate)}`,
    });
  } catch (error) {
    return handleApiError(error, "Failed to generate the report");
  }
});
