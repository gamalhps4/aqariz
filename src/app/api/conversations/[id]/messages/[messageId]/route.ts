/**
 * PropertyPro - Individual Message API Routes
 * Handle operations on specific messages (edit, delete, etc.)
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  buildLastMessagePayload,
  canParticipantDeleteMessages,
  getActiveParticipant,
  parseParticipants,
} from "@/lib/messaging/conversations";

const SENDER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
} as const;

function withPopulatedSender<
  T extends { sender?: Record<string, unknown> | null; senderId: string }
>({ sender, ...message }: T) {
  return { ...message, senderId: sender ?? message.senderId };
}

// GET /api/conversations/[id]/messages/[messageId] - Get specific message
export const GET = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    try {
      const { id: conversationId, messageId } = await params;

      // Verify user has access to this conversation
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const activeParticipant = getActiveParticipant(
        parseParticipants(conversation.participants),
        user.id
      );
      if (!activeParticipant) {
        return createErrorResponse("Access denied", 403);
      }

      // Get the specific message
      const message = await db.message.findFirst({
        where: { id: messageId, conversationId, deletedAt: null },
        include: { sender: { select: SENDER_SELECT } },
      });

      if (!message) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
      }

      return createSuccessResponse({ message: withPopulatedSender(message) });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// PUT /api/conversations/[id]/messages/[messageId] - Edit message
export const PUT = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    try {
      const { id: conversationId, messageId } = await params;
      const body = await request.json();
      const { content } = body;

      // Validate input
      if (!content || content.trim().length === 0) {
        return NextResponse.json(
          { error: "Message content is required" },
          { status: 400 }
        );
      }

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const activeParticipant = getActiveParticipant(
        parseParticipants(conversation.participants),
        user.id
      );
      if (!activeParticipant) {
        return createErrorResponse("Access denied", 403);
      }

      // Find the message
      const message = await db.message.findFirst({
        where: { id: messageId, conversationId, deletedAt: null },
      });

      if (!message) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
      }

      // Check if user is the sender
      if (message.senderId !== user.id) {
        return createErrorResponse("You can only edit your own messages", 403);
      }

      // Check if message is not too old (e.g., 15 minutes)
      const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
      if (message.createdAt < fifteenMinutesAgo) {
        return createErrorResponse("Message is too old to edit", 400);
      }

      // Update the message
      const updated = await db.message.update({
        where: { id: messageId },
        data: {
          content: content.trim(),
          isEdited: true,
          editedAt: new Date(),
        },
        include: { sender: { select: SENDER_SELECT } },
      });

      return createSuccessResponse({ message: withPopulatedSender(updated) });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// DELETE /api/conversations/[id]/messages/[messageId] - Delete message
export const DELETE = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; messageId: string }> }
  ) => {
    try {
      const { id: conversationId, messageId } = await params;

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });
      if (!conversation) {
        return NextResponse.json(
          { error: "Conversation not found" },
          { status: 404 }
        );
      }

      const participants = parseParticipants(conversation.participants);
      const activeParticipant = getActiveParticipant(participants, user.id);
      if (!activeParticipant) {
        return createErrorResponse("Access denied", 403);
      }

      // Find the message
      const message = await db.message.findFirst({
        where: { id: messageId, conversationId, deletedAt: null },
      });

      if (!message) {
        return NextResponse.json({ error: "Message not found" }, { status: 404 });
      }

      // Check if user is the sender or has conversation delete permissions
      const isOwner = message.senderId === user.id;
      const canDeleteMessages = canParticipantDeleteMessages(
        participants,
        user.id
      );

      if (!isOwner && !canDeleteMessages) {
        return NextResponse.json(
          { error: "You can only delete your own messages" },
          { status: 403 }
        );
      }

      // Soft delete - mark as deleted instead of removing
      await db.message.update({
        where: { id: messageId },
        data: { deletedAt: new Date(), deletedById: user.id },
      });

      // If this was the last message in conversation, update the lastMessage cache
      const lastMessage =
        conversation.lastMessage &&
        typeof conversation.lastMessage === "object" &&
        !Array.isArray(conversation.lastMessage)
          ? (conversation.lastMessage as Record<string, unknown>)
          : null;

      if (lastMessage && String(lastMessage.messageId) === messageId) {
        // Find the previous message
        const previousMessage = await db.message.findFirst({
          where: {
            conversationId,
            deletedAt: null,
            id: { not: messageId },
          },
          orderBy: { createdAt: "desc" },
          include: {
            sender: { select: { firstName: true, lastName: true, email: true } },
          },
        });

        if (previousMessage) {
          const senderName =
            [previousMessage.sender?.firstName, previousMessage.sender?.lastName]
              .filter(Boolean)
              .join(" ")
              .trim() ||
            previousMessage.sender?.email ||
            "Unknown User";

          await db.conversation.update({
            where: { id: conversationId },
            data: {
              lastMessage: buildLastMessagePayload(previousMessage, senderName),
            },
          });
        } else {
          await db.conversation.update({
            where: { id: conversationId },
            data: { lastMessage: Prisma.DbNull },
          });
        }
      }

      return createSuccessResponse(null, "Message deleted successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);
