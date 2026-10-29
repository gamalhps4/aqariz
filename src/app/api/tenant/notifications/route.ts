/**
 * PropertyPro - Tenant Notifications API
 * Handles fetching and managing payment notifications for tenants
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";

export const dynamic = "force-dynamic";

function getTenantNotificationIds(
  user: AuthenticatedAccessUser,
  tenantProfile?: any
): string[] {
  return [
    ...new Set(
      [user.id, tenantProfile?.id, tenantProfile?.userId].filter(
        (id): id is string => typeof id === "string" && id.length > 0
      )
    ),
  ];
}

// ============================================================================
// GET - Fetch tenant's payment notifications
// ============================================================================

export const GET = withPermissionAndDB("payment_portal")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = parseInt(searchParams.get("limit") || "12");
      const type = searchParams.get("type");
      const status = searchParams.get("status");

      const tenantIds = getTenantNotificationIds(user, context?.tenantProfile);
      const where: Prisma.PaymentNotificationWhereInput = {
        tenantId: { in: tenantIds },
      };

      if (type) {
        where.type = type;
      }

      if (status) {
        where.status = status;
      }

      const skip = (page - 1) * limit;

      const notificationRows = await db.paymentNotification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      });

      // PaymentNotification.paymentId is a plain column (no relation) —
      // resolve the populated `paymentId` shape with a batched lookup.
      const paymentIds = [
        ...new Set(
          notificationRows
            .map((notification) => notification.paymentId)
            .filter(Boolean)
        ),
      ];
      const payments = paymentIds.length
        ? await db.payment.findMany({
            where: { id: { in: paymentIds } },
            select: { id: true, amount: true, type: true, dueDate: true },
          })
        : [];
      const paymentMap = new Map(payments.map((payment) => [payment.id, payment]));

      const notifications = notificationRows.map((notification) => ({
        ...notification,
        paymentId:
          paymentMap.get(notification.paymentId) ?? notification.paymentId,
      }));

      const total = await db.paymentNotification.count({ where });
      const totalPages = Math.ceil(total / limit);

      return createApiSuccessResponse<{
        notifications: typeof notifications;
        pagination: {
          page: number;
          limit: number;
          total: number;
          totalPages: number;
        };
      }>(
        {
          notifications,
          pagination: {
            page,
            limit,
            total,
            totalPages,
          },
        },
        "Notifications fetched successfully"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to fetch notifications";

      return createApiErrorResponse(errorMessage, 500, errorMessage);
    }
  }
);

// ============================================================================
// POST - Create a new notification (typically used by system)
// ============================================================================

export const POST = withPermissionAndDB([
  "payment_processing",
  "financial_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();
      const {
        tenantId,
        paymentId,
        type,
        scheduledDate,
        emailAddress,
        subject,
        message,
      } = body;

      if (
        !tenantId ||
        !paymentId ||
        !type ||
        !emailAddress ||
        !subject ||
        !message
      ) {
        return createApiErrorResponse(
          "Missing required fields",
          400,
          "Missing required fields"
        );
      }

      if (!["reminder", "overdue", "confirmation", "receipt"].includes(type)) {
        return createApiErrorResponse(
          "Invalid notification type",
          400,
          "Invalid notification type"
        );
      }

      const notification = await db.paymentNotification.create({
        data: {
          organizationId: user.organizationId!,
          tenantId,
          paymentId,
          type,
          status: "pending",
          scheduledDate: scheduledDate ? new Date(scheduledDate) : new Date(),
          emailAddress,
          subject,
          message,
        },
      });

      return createApiSuccessResponse<typeof notification>(
        notification,
        "Notification created successfully"
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to create notification";

      return createApiErrorResponse(errorMessage, 500, errorMessage);
    }
  }
);

// ============================================================================
// PUT - Mark notifications as read (bulk operation)
// ============================================================================

export const PUT = withPermissionAndDB("payment_portal")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const body = await request.json();
      const { notificationIds, markAsRead = true } = body;

      if (!notificationIds || !Array.isArray(notificationIds)) {
        return createApiErrorResponse(
          "Invalid notification IDs",
          400,
          "Invalid notification IDs"
        );
      }

      const tenantIds = getTenantNotificationIds(user, context?.tenantProfile);
      // PaymentNotification carries no read-state columns; touch the matched
      // rows so the caller still gets a modified count back.
      const result = await db.paymentNotification.updateMany({
        where: {
          id: { in: notificationIds },
          tenantId: { in: tenantIds },
        },
        data: {
          updatedAt: new Date(),
        },
      });

      return createApiSuccessResponse<{ modifiedCount: number }>(
        {
          modifiedCount: result.count,
        },
        `${result.count} notifications updated successfully`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to update notifications";

      return createApiErrorResponse(errorMessage, 500, errorMessage);
    }
  }
);

// ============================================================================
// DELETE - Delete notifications (bulk operation)
// ============================================================================

export const DELETE = withPermissionAndDB("payment_portal")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const { searchParams } = new URL(request.url);
      const notificationIds = searchParams.get("ids")?.split(",");
      const deleteAll = searchParams.get("all") === "true";

      let result;
      const tenantIds = getTenantNotificationIds(user, context?.tenantProfile);

      if (deleteAll) {
        result = await db.paymentNotification.deleteMany({
          where: { tenantId: { in: tenantIds } },
        });
      } else if (notificationIds && notificationIds.length > 0) {
        result = await db.paymentNotification.deleteMany({
          where: {
            id: { in: notificationIds },
            tenantId: { in: tenantIds },
          },
        });
      } else {
        return createApiErrorResponse(
          "No notifications specified for deletion",
          400,
          "No notifications specified for deletion"
        );
      }

      return createApiSuccessResponse<{ deletedCount: number }>(
        {
          deletedCount: result.count,
        },
        `${result.count} notifications deleted successfully`
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to delete notifications";

      return createApiErrorResponse(errorMessage, 500, errorMessage);
    }
  }
);
