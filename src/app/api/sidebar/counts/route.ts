/**
 * PropertyPro - Sidebar Counts API
 * Provides real-time counts for sidebar navigation badges
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  applyScope,
  ticketIdentityIds,
  ticketScope,
} from "@/lib/db/scopes";
import {
  UserRole,
  LeaseStatus,
  MaintenancePriority,
  MaintenanceStatus,
  TicketStatus,
} from "@/types";
import { getReceivablesTotals } from "@/lib/services/payment-reports.service";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  buildNotificationVisibilityFilter,
  mergeNotificationFilters,
} from "@/lib/notification-visibility";
import {
  buildAnnouncementVisibilityFilter,
} from "@/lib/inbox-visibility";
import { getOrganizationModules } from "@/lib/billing/entitlements";

// ============================================================================
// GET /api/sidebar/counts - Get sidebar navigation counts
// ============================================================================

export const GET = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any }
) => {
  try {
    const canViewOperationalCounts = user.isCompanyStaff;
    // A badge belongs to a menu entry, and an entry the package leaves out is
    // not drawn — so its count is neither run nor added into the Inbox total.
    const { state } = await getOrganizationModules(user.organizationId!);
    const moduleOn = (key: string) => state.enabled.has(key);

    // Initialize counts object
    const counts = {
      applications: 0,
      expiringLeases: 0,
      emergencyMaintenance: 0,
      overduePayments: 0,
      inbox: 0,
      messages: 0,
      notifications: 0,
      announcements: 0,
      tickets: 0,
    };

    // Role-based count fetching - Single company architecture
    if (canViewOperationalCounts && moduleOn("clients.tenants.applications")) {
      // Applications count - users with pending application status
      counts.applications = await db.user.count({
        where: {
          role: UserRole.TENANT,
          tenantStatus: { in: ["application_submitted", "under_review"] },
          isActive: true,
          deletedAt: null,
        },
      });
    }

    if (canViewOperationalCounts && moduleOn("leasing.reports.expiring_soon")) {
      // Expiring leases count - leases expiring in next 30 days
      const thirtyDaysFromNow = new Date();
      thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

      counts.expiringLeases = await db.lease.count({
        where: {
          status: LeaseStatus.ACTIVE,
          endDate: {
            gte: new Date(),
            lte: thirtyDaysFromNow,
          },
          deletedAt: null,
        },
      });
    }

    if (canViewOperationalCounts && moduleOn("maintenance.emergency")) {
      // Emergency maintenance count - emergency priority requests that are not completed/cancelled
      counts.emergencyMaintenance = await db.maintenanceRequest.count({
        where: {
          priority: MaintenancePriority.EMERGENCY,
          status: {
            notIn: [MaintenanceStatus.COMPLETED, MaintenanceStatus.CANCELLED],
          },
          deletedAt: null,
        },
      });
    }

    if (canViewOperationalCounts && moduleOn("collections.overdue_tenants")) {
      // The badge on "Overdue tenants": how many tenants that report lists
      // today — rent installments past their due date and still owed, for
      // the buildings this reader holds. It counted payment rows by a stored
      // status that only changes when something touches the row. The key
      // keeps its name for the menu that reads it.
      counts.overduePayments = (
        await getReceivablesTotals({ actor: user, overdueOnly: true })
      ).tenantCount;
    }

    const conversations = moduleOn("communication.messages")
      ? await db.conversation.findMany({
          where: {
            participantIds: { has: user.id },
            isArchived: false,
            deletedAt: null,
          },
          select: { id: true },
        })
      : [];
    const conversationIds = conversations.map(
      (conversation) => conversation.id
    );

    if (conversationIds.length > 0) {
      counts.messages = await db.message.count({
        where: {
          conversationId: { in: conversationIds },
          senderId: { not: user.id },
          deletedAt: null,
          status: { not: "read" },
          NOT: { readBy: { array_contains: [{ userId: user.id }] } },
        },
      });
    }

    const notificationVisibility = await buildNotificationVisibilityFilter(
      user,
      context?.tenantProfile
    );
    const unreadNotificationWhere = mergeNotificationFilters(
      notificationVisibility.where,
      { read: false }
    );

    if (notificationVisibility.isRestricted) {
      // Tenant metadata rules live in JS (the metadata column is Json) —
      // fetch the candidate rows and count the ones that pass.
      const unreadNotifications = await db.notification.findMany({
        where: unreadNotificationWhere,
        select: { type: true, metadata: true },
      });
      counts.notifications = unreadNotifications.filter((notification) =>
        notificationVisibility.matches(notification)
      ).length;
    } else {
      counts.notifications = await db.notification.count({
        where: unreadNotificationWhere,
      });
    }

    const announcementVisibility = moduleOn("communication.announcements")
      ? await buildAnnouncementVisibilityFilter(user, context?.tenantProfile)
      : null;

    if (!announcementVisibility) {
      counts.announcements = 0;
    } else if (announcementVisibility.isRestricted) {
      const visibleAnnouncements = await db.announcement.findMany({
        where: announcementVisibility.where,
        select: { targetAudience: true },
      });
      counts.announcements = visibleAnnouncements.filter((announcement) =>
        announcementVisibility.matches(announcement)
      ).length;
    } else {
      counts.announcements = await db.announcement.count({
        where: announcementVisibility.where,
      });
    }

    const ticketWhere: Record<string, any> = {
      status: {
        in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
      },
      deletedAt: null,
    };

    // Same ticket rule the tickets routes use — see lib/db/scopes.ts.
    applyScope(
      ticketWhere,
      ticketScope(user, ticketIdentityIds(user, context?.tenantProfile))
    );

    counts.tickets = moduleOn("communication.tickets")
      ? await db.ticket.count({ where: ticketWhere })
      : 0;
    counts.inbox =
      counts.messages +
      counts.notifications +
      counts.announcements +
      counts.tickets;

    return createSuccessResponse(
      counts,
      "Sidebar counts retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});
