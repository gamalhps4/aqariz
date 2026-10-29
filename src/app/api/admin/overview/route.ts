export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { getPlatformBillingMetrics } from "@/lib/billing/metrics";
import { bypassOrgScope } from "@/lib/tenancy/context";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const [orgGroups, userGroups, properties, billing, recentOrganizations, recentActivity] =
        await Promise.all([
          db.organization.groupBy({
            by: ["status"],
            _count: { _all: true },
          }),
          bypassOrgScope(() =>
            db.user.groupBy({
              by: ["role"],
              where: { organizationId: { not: null }, deletedAt: null },
              _count: { _all: true },
            }),
          ),
          bypassOrgScope(() => db.property.count({ where: { deletedAt: null } })),
          getPlatformBillingMetrics(),
          db.organization.findMany({
            select: {
              id: true,
              name: true,
              slug: true,
              status: true,
              plan: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          }),
          db.platformAuditLog.findMany({
            select: {
              id: true,
              action: true,
              targetType: true,
              targetName: true,
              summary: true,
              actorEmail: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 8,
          }),
        ]);

      const organizations = orgGroups.map((item) => ({
        _id: item.status,
        count: item._count._all,
      }));
      const users = userGroups.map((item) => ({
        _id: item.role,
        count: item._count._all,
      }));

      const organizationCounts = Object.fromEntries(
        organizations.map((item) => [item._id, item.count]),
      );
      const userCounts = Object.fromEntries(users.map((item) => [item._id, item.count]));

      return createSuccessResponse({
        organizations: {
          total: organizations.reduce((sum, item) => sum + item.count, 0),
          active: organizationCounts.active ?? 0,
          trial: organizationCounts.trial ?? 0,
          suspended: organizationCounts.suspended ?? 0,
        },
        users: {
          total: users.reduce((sum, item) => sum + item.count, 0),
          byRole: userCounts,
        },
        properties,
        billing: {
          currency: billing.currency,
          mrr: billing.mrr,
          arr: billing.arr,
          atRiskMrr: billing.atRiskMrr,
          paying: billing.counts.paying,
          pastDue: billing.counts.pastDue,
        },
        recentOrganizations: recentOrganizations.map((organization) => ({
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          plan: organization.plan,
          createdAt: organization.createdAt,
        })),
        recentActivity: recentActivity.map((event) => ({
          id: event.id,
          action: event.action,
          targetType: event.targetType,
          targetName: event.targetName,
          summary: event.summary,
          actorEmail: event.actorEmail,
          createdAt: event.createdAt,
        })),
      });
    } catch (error) {
      return handleApiError(error, "Failed to load platform overview");
    }
  },
);
