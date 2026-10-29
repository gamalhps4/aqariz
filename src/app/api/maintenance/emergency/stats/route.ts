/**
 * PropertyPro - Emergency Statistics API Route
 * Provide detailed statistics and analytics for emergency maintenance requests
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, maintenanceScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { MaintenancePriority, MaintenanceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  addBusinessDays,
  businessDay,
  businessDayStart,
  businessToday,
} from "@/lib/dates/business-day";

const ACTIVE_STATUSES = [
  MaintenanceStatus.SUBMITTED,
  MaintenanceStatus.ASSIGNED,
  MaintenanceStatus.IN_PROGRESS,
] as string[];

const CLOSED_STATUSES = [
  MaintenanceStatus.COMPLETED,
  MaintenanceStatus.CANCELLED,
] as string[];

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / (1000 * 60 * 60);
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

// ============================================================================
// GET /api/maintenance/emergency/stats - Get emergency statistics
// ============================================================================

export const GET = withPermissionAndDB("maintenance_management")(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const timeframe = searchParams.get("timeframe") || "30"; // days
    const propertyId = searchParams.get("propertyId");

    // The window opens at the start of a day on the office's calendar, as many
    // days back as asked — not at "now minus N days" on the server's clock.
    const startDate = businessDayStart(
      addBusinessDays(businessToday(), -(parseInt(timeframe) || 30)),
    );

    // Build base query
    const where: Prisma.MaintenanceRequestWhereInput = {
      priority: MaintenancePriority.EMERGENCY,
      deletedAt: null,
      createdAt: { gte: startDate },
    };

    if (propertyId) {
      where.propertyId = propertyId;
    }

    // Manager-equivalent roles are limited to their assigned and unassigned emergencies.
    if (user.isManager && !user.isAdmin) {
      where.OR = [{ assignedToId: user.id }, { assignedToId: null }];
    }

    // A narrowed employee sees emergencies in their own buildings only.
    // AND-ed on, because `propertyId` above comes from the query string.
    applyScope(where, maintenanceScope(user));

    const rows = await db.maintenanceRequest.findMany({
      where,
      select: {
        status: true,
        category: true,
        assignedToId: true,
        estimatedCost: true,
        actualCost: true,
        createdAt: true,
        completedDate: true,
      },
    });

    const now = new Date();

    // Overview statistics (mirrors the old aggregation pipeline)
    let statistics: Record<string, number | null>;
    if (rows.length === 0) {
      statistics = {
        totalEmergencies: 0,
        activeEmergencies: 0,
        completedEmergencies: 0,
        overdueEmergencies: 0,
        unassignedEmergencies: 0,
        avgResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        criticalCount: 0,
        overdueCount: 0,
        normalCount: 0,
        totalEstimatedCost: 0,
        totalActualCost: 0,
        avgEstimatedCost: 0,
        avgActualCost: 0,
      };
    } else {
      let activeEmergencies = 0;
      let completedEmergencies = 0;
      let overdueEmergencies = 0;
      let unassignedEmergencies = 0;
      let criticalCount = 0;
      let overdueCount = 0;
      let normalCount = 0;
      let totalEstimatedCost = 0;
      let totalActualCost = 0;
      const estimatedCosts: number[] = [];
      const actualCosts: number[] = [];
      const responseTimes: number[] = [];

      for (const row of rows) {
        const hours = hoursBetween(row.createdAt, now);
        const closed = CLOSED_STATUSES.includes(row.status);
        const isOverdue = !closed && hours > 2;
        const urgencyLevel = closed
          ? "completed"
          : hours > 4
            ? "critical"
            : hours > 2
              ? "overdue"
              : "normal";

        if (ACTIVE_STATUSES.includes(row.status)) activeEmergencies += 1;
        if (row.status === MaintenanceStatus.COMPLETED) {
          completedEmergencies += 1;
          if (row.completedDate) {
            responseTimes.push(hoursBetween(row.createdAt, row.completedDate));
          }
        }
        if (isOverdue) overdueEmergencies += 1;
        if (!row.assignedToId && ACTIVE_STATUSES.includes(row.status)) {
          unassignedEmergencies += 1;
        }
        if (urgencyLevel === "critical") criticalCount += 1;
        if (urgencyLevel === "overdue") overdueCount += 1;
        if (urgencyLevel === "normal") normalCount += 1;
        if (typeof row.estimatedCost === "number") {
          totalEstimatedCost += row.estimatedCost;
          estimatedCosts.push(row.estimatedCost);
        }
        if (typeof row.actualCost === "number") {
          totalActualCost += row.actualCost;
          actualCosts.push(row.actualCost);
        }
      }

      statistics = {
        totalEmergencies: rows.length,
        activeEmergencies,
        completedEmergencies,
        overdueEmergencies,
        unassignedEmergencies,
        avgResponseTime: average(responseTimes),
        minResponseTime:
          responseTimes.length > 0 ? Math.min(...responseTimes) : null,
        maxResponseTime:
          responseTimes.length > 0 ? Math.max(...responseTimes) : null,
        criticalCount,
        overdueCount,
        normalCount,
        totalEstimatedCost,
        totalActualCost,
        avgEstimatedCost: average(estimatedCosts),
        avgActualCost: average(actualCosts),
      };
    }

    // Get category breakdown
    const categoryBuckets = new Map<
      string,
      { count: number; responseTimes: number[] }
    >();
    for (const row of rows) {
      const bucket = categoryBuckets.get(row.category) ?? {
        count: 0,
        responseTimes: [],
      };
      bucket.count += 1;
      if (row.status === MaintenanceStatus.COMPLETED && row.completedDate) {
        bucket.responseTimes.push(
          hoursBetween(row.createdAt, row.completedDate)
        );
      }
      categoryBuckets.set(row.category, bucket);
    }
    const categoryStats = [...categoryBuckets.entries()]
      .map(([category, bucket]) => ({
        _id: category,
        count: bucket.count,
        avgResponseTime: average(bucket.responseTimes),
      }))
      .sort((a, b) => b.count - a.count);

    // Get daily trend data
    const trendBuckets = new Map<string, { count: number; completed: number }>();
    for (const row of rows) {
      const day = businessDay(row.createdAt);
      const bucket = trendBuckets.get(day) ?? { count: 0, completed: 0 };
      bucket.count += 1;
      if (row.status === MaintenanceStatus.COMPLETED) bucket.completed += 1;
      trendBuckets.set(day, bucket);
    }
    const trendData = [...trendBuckets.entries()]
      .map(([day, bucket]) => ({
        _id: day,
        count: bucket.count,
        completed: bucket.completed,
      }))
      .sort((a, b) => a._id.localeCompare(b._id));

    // Get response time distribution ($bucket boundaries [0,2,4,8,24,48,Infinity])
    const boundaries = [0, 2, 4, 8, 24, 48];
    const distributionBuckets = new Map<
      string | number,
      { count: number; costs: number[] }
    >();
    for (const row of rows) {
      if (row.status !== MaintenanceStatus.COMPLETED || !row.completedDate) {
        continue;
      }
      const hours = hoursBetween(row.createdAt, row.completedDate);
      let key: string | number = "other";
      for (let i = boundaries.length - 1; i >= 0; i--) {
        if (hours >= boundaries[i]) {
          key = boundaries[i];
          break;
        }
      }
      const bucket = distributionBuckets.get(key) ?? { count: 0, costs: [] };
      bucket.count += 1;
      if (typeof row.actualCost === "number") bucket.costs.push(row.actualCost);
      distributionBuckets.set(key, bucket);
    }
    const responseTimeDistribution = [...distributionBuckets.entries()]
      .map(([key, bucket]) => ({
        _id: key,
        count: bucket.count,
        avgCost: average(bucket.costs),
      }))
      .sort((a, b) => {
        const av = typeof a._id === "number" ? a._id : Infinity;
        const bv = typeof b._id === "number" ? b._id : Infinity;
        return av - bv;
      });

    // Calculate performance metrics
    const totalEmergencies = statistics.totalEmergencies ?? 0;
    const completedEmergencies = statistics.completedEmergencies ?? 0;
    const overdueEmergencies = statistics.overdueEmergencies ?? 0;

    const completionRate =
      totalEmergencies > 0
        ? (completedEmergencies / totalEmergencies) * 100
        : 0;

    const onTimeRate =
      completedEmergencies > 0
        ? ((completedEmergencies - overdueEmergencies) / completedEmergencies) *
          100
        : 0;

    return createSuccessResponse(
      {
        overview: {
          ...statistics,
          completionRate: Math.round(completionRate * 100) / 100,
          onTimeRate: Math.round(onTimeRate * 100) / 100,
        },
        categoryBreakdown: categoryStats,
        trendData,
        responseTimeDistribution,
        timeframe: parseInt(timeframe),
      },
      "Emergency statistics retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});
