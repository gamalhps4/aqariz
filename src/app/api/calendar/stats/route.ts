/**
 * PropertyPro - Calendar Statistics API
 * Get calendar statistics and analytics data
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { EventType, EventStatus } from "@/types";
import { readAttendees } from "@/lib/services/calendar.service";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/dates/business-day";

// ============================================================================
// GET /api/calendar/stats - Get calendar statistics
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    // Build date filter
    const dateFilter: { gte?: Date; lte?: Date } = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }
    const hasDateFilter = Object.keys(dateFilter).length > 0;

    // Base filters: events the user organizes, created, or attends
    const userOr: Prisma.EventWhereInput[] = [
      { organizerId: user.id },
      { createdById: user.id },
      { attendeeIds: { has: user.id } },
    ];

    const baseWhere: Prisma.EventWhereInput = {
      deletedAt: null,
      OR: userOr,
      ...(hasDateFilter ? { startDate: dateFilter } : {}),
    };

    // Get total events count
    const totalEvents = await db.event.count({ where: baseWhere });

    // Get upcoming events (from now)
    const now = new Date();
    const upcomingEvents = await db.event.count({
      where: {
        deletedAt: null,
        OR: userOr,
        startDate: { gte: now },
        status: { notIn: [EventStatus.CANCELLED, EventStatus.COMPLETED] },
      },
    });

    // Get today's events
    const startOfDay = startOfBusinessDay(now);
    const endOfDay = endOfBusinessDay(now);

    const todayEvents = await db.event.count({
      where: {
        deletedAt: null,
        OR: userOr,
        startDate: { gte: startOfDay, lte: endOfDay },
      },
    });

    // Get pending RSVPs for events organized by the user
    // Count attendees with pending status in events organized by the user
    const organizedFutureEvents = await db.event.findMany({
      where: {
        organizerId: user.id,
        startDate: { gte: now }, // Only count future events
        status: { notIn: [EventStatus.CANCELLED, EventStatus.COMPLETED] },
      },
      select: { attendees: true },
    });

    const pendingRSVPs = organizedFutureEvents.reduce(
      (sum, event) =>
        sum +
        readAttendees(event).filter((attendee) => attendee.status === "pending")
          .length,
      0,
    );

    // Get events by type
    const eventsByTypeAgg = await db.event.groupBy({
      by: ["type"],
      where: baseWhere,
      _count: { _all: true },
    });

    const eventsByType: Record<string, number> = {};
    Object.values(EventType).forEach((type) => {
      eventsByType[type] = 0;
    });
    eventsByTypeAgg.forEach((item) => {
      eventsByType[item.type] = item._count._all;
    });

    // Get events by status
    const eventsByStatusAgg = await db.event.groupBy({
      by: ["status"],
      where: baseWhere,
      _count: { _all: true },
    });

    const eventsByStatus: Record<string, number> = {};
    Object.values(EventStatus).forEach((status) => {
      eventsByStatus[status] = 0;
    });
    eventsByStatusAgg.forEach((item) => {
      eventsByStatus[item.status] = item._count._all;
    });

    // Get recent activity (events created in last 30 days)
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const recentEvents = await db.event.count({
      where: {
        deletedAt: null,
        OR: userOr,
        createdAt: { gte: thirtyDaysAgo },
      },
    });

    // Get completion rate
    const completedEvents = eventsByStatus[EventStatus.COMPLETED] ?? 0;
    const completionRate =
      totalEvents > 0 ? (completedEvents / totalEvents) * 100 : 0;

    // Get average events per week (last 4 weeks)
    const fourWeeksAgo = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);
    const recentEventsCount = await db.event.count({
      where: {
        deletedAt: null,
        OR: userOr,
        startDate: { gte: fourWeeksAgo },
      },
    });
    const avgEventsPerWeek = recentEventsCount / 4;

    // Busiest day of week + monthly trend, computed from the start dates
    const startDates = await db.event.findMany({
      where: baseWhere,
      select: { startDate: true },
    });

    const dayCounts = new Map<number, number>();
    for (const { startDate: eventStart } of startDates) {
      // Mongo's $dayOfWeek is UTC-based: 1 = Sunday … 7 = Saturday
      const day = eventStart.getUTCDay() + 1;
      dayCounts.set(day, (dayCounts.get(day) ?? 0) + 1);
    }
    let busiestDay: number | null = null;
    let busiestCount = -1;
    for (const [day, count] of dayCounts) {
      if (count > busiestCount) {
        busiestDay = day;
        busiestCount = count;
      }
    }

    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];
    const busiestDayName = busiestDay ? dayNames[busiestDay - 1] : null;

    // Get monthly trend (last 6 months)
    const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);
    const monthBuckets = new Map<string, { year: number; month: number; count: number }>();
    for (const { startDate: eventStart } of startDates) {
      if (eventStart < sixMonthsAgo) continue;
      const year = eventStart.getUTCFullYear();
      const month = eventStart.getUTCMonth() + 1;
      const key = `${year}-${month}`;
      const bucket = monthBuckets.get(key) ?? { year, month, count: 0 };
      bucket.count += 1;
      monthBuckets.set(key, bucket);
    }
    const monthlyTrend = [...monthBuckets.values()]
      .sort((a, b) => a.year - b.year || a.month - b.month)
      .map((bucket) => ({
        _id: { year: bucket.year, month: bucket.month },
        count: bucket.count,
      }));

    const stats = {
      totalEvents,
      upcomingEvents,
      todayEvents,
      pendingRSVPs,
      eventsByType,
      eventsByStatus,
      recentEvents,
      completionRate: Math.round(completionRate * 100) / 100,
      avgEventsPerWeek: Math.round(avgEventsPerWeek * 100) / 100,
      busiestDay: busiestDayName,
      monthlyTrend,
      summary: {
        totalEvents,
        activeEvents: upcomingEvents,
        completedEvents,
        cancelledEvents: eventsByStatus[EventStatus.CANCELLED] ?? 0,
        responseRate:
          pendingRSVPs > 0
            ? Math.round(((totalEvents - pendingRSVPs) / totalEvents) * 100)
            : 100,
      },
    };

    return createSuccessResponse(
      stats,
      "Calendar statistics retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});
