/**
 * PropertyPro - Notifications API
 * Handle notification management and automation rules
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Notification, Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createPaginationInfo,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  notificationService,
  NotificationType,
  NotificationPriority,
} from "@/lib/notification-service";
import { notificationAutomation } from "@/lib/notification-automation";
import {
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  buildNotificationVisibilityFilter,
  mergeNotificationFilters,
} from "@/lib/notification-visibility";
import { businessDayEnd, businessDayStart, parseBusinessDay } from "@/lib/dates/business-day";

export const dynamic = "force-dynamic";

const CATEGORY_TYPE_PREFIXES = {
  payments: ["payment_"],
  leases: ["lease_"],
  maintenance: ["maintenance_"],
} as const;

function buildCategoryClause(category: string): Record<string, any> | null {
  if (category === "system") {
    return {
      NOT: {
        OR: [
          { type: { startsWith: "payment_", mode: "insensitive" } },
          { type: { startsWith: "lease_", mode: "insensitive" } },
          { type: { startsWith: "maintenance_", mode: "insensitive" } },
        ],
      },
    };
  }

  const prefixes =
    CATEGORY_TYPE_PREFIXES[category as keyof typeof CATEGORY_TYPE_PREFIXES];
  if (!prefixes) return null;

  return {
    OR: prefixes.map((prefix) => ({
      type: { startsWith: prefix, mode: "insensitive" },
    })),
  };
}

function serializeNotification(notification: Notification) {
  return {
    id: notification.id,
    title: notification.title,
    message: notification.message,
    type: notification.type,
    priority: notification.priority,
    read: notification.read,
    readAt: notification.readAt ?? null,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
    actionUrl: notification.actionUrl,
    metadata: (notification.metadata as Record<string, any>) ?? {},
  };
}

/** Staff holding Company settings: the right POST and PUT ask for below. */
function canManageAutomation(user: AuthenticatedAccessUser): boolean {
  return (
    user.isCompanyStaff && user.permissions.includes("company_settings")
  );
}

// GET /api/notifications - Get notification history and automation rules
export const GET = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any },
) => {
  try {
    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type");

    // Automation rules and the schedule are the office's settings, which
    // creating and switching rules already asks Company settings for. Only
    // tenants were turned away here, so owners and every member of staff
    // read them — and could delete one below.
    if (type === "automation-rules") {
      if (!canManageAutomation(user)) {
        return createErrorResponse("Forbidden", 403);
      }

      // Get automation rules
      const rules = notificationAutomation.getAllRules();
      return createSuccessResponse(rules);
    }

    if (type === "scheduled") {
      if (!canManageAutomation(user)) {
        return createErrorResponse("Forbidden", 403);
      }

      // Get scheduled notifications (placeholder - would fetch from database)
      const scheduledNotifications: unknown[] = []; // TODO: Implement database storage
      return createSuccessResponse(scheduledNotifications);
    }

    const includeRead = searchParams.get("includeRead") === "true";
    const status = searchParams.get("status");
    const category = searchParams.get("category");
    const priority = searchParams.get("priority");
    const search = searchParams.get("search")?.trim();
    const dateFrom = searchParams.get("dateFrom");
    const dateTo = searchParams.get("dateTo");
    const page = Math.max(
      Number.parseInt(searchParams.get("page") || "1", 10) || 1,
      1,
    );
    const limit = Math.min(
      Number.parseInt(searchParams.get("limit") || "20", 10) || 20,
      100,
    );
    const skip = (page - 1) * limit;

    const visibility = await buildNotificationVisibilityFilter(
      user,
      context?.tenantProfile,
    );
    const clauses: Record<string, any>[] = [visibility.where];

    if (status === "unread") {
      clauses.push({ read: false });
    } else if (status === "read") {
      clauses.push({ read: true });
    } else if (!includeRead) {
      clauses.push({ read: false });
    }

    if (category) {
      const categoryClause = buildCategoryClause(category);
      if (categoryClause) {
        clauses.push(categoryClause);
      }
    }

    if (priority === "high") {
      clauses.push({ priority: { in: ["high", "critical"] } });
    } else if (
      priority &&
      ["low", "normal", "medium", "high", "critical"].includes(priority)
    ) {
      clauses.push({ priority });
    }

    if (search) {
      clauses.push({
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { message: { contains: search, mode: "insensitive" } },
          { type: { contains: search, mode: "insensitive" } },
          {
            metadata: {
              path: ["propertyName"],
              string_contains: search,
              mode: "insensitive",
            },
          },
        ],
      });
    }

    if (dateFrom || dateTo) {
      const createdAt: Record<string, Date> = {};

      // Whole days on the office's calendar (Riyadh).
      const fromDay = parseBusinessDay(dateFrom);
      if (fromDay) createdAt.gte = businessDayStart(fromDay);

      const toDay = parseBusinessDay(dateTo);
      if (toDay) createdAt.lte = businessDayEnd(toDay);

      if (Object.keys(createdAt).length > 0) {
        clauses.push({ createdAt });
      }
    }

    const filter = mergeNotificationFilters(
      ...clauses,
    ) as Prisma.NotificationWhereInput;
    const unreadFilter = mergeNotificationFilters(visibility.where, {
      read: false,
    }) as Prisma.NotificationWhereInput;

    let serialized: ReturnType<typeof serializeNotification>[];
    let unreadCount: number;
    let filteredCount: number;

    if (!visibility.isRestricted) {
      const [notifications, unread, total] = await Promise.all([
        db.notification.findMany({
          where: filter,
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        db.notification.count({ where: unreadFilter }),
        db.notification.count({ where: filter }),
      ]);

      serialized = notifications.map(serializeNotification);
      unreadCount = unread;
      filteredCount = total;
    } else {
      // Tenant callers: the metadata-based visibility rules live in Json and
      // cannot be expressed in the where clause, so the visibility filtering
      // happens in JS — over a bounded window of the newest rows (capped
      // below), not an unbounded fetch of every matching notification.
      // Counts and pagination are therefore relative to that window.
      const RESTRICTED_FETCH_CAP = 500;
      const [allMatching, allUnread] = await Promise.all([
        db.notification.findMany({
          where: filter,
          orderBy: { createdAt: "desc" },
          take: RESTRICTED_FETCH_CAP,
        }),
        db.notification.findMany({
          where: unreadFilter,
          orderBy: { createdAt: "desc" },
          take: RESTRICTED_FETCH_CAP,
        }),
      ]);

      const visible = allMatching.filter((notification) =>
        visibility.matches(notification),
      );
      filteredCount = visible.length;
      unreadCount = allUnread.filter((notification) =>
        visibility.matches(notification),
      ).length;
      serialized = visible.slice(skip, skip + limit).map(serializeNotification);
    }

    return createSuccessResponse(
      {
        notifications: serialized,
        unreadCount,
        totalCount: filteredCount,
        metrics: {
          highPriority: serialized.filter((n) =>
            ["high", "critical"].includes(n.priority),
          ).length,
          lastUpdated: serialized.length > 0 ? serialized[0].createdAt : null,
        },
      },
      undefined,
      createPaginationInfo(page, limit, filteredCount),
    );
  } catch (error) {
    console.error("Failed to fetch notifications:", error);
    return createErrorResponse("Failed to fetch notifications", 500);
  }
});

// POST /api/notifications - Send notification or create automation rule
export const POST = withPermissionAndDB("company_settings")(async (
  _user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    const { action, ...data } = body;

    switch (action) {
      case "send-notification":
        return await handleSendNotification(data);

      case "create-automation-rule":
        return await handleCreateAutomationRule(data);

      case "schedule-notification":
        return await handleScheduleNotification(data);

      default:
        return createErrorResponse("Invalid action", 400);
    }
  } catch (error) {
    console.error("Failed to process notification request:", error);
    return createErrorResponse("Failed to process notification request", 500);
  }
});

// PUT /api/notifications - Update automation rule
export const PUT = withPermissionAndDB("company_settings")(async (
  _user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    const { ruleId, enabled } = body;

    if (!ruleId) {
      return createErrorResponse("Rule ID is required", 400);
    }

    const updated = notificationAutomation.toggleRule(ruleId, enabled);

    if (!updated) {
      return createErrorResponse("Automation rule not found", 404);
    }

    return createSuccessResponse({
      message: `Automation rule ${enabled ? "enabled" : "disabled"}`,
      ruleId,
      enabled,
    });
  } catch (error) {
    console.error("Failed to update automation rule:", error);
    return createErrorResponse("Failed to update automation rule", 500);
  }
});

export const PATCH = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any },
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    const visibility = await buildNotificationVisibilityFilter(
      user,
      context?.tenantProfile,
    );
    const { notificationIds, read = true, markAll = false } = body ?? {};

    const update = {
      read,
      readAt: read ? new Date() : null,
    };

    let validIds: string[] | null = null;

    if (!markAll) {
      if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
        return createErrorResponse(
          "notificationIds is required unless markAll is true",
          400,
        );
      }

      validIds = notificationIds.filter(
        (id: unknown): id is string =>
          typeof id === "string" && isValidObjectId(id),
      );

      if (validIds.length === 0) {
        return createErrorResponse("No valid notification ids provided", 400);
      }
    }

    const scopedWhere = (validIds
      ? mergeNotificationFilters(visibility.where, { id: { in: validIds } })
      : visibility.where) as Prisma.NotificationWhereInput;

    let modifiedCount = 0;

    if (!visibility.isRestricted) {
      const result = await db.notification.updateMany({
        where: scopedWhere,
        data: update,
      });
      modifiedCount = result.count;
    } else {
      const candidates = await db.notification.findMany({
        where: scopedWhere,
        select: { id: true, type: true, metadata: true },
      });
      const visibleIds = candidates
        .filter((notification) => visibility.matches(notification))
        .map((notification) => notification.id);

      if (visibleIds.length > 0) {
        const result = await db.notification.updateMany({
          where: { id: { in: visibleIds } },
          data: update,
        });
        modifiedCount = result.count;
      }
    }

    return createSuccessResponse({
      modifiedCount,
      read,
      markAll,
    });
  } catch (error) {
    console.error("Failed to update notifications:", error);
    return createErrorResponse("Failed to update notifications", 500);
  }
});

// DELETE /api/notifications - Delete automation rule or bulk delete notifications
export const DELETE = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any },
) => {
  try {
    const { searchParams } = new URL(request.url);
    const ruleId = searchParams.get("ruleId");
    const notificationIds = searchParams.get("ids");

    // Bulk delete notifications
    if (notificationIds) {
      const visibility = await buildNotificationVisibilityFilter(
        user,
        context?.tenantProfile,
      );
      const ids = notificationIds
        .split(",")
        .map((id) => id.trim())
        .filter((id) => isValidObjectId(id));

      if (ids.length === 0) {
        return createErrorResponse("No valid notification IDs provided", 400);
      }

      const scopedWhere = mergeNotificationFilters(visibility.where, {
        id: { in: ids },
      }) as Prisma.NotificationWhereInput;

      let deletedCount = 0;

      if (!visibility.isRestricted) {
        const result = await db.notification.deleteMany({ where: scopedWhere });
        deletedCount = result.count;
      } else {
        const candidates = await db.notification.findMany({
          where: scopedWhere,
          select: { id: true, type: true, metadata: true },
        });
        const visibleIds = candidates
          .filter((notification) => visibility.matches(notification))
          .map((notification) => notification.id);

        if (visibleIds.length > 0) {
          const result = await db.notification.deleteMany({
            where: { id: { in: visibleIds } },
          });
          deletedCount = result.count;
        }
      }

      return createSuccessResponse({
        message: `${deletedCount} notification(s) deleted`,
        deletedCount,
      });
    }

    // Delete automation rule: the right creating one asks for.
    if (!ruleId) {
      return createErrorResponse("Rule ID or notification IDs required", 400);
    }

    if (!canManageAutomation(user)) {
      return createErrorResponse("Forbidden", 403);
    }

    const deleted = notificationAutomation.removeRule(ruleId);

    if (!deleted) {
      return createErrorResponse("Automation rule not found", 404);
    }

    return createSuccessResponse({
      message: "Automation rule deleted",
      ruleId,
    });
  } catch (error) {
    console.error("Failed to delete:", error);
    return createErrorResponse("Failed to delete", 500);
  }
});

// Handle send notification
async function handleSendNotification(data: any): Promise<NextResponse> {
  const {
    type,
    priority = NotificationPriority.NORMAL,
    userId,
    title,
    message,
    notificationData = {},
  } = data;

  if (!type || !userId || !title || !message) {
    return createErrorResponse(
      "Missing required fields: type, userId, title, message",
      400,
    );
  }

  const success = await notificationService.sendNotification({
    type: type as NotificationType,
    priority: priority as NotificationPriority,
    userId,
    title,
    message,
    data: notificationData,
  });

  if (success) {
    return createSuccessResponse({ message: "Notification sent successfully" });
  } else {
    return createErrorResponse("Failed to send notification", 500);
  }
}

// Handle create automation rule
async function handleCreateAutomationRule(data: any): Promise<NextResponse> {
  const { name, type, trigger, conditions, schedule, enabled = true } = data;

  if (!name || !type || !trigger || !conditions) {
    return createErrorResponse(
      "Missing required fields: name, type, trigger, conditions",
      400,
    );
  }

  const ruleId = `custom_${Date.now()}`;

  notificationAutomation.addRule({
    id: ruleId,
    name,
    type: type as NotificationType,
    trigger,
    conditions,
    schedule,
    enabled,
  });

  return createSuccessResponse({
    message: "Automation rule created successfully",
    ruleId,
  });
}

// Handle schedule notification
async function handleScheduleNotification(data: any): Promise<NextResponse> {
  const { type, userId, scheduledFor, notificationData = {} } = data;

  if (!type || !userId || !scheduledFor) {
    return createErrorResponse(
      "Missing required fields: type, userId, scheduledFor",
      400,
    );
  }

  const scheduledDate = new Date(scheduledFor);
  if (scheduledDate <= new Date()) {
    return createErrorResponse("Scheduled time must be in the future", 400);
  }

  const notificationId = await notificationService.scheduleNotification(
    type as NotificationType,
    userId,
    scheduledDate,
    notificationData,
  );

  return createSuccessResponse({
    message: "Notification scheduled successfully",
    notificationId,
  });
}
