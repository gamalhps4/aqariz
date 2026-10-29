/**
 * PropertyPro - Messages API Routes
 * Handle CRUD operations for conversation messages
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  isValidObjectId,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  activeParticipantIds,
  buildLastMessagePayload,
  bumpConversationMetadata,
  getActiveParticipant,
  parseParticipants,
  participantsAsJson,
} from "@/lib/messaging/conversations";
import { publish } from "@/lib/realtime/bus";
import { sendPushToUsers } from "@/lib/push/send";

const SENDER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
} as const;

// GET /api/conversations/[id]/messages - Get messages for a conversation
export const GET = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;
      if (!conversationId || !isValidObjectId(conversationId)) {
        return NextResponse.json(
          { error: "Invalid conversation ID" },
          { status: 400 }
        );
      }
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = parseInt(searchParams.get("limit") || "50");
      const skip = (page - 1) * limit;

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
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      // Get messages with pagination
      const rows = await db.message.findMany({
        where: { conversationId, deletedAt: null },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: { sender: { select: SENDER_SELECT } },
      });

      const messages = rows.map(({ sender, ...message }) => ({
        ...message,
        _id: message.id,
        senderId: sender ?? message.senderId,
      }));

      // Get total count for pagination
      const total = await db.message.count({
        where: { conversationId, deletedAt: null },
      });

      return NextResponse.json({
        messages: messages.reverse(), // Reverse to show oldest first
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
          hasNext: page * limit < total,
          hasPrev: page > 1,
        },
      });
    } catch (error) {
      console.error("Get messages error:", error);
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500 }
      );
    }
  }
);

// POST /api/conversations/[id]/messages - Send a new message
export const POST = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;
      if (!conversationId || !isValidObjectId(conversationId)) {
        return NextResponse.json(
          { error: "Invalid conversation ID" },
          { status: 400 }
        );
      }
      const body = await request.json();
      const {
        content,
        messageType = "general",
        priority = "normal",
        attachments = [],
      } = body;

      // Validate input
      if (!content || content.trim().length === 0) {
        return NextResponse.json(
          { error: "Message content is required" },
          { status: 400 }
        );
      }

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
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      // Create new message
      const message = await db.message.create({
        data: {
          organizationId: user.organizationId!,
          conversationId,
          senderId: user.id,
          content: content.trim(),
          messageType,
          priority,
          attachments: attachments as Prisma.InputJsonValue,
          status: "sent",
          isSystemMessage: false,
          isEdited: false,
        },
        include: { sender: { select: SENDER_SELECT } },
      });

      const senderFullName =
        [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
        user.email ||
        "Unknown User";

      // Update conversation's lastMessage cache + metadata counters
      // (replaces the old Message post-save hook)
      await db.conversation.update({
        where: { id: conversationId },
        data: {
          lastMessage: buildLastMessagePayload(message, senderFullName),
          metadata: bumpConversationMetadata(
            conversation.metadata
          ) as Prisma.InputJsonValue,
        },
      });

      const messagePayload = {
        _id: message.id,
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.sender ?? message.senderId,
        content: message.content,
        messageType: message.messageType,
        priority: message.priority,
        attachments: message.attachments,
        status: message.status,
        isSystemMessage: message.isSystemMessage,
        isEdited: message.isEdited,
        createdAt: message.createdAt,
        updatedAt: message.updatedAt,
      };

      // Publish realtime event to all conversation participants
      const participantIds: string[] = conversation.participantIds ?? [];

      publish({
        type: "message.created",
        conversationId: String(conversationId),
        participantIds,
        message: messagePayload,
      });

      // Fire web push to other participants (fire-and-forget)
      const recipientIds = participantIds.filter((id) => id !== user.id);
      if (recipientIds.length > 0) {
        void sendPushToUsers(recipientIds, {
          title: senderFullName,
          body: message.content.slice(0, 160),
          url: `/dashboard/messages?conversation=${conversationId}`,
          tag: `conversation-${conversationId}`,
        });
      }

      return NextResponse.json({ message: messagePayload }, { status: 201 });
    } catch (error) {
      console.error("Send message error:", error);
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500 }
      );
    }
  }
);

// PUT /api/conversations/[id]/messages - Update message status (mark as read)
export const PUT = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;
      if (!conversationId || !isValidObjectId(conversationId)) {
        return NextResponse.json(
          { error: "Invalid conversation ID" },
          { status: 400 }
        );
      }
      const body = await request.json();
      const { action, messageIds } = body;

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

      const participants = parseParticipants(conversation.participants);
      const activeParticipant = getActiveParticipant(participants, user.id);

      if (!activeParticipant) {
        return NextResponse.json({ error: "Access denied" }, { status: 403 });
      }

      if (action === "mark_as_read" && messageIds && Array.isArray(messageIds)) {
        const validMessageIds = messageIds.filter(
          (id: unknown): id is string =>
            typeof id === "string" && isValidObjectId(id)
        );

        if (validMessageIds.length === 0) {
          return NextResponse.json(
            { error: "No valid message IDs provided" },
            { status: 400 }
          );
        }

        const now = new Date();

        // Mark messages as read (readBy is a Json array — append per row,
        // deduped by userId)
        const targets = await db.message.findMany({
          where: {
            id: { in: validMessageIds },
            conversationId,
            senderId: { not: user.id }, // Don't mark own messages as read
          },
          select: { id: true, readBy: true },
        });

        await Promise.all(
          targets.map((target) => {
            const readBy = Array.isArray(target.readBy)
              ? (target.readBy as Array<Record<string, unknown>>)
              : [];
            const alreadyRead = readBy.some(
              (entry) => entry && entry.userId === user.id
            );
            return db.message.update({
              where: { id: target.id },
              data: {
                status: "read",
                readAt: now,
                ...(alreadyRead
                  ? {}
                  : {
                      readBy: [
                        ...readBy,
                        { userId: user.id, readAt: now.toISOString() },
                      ] as Prisma.InputJsonValue,
                    }),
              },
            });
          })
        );

        // Update the participant's lastReadAt in the conversation
        const nextParticipants = participants.map((participant) =>
          String(participant.userId) === user.id
            ? { ...participant, lastReadAt: now.toISOString() }
            : participant
        );
        await db.conversation.update({
          where: { id: conversationId },
          data: {
            participants: participantsAsJson(nextParticipants),
            participantIds: activeParticipantIds(nextParticipants),
          },
        });

        return NextResponse.json({ success: true, action: "marked_as_read" });
      }

      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    } catch (error) {
      console.error("Update messages error:", error);
      return NextResponse.json(
        { error: "Failed to update messages" },
        { status: 500 }
      );
    }
  }
);
