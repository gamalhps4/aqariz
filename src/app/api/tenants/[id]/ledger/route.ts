/**
 * PropertyPro - Tenant Ledger API
 * API endpoints for tenant ledger and financial history
 *
 * The tenant is reached through `findTenantInScope` (lib/db/tenant-scope.ts):
 * a tenant reads their own ledger, an employee narrowed to some buildings the
 * ledgers of the tenants with a contract in one of them. Asking
 * `tenantRecordAllows` instead refused every narrowed employee outright.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  tenantLedgerService,
  type LedgerEntry,
} from "@/lib/services/tenant-ledger.service";
import { db } from "@/lib/db/prisma";
import { leaseScope, withScope } from "@/lib/db/scopes";
import { findTenantInScope } from "@/lib/db/tenant-scope";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportSheet,
} from "@/lib/reports/export";
import { buildCsv } from "@/lib/reports/csv";
import { businessDay, businessToday } from "@/lib/dates/business-day";
import { describeCharge } from "@/lib/i18n/charge-description";

/**
 * The ledger's own category keys, as the stored codes the export catalogue
 * translates ("securityDeposit" is the service's bucket, "security_deposit"
 * the code every other export writes).
 */
const CATEGORY_CODES: Record<string, string> = {
  rent: "rent",
  securityDeposit: "security_deposit",
  lateFees: "late_fee",
  utilities: "utility",
  maintenance: "maintenance",
  other: "other",
  payment: "payment",
};

/**
 * Whether the caller may read this tenant's ledger — and, when one contract
 * was asked for, that contract. An id outside the caller's reach is a 404,
 * the same answer as one that does not exist.
 */
async function ledgerInReach(
  user: AuthenticatedAccessUser,
  tenantId: string,
  leaseId: string | null | undefined,
): Promise<boolean> {
  const tenant = await findTenantInScope(user, tenantId);
  if (!tenant) return false;
  if (!leaseId) return true;
  const lease = await db.lease.count({
    where: withScope({ id: leaseId, tenantId }, leaseScope(user)),
  });
  return lease > 0;
}

// ============================================================================
// GET /api/tenants/[id]/ledger - Get tenant ledger
// ============================================================================
async function getTenantLedger(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const { searchParams } = new URL(request.url);

    if (!isValidObjectId(tenantId)) {
      return createErrorResponse("Invalid tenant ID", 400);
    }

    // Parse query parameters
    const leaseId = searchParams.get("leaseId");
    const startDate = searchParams.get("startDate")
      ? new Date(searchParams.get("startDate")!)
      : undefined;
    const endDate = searchParams.get("endDate")
      ? new Date(searchParams.get("endDate")!)
      : undefined;
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "50");
    const includeZeroBalance =
      searchParams.get("includeZeroBalance") === "true";
    const format = searchParams.get("format");

    // Validate lease ID if provided
    if (leaseId && !isValidObjectId(leaseId)) {
      return createErrorResponse("Invalid lease ID", 400);
    }

    if (!(await ledgerInReach(user, tenantId, leaseId))) {
      return createErrorResponse("Tenant not found", 404);
    }

    // The ledger as a file, through the export every other list uses: Excel
    // and PDF as well as CSV, headings in the reader's language, a byte-order
    // mark so Arabic survives Excel. It used to be a hand-built English CSV
    // with none of that, open to anyone who could read the ledger — export is
    // its own right (canExport), the payments one, as a ledger is money.
    if (format) {
      if (!canExport(user, "payment_export", "financial_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (!isReportFormat(format)) {
        return createErrorResponse(`Unsupported export format "${format}"`, 400);
      }

      const ledger = await tenantLedgerService.generateTenantLedger(tenantId, {
        leaseId: leaseId || undefined,
        startDate,
        endDate,
        limit: 10000,
        includeZeroBalanceEntries: includeZeroBalance,
      });
      const { summary } = ledger;
      const tenant = await findTenantInScope(user, tenantId);
      const tenantName =
        `${tenant?.firstName ?? ""} ${tenant?.lastName ?? ""}`.trim() ||
        summary.tenantName;

      const exportLanguage = reportLanguage(searchParams);
      const sheet: ReportSheet<LedgerEntry> = {
        title: "Tenant ledger",
        columns: [
          { header: "Date", value: (entry) => businessDay(entry.date) },
          {
            header: "Type",
            value: (entry) => (entry.type === "debit" ? "charge" : "payment"),
          },
          {
            header: "Category",
            value: (entry) => CATEGORY_CODES[entry.category] ?? entry.category,
          },
          {
            // Generated wordings in the reader's language, with the billing
            // period of a rent line; typed text as typed.
            header: "Description",
            value: (entry) =>
              describeCharge(
                {
                  description: entry.description,
                  periodStart: entry.periodStart,
                  periodEnd: entry.periodEnd,
                },
                exportLanguage,
              ),
          },
          { header: "Reference", value: (entry) => entry.reference ?? "" },
          {
            header: "Debit",
            value: (entry) => (entry.debitAmount ? Number(entry.debitAmount) : ""),
          },
          {
            header: "Credit",
            value: (entry) =>
              entry.creditAmount ? Number(entry.creditAmount) : "",
          },
          { header: "Balance", value: (entry) => Number(entry.runningBalance) },
          { header: "Status", value: (entry) => entry.status ?? "" },
        ],
        rows: ledger.entries,
        summary: [
          ["Tenant", tenantName],
          [
            "Period",
            `${businessDay(summary.periodStart)} to ${businessDay(summary.periodEnd)}`,
          ],
          ["Total charges", Number(summary.totalDebits)],
          ["Total payments", Number(summary.totalCredits)],
          ["Balance", Number(summary.currentBalance)],
        ],
      };

      return buildReportResponse(sheet, {
        format,
        rtl: isRtlReportRequest(searchParams),
        lang: exportLanguage,
        fileName: "Tenant ledger",
        dateStamp: `${tenantName}-${businessToday()}`,
      });
    }

    // Generate ledger report
    const ledgerReport = await tenantLedgerService.generateTenantLedger(
      tenantId,
      {
        leaseId: leaseId || undefined,
        startDate,
        endDate,
        page,
        limit,
        includeZeroBalanceEntries: includeZeroBalance,
      }
    );

    return createSuccessResponse(
      ledgerReport,
      "Tenant ledger retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to retrieve tenant ledger");
  }
}

// ============================================================================
// POST /api/tenants/[id]/ledger - Generate custom ledger report
// ============================================================================
async function generateTenantLedger(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const body = await request.json();

    if (!isValidObjectId(tenantId)) {
      return createErrorResponse("Invalid tenant ID", 400);
    }

    const {
      leaseId,
      startDate,
      endDate,
      includeCategories = [],
      excludeCategories = [],
      minAmount,
      maxAmount,
      exportFormat = "json",
    } = body;

    // Validate lease ID if provided
    if (leaseId && !isValidObjectId(leaseId)) {
      return createErrorResponse("Invalid lease ID", 400);
    }

    if (!(await ledgerInReach(user, tenantId, leaseId))) {
      return createErrorResponse("Tenant not found", 404);
    }

    // A file is an export, whichever door it leaves by.
    if (
      exportFormat === "csv" &&
      !canExport(user, "payment_export", "financial_management")
    ) {
      return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
    }

    // Generate custom ledger report
    const ledgerReport = await tenantLedgerService.generateTenantLedger(
      tenantId,
      {
        leaseId,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        limit: 1000, // Higher limit for custom reports
      }
    );

    // Apply custom filters
    let filteredEntries = ledgerReport.entries;

    if (includeCategories.length > 0) {
      filteredEntries = filteredEntries.filter((entry) =>
        includeCategories.includes(entry.category)
      );
    }

    if (excludeCategories.length > 0) {
      filteredEntries = filteredEntries.filter(
        (entry) => !excludeCategories.includes(entry.category)
      );
    }

    if (minAmount !== undefined) {
      filteredEntries = filteredEntries.filter(
        (entry) =>
          entry.debitAmount >= minAmount || entry.creditAmount >= minAmount
      );
    }

    if (maxAmount !== undefined) {
      filteredEntries = filteredEntries.filter(
        (entry) =>
          entry.debitAmount <= maxAmount || entry.creditAmount <= maxAmount
      );
    }

    // Handle CSV export
    if (exportFormat === "csv") {
      const headers = [
        "Date",
        "Type",
        "Category",
        "Description",
        "Reference",
        "Debit Amount",
        "Credit Amount",
        "Running Balance",
        "Status",
      ];

      const rows = filteredEntries.map((entry) => [
        // A day, not the server's locale's idea of one.
        businessDay(entry.date),
        entry.type,
        entry.category,
        entry.description,
        entry.reference,
        entry.debitAmount.toFixed(2),
        entry.creditAmount.toFixed(2),
        entry.runningBalance.toFixed(2),
        entry.status,
      ]);

      // The shared CSV writer: the byte-order mark Excel needs to read an
      // Arabic description, and a quote inside a cell escaped rather than
      // closing it.
      const csvContent = buildCsv([headers, ...rows]);

      return new NextResponse(csvContent, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="custom_ledger_${tenantId}.csv"`,
        },
      });
    }

    // Return filtered JSON report
    const customReport = {
      ...ledgerReport,
      entries: filteredEntries,
      filters: {
        includeCategories,
        excludeCategories,
        minAmount,
        maxAmount,
      },
    };

    return createSuccessResponse(
      customReport,
      "Custom ledger report generated successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to generate custom ledger report");
  }
}

// ============================================================================
// Helper endpoint for current balance
// ============================================================================
async function getTenantBalance(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: tenantId } = await params;
    const { searchParams } = new URL(request.url);
    const leaseId = searchParams.get("leaseId");

    if (!isValidObjectId(tenantId)) {
      return createErrorResponse("Invalid tenant ID", 400);
    }
    if (leaseId && !isValidObjectId(leaseId)) {
      return createErrorResponse("Invalid lease ID", 400);
    }
    if (!(await ledgerInReach(user, tenantId, leaseId))) {
      return createErrorResponse("Tenant not found", 404);
    }

    // Get current balance information
    const balanceInfo = await tenantLedgerService.getCurrentBalance(
      tenantId,
      leaseId || undefined
    );

    return createSuccessResponse(
      balanceInfo,
      "Current balance retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to retrieve current balance");
  }
}

const ledgerPermissions = ["financial_management", "payment_history"];

export const GET = withPermissionAndDB(ledgerPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    getTenantLedger(user, request, context),
);
export const POST = withPermissionAndDB(ledgerPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    generateTenantLedger(user, request, context),
);
export const PATCH = withPermissionAndDB(ledgerPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    getTenantBalance(user, request, context),
);
