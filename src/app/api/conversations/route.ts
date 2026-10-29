/**
 * PropertyPro - Conversations API Routes
 * CRUD operations for conversation management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  CONVERSATION_ADMIN_ROLE,
  CONVERSATION_MEMBER_ROLE,
  activeParticipantIds,
  makeParticipant,
  participantsAsJson,
  parseParticipants,
  serializeConversations,
} from "@/lib/messaging/conversations";
import { z } from "zod";

// Validation schemas
const createConversationSchema = z.object({
  type: z.enum(["individual", "group", "announcement"]),
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(500).optional(),
  participants: z.array(z.string()).min(1),
  propertyId: z.string().optional(),
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
});

// ============================================================================
// GET /api/conversations - Get user's conversations
// ============================================================================

export const GET = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest
) => {
  try {
    const { searchParams } = new URL(request.url);

    const { page = 1, limit = 10 } = parsePaginationParams(searchParams);

    const includeArchived = searchParams.get("includeArchived") === "true";
    const propertyId = searchParams.get("propertyId");
    const type = searchParams.get("type");
    const search = searchParams.get("search");

    const where = {
      participantIds: { has: user.id },
      deletedAt: null,
      ...(includeArchived ? {} : { isArchived: false }),
      ...(propertyId && isValidObjectId(propertyId) ? { propertyId } : {}),
    };

    const [rows, totalCount] = await Promise.all([
      db.conversation.findMany({
        where,
        orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.conversation.count({ where }),
    ]);

    let conversations = await serializeConversations(rows);

    // Apply additional filters (post-pagination, mirroring the old route)
    if (type) {
      conversations = conversations.filter((conv: any) => conv.type === type);
    }

    if (search) {
      const searchLower = search.toLowerCase();
      conversations = conversations.filter((conv: any) => {
        return (
          conv.name?.toLowerCase().includes(searchLower) ||
          conv.description?.toLowerCase().includes(searchLower) ||
          (Array.isArray(conv.participants) &&
            conv.participants.some((p: any) =>
              `${p.userId?.firstName ?? ""} ${p.userId?.lastName ?? ""}`
                .toLowerCase()
                .includes(searchLower)
            ))
        );
      });
    }

    // Unread counts per conversation: messages from other senders that are
    // not globally marked read (same rule as before).
    const conversationIds = conversations.map((conv: any) => String(conv.id));
    const unreadGroups =
      conversationIds.length > 0
        ? await db.message.groupBy({
            by: ["conversationId"],
            where: {
              conversationId: { in: conversationIds },
              senderId: { not: user.id },
              status: { not: "read" },
            },
            _count: true,
          })
        : [];
    const unreadMap = new Map(
      unreadGroups.map((group) => [group.conversationId, group._count])
    );

    const conversationsWithUnread = conversations.map((conversation: any) => ({
      ...conversation,
      unreadCount: unreadMap.get(String(conversation.id)) ?? 0,
    }));

    const responseData = {
      conversations: conversationsWithUnread,
      pagination: {
        page,
        limit,
        total: totalCount,
        pages: Math.ceil(totalCount / limit),
      },
      totalUnread: conversationsWithUnread.reduce(
        (sum: number, conv: any) => sum + (conv.unreadCount || 0),
        0
      ),
    };

    return createSuccessResponse(responseData);
  } catch (error) {
    console.error("API Error in GET /api/conversations:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/conversations - Create a new conversation
// ============================================================================

export const POST = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    // Validate request body
    const validation = createConversationSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation error: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400
      );
    }

    const { type, name, description, participants, propertyId, settings } =
      validation.data;

    // Validate participants exist
    const participantUsers = await db.user.findMany({
      where: { id: { in: participants }, isActive: true },
      select: { id: true },
    });

    if (participantUsers.length !== participants.length) {
      return createErrorResponse(
        "One or more participants not found or inactive",
        400
      );
    }

    // Validate property if provided
    if (propertyId) {
      if (!isValidObjectId(propertyId)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // Scoped: a conversation cannot be attached to a building this
      // caller does not hold.
      const property = await db.property.findFirst({
        where: withScope({ id: propertyId }, propertyScope(user)),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }
    }

    if (type === "individual") {
      if (participants.length !== 1) {
        return createErrorResponse(
          "Individual conversations require exactly one other participant",
          400
        );
      }

      const otherParticipantId = participants[0];

      // Check if conversation already exists
      const existing = await db.conversation.findFirst({
        where: {
          type: "individual",
          participantIds: { hasEvery: [user.id, otherParticipantId] },
          deletedAt: null,
          ...(propertyId ? { propertyId } : {}),
        },
      });

      if (existing) {
        const [conversation] = await serializeConversations([existing]);
        return createSuccessResponse(
          { conversation },
          "Conversation already exists"
        );
      }

      const participantRecords = [
        makeParticipant(user.id, CONVERSATION_MEMBER_ROLE),
        makeParticipant(otherParticipantId, CONVERSATION_MEMBER_ROLE),
      ];

      const created = await db.conversation.create({
        data: {
          organizationId: user.organizationId!,
          type: "individual",
          participants: participantsAsJson(participantRecords),
          participantIds: activeParticipantIds(participantRecords),
          createdById: user.id,
          propertyId: propertyId ?? null,
          metadata: {
            totalMessages: 0,
            totalParticipants: 2,
            lastActivity: new Date().toISOString(),
          },
        },
      });

      const [conversation] = await serializeConversations([created]);
      return createSuccessResponse(
        { conversation },
        "Conversation created successfully"
      );
    }

    // Group or announcement conversation
    if (!name) {
      return createErrorResponse(`${type} conversations require a name`, 400);
    }

    const memberIds = participants.filter(
      (participantId) => participantId !== user.id
    );
    const participantRecords = [
      makeParticipant(user.id, CONVERSATION_ADMIN_ROLE),
      ...memberIds.map((participantId) =>
        makeParticipant(participantId, CONVERSATION_MEMBER_ROLE)
      ),
    ];

    const created = await db.conversation.create({
      data: {
        organizationId: user.organizationId!,
        type,
        name,
        description,
        participants: participantsAsJson(participantRecords),
        participantIds: activeParticipantIds(participantRecords),
        createdById: user.id,
        propertyId: propertyId ?? null,
        settings: settings || {},
        metadata: {
          totalMessages: 0,
          totalParticipants: parseParticipants(participantRecords).filter(
            (p) => p.isActive
          ).length,
          lastActivity: new Date().toISOString(),
        },
      },
    });

    const [conversation] = await serializeConversations([created]);

    return createSuccessResponse(
      { conversation },
      "Conversation created successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to create conversation");
  }
});
