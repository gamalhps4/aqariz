/**
 * PropertyPro - Expenses API Routes
 * GET /api/accounting/expenses - List expenses (`?format=` downloads them)
 * POST /api/accounting/expenses - Create expense
 *
 * Each action asks for its own right or `financial_management`, and an
 * employee limited to some buildings reads and records expenses on those
 * buildings only (lib/services/expense.service.ts).
 */

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  withPermissionAndDB,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
} from "@/lib/api-utils";
import {
  ExpenseScopeError,
  expenseService,
} from "@/lib/services/expense.service";
import { expenseCreateSchema, validateSchema } from "@/lib/validations";
import { expenseVatFields } from "@/lib/invoice/expense-vat";
import { checkExpenseVat } from "@/lib/invoice/expense-vat-check";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { expenseName, expenseSnapshot } from "@/lib/audit/records/expense";
import { compact } from "@/lib/audit/records/shared";

/** An expense with the VAT inside it and who supplied it (accounting phase 0). */
const expenseBodySchema = expenseCreateSchema.extend(expenseVatFields);
import {
  EXPENSE_CREATE_PERMISSIONS,
  EXPENSE_READ_PERMISSIONS,
} from "@/lib/finance-permissions";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  EXPORT_ROW_LIMIT,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { businessDay, businessToday } from "@/lib/dates/business-day";

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

export const GET = withPermissionAndDB([...EXPENSE_READ_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = Math.min(parseInt(searchParams.get("limit") || "12"), 100);
      const search = (searchParams.get("search") || "").trim();
      const category = searchParams.get("category");
      const status = searchParams.get("status");
      const propertyId = searchParams.get("propertyId");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const sortBy = searchParams.get("sortBy") || "date";
      const sortOrder =
        (searchParams.get("sortOrder") as "asc" | "desc") || "desc";

      const filters = {
        actor: user,
        search: search || undefined,
        category: category || undefined,
        status: status || undefined,
        propertyId: propertyId || undefined,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        sortBy,
        sortOrder,
      };

      // The list as filtered, as a file. Export is its own right, not a
      // by-product of reading the list — see canExport.
      const rawFormat = searchParams.get("format");
      if (rawFormat) {
        if (!canExport(user, "expense_export", "financial_management")) {
          return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
        }
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400
          );
        }
        const { expenses: rows } = await expenseService.listExpenses({
          ...filters,
          page: 1,
          limit: EXPORT_ROW_LIMIT,
        });
        const sheet: ReportSheet<(typeof rows)[number]> = {
          title: "Expenses",
          columns: [
            { header: "Date", value: (row) => businessDay(row.date) },
            { header: "Number", value: (row) => row.expenseNumber ?? "" },
            { header: "Description", value: (row) => row.description ?? "" },
            { header: "Category", value: (row) => row.category ?? "" },
            {
              header: "Building",
              value: (row) =>
                typeof row.propertyId === "object" && row.propertyId
                  ? (row.propertyId.name ?? "")
                  : "",
            },
            { header: "Status", value: (row) => row.status ?? "" },
            { header: "Method", value: (row) => row.paymentMethod ?? "" },
            { header: "Reference", value: (row) => row.referenceNumber ?? "" },
            {
              header: "Supplier",
              value: (row) => (row as { supplier?: { name?: string } }).supplier?.name ?? "",
            },
            {
              header: "Supplier invoice no.",
              value: (row) =>
                (row as { supplierInvoiceNumber?: string | null }).supplierInvoiceNumber ?? "",
            },
            { header: "Amount", value: (row) => Number(row.amount) },
            {
              header: "VAT",
              value: (row) => Number((row as { vatAmount?: number }).vatAmount ?? 0),
            },
          ],
          rows,
          summary: [
            ["Rows", rows.length],
            ...(rows.length === EXPORT_ROW_LIMIT
              ? ([["Note", `Truncated at ${EXPORT_ROW_LIMIT} rows — narrow the filters`]] as Array<[string, string]>)
              : []),
          ],
        };
        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang: reportLanguage(searchParams),
          fileName: "Expenses",
          dateStamp: businessToday(),
        });
      }

      // Get summary in parallel
      const includeSummary = searchParams.get("includeSummary") === "true";

      const result = await expenseService.listExpenses({
        ...filters,
        page,
        limit,
      });

      let summary = undefined;
      if (includeSummary) {
        summary = await expenseService.getExpenseSummary(
          user,
          propertyId || undefined
        );
      }

      return createSuccessResponse(
        {
          expenses: result.expenses,
          summary,
        },
        "Expenses retrieved successfully",
        result.pagination
      );
    } catch (error) {
      console.error("[Expenses API] Error:", error);
      return createErrorResponse("Failed to fetch expenses", 500);
    }
  }
);

export const POST = withPermissionAndDB([...EXPENSE_CREATE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();

      const validation = validateSchema(expenseBodySchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "));
      }
      // The VAT inside the amount and the supplier: checked, and left out
      // before the database has their columns.
      const checked = await checkExpenseVat(validation.data);
      if (!checked.ok) {
        return createErrorResponse(checked.message, checked.status);
      }

      const expense = await expenseService.createExpense(
        {
          ...checked.data,
          createdBy: user?.id,
        },
        user
      );

      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "expense",
        recordId: expense.id,
        recordName: expenseName(expense),
        after: compact(expenseSnapshot(expense)),
      });

      return createSuccessResponse(expense, "Expense created successfully");
    } catch (error) {
      if (error instanceof ExpenseScopeError) {
        return createErrorResponse(error.message, error.statusCode);
      }
      console.error("[Expenses API] Create error:", error);
      return createErrorResponse("Failed to create expense", 500);
    }
  }
);
