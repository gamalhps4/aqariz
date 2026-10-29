/**
 * PropertyPro - Revenues API Route
 * GET /api/accounting/revenues - Get revenue data
 */

import { NextRequest } from "next/server";
import {
  withPermissionAndDB,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
} from "@/lib/api-utils";
import { revenueService } from "@/lib/services/revenue.service";
import { ACCOUNTING_READ_PERMISSIONS } from "@/lib/finance-permissions";

function createSuccessResponse(
  data: any,
  message: string,
  pagination?: any
) {
  return createApiSuccessResponse(data, message, pagination);
}

function createErrorResponse(message: string, status: number = 400) {
  return createApiErrorResponse(message, status, message);
}

export const GET = withPermissionAndDB([...ACCOUNTING_READ_PERMISSIONS])(
  async (user: any, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const propertyId = searchParams.get("propertyId") || undefined;
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const parsedMonths = parseInt(searchParams.get("months") || "12");
      const months = Number.isNaN(parsedMonths) ? 12 : parsedMonths;

      const [summary, byCategory, byProperty, monthlyTrends] =
        await Promise.all([
          revenueService.getRevenueSummary(user, propertyId),
          revenueService.getRevenueByCategory(
            user,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined,
            propertyId
          ),
          revenueService.getRevenueByProperty(
            user,
            startDate ? new Date(startDate) : undefined,
            endDate ? new Date(endDate) : undefined
          ),
          revenueService.getMonthlyRevenue(user, months, propertyId),
        ]);

      return createSuccessResponse(
        {
          summary,
          byCategory,
          byProperty,
          monthlyTrends,
        },
        "Revenue data retrieved successfully"
      );
    } catch (error) {
      console.error("[Revenues API] Error:", error);
      return createErrorResponse("Failed to fetch revenue data", 500);
    }
  }
);
