/**
 * PropertyPro - Individual Notification API Routes
 * GET, PATCH, DELETE operations for individual notification management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  isValidObjectId,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  buildNotificationVisibilityFilter,
  mergeNotificationFilters,
} from "@/lib/notification-visibility";

export const dynamic = "force-dynamic";

// GET /api/notifications/[id] - Get notification details
export const GET = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  _request: NextRequest,
  {
    params,
    tenantProfile,
  }: { params: Promise<{ id: string }>; tenantProfile?: any },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid notification ID", 400);
    }

    const visibility = await buildNotificationVisibilityFilter(
      user,
      tenantProfile,
    );
    const notification = await db.notification.findFirst({
      where: mergeNotificationFilters(visibility.where, {
        id,
      }) as Prisma.NotificationWhereInput,
    });

    if (!notification || !visibility.matches(notification)) {
      return createErrorResponse("Notification not found", 404);
    }

    return createSuccessResponse({
      id: notification.id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      priority: notification.priority,
      read: notification.read,
      readAt: notification.readAt ?? null,
      createdAt: notification.createdAt,
      updatedAt: notification.updatedAt,
      actionUrl: notification.actionUrl ?? null,
      metadata: (notification.metadata as Record<string, any>) ?? {},
    });
  } catch (error) {
    console.error("Failed to fetch notification:", error);
    return createErrorResponse("Failed to fetch notification", 500);
  }
});

// DELETE /api/notifications/[id] - Delete a single notification
export const DELETE = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  _request: NextRequest,
  {
    params,
    tenantProfile,
  }: { params: Promise<{ id: string }>; tenantProfile?: any },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid notification ID", 400);
    }

    const visibility = await buildNotificationVisibilityFilter(
      user,
      tenantProfile,
    );
    const notification = await db.notification.findFirst({
      where: mergeNotificationFilters(visibility.where, {
        id,
      }) as Prisma.NotificationWhereInput,
    });

    if (!notification || !visibility.matches(notification)) {
      return createErrorResponse("Notification not found", 404);
    }

    await db.notification.deleteMany({ where: { id: notification.id } });

    return createSuccessResponse({
      message: "Notification deleted",
      id,
    });
  } catch (error) {
    console.error("Failed to delete notification:", error);
    return createErrorResponse("Failed to delete notification", 500);
  }
});
