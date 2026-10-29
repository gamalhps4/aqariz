/**
 * PropertyPro - Bank Transactions API Route
 * GET /api/accounting/transactions - List settled bank-level transactions
 * (`?format=` downloads them)
 */

import { NextRequest } from "next/server";
import { TransactionType, UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
  withAccessAndDB,
} from "@/lib/api-utils";
import { transactionService } from "@/lib/services/transaction.service";
import { ACCOUNTING_READ_PERMISSIONS } from "@/lib/finance-permissions";
import {
  buildReportResponse,
  canExport,
  capExportRows,
  EXPORT_DENIED_MESSAGE,
  EXPORT_FETCH_LIMIT,
  EXPORT_ROW_LIMIT,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { transactionTypeText, translatorFor } from "@/lib/reports/list-labels";
import {
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessToday,
  parseBusinessDay,
} from "@/lib/dates/business-day";
import type { IUnifiedTransaction } from "@/types";

function createSuccessResponse(
  data: any,
  message: string,
  pagination?: any,
  status: number = 200
) {
  return createApiSuccessResponse(data, message, pagination);
}

function createErrorResponse(message: string, status: number = 400) {
  return createApiErrorResponse(message, status, message);
}

/**
 * A date filter as the instants it covers. A day ("2026-10-03") is the whole
 * of it on the office's calendar — the start of the first, the end of the
 * last — where `new Date("2026-10-03")` was midnight UTC and left the last
 * day out. Anything else is read as the instant it names, as before.
 */
function filterInstant(
  value: string | null,
  edge: "start" | "end",
): Date | undefined {
  if (!value) return undefined;
  const day = parseBusinessDay(value);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return edge === "start" ? businessDayStart(day) : businessDayEnd(day);
  }
  return new Date(value);
}

/**
 * Staff read the ledger with View accounting (or the finance rights that
 * always opened it); it asked for no permission at all, so every employee
 * could read the office's money. An owner or a tenant keeps the view they
 * had: the service narrows them to their own rows.
 */
const TRANSACTION_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [...ACCOUNTING_READ_PERMISSIONS],
  match: "any" as const,
};

export const GET = withAccessAndDB(TRANSACTION_READ_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = Math.min(parseInt(searchParams.get("limit") || "12"), 100);
      const search = (searchParams.get("search") || "").trim();
      const type = searchParams.get("type") as TransactionType | null;
      const category = searchParams.get("category");
      const propertyId = searchParams.get("propertyId");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const sortBy = searchParams.get("sortBy") || "date";
      const sortOrder =
        (searchParams.get("sortOrder") as "asc" | "desc") || "desc";

      // Build params
      const params = {
        actor: user,
        page,
        limit,
        search: search || undefined,
        type: type || undefined,
        category: category || undefined,
        propertyId: propertyId || undefined,
        tenantId: undefined as string | undefined,
        startDate: filterInstant(startDate, "start"),
        endDate: filterInstant(endDate, "end"),
        sortBy,
        sortOrder,
        bankOnly: true,
      };

      // Row scoping is the service's: it takes the actor and applies the
      // payment, invoice and expense rules from lib/db/scopes.ts to each
      // branch of its query.
      //
      // The tenant id stays as well: it is what tells the service to leave
      // the expenses branch out of a tenant's view altogether.
      if (user.isTenant) {
        params.tenantId = user.id;
      }

      // The ledger as filtered, as a file — staff only, and with Export
      // accounting or the finance umbrella.
      const rawFormat = searchParams.get("format");
      if (rawFormat) {
        if (
          !user.isCompanyStaff ||
          !canExport(user, "accounting_export", "financial_management")
        ) {
          return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
        }
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400
          );
        }
        const { transactions: fetched } =
          await transactionService.getUnifiedTransactions({
            ...params,
            page: 1,
            limit: EXPORT_FETCH_LIMIT,
          });
        const { rows, truncated } = capExportRows(fetched);
        const lang = reportLanguage(searchParams);
        const tr = translatorFor(lang);
        const sheet: ReportSheet<IUnifiedTransaction> = {
          title: "Transactions",
          columns: [
            { header: "Date", value: (row) => businessDay(row.date) },
            { header: "Type", value: (row) => transactionTypeText(row.type, tr) },
            { header: "Category", value: (row) => row.category },
            { header: "Description", value: (row) => row.description },
            { header: "Reference", value: (row) => row.reference },
            {
              header: "Tenant",
              value: (row) =>
                row.tenantId
                  ? `${row.tenantId.firstName ?? ""} ${row.tenantId.lastName ?? ""}`.trim()
                  : "",
            },
            { header: "Building", value: (row) => row.propertyId?.name ?? "" },
            { header: "Status", value: (row) => row.status },
            { header: "Amount", value: (row) => Number(row.amount) },
          ],
          rows,
          filtersSummary: {
            period: {
              from: parseBusinessDay(startDate),
              to: parseBusinessDay(endDate),
            },
            filters: [
              ["Search", search],
              ["Type", type ? transactionTypeText(type, tr) : undefined],
              ["Category", category],
              ...(await describeAppliedFilters(user, { propertyId })),
            ],
            limit: EXPORT_ROW_LIMIT,
            truncated,
          },
        };
        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: "Transactions",
          dateStamp: businessToday(),
        });
      }

      const result = await transactionService.getUnifiedTransactions(params);

      return createSuccessResponse(
        {
          transactions: result.transactions,
          summary: result.summary,
        },
        "Transactions retrieved successfully",
        result.pagination
      );
    } catch (error) {
      console.error("[Transactions API] Error:", error);
      return createErrorResponse("Failed to fetch transactions", 500);
    }
  }
);
