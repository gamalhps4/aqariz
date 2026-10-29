/**
 * PropertyPro - Property insights API
 *
 * The financial picture behind one property's Reports tab.
 * `?format=` returns the same figures as a download, with the building
 * statement's settlement in the reader's language.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { getPropertyInsights } from "@/lib/services/property-insights.service";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { pdfLabel } from "@/lib/invoice/pdf-i18n";
import type { LineTranslate } from "@/lib/statements/line-text";
import { feeDetailText } from "@/lib/statements/document";
import { statementSummaryRows } from "@/lib/statements/summary";
import { businessDay } from "@/lib/dates/business-day";
import { readReportWindow } from "@/lib/report-filters/params";

export const GET = withPermissionAndDB([
  "property_view",
  "property_management",
  "financial_reports",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // property_view alone would hand an owner every building's numbers, not
      // just their own. See lib/db/scopes.ts.
      const inScope = await db.property.count({
        where: withScope({ id }, propertyScope(user)),
      });
      if (!inScope) {
        return createErrorResponse("Property not found", 404);
      }

      const { searchParams } = request.nextUrl;

      const rawFormat = searchParams.get("format");
      if (rawFormat && !isReportFormat(rawFormat)) {
        return createErrorResponse(
          `Unsupported export format "${rawFormat}"`,
          400,
        );
      }
      const format: ReportFormat | null = rawFormat
        ? (rawFormat as ReportFormat)
        : null;

      // Default window: the year to date.
      const range = readReportWindow(searchParams);
      if (!range.ok) return createErrorResponse(range.message, 400);
      const { startDate, endDate } = range;

      const insights = await getPropertyInsights(id, {
        actor: user,
        startDate,
        endDate,
      });
      if (!insights) {
        return createErrorResponse("Property not found", 404);
      }

      if (!format) {
        return createSuccessResponse(
          insights,
          "Property insights retrieved successfully",
        );
      }

      const lang = reportLanguage(searchParams);
      const tr: LineTranslate = (key, english, values) =>
        pdfLabel(lang, key, english, values);
      const { money } = insights;

      // Who owes whom, in the building statement's rows and words — the VAT
      // on the commission, and the money the owner received directly.
      const settlement = statementSummaryRows(
        {
          collected: money.rentCollected,
          commission: money.commission,
          commissionTax: money.commissionTax,
          expenses: money.expenses,
          investmentRent: money.investmentRent,
          collectedByOwner: money.collectedByOwner,
          collectedByOperator: money.collectedByOperator,
          dueToOwner: money.dueToOwner,
          dueToOperator: money.dueToOperator,
        },
        insights.commissionPercentage,
        tr,
      ).map((row) => [row.label, row.amount] as [string, number]);

      // The export is the monthly breakdown; the headline figures ride along
      // in the summary block above it.
      const sheet: ReportSheet<(typeof insights.monthly)[number]> = {
        title: `Property Report — ${insights.propertyName}`,
        columns: [
          { header: "Month", value: (row) => row.month },
          { header: "Collected", value: (row) => row.collected },
          { header: "Expenses", value: (row) => row.expenses },
          {
            header: "Net",
            value: (row) =>
              Math.round((row.collected - row.expenses) * 100) / 100,
          },
        ],
        rows: insights.monthly,
        filtersSummary: {
          period: {
            from: businessDay(insights.period.startDate),
            to: businessDay(insights.period.endDate),
          },
          filters: await describeAppliedFilters(user, { propertyId: id }),
        },
        summary: [
          ["Currency", insights.currency],
          ["Units", insights.occupancy.totalUnits],
          ["Occupied", insights.occupancy.occupied],
          ["Occupancy %", insights.occupancy.rate],
          ["Active contracts", insights.leasing.activeContracts],
          ["Contracted rent per installment", insights.leasing.contractedRent],
          ["Annualised rent", insights.leasing.annualisedRent],
          ["Rent billed", money.rentBilled],
          ["Collection rate %", money.collectionRate],
          ["Outstanding", money.outstanding],
          ["Overdue", money.overdue],
          [
            tr("statements.details.agreements", "Agreements"),
            insights.agreements.length
              ? insights.agreements
                  .map(
                    (agreement) =>
                      `${agreement.number ?? tr("agreements.table.unnumbered", "(no number)")} — ${feeDetailText(agreement.fee, agreement.commissionBasis, tr)}`,
                  )
                  .join(" · ")
              : tr("properties.tabs.reports.noAgreement", "No management agreement"),
          ],
          ...settlement,
          [tr("statements.columns.ownerShare", "Owner's share"), money.ownerShare],
          ...insights.expensesByCategory.map(
            (entry) =>
              [
                `  ${tr(`expenses.categories.${entry.category}`, entry.category.replace(/_/g, " "))}`,
                entry.amount,
              ] as [string, number],
          ),
        ],
      };

      return buildReportResponse(sheet, {
        format,
        rtl: isRtlReportRequest(searchParams),
        lang,
        fileName: `Property Report ${insights.propertyName}`,
        dateStamp: `${businessDay(startDate)}_${businessDay(endDate)}`,
      });
    } catch (error) {
      return handleApiError(error, "Failed to retrieve property insights");
    }
  },
);
