/**
 * PropertyPro - Tenant Statistics API
 * Comprehensive tenant analytics and status reporting
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { tenantRecordScope, withScope, type ScopeActor } from "@/lib/db/scopes";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";

/**
 * The tenant scope as a condition on `users` in raw SQL, for the trend query
 * that aggregates there. `null` is "no condition".
 *
 * Mirrors tenantRecordScope: an employee narrowed to some buildings counts
 * the tenants with a contract in one of them. Any other narrowed reader —
 * none reaches this route today — counts nothing rather than everything.
 */
function tenantScopeSql(actor: ScopeActor): Prisma.Sql | null {
  if (Object.keys(tenantRecordScope(actor)).length === 0) return null;
  const held = actor.scopedPropertyIds;
  if (actor.isTenant || actor.isOwner || !held || held.length === 0) {
    return Prisma.sql`FALSE`;
  }
  return Prisma.sql`EXISTS (
    SELECT 1 FROM leases l
    WHERE l."tenantId" = users.id
      AND l."deletedAt" IS NULL
      AND l."propertyId" IN (${Prisma.join([...held])})
  )`;
}

// ============================================================================
// GET /api/tenants/statistics - Get comprehensive tenant statistics
// ============================================================================

// The module's umbrella right as well, as on the tenant list.
export const GET = withPermissionAndDB(["tenant_view", "tenant_management"])(async (
  user: AuthenticatedAccessUser,
  request: NextRequest
) => {
  try {
    const { searchParams } = new URL(request.url);
    const timeframe = searchParams.get("timeframe") || "all"; // all, month, quarter, year
    const includeHistory = searchParams.get("includeHistory") === "true";

    // Build date filter based on timeframe
    let dateFilter: Prisma.UserWhereInput = {};
    if (timeframe !== "all") {
      const now = new Date();
      const startDate = new Date();

      switch (timeframe) {
        case "month":
          startDate.setMonth(now.getMonth() - 1);
          break;
        case "quarter":
          startDate.setMonth(now.getMonth() - 3);
          break;
        case "year":
          startDate.setFullYear(now.getFullYear() - 1);
          break;
      }

      dateFilter = { createdAt: { gte: startDate } };
    }

    // Counted over the tenants this reader may see (lib/db/scopes.ts), the
    // same set the tenant list shows them. Unscoped, a narrowed employee's
    // dashboard reported the whole office.
    const baseWhere: Prisma.UserWhereInput = withScope(
      {
        role: UserRole.TENANT,
        isActive: true,
        deletedAt: null,
      },
      tenantRecordScope(user),
    );
    const scopeSql = tenantScopeSql(user);

    // Get status counts
    const statusCounts = await db.user.groupBy({
      by: ["tenantStatus"],
      where: { ...baseWhere, ...dateFilter },
      _count: { _all: true },
    });

    // Get background check status counts
    const backgroundCheckCounts = await db.user.groupBy({
      by: ["backgroundCheckStatus"],
      where: { ...baseWhere, ...dateFilter },
      _count: { _all: true },
    });

    // Get move-in/move-out statistics
    const [totalTenants, activeTenants, movedOutTenants, pendingMoveIn] =
      await Promise.all([
        db.user.count({ where: baseWhere }),
        db.user.count({
          where: {
            ...baseWhere,
            moveInDate: { not: null },
            moveOutDate: null,
          },
        }),
        db.user.count({
          where: { ...baseWhere, moveOutDate: { not: null } },
        }),
        db.user.count({
          where: {
            ...baseWhere,
            tenantStatus: "approved",
            moveInDate: null,
          },
        }),
      ]);

    // Get application trends (last 12 months)
    const trendsSince = new Date(
      new Date().setFullYear(new Date().getFullYear() - 1)
    );
    const trendRows = await db.$queryRaw<
      Array<{
        year: number;
        month: number;
        applications: number;
        approved: number;
        rejected: number;
      }>
    >`
      SELECT
        EXTRACT(YEAR FROM "applicationDate")::int AS year,
        EXTRACT(MONTH FROM "applicationDate")::int AS month,
        COUNT(*)::int AS applications,
        SUM(CASE WHEN "tenantStatus" = 'approved' THEN 1 ELSE 0 END)::int AS approved,
        SUM(CASE WHEN "tenantStatus" = 'terminated' THEN 1 ELSE 0 END)::int AS rejected
      FROM users
      WHERE role = 'tenant'
        AND "isActive" = true
        AND "deletedAt" IS NULL
        AND "applicationDate" >= ${trendsSince}
        ${scopeSql ? Prisma.sql`AND ${scopeSql}` : Prisma.empty}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    const applicationTrends = trendRows.map((row) => ({
      _id: { year: row.year, month: row.month },
      applications: row.applications,
      approved: row.approved,
      rejected: row.rejected,
    }));

    // Format status counts
    const formattedStatusCounts: Record<string, number> = {};
    statusCounts.forEach((item) => {
      formattedStatusCounts[item.tenantStatus || "unknown"] =
        item._count._all;
    });

    // Format background check counts
    const formattedBackgroundCounts: Record<string, number> = {};
    backgroundCheckCounts.forEach((item) => {
      formattedBackgroundCounts[item.backgroundCheckStatus || "unknown"] =
        item._count._all;
    });

    // Get recent status changes if history is requested
    let recentStatusChanges: unknown[] = [];
    if (includeHistory) {
      const usersWithHistory = await db.user.findMany({
        where: {
          ...baseWhere,
          statusHistory: { not: [] },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          tenantStatus: true,
          statusHistory: true,
        },
        orderBy: { lastStatusUpdate: "desc" },
        take: 20,
      });

      // Last 5 status changes per tenant, with changedBy populated
      const trimmed = usersWithHistory.map((tenant) => ({
        ...tenant,
        statusHistory: (((tenant.statusHistory as unknown[]) ??
          []) as unknown[]).slice(-5),
      }));

      const changedByIds = [
        ...new Set(
          trimmed
            .flatMap((tenant) => tenant.statusHistory as any[])
            .map((entry) =>
              typeof entry?.changedBy === "string"
                ? entry.changedBy
                : entry?.changedBy?.id ?? entry?.changedBy?._id
            )
            .filter((id): id is string => Boolean(id))
        ),
      ];

      const changedByUsers = changedByIds.length
        ? await db.user.findMany({
            where: { id: { in: changedByIds } },
            select: { id: true, firstName: true, lastName: true },
          })
        : [];
      const changedByMap = new Map(
        changedByUsers.map((changer) => [changer.id, changer])
      );

      recentStatusChanges = trimmed.map((tenant) => ({
        ...tenant,
        statusHistory: (tenant.statusHistory as any[]).map((entry) => {
          const key =
            typeof entry?.changedBy === "string"
              ? entry.changedBy
              : entry?.changedBy?.id ?? entry?.changedBy?._id;
          const changer = key ? changedByMap.get(key) : undefined;
          return changer ? { ...entry, changedBy: changer } : entry;
        }),
      }));
    }

    const statistics = {
      overview: {
        totalTenants: totalTenants || 0,
        activeTenants: activeTenants || 0,
        movedOutTenants: movedOutTenants || 0,
        pendingMoveIn: pendingMoveIn || 0,
      },
      statusBreakdown: formattedStatusCounts,
      backgroundCheckBreakdown: formattedBackgroundCounts,
      applicationTrends,
      recentStatusChanges: includeHistory ? recentStatusChanges : undefined,
      generatedAt: new Date(),
      timeframe,
    };

    return createSuccessResponse(
      statistics,
      "Tenant statistics retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});
