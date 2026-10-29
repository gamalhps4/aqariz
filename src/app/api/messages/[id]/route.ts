/**
 * PropertyPro - Individual Message API Routes
 * Operations for individual messages
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope, type ScopeActor } from "@/lib/db/scopes";
import type { Message as MessageRow } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";

const USER_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

/** Rebuild the populated shapes the old route returned. */
async function populateMessage(
  message: MessageRow,
  actor: ScopeActor,
): Promise<Record<string, unknown>> {
  const userIds = new Set<string>([message.senderId]);
  if (message.recipientId) userIds.add(message.recipientId);

  const [users, property, replyTo] = await Promise.all([
    db.user.findMany({
      where: { id: { in: [...userIds] } },
      select: USER_SUMMARY_SELECT,
    }),
    message.propertyId
      ? db.property.findFirst({
          // Scoped: the message itself is already this caller's to read, but
          // its building's name and street address are not automatically —
          // out of scope, the property simply drops out of the response.
          where: withScope({ id: message.propertyId }, propertyScope(actor)),
          select: {
            id: true,
            name: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
            addressCountry: true,
          },
        })
      : Promise.resolve(null),
    message.replyToId
      ? db.message.findFirst({
          where: { id: message.replyToId },
          select: { id: true, subject: true, content: true, senderId: true },
        })
      : Promise.resolve(null),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));

  return {
    ...message,
    senderId: userMap.get(message.senderId) ?? message.senderId,
    recipientId: message.recipientId
      ? userMap.get(message.recipientId) ?? message.recipientId
      : message.recipientId,
    propertyId: property
      ? {
          id: property.id,
          name: property.name,
          address: {
            street: property.addressStreet,
            city: property.addressCity,
            state: property.addressState,
            zipCode: property.addressZipCode,
            country: property.addressCountry,
          },
        }
      : message.propertyId,
    replyToId: replyTo ?? message.replyToId,
  };
}

// ============================================================================
// GET /api/messages/[id] - Get a specific message
// ============================================================================

export const GET = withAccessAndDB({})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid message ID", 400);
      }

      // Find the message
      let message = await db.message.findFirst({
        where: { id, deletedAt: null },
      });

      if (!message) {
        return createErrorResponse("Message not found", 404);
      }

      // Check permissions - user must be sender or recipient
      const canAccess =
        message.senderId === user.id ||
        message.recipientId === user.id ||
        user.isAdmin;

      if (!canAccess) {
        return createErrorResponse("Access denied", 403);
      }

      // Mark as read if user is the recipient
      if (message.recipientId === user.id && message.status !== "read") {
        const now = new Date();
        message = await db.message.update({
          where: { id },
          data: {
            status: "read",
            readAt: now,
            ...(message.deliveredAt ? {} : { deliveredAt: now }),
          },
        });
      }

      return createSuccessResponse({ message: await populateMessage(message, user) });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/messages/[id] - Update message status
// ============================================================================

export const PUT = withAccessAndDB({})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid message ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const { action } = body;

      // Find the message
      let message = await db.message.findFirst({
        where: { id, deletedAt: null },
      });
      if (!message) {
        return createErrorResponse("Message not found", 404);
      }

      // Check permissions
      const canUpdate =
        message.senderId === user.id ||
        message.recipientId === user.id ||
        user.isAdmin;

      if (!canUpdate) {
        return createErrorResponse("Access denied", 403);
      }

      const now = new Date();

      // Handle different actions
      switch (action) {
        case "mark_read":
          if (message.recipientId === user.id) {
            message = await db.message.update({
              where: { id },
              data: {
                status: "read",
                readAt: now,
                ...(message.deliveredAt ? {} : { deliveredAt: now }),
              },
            });
          } else {
            return createErrorResponse(
              "Only recipient can mark message as read",
              403
            );
          }
          break;

        case "mark_delivered":
          if (message.recipientId === user.id) {
            if (message.status === "sent") {
              message = await db.message.update({
                where: { id },
                data: { status: "delivered", deliveredAt: now },
              });
            }
          } else {
            return createErrorResponse(
              "Only recipient can mark message as delivered",
              403
            );
          }
          break;

        default:
          return createErrorResponse("Invalid action", 400);
      }

      // Populate and return updated message
      return createSuccessResponse(
        { message: await populateMessage(message, user) },
        `Message ${String(action).replace("_", " ")} successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/messages/[id] - Delete a message (soft delete)
// ============================================================================

export const DELETE = withAccessAndDB({})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid message ID", 400);
      }

      // Find the message
      const message = await db.message.findFirst({
        where: { id, deletedAt: null },
      });
      if (!message) {
        return createErrorResponse("Message not found", 404);
      }

      // Check permissions - only sender can delete their own messages
      const canDelete = message.senderId === user.id || user.isAdmin;

      if (!canDelete) {
        return createErrorResponse(
          "Only the sender can delete this message",
          403
        );
      }

      // Soft delete
      await db.message.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return createSuccessResponse(null, "Message deleted successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);
