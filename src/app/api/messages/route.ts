/**
 * PropertyPro - Messages API Routes
 * CRUD operations for tenant-property manager messaging
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Message as MessageRow, Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  parsePaginationParams,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  activeParticipantIds,
  buildLastMessagePayload,
  bumpConversationMetadata,
  getActiveParticipant,
  parseParticipants,
  participantsAsJson,
} from "@/lib/messaging/conversations";

const USER_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
} as const;

/**
 * Rebuild the populated shapes the Mongoose route returned: senderId /
 * recipientId / mentions become user objects, replyToId / forwardedFromId
 * become message previews, conversationId (search results) becomes
 * `{ name, type }`.
 */
async function populateMessages(
  messages: MessageRow[],
  options: { conversation?: boolean } = {}
): Promise<Record<string, unknown>[]> {
  const userIds = new Set<string>();
  const messageRefIds = new Set<string>();
  const conversationIds = new Set<string>();

  for (const message of messages) {
    userIds.add(message.senderId);
    if (message.recipientId) userIds.add(message.recipientId);
    for (const mention of message.mentions ?? []) userIds.add(mention);
    if (message.replyToId) messageRefIds.add(message.replyToId);
    if (message.forwardedFromId) messageRefIds.add(message.forwardedFromId);
    if (options.conversation) conversationIds.add(message.conversationId);
  }

  const [users, referencedMessages, conversations] = await Promise.all([
    userIds.size > 0
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
          select: USER_SUMMARY_SELECT,
        })
      : Promise.resolve([]),
    messageRefIds.size > 0
      ? db.message.findMany({
          where: { id: { in: [...messageRefIds] } },
          select: {
            id: true,
            subject: true,
            content: true,
            senderId: true,
            createdAt: true,
          },
        })
      : Promise.resolve([]),
    conversationIds.size > 0
      ? db.conversation.findMany({
          where: { id: { in: [...conversationIds] } },
          select: { id: true, name: true, type: true },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const messageRefMap = new Map(referencedMessages.map((m) => [m.id, m]));
  const conversationMap = new Map(conversations.map((c) => [c.id, c]));

  return messages.map((message) => ({
    ...message,
    senderId: userMap.get(message.senderId) ?? message.senderId,
    recipientId: message.recipientId
      ? userMap.get(message.recipientId) ?? message.recipientId
      : message.recipientId,
    mentions: (message.mentions ?? []).map(
      (mention) => userMap.get(mention) ?? mention
    ),
    replyToId: message.replyToId
      ? messageRefMap.get(message.replyToId) ?? message.replyToId
      : message.replyToId,
    forwardedFromId: message.forwardedFromId
      ? messageRefMap.get(message.forwardedFromId) ?? message.forwardedFromId
      : message.forwardedFromId,
    ...(options.conversation
      ? {
          conversationId:
            conversationMap.get(message.conversationId) ??
            message.conversationId,
        }
      : {}),
  }));
}

// ============================================================================
// GET /api/messages - Get user's conversations or messages
// ============================================================================

export const GET = withAccessAndDB({})(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { searchParams } = new URL(request.url);

    const conversationId = searchParams.get("conversationId");
    const type = searchParams.get("type") ?? "messages"; // "messages" or "search"
    const search = searchParams.get("search");
    const messageType = searchParams.get("messageType");
    const beforeDate = searchParams.get("beforeDate");
    const afterDate = searchParams.get("afterDate");

    if (type === "search" && search) {
      // Search messages the user is involved in
      const { page, limit } = parsePaginationParams(searchParams);

      const rows = await db.message.findMany({
        where: {
          AND: [
            {
              OR: [
                { senderId: user.id },
                { recipientId: user.id },
                { mentions: { has: user.id } },
              ],
            },
            {
              OR: [
                { content: { contains: search, mode: "insensitive" } },
                { subject: { contains: search, mode: "insensitive" } },
              ],
            },
          ],
          deletedAt: null,
          ...(conversationId ? { conversationId } : {}),
          ...(messageType ? { messageType } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
      });

      const messages = await populateMessages(rows, { conversation: true });

      return createSuccessResponse({
        messages,
        searchQuery: search,
        pagination: {
          page,
          limit,
          total: messages.length,
        },
      });
    } else if (conversationId) {
      // Get messages in a specific conversation
      const { page, limit } = parsePaginationParams(searchParams);

      // Validate conversation access
      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });
      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);
      const isParticipant = Boolean(getActiveParticipant(participants, user.id));
      if (!isParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      // Build query
      const createdAtFilter: Record<string, Date> = {};
      if (beforeDate) createdAtFilter.lt = new Date(beforeDate);
      if (afterDate) createdAtFilter.gt = new Date(afterDate);

      const rows = await db.message.findMany({
        where: {
          conversationId,
          deletedAt: null,
          ...(Object.keys(createdAtFilter).length > 0
            ? { createdAt: createdAtFilter }
            : {}),
          ...(messageType ? { messageType } : {}),
        },
        orderBy: { createdAt: "desc" },
        skip: ((page ?? 1) - 1) * (limit ?? 50),
        take: limit,
      });

      const messages = await populateMessages(rows);

      // Mark messages as delivered for the current user
      await db.messageStatus.updateMany({
        where: {
          conversationId,
          recipientId: user.id,
          status: "sent",
        },
        data: {
          status: "delivered",
          deliveredAt: new Date(),
        },
      });

      // Update conversation read status (participant lastReadAt)
      const nextParticipants = participants.map((participant) =>
        String(participant.userId) === user.id
          ? { ...participant, lastReadAt: new Date().toISOString() }
          : participant
      );
      await db.conversation.update({
        where: { id: conversationId },
        data: {
          participants: participantsAsJson(nextParticipants),
          participantIds: activeParticipantIds(nextParticipants),
        },
      });

      return createSuccessResponse({
        messages,
        conversationId,
        pagination: {
          page,
          limit,
          total: await db.message.count({
            where: { conversationId, deletedAt: null },
          }),
        },
      });
    } else {
      return createErrorResponse("conversationId is required", 400);
    }
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/messages - Send a new message
// ============================================================================

export const POST = withAccessAndDB({})(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    const {
      conversationId,
      content,
      messageType = "general",
      priority = "normal",
      attachments = [],
      replyToId,
      mentions = [],
    } = body;

    // Validate required fields
    if (!conversationId || !content) {
      return createErrorResponse(
        "Conversation ID and content are required",
        400,
      );
    }

    // Validate conversation exists and user is a participant
    const conversation = await db.conversation.findFirst({
      where: { id: conversationId, deletedAt: null },
    });
    if (!conversation) {
      return createErrorResponse("Conversation not found", 404);
    }

    const participants = parseParticipants(conversation.participants);
    const isParticipant = Boolean(getActiveParticipant(participants, user.id));
    if (!isParticipant) {
      return createErrorResponse(
        "You are not a participant in this conversation",
        403,
      );
    }

    // Validate reply-to message if provided
    if (replyToId) {
      const originalMessage = await db.message.findFirst({
        where: { id: replyToId, deletedAt: null },
      });
      if (!originalMessage) {
        return createErrorResponse("Original message not found", 404);
      }

      // Ensure reply is in the same conversation
      if (originalMessage.conversationId !== conversationId) {
        return createErrorResponse(
          "Reply message must be in the same conversation",
          400,
        );
      }
    }

    // Validate mentions
    if (mentions && mentions.length > 0) {
      const mentionedUsers = await db.user.findMany({
        where: { id: { in: mentions } },
        select: { id: true },
      });
      if (mentionedUsers.length !== mentions.length) {
        return createErrorResponse(
          "One or more mentioned users not found",
          400,
        );
      }

      // Ensure mentioned users are participants in the conversation
      const participantIds = activeParticipantIds(participants);

      const invalidMentions = (mentions as string[]).filter(
        (id: string) => !participantIds.includes(id),
      );
      if (invalidMentions.length > 0) {
        return createErrorResponse(
          "Mentioned users must be participants in the conversation",
          400,
        );
      }
    }

    // Create the message
    const message = await db.message.create({
      data: {
        organizationId: user.organizationId!,
        conversationId,
        senderId: user.id,
        content,
        messageType,
        priority,
        attachments: attachments as Prisma.InputJsonValue,
        replyToId: replyToId ?? null,
        mentions,
        metadata: {
          ipAddress: request.headers.get("x-forwarded-for") ?? "unknown",
          userAgent: request.headers.get("user-agent") ?? "unknown",
          platform: "web",
        },
      },
    });

    // Create message status (per-recipient receipt row) for each active
    // participant except the sender
    const recipients = participants.filter(
      (participant) =>
        participant.isActive && String(participant.userId) !== user.id,
    );

    if (recipients.length > 0) {
      await db.messageStatus.createMany({
        data: recipients.map((participant) => ({
          organizationId: user.organizationId!,
          messageId: message.id,
          conversationId,
          senderId: user.id,
          recipientId: String(participant.userId),
          status: "sent",
        })),
      });
    }

    // Update the conversation's lastMessage cache + metadata counters
    // (replaces the old Message post-save hook)
    const senderFullName =
      [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
      user.email ||
      "Unknown";
    await db.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessage: buildLastMessagePayload(message, senderFullName),
        metadata: bumpConversationMetadata(
          conversation.metadata,
        ) as Prisma.InputJsonValue,
      },
    });

    // Populate the response
    const [populatedMessage] = await populateMessages([message]);

    // In a real implementation, you would send real-time notifications here
    // This would be handled by Socket.io in the actual implementation

    return createSuccessResponse(
      {
        message: populatedMessage,
        conversation: {
          _id: conversation.id,
          name: conversation.name,
          type: conversation.type,
        },
      },
      "Message sent successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});
