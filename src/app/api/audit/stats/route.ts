/**
 * PropertyPro - Audit statistics
 *
 * Aggregates for the audit dashboard, which shipped fully built but pointed at
 * this route and an export endpoint that never existed — so the whole screen
 * was unreachable.
 *
 * The `_id` field names in the response are the shape the dashboard already
 * expects (a Mongo-era convention preserved so the component needs no
 * rewrite); everything below is plain Postgres aggregation.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { AuditCategory } from "@/lib/audit-service";
import type { Prisma } from "@/generated/prisma/client";
import { activityTimeWhere } from "@/lib/audit/read";
import { AUDIT_TIME_ZONE } from "@/lib/audit/time";

/** Categories that count as security-relevant on the summary card. */
const SECURITY_CATEGORIES: string[] = [
  AuditCategory.AUTHENTICATION,
  AuditCategory.SECURITY,
  AuditCategory.COMPLIANCE,
];

const DEFAULT_WINDOW_DAYS = 30;

export const GET = withPermissionAndDB("audit_logs")(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = new URL(request.url).searchParams;

      // Whole Riyadh days, the last one included — the same reading of a
      // date range as the activity list beside it (lib/audit/time).
      const range = activityTimeWhere(
        params.get("startDate"),
        params.get("endDate")?.slice(0, 10) ?? null,
      );
      const endDate = range?.lt ?? range?.lte ?? new Date();
      const startDate =
        range?.gte ??
        new Date(endDate.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const where: Prisma.AuditLogWhereInput = {
        timestamp: { gte: startDate, lt: endDate },
      };

      const [totalLogs, securityEvents, categories, actions, severities, users] =
        await Promise.all([
          db.auditLog.count({ where }),
          db.auditLog.count({
            where: { ...where, category: { in: SECURITY_CATEGORIES } },
          }),
          db.auditLog.groupBy({
            by: ["category"],
            where,
            _count: { _all: true },
            orderBy: { _count: { category: "desc" } },
          }),
          db.auditLog.groupBy({
            by: ["action"],
            where,
            _count: { _all: true },
            orderBy: { _count: { action: "desc" } },
            take: 15,
          }),
          db.auditLog.groupBy({
            by: ["severity"],
            where,
            _count: { _all: true },
          }),
          db.auditLog.groupBy({
            by: ["userId"],
            where: { ...where, userId: { not: null } },
            _count: { _all: true },
            orderBy: { _count: { userId: "desc" } },
            take: 10,
          }),
        ]);

      // Daily counts. Grouping by a date expression is beyond Prisma's
      // groupBy, so this is one raw query rather than N per-day counts.
      const daily = await db.$queryRaw<Array<{ day: Date; count: bigint }>>`
        SELECT date_trunc('day', ("timestamp" AT TIME ZONE 'UTC') AT TIME ZONE ${AUDIT_TIME_ZONE}) AS day,
               COUNT(*)::bigint AS count
        FROM audit_logs
        WHERE "timestamp" >= ${startDate} AND "timestamp" < ${endDate}
        GROUP BY day
        ORDER BY day ASC
      `;

      const userIds = users
        .map((row) => row.userId)
        .filter((id): id is string => Boolean(id));
      const userRows = userIds.length
        ? await db.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [];
      const userById = new Map(userRows.map((row) => [row.id, row]));

      return createSuccessResponse({
        summary: {
          totalLogs,
          securityEvents,
          dateRange: {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
        },
        breakdown: {
          categories: categories.map((row) => ({
            _id: row.category,
            count: row._count._all,
          })),
          actions: actions.map((row) => ({
            _id: row.action,
            count: row._count._all,
          })),
          severity: severities.map((row) => ({
            _id: row.severity,
            count: row._count._all,
          })),
        },
        trends: {
          daily: daily.map((row) => ({
            // The query already cut the day on Riyadh's clock; its wall time
            // comes back as a UTC date, so the UTC fields are that day.
            _id: row.day.toISOString().slice(0, 10),
            count: Number(row.count),
          })),
        },
        topUsers: users.map((row) => {
          const profile = row.userId ? userById.get(row.userId) : undefined;
          return {
            _id: row.userId ?? "unknown",
            count: row._count._all,
            name:
              [profile?.firstName, profile?.lastName]
                .filter(Boolean)
                .join(" ")
                .trim() || "Unknown user",
            email: profile?.email ?? "",
          };
        }),
      });
    } catch (error) {
      return handleApiError(error, "Failed to build audit statistics");
    }
  },
);
