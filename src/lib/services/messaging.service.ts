/**
 * PropertyPro - Enhanced Messaging Service
 * Service for managing real-time messaging and communication
 */

import { db } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import { UserRole } from "@/types";
import type { Message as MessageRow, Prisma } from "@/generated/prisma/client";
import {
  CONVERSATION_MEMBER_ROLE,
  buildLastMessagePayload,
  bumpConversationMetadata,
  makeParticipant,
  parseParticipants,
  participantsAsJson,
} from "@/lib/messaging/conversations";

export interface CreateMessageParams {
  senderId: string;
  recipientId?: string;
  recipientIds?: string[]; // For group messages
  propertyId?: string;
  subject: string;
  content: string;
  messageType?:
    | "general"
    | "maintenance"
    | "payment"
    | "lease"
    | "emergency"
    | "announcement";
  priority?: "low" | "normal" | "high" | "urgent";
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
  }>;
  replyToId?: string;
  isSystemMessage?: boolean;
  scheduledFor?: Date;
}

export interface MessageQueryParams {
  conversationId?: string;
  senderId?: string;
  recipientId?: string;
  propertyId?: string;
  messageType?: string;
  priority?: string;
  status?: string;
  unreadOnly?: boolean;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
}

export interface ConversationSummary {
  conversationId: string;
  participants: Array<{
    userId: string;
    name: string;
    avatar?: string;
    role: string;
  }>;
  lastMessage: {
    content: string;
    senderId: string;
    senderName: string;
    createdAt: Date;
    isRead: boolean;
  };
  unreadCount: number;
  propertyId?: string;
  propertyName?: string;
  messageType: string;
  priority: string;
}

export interface AnnouncementParams {
  title: string;
  content: string;
  priority: "low" | "normal" | "high" | "urgent";
  targetAudience: {
    roles?: UserRole[];
    propertyIds?: string[];
    userIds?: string[];
    tenantIds?: string[];
    includeAll?: boolean;
  };
  scheduledFor?: Date;
  expiresAt?: Date;
  attachments?: Array<{
    fileName: string;
    fileUrl: string;
    fileSize: number;
    fileType: string;
  }>;
  actionButton?: {
    text: string;
    url: string;
  };
}

type PopulatedMessage = Record<string, unknown>;

const USER_SUMMARY_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
} as const;

export class MessagingService {
  /** Creates must carry organizationId; resolve it from the request context
   * or, in bypass contexts, from the sender's user record. */
  private async resolveOrganizationId(senderId: string): Promise<string> {
    const contextOrgId = getOrgContext()?.organizationId;
    if (contextOrgId) return contextOrgId;

    const sender = await db.user.findFirst({
      where: { id: senderId },
      select: { organizationId: true },
    });

    if (!sender?.organizationId) {
      throw new Error("Unable to resolve organization for message sender");
    }

    return sender.organizationId;
  }

  /**
   * Find (or create) the individual conversation between two users — the
   * conversationId is a real conversations row now, not a derived string.
   */
  private async findOrCreateIndividualConversation(
    organizationId: string,
    senderId: string,
    recipientId: string,
    propertyId?: string
  ) {
    // Deterministic find: no unique constraint backs the (sender, recipient)
    // pair, so ordering by createdAt (id as tiebreaker) makes every caller —
    // including concurrent ones that raced past the create below — converge
    // on the same conversation row.
    const findExisting = () =>
      db.conversation.findFirst({
        where: {
          type: "individual",
          participantIds: { hasEvery: [senderId, recipientId] },
          deletedAt: null,
          ...(propertyId ? { propertyId } : {}),
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });

    const existing = await findExisting();

    if (existing) return existing;

    const participants = [
      makeParticipant(senderId, CONVERSATION_MEMBER_ROLE),
      makeParticipant(recipientId, CONVERSATION_MEMBER_ROLE),
    ];

    const created = await db.conversation.create({
      data: {
        organizationId,
        type: "individual",
        participants: participantsAsJson(participants),
        participantIds: [senderId, recipientId],
        createdById: senderId,
        propertyId: propertyId ?? null,
        metadata: {
          totalMessages: 0,
          totalParticipants: 2,
          lastActivity: new Date().toISOString(),
        },
      },
    });

    // Two concurrent first messages can both miss the find above and create
    // two rows, permanently splitting the thread. Re-run the deterministic
    // find: if a different row wins, retire our duplicate (nothing references
    // it yet) and use the winner.
    const winner = await findExisting();
    if (winner && winner.id !== created.id) {
      await db.conversation
        .update({
          where: { id: created.id },
          data: { deletedAt: new Date() },
        })
        .catch(() => {
          // Best effort: an orphaned duplicate is harmless once every send
          // converges on the winner.
        });
      return winner;
    }

    return created;
  }

  /**
   * lastMessage denormalized cache: refresh the conversation right after a
   * message is created (replaces the old Message post-save hook).
   */
  private async applyMessageToConversation(
    conversation: { id: string; metadata: unknown },
    message: MessageRow,
    senderName: string
  ): Promise<void> {
    await db.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessage: buildLastMessagePayload(message, senderName),
        metadata: bumpConversationMetadata(
          conversation.metadata
        ) as Prisma.InputJsonValue,
      },
    });
  }

  private async populateMessage(message: MessageRow): Promise<PopulatedMessage> {
    const [populated] = await this.populateMessages([message]);
    return populated;
  }

  private async populateMessages(
    messages: MessageRow[]
  ): Promise<PopulatedMessage[]> {
    const userIds = new Set<string>();
    const propertyIds = new Set<string>();
    const replyToIds = new Set<string>();

    for (const message of messages) {
      userIds.add(message.senderId);
      if (message.recipientId) userIds.add(message.recipientId);
      if (message.propertyId) propertyIds.add(message.propertyId);
      if (message.replyToId) replyToIds.add(message.replyToId);
    }

    const [users, properties, replyTargets] = await Promise.all([
      userIds.size > 0
        ? db.user.findMany({
            where: { id: { in: [...userIds] } },
            select: USER_SUMMARY_SELECT,
          })
        : Promise.resolve([]),
      propertyIds.size > 0
        ? db.property.findMany({
            where: { id: { in: [...propertyIds] } },
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
        : Promise.resolve([]),
      replyToIds.size > 0
        ? db.message.findMany({
            where: { id: { in: [...replyToIds] } },
            select: {
              id: true,
              subject: true,
              content: true,
              senderId: true,
              createdAt: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const propertyMap = new Map(
      properties.map((p) => [
        p.id,
        {
          id: p.id,
          name: p.name,
          address: {
            street: p.addressStreet,
            city: p.addressCity,
            state: p.addressState,
            zipCode: p.addressZipCode,
            country: p.addressCountry,
          },
        },
      ])
    );
    const replyMap = new Map(replyTargets.map((m) => [m.id, m]));

    return messages.map((message) => ({
      ...message,
      senderId: userMap.get(message.senderId) ?? message.senderId,
      recipientId: message.recipientId
        ? userMap.get(message.recipientId) ?? message.recipientId
        : message.recipientId,
      propertyId: message.propertyId
        ? propertyMap.get(message.propertyId) ?? message.propertyId
        : message.propertyId,
      replyToId: message.replyToId
        ? replyMap.get(message.replyToId) ?? message.replyToId
        : message.replyToId,
    }));
  }

  /** Resolve the sender's display name once per send, not once per recipient. */
  private async getSenderName(senderId: string): Promise<string> {
    const sender = await db.user.findFirst({
      where: { id: senderId },
      select: { firstName: true, lastName: true, email: true },
    });
    return (
      [sender?.firstName, sender?.lastName].filter(Boolean).join(" ").trim() ||
      sender?.email ||
      "Unknown"
    );
  }

  private async createMessageForRecipient(
    organizationId: string,
    params: CreateMessageParams,
    recipientId: string,
    senderName: string
  ): Promise<MessageRow> {
    const {
      senderId,
      propertyId,
      subject,
      content,
      messageType = "general",
      priority = "normal",
      attachments = [],
      replyToId,
      isSystemMessage = false,
    } = params;

    const conversation = await this.findOrCreateIndividualConversation(
      organizationId,
      senderId,
      recipientId,
      propertyId
    );

    const message = await db.message.create({
      data: {
        organizationId,
        conversationId: conversation.id,
        senderId,
        recipientId,
        propertyId: propertyId ?? null,
        subject,
        content,
        messageType,
        priority,
        attachments: attachments as unknown as Prisma.InputJsonValue,
        replyToId: replyToId ?? null,
        isSystemMessage,
      },
    });

    await this.applyMessageToConversation(conversation, message, senderName);

    return message;
  }

  // Create a new message
  async createMessage(params: CreateMessageParams): Promise<PopulatedMessage> {
    const { senderId, recipientId, recipientIds = [] } = params;

    const organizationId = await this.resolveOrganizationId(senderId);
    const senderName = await this.getSenderName(senderId);

    // Handle group messages
    if (recipientIds.length > 0) {
      const messages: MessageRow[] = [];

      for (const targetRecipientId of recipientIds) {
        const message = await this.createMessageForRecipient(
          organizationId,
          params,
          targetRecipientId,
          senderName
        );
        messages.push(message);
      }

      // Return the first message (they're all similar)
      return messages[0] as unknown as PopulatedMessage;
    }

    // Single recipient message
    if (!recipientId) {
      throw new Error("Recipient ID is required for single messages");
    }

    const message = await this.createMessageForRecipient(
      organizationId,
      params,
      recipientId,
      senderName
    );

    return this.populateMessage(message);
  }

  // Get messages with filtering and pagination
  async getMessages(params: MessageQueryParams): Promise<{
    messages: PopulatedMessage[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    const {
      conversationId,
      senderId,
      recipientId,
      propertyId,
      messageType,
      priority,
      status,
      unreadOnly = false,
      page = 1,
      limit = 20,
      sortBy = "createdAt",
      sortOrder = "desc",
    } = params;

    // Build query
    const where: Record<string, unknown> = { deletedAt: null };

    if (conversationId) where.conversationId = conversationId;
    if (senderId) where.senderId = senderId;
    if (recipientId) where.recipientId = recipientId;
    if (propertyId) where.propertyId = propertyId;
    if (messageType) where.messageType = messageType;
    if (priority) where.priority = priority;
    if (status) where.status = status;
    if (unreadOnly) where.readAt = null;

    // Execute query with pagination
    const skip = (page - 1) * limit;

    const [messages, total] = await Promise.all([
      db.message.findMany({
        where: where as Prisma.MessageWhereInput,
        orderBy: { [sortBy]: sortOrder } as Prisma.MessageOrderByWithRelationInput,
        skip,
        take: limit,
      }),
      db.message.count({ where: where as Prisma.MessageWhereInput }),
    ]);

    return {
      messages: await this.populateMessages(messages),
      total,
      page,
      totalPages: Math.ceil(total / limit),
    };
  }

  // Get conversation summaries for a user
  async getConversations(
    userId: string,
    limit: number = 20
  ): Promise<ConversationSummary[]> {
    const conversations = await db.conversation.findMany({
      where: {
        participantIds: { has: userId },
        deletedAt: null,
        isArchived: false,
      },
      orderBy: [{ isPinned: "desc" }, { updatedAt: "desc" }],
      take: limit,
    });

    if (conversations.length === 0) return [];

    const conversationIds = conversations.map((c) => c.id);

    // Unread means readAt is unset — the same definition getUnreadCount uses
    // (status lags readAt and disagreed with it). Message is not in the
    // auto-soft-delete model list, so exclude deleted rows explicitly.
    const unreadGroups = await db.message.groupBy({
      by: ["conversationId"],
      where: {
        conversationId: { in: conversationIds },
        senderId: { not: userId },
        readAt: null,
        deletedAt: null,
      },
      _count: true,
    });
    const unreadMap = new Map(
      unreadGroups.map((group) => [group.conversationId, group._count])
    );

    const participantUserIds = new Set<string>();
    const propertyIds = new Set<string>();
    for (const conversation of conversations) {
      for (const participant of parseParticipants(conversation.participants)) {
        if (participant?.userId) participantUserIds.add(String(participant.userId));
      }
      if (conversation.propertyId) propertyIds.add(conversation.propertyId);
    }

    const [users, properties] = await Promise.all([
      participantUserIds.size > 0
        ? db.user.findMany({
            where: { id: { in: [...participantUserIds] } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
              role: true,
            },
          })
        : Promise.resolve([]),
      propertyIds.size > 0
        ? db.property.findMany({
            where: { id: { in: [...propertyIds] } },
            select: { id: true, name: true },
          })
        : Promise.resolve([]),
    ]);

    const userMap = new Map(users.map((u) => [u.id, u]));
    const propertyMap = new Map(properties.map((p) => [p.id, p]));

    return conversations.map((conversation) => {
      const participantRecords = parseParticipants(conversation.participants);
      const participants = participantRecords
        .filter((participant) => participant?.isActive)
        .map((participant) => {
          const participantUser = userMap.get(String(participant.userId));
          return {
            userId: String(participant.userId),
            name: participantUser
              ? `${participantUser.firstName} ${participantUser.lastName}`.trim()
              : "Unknown",
            avatar: participantUser?.avatar ?? undefined,
            role: participantUser?.role ?? participant.role,
          };
        });

      const cachedLast =
        conversation.lastMessage &&
        typeof conversation.lastMessage === "object" &&
        !Array.isArray(conversation.lastMessage)
          ? (conversation.lastMessage as Record<string, any>)
          : null;

      const unreadCount = unreadMap.get(conversation.id) ?? 0;

      const property = conversation.propertyId
        ? propertyMap.get(conversation.propertyId)
        : undefined;

      return {
        conversationId: conversation.id,
        participants,
        lastMessage: {
          content: cachedLast?.content ?? "",
          senderId: cachedLast?.senderId ? String(cachedLast.senderId) : "",
          senderName: cachedLast?.senderName ?? "",
          createdAt: cachedLast?.createdAt
            ? new Date(cachedLast.createdAt)
            : conversation.updatedAt,
          isRead: unreadCount === 0,
        },
        unreadCount,
        propertyId: property?.id,
        propertyName: property?.name,
        messageType: cachedLast?.messageType ?? "general",
        priority: "normal",
      };
    });
  }

  // Mark message as read
  async markAsRead(messageId: string, userId: string): Promise<boolean> {
    const result = await db.message.updateMany({
      where: {
        id: messageId,
        recipientId: userId,
        readAt: null,
      },
      data: {
        status: "read",
        readAt: new Date(),
      },
    });

    return result.count > 0;
  }

  // Mark all messages in a conversation as read
  async markConversationAsRead(
    conversationId: string,
    userId: string
  ): Promise<number> {
    const result = await db.message.updateMany({
      where: {
        conversationId,
        recipientId: userId,
        readAt: null,
      },
      data: {
        status: "read",
        readAt: new Date(),
      },
    });

    return result.count;
  }

  // Delete message (soft delete)
  async deleteMessage(messageId: string, userId: string): Promise<boolean> {
    const message = await db.message.findFirst({
      where: { id: messageId },
    });
    if (!message) return false;

    // Only sender can delete their own messages
    if (message.senderId !== userId) return false;

    await db.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date() },
    });

    return true;
  }

  // Get unread message count for a user
  async getUnreadCount(userId: string): Promise<number> {
    return db.message.count({
      where: {
        recipientId: userId,
        readAt: null,
        deletedAt: null,
      },
    });
  }

  // Search messages
  async searchMessages(
    userId: string,
    query: string,
    options?: {
      propertyId?: string;
      messageType?: string;
      limit?: number;
    }
  ): Promise<PopulatedMessage[]> {
    const { propertyId, messageType, limit = 20 } = options || {};

    const messages = await db.message.findMany({
      where: {
        AND: [
          { OR: [{ senderId: userId }, { recipientId: userId }] },
          {
            OR: [
              { content: { contains: query, mode: "insensitive" } },
              { subject: { contains: query, mode: "insensitive" } },
            ],
          },
        ],
        deletedAt: null,
        ...(propertyId ? { propertyId } : {}),
        ...(messageType ? { messageType } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return this.populateMessages(messages);
  }

  // Create announcement (broadcast message)
  async createAnnouncement(
    params: AnnouncementParams,
    createdBy: string
  ): Promise<any> {
    const {
      title,
      content,
      priority,
      targetAudience,
      scheduledFor,
      expiresAt,
      attachments = [],
      actionButton,
    } = params;

    const organizationId = await this.resolveOrganizationId(createdBy);

    // Mirror the old pre-save hook: a scheduled time already in the past
    // publishes immediately.
    const now = new Date();
    const isScheduledForFuture = Boolean(scheduledFor && scheduledFor > now);

    const announcement = await db.announcement.create({
      data: {
        organizationId,
        title,
        content,
        priority,
        type: "general",
        targetAudience: targetAudience as unknown as Prisma.InputJsonValue,
        scheduledFor: scheduledFor ?? null,
        expiresAt: expiresAt ?? null,
        attachments: attachments as unknown as Prisma.InputJsonValue,
        actionButton: actionButton
          ? (actionButton as unknown as Prisma.InputJsonValue)
          : undefined,
        status: isScheduledForFuture ? "scheduled" : "published",
        publishedAt: isScheduledForFuture ? null : now,
        createdById: createdBy,
      },
    });

    // If publishing immediately, send notifications. Tested against
    // isScheduledForFuture, not scheduledFor: a past-dated schedule publishes
    // immediately, and testing the raw field left such announcements marked
    // "published" with notifications that never got sent (nothing picks a
    // published announcement up later).
    if (!isScheduledForFuture) {
      await this.sendAnnouncementNotifications(announcement);
    }

    return announcement;
  }

  // Send notifications for announcement
  private async sendAnnouncementNotifications(announcement: {
    id: string;
    title: string;
    content: string;
    priority: string;
    attachments: unknown;
    targetAudience: unknown;
    createdById: string;
  }): Promise<void> {
    try {
      const audience =
        announcement.targetAudience &&
        typeof announcement.targetAudience === "object" &&
        !Array.isArray(announcement.targetAudience)
          ? (announcement.targetAudience as Record<string, any>)
          : {};

      // Build query to find target users
      const where: Record<string, unknown> = { isActive: true };

      if (!audience.includeAll) {
        const orConditions: Record<string, unknown>[] = [];

        if (Array.isArray(audience.roles) && audience.roles.length > 0) {
          orConditions.push({ role: { in: audience.roles.map(String) } });
        }

        if (Array.isArray(audience.userIds) && audience.userIds.length > 0) {
          orConditions.push({ id: { in: audience.userIds.map(String) } });
        }

        // tenantIds and propertyIds are valid sole targets per the route's
        // validation, but were ignored here — an audience of only those
        // collapsed to `{ isActive: true }` and broadcast a building-specific
        // notice to every active user in the org.
        if (Array.isArray(audience.tenantIds) && audience.tenantIds.length > 0) {
          orConditions.push({ id: { in: audience.tenantIds.map(String) } });
        }

        if (
          Array.isArray(audience.propertyIds) &&
          audience.propertyIds.length > 0
        ) {
          const leases = await db.lease.findMany({
            where: {
              propertyId: { in: audience.propertyIds.map(String) },
              status: { in: ["active", "pending"] },
              deletedAt: null,
            },
            select: { tenantId: true },
          });
          const propertyTenantIds = [
            ...new Set(leases.map((lease) => lease.tenantId)),
          ];
          if (propertyTenantIds.length > 0) {
            orConditions.push({ id: { in: propertyTenantIds } });
          }
        }

        if (orConditions.length > 0) {
          where.OR = orConditions;
        } else {
          // A targeted audience that resolves to nobody sends to nobody.
          return;
        }
      }

      const targetUsers = await db.user.findMany({
        where: where as Prisma.UserWhereInput,
        select: { id: true, email: true, firstName: true, lastName: true },
      });

      // Resolve the org and the sender's display name once for the whole
      // fan-out instead of re-fetching them per recipient.
      const organizationId = await this.resolveOrganizationId(
        announcement.createdById
      );
      const senderName = await this.getSenderName(announcement.createdById);

      const messageParams: CreateMessageParams = {
        senderId: announcement.createdById,
        subject: `📢 ${announcement.title}`,
        content: announcement.content,
        messageType: "announcement",
        priority: announcement.priority as CreateMessageParams["priority"],
        attachments: Array.isArray(announcement.attachments)
          ? (announcement.attachments as CreateMessageParams["attachments"])
          : [],
        isSystemMessage: true,
      };

      // Send notifications to each user
      for (const user of targetUsers) {
        // A user cannot message themselves — skip the creator.
        if (user.id === announcement.createdById) continue;

        // Create individual messages for each user
        await this.createMessageForRecipient(
          organizationId,
          messageParams,
          user.id,
          senderName
        );
      }
    } catch (error) {
      console.error("Failed to send announcement notifications:", error);
    }
  }
}

export const messagingService = new MessagingService();
