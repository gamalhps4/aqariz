/**
 * PropertyPro - Individual Conversation API Routes
 * CRUD operations for specific conversations
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  activeParticipantIds,
  activeParticipantsCount,
  assertConversationInvariants,
  canParticipantDeleteConversation,
  canParticipantEditConversation,
  getActiveParticipant,
  parseParticipants,
  participantsAsJson,
  removeParticipantRecord,
  serializeConversations,
  unreadMessagesWhere,
  withParticipantMetadata,
} from "@/lib/messaging/conversations";
import { z } from "zod";

// Validation schemas
const updateConversationSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  settings: z
    .object({
      allowFileSharing: z.boolean().optional(),
      allowMemberInvites: z.boolean().optional(),
      muteNotifications: z.boolean().optional(),
      autoDeleteMessages: z.boolean().optional(),
      autoDeleteDays: z.number().min(1).max(365).optional(),
      requireApprovalForNewMembers: z.boolean().optional(),
    })
    .optional(),
  isArchived: z.boolean().optional(),
  isPinned: z.boolean().optional(),
  tags: z.array(z.string()).max(10).optional(),
});

// ============================================================================
// GET /api/conversations/[id] - Get specific conversation details
// ============================================================================

export const GET = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;

      if (!isValidObjectId(conversationId)) {
        return createErrorResponse("Invalid conversation ID", 400);
      }

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });

      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);
      const activeParticipant = getActiveParticipant(participants, user.id);
      if (!activeParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      // Get unread count for this user
      const unreadCount = await db.message.count({
        where: unreadMessagesWhere(conversation.id, user.id),
      });

      // Get recent messages count
      const recentMessagesCount = await db.message.count({
        where: { conversationId: conversation.id, deletedAt: null },
      });

      const [serialized] = await serializeConversations([conversation]);

      return createSuccessResponse({
        conversation: {
          ...serialized,
          unreadCount,
          recentMessagesCount,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to fetch conversation");
    }
  }
);

// ============================================================================
// PATCH /api/conversations/[id] - Update conversation
// ============================================================================

export const PATCH = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;

      if (!isValidObjectId(conversationId)) {
        return createErrorResponse("Invalid conversation ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = updateConversationSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation error: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });

      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);
      const activeParticipant = getActiveParticipant(participants, user.id);
      if (!activeParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      // Check permissions for certain updates
      const { name, description, settings, isArchived, isPinned, tags } =
        validation.data;

      if (name || description || settings) {
        if (!canParticipantEditConversation(participants, user.id)) {
          return createErrorResponse(
            "Insufficient permissions to edit conversation",
            403
          );
        }
      }

      // Update conversation
      const updates: Record<string, unknown> = {};

      if (name !== undefined) updates.name = name;
      if (description !== undefined) updates.description = description;
      if (settings !== undefined) {
        const currentSettings =
          conversation.settings &&
          typeof conversation.settings === "object" &&
          !Array.isArray(conversation.settings)
            ? (conversation.settings as Record<string, unknown>)
            : {};
        updates.settings = { ...currentSettings, ...settings };
      }
      if (isArchived !== undefined) updates.isArchived = isArchived;
      if (isPinned !== undefined) updates.isPinned = isPinned;
      if (tags !== undefined) updates.tags = tags;

      const updated = await db.conversation.update({
        where: { id: conversationId },
        data: updates as Prisma.ConversationUpdateInput,
      });

      const [updatedConversation] = await serializeConversations([updated]);

      return createSuccessResponse(
        { conversation: updatedConversation },
        "Conversation updated successfully"
      );
    } catch (error) {
      return handleApiError(error, "Failed to update conversation");
    }
  }
);

// ============================================================================
// DELETE /api/conversations/[id] - Delete/Leave conversation
// ============================================================================

export const DELETE = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;

      if (!isValidObjectId(conversationId)) {
        return createErrorResponse("Invalid conversation ID", 400);
      }

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });

      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);
      const activeParticipant = getActiveParticipant(participants, user.id);
      if (!activeParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      const { searchParams } = new URL(request.url);
      const action = searchParams.get("action") || "leave"; // "leave" or "delete"

      if (action === "delete") {
        if (
          !canParticipantDeleteConversation(
            participants,
            conversation.createdById,
            user.id
          )
        ) {
          return createErrorResponse(
            "Insufficient permissions to delete conversation",
            403
          );
        }

        // Soft delete the conversation
        await db.conversation.update({
          where: { id: conversationId },
          data: { deletedAt: new Date() },
        });

        return createSuccessResponse(null, "Conversation deleted successfully");
      } else {
        // Leave conversation (remove user as participant)
        if (conversation.type === "individual") {
          return createErrorResponse(
            "Cannot leave individual conversations",
            400
          );
        }

        // Remove user from participants (with last-admin promotion)
        const nextParticipants = removeParticipantRecord(
          participants,
          user.id,
          conversation.type
        );

        // Same validation rules the old pre-save hook enforced
        assertConversationInvariants({
          type: conversation.type,
          name: conversation.name,
          createdById: conversation.createdById,
          participants: nextParticipants,
        });

        const noActiveParticipants =
          activeParticipantsCount(nextParticipants) === 0;

        await db.conversation.update({
          where: { id: conversationId },
          data: {
            participants: participantsAsJson(nextParticipants),
            participantIds: activeParticipantIds(nextParticipants),
            metadata: withParticipantMetadata(
              conversation.metadata,
              nextParticipants
            ) as Prisma.InputJsonValue,
            // If no active participants left, soft delete the conversation
            ...(noActiveParticipants ? { deletedAt: new Date() } : {}),
          },
        });

        return createSuccessResponse(null, "Left conversation successfully");
      }
    } catch (error) {
      return handleApiError(error, "Failed to process conversation deletion");
    }
  }
);
