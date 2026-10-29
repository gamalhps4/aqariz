/**
 * PropertyPro - Invoice Statistics API
 * Comprehensive invoice analytics and status reporting
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, invoiceScope } from "@/lib/db/scopes";
import { InvoiceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { INVOICE_LIST_PERMISSIONS } from "@/lib/finance-permissions";
import { invoicePartyWhere } from "@/lib/invoice/party-filter";
import { accountingPhase0Available } from "@/lib/invoice/phase0-columns";

// ============================================================================
// GET /api/invoices/stats - Get comprehensive invoice statistics
// ============================================================================

export const GET = withPermissionAndDB([
  "financial_reports",
  ...INVOICE_LIST_PERMISSIONS,
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const timeframe = searchParams.get("timeframe") || "all"; // all, month, quarter, year
    const propertyId = searchParams.get("propertyId");
    const tenantId = searchParams.get("tenantId");
    const leaseId = searchParams.get("leaseId");

    // Build base query
    const baseQuery: Record<string, unknown> = {};

    // Single company architecture - Managers can view invoice stats for all
    // properties. A tenant asking after someone else gets a 403 rather than a
    // silently empty stat block; the scope below enforces it either way.
    if (user.isTenant && tenantId && tenantId !== user.id) {
      return createErrorResponse(
        "You can only view your own invoice statistics",
        403
      );
    }
    // The same documents the list shows: a tenant's invoices unless the
    // screen asks for more (`party`, see lib/invoice/party-filter.ts).
    const party = invoicePartyWhere(
      searchParams,
      await accountingPhase0Available(),
    );
    if ("error" in party) {
      return createErrorResponse(String(party.error), 400);
    }
    Object.assign(baseQuery, party);
    // See lib/db/scopes.ts.
    applyScope(baseQuery, invoiceScope(user));

    // Apply additional filters
    if (propertyId) {
      baseQuery.propertyId = propertyId;
    }
    if (tenantId) {
      // Non-tenant roles may inspect other tenants; tenants already validated above
      baseQuery.tenantId = tenantId;
    }
    if (leaseId) {
      baseQuery.leaseId = leaseId;
    }

    // Apply timeframe filter
    if (timeframe !== "all") {
      const now = new Date();
      let startDate: Date;

      switch (timeframe) {
        case "month":
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          break;
        case "quarter":
          const quarterStart = Math.floor(now.getMonth() / 3) * 3;
          startDate = new Date(now.getFullYear(), quarterStart, 1);
          break;
        case "year":
          startDate = new Date(now.getFullYear(), 0, 1);
          break;
        default:
          startDate = new Date(0); // Beginning of time
      }

      baseQuery.createdAt = { gte: startDate };
    }

    // Get status counts and total statistics
    const [statusCounts, totalStats, overdueStats] = await Promise.all([
      db.invoice.groupBy({
        by: ["status"],
        where: baseQuery,
        _count: { _all: true },
      }),
      db.invoice.aggregate({
        where: baseQuery,
        _count: { _all: true },
        _sum: { totalAmount: true, amountPaid: true },
      }),
      db.invoice.aggregate({
        where: { ...baseQuery, status: InvoiceStatus.OVERDUE },
        _sum: { balanceRemaining: true },
      }),
    ]);

    // Initialize stats object
    const stats = {
      total: 0,
      scheduled: 0,
      issued: 0,
      paid: 0,
      partial: 0,
      overdue: 0,
      cancelled: 0,
      totalAmount: 0,
      paidAmount: 0,
      overdueAmount: 0,
    };

    // Populate status counts
    statusCounts.forEach((row) => {
      const statusKey = row.status as keyof typeof stats;
      if (statusKey in stats && typeof stats[statusKey] === "number") {
        (stats as any)[statusKey] = row._count._all;
      }
    });

    // Set total statistics
    stats.total = totalStats._count._all;
    stats.totalAmount = totalStats._sum.totalAmount ?? 0;
    stats.paidAmount = totalStats._sum.amountPaid ?? 0;
    stats.overdueAmount = overdueStats._sum.balanceRemaining ?? 0;

    return createSuccessResponse(
      stats,
      "Invoice statistics retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});
