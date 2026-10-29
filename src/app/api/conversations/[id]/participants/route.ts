/**
 * PropertyPro - Conversation Participants API Routes
 * Manage conversation participants (add, remove, update permissions)
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
  ADMIN_PARTICIPANT_PERMISSIONS,
  CONVERSATION_ADMIN_ROLE,
  CONVERSATION_MEMBER_ROLE,
  MEMBER_PARTICIPANT_PERMISSIONS,
  activeParticipantIds,
  activeParticipantsCount,
  addParticipantRecord,
  assertConversationInvariants,
  canParticipantAddMembers,
  canParticipantRemoveMembers,
  getActiveParticipant,
  isParticipantAdmin,
  parseParticipants,
  participantsAsJson,
  removeParticipantRecord,
  serializeConversations,
  withParticipantMetadata,
} from "@/lib/messaging/conversations";
import { z } from "zod";

// Validation schemas
const addParticipantSchema = z.object({
  userId: z.string(),
  role: z.enum([CONVERSATION_ADMIN_ROLE, CONVERSATION_MEMBER_ROLE]).optional(),
  permissions: z
    .object({
      canAddMembers: z.boolean().optional(),
      canRemoveMembers: z.boolean().optional(),
      canEditConversation: z.boolean().optional(),
      canDeleteMessages: z.boolean().optional(),
    })
    .optional(),
});

const updateParticipantSchema = z.object({
  role: z.enum([CONVERSATION_ADMIN_ROLE, CONVERSATION_MEMBER_ROLE]).optional(),
  permissions: z
    .object({
      canAddMembers: z.boolean().optional(),
      canRemoveMembers: z.boolean().optional(),
      canEditConversation: z.boolean().optional(),
      canDeleteMessages: z.boolean().optional(),
    })
    .optional(),
});

async function persistParticipants(
  conversation: {
    id: string;
    type: string;
    name: string | null;
    createdById: string;
    metadata: unknown;
  },
  nextParticipants: ReturnType<typeof parseParticipants>,
  extraData: Record<string, unknown> = {}
) {
  // Same validation rules the old pre-save hook enforced
  assertConversationInvariants({
    type: conversation.type,
    name: conversation.name,
    createdById: conversation.createdById,
    participants: nextParticipants,
  });

  return db.conversation.update({
    where: { id: conversation.id },
    data: {
      participants: participantsAsJson(nextParticipants),
      participantIds: activeParticipantIds(nextParticipants),
      metadata: withParticipantMetadata(
        conversation.metadata,
        nextParticipants
      ) as Prisma.InputJsonValue,
      ...extraData,
    },
  });
}

// ============================================================================
// GET /api/conversations/[id]/participants - Get conversation participants
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
      if (!getActiveParticipant(participants, user.id)) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      const [serialized] = await serializeConversations([conversation]);

      // Filter active participants (populated shape)
      const activeParticipants = (
        (serialized.participants as any[]) ?? []
      ).filter((p: any) => p.isActive);

      return createSuccessResponse({
        participants: activeParticipants,
        totalCount: activeParticipants.length,
      });
    } catch (error) {
      return handleApiError(error, "Failed to fetch participants");
    }
  }
);

// ============================================================================
// POST /api/conversations/[id]/participants - Add participant to conversation
// ============================================================================

export const POST = withPermissionAndDB("profile_management")(
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
      const validation = addParticipantSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation error: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const {
        userId,
        role = CONVERSATION_MEMBER_ROLE,
        permissions,
      } = validation.data;

      if (!isValidObjectId(userId)) {
        return createErrorResponse("Invalid user ID", 400);
      }

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });

      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);

      // Check if current user is a participant with add permissions
      const currentParticipant = getActiveParticipant(participants, user.id);
      if (!currentParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      if (!canParticipantAddMembers(participants, user.id)) {
        return createErrorResponse(
          "Insufficient permissions to add participants",
          403
        );
      }

      // Check if conversation allows member invites (defaults to true, as the
      // old settings schema did)
      const settings =
        conversation.settings &&
        typeof conversation.settings === "object" &&
        !Array.isArray(conversation.settings)
          ? (conversation.settings as Record<string, unknown>)
          : {};
      const allowMemberInvites =
        settings.allowMemberInvites === undefined
          ? true
          : Boolean(settings.allowMemberInvites);

      if (!allowMemberInvites && !isParticipantAdmin(participants, user.id)) {
        return createErrorResponse(
          "Member invites are not allowed in this conversation",
          403
        );
      }

      // Validate user exists and is active
      const userToAdd = await db.user.findFirst({ where: { id: userId } });
      if (!userToAdd || !userToAdd.isActive) {
        return createErrorResponse("User not found or inactive", 404);
      }

      // Check if user is already a participant
      const existingParticipant = participants.find(
        (p) => String(p.userId) === userId
      );

      if (existingParticipant && existingParticipant.isActive) {
        return createErrorResponse("User is already a participant", 400);
      }

      // Add participant (reactivates an inactive record, role presets applied)
      const nextParticipants = addParticipantRecord(
        participants,
        userId,
        role,
        permissions
      );

      const updated = await persistParticipants(
        conversation,
        nextParticipants
      );

      const [serialized] = await serializeConversations([updated]);

      return createSuccessResponse({
        conversation: serialized,
        addedParticipant: {
          userId: userToAdd.id,
          firstName: userToAdd.firstName,
          lastName: userToAdd.lastName,
          email: userToAdd.email,
          role,
        },
      }, "Participant added successfully");
    } catch (error) {
      return handleApiError(error, "Failed to add participant");
    }
  }
);

// ============================================================================
// PATCH /api/conversations/[id]/participants?userId= - Update participant
// ============================================================================

export const PATCH = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;
      const { searchParams } = new URL(request.url);
      const targetUserId = searchParams.get("userId");

      if (
        !isValidObjectId(conversationId) ||
        !targetUserId ||
        !isValidObjectId(targetUserId)
      ) {
        return createErrorResponse("Invalid conversation or user ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = updateParticipantSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          `Validation error: ${validation.error.errors
            .map((e) => e.message)
            .join(", ")}`,
          400
        );
      }

      const { role, permissions } = validation.data;

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });

      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);

      // Check if current user is a participant with admin permissions
      const currentParticipant = getActiveParticipant(participants, user.id);
      if (!currentParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      if (!isParticipantAdmin(participants, user.id)) {
        return createErrorResponse(
          "Only admins can update participant permissions",
          403
        );
      }

      // Find target participant
      const targetParticipant = participants.find(
        (p) => String(p.userId) === targetUserId && p.isActive
      );

      if (!targetParticipant) {
        return createErrorResponse("Participant not found", 404);
      }

      // Prevent removing the last admin
      if (
        role === CONVERSATION_MEMBER_ROLE &&
        targetParticipant.role === CONVERSATION_ADMIN_ROLE
      ) {
        const adminCount = participants.filter(
          (p) => p.isActive && p.role === CONVERSATION_ADMIN_ROLE
        ).length;

        if (adminCount <= 1) {
          return createErrorResponse(
            "Cannot remove the last admin from the conversation",
            400
          );
        }
      }

      // Update participant
      const nextParticipants = participants.map((p) => {
        if (String(p.userId) !== targetUserId || !p.isActive) return { ...p };

        let nextRole = p.role;
        let nextPermissions = { ...p.permissions };

        if (role !== undefined) {
          nextRole = role;
          // Update permissions based on role
          nextPermissions =
            role === CONVERSATION_ADMIN_ROLE
              ? { ...ADMIN_PARTICIPANT_PERMISSIONS }
              : { ...MEMBER_PARTICIPANT_PERMISSIONS };
        }

        if (permissions !== undefined) {
          nextPermissions = { ...nextPermissions, ...permissions };
        }

        return { ...p, role: nextRole, permissions: nextPermissions };
      });

      const updated = await persistParticipants(
        conversation,
        nextParticipants
      );

      const [serialized] = await serializeConversations([updated]);

      return createSuccessResponse(
        { conversation: serialized },
        "Participant updated successfully"
      );
    } catch (error) {
      return handleApiError(error, "Failed to update participant");
    }
  }
);

// ============================================================================
// DELETE /api/conversations/[id]/participants?userId= - Remove participant
// ============================================================================

export const DELETE = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: conversationId } = await params;
      const { searchParams } = new URL(request.url);
      const targetUserId = searchParams.get("userId");

      if (
        !isValidObjectId(conversationId) ||
        !targetUserId ||
        !isValidObjectId(targetUserId)
      ) {
        return createErrorResponse("Invalid conversation or user ID", 400);
      }

      const conversation = await db.conversation.findFirst({
        where: { id: conversationId, deletedAt: null },
      });

      if (!conversation) {
        return createErrorResponse("Conversation not found", 404);
      }

      const participants = parseParticipants(conversation.participants);

      // Check if current user is a participant
      const currentParticipant = getActiveParticipant(participants, user.id);
      if (!currentParticipant) {
        return createErrorResponse("Access denied to this conversation", 403);
      }

      // Check permissions
      const isSelfRemoval = user.id === targetUserId;
      const hasRemovePermission = canParticipantRemoveMembers(
        participants,
        user.id
      );

      if (!isSelfRemoval && !hasRemovePermission) {
        return createErrorResponse(
          "Insufficient permissions to remove participants",
          403
        );
      }

      // Find target participant
      const targetParticipant = participants.find(
        (p) => String(p.userId) === targetUserId && p.isActive
      );

      if (!targetParticipant) {
        return createErrorResponse("Participant not found", 404);
      }

      // Prevent removing the last admin (unless it's self-removal)
      if (targetParticipant.role === CONVERSATION_ADMIN_ROLE) {
        const adminCount = participants.filter(
          (p) => p.isActive && p.role === CONVERSATION_ADMIN_ROLE
        ).length;

        if (adminCount <= 1 && !isSelfRemoval) {
          return createErrorResponse(
            "Cannot remove the last admin from the conversation",
            400
          );
        }
      }

      // Remove participant (with last-admin promotion)
      const nextParticipants = removeParticipantRecord(
        participants,
        targetUserId,
        conversation.type
      );

      // If no active participants left, soft delete the conversation
      const noActiveParticipants =
        activeParticipantsCount(nextParticipants) === 0;

      await persistParticipants(
        conversation,
        nextParticipants,
        noActiveParticipants ? { deletedAt: new Date() } : {}
      );

      return createSuccessResponse(
        null,
        isSelfRemoval
          ? "Left conversation successfully"
          : "Participant removed successfully"
      );
    } catch (error) {
      return handleApiError(error, "Failed to remove participant");
    }
  }
);
