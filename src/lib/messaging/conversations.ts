/**
 * PropertyPro - Conversation participant & cache helpers (Prisma era).
 *
 * The Mongoose Conversation model carried instance methods
 * (addParticipant / removeParticipant / permission checks / updateLastMessage)
 * plus pre-save validation. Participants now live in a Json column with the
 * ACTIVE participant user ids mirrored into `participantIds` (String[]) for
 * queryability. These pure helpers reproduce those exact rules; routes and
 * services apply them and persist `participants` + `participantIds` together.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";

export const CONVERSATION_ADMIN_ROLE = "admin" as const;
export const CONVERSATION_MEMBER_ROLE = "member" as const;

export type ConversationParticipantRole = "admin" | "member";

export interface ParticipantPermissions {
  canAddMembers: boolean;
  canRemoveMembers: boolean;
  canEditConversation: boolean;
  canDeleteMessages: boolean;
}

export interface ParticipantRecord {
  userId: string;
  role: ConversationParticipantRole;
  joinedAt: string | Date;
  lastReadAt?: string | Date | null;
  isActive: boolean;
  permissions: ParticipantPermissions;
}

export const ADMIN_PARTICIPANT_PERMISSIONS: ParticipantPermissions = {
  canAddMembers: true,
  canRemoveMembers: true,
  canEditConversation: true,
  canDeleteMessages: true,
};

export const MEMBER_PARTICIPANT_PERMISSIONS: ParticipantPermissions = {
  canAddMembers: false,
  canRemoveMembers: false,
  canEditConversation: false,
  canDeleteMessages: false,
};

function presetPermissions(
  role: ConversationParticipantRole
): ParticipantPermissions {
  return role === CONVERSATION_ADMIN_ROLE
    ? { ...ADMIN_PARTICIPANT_PERMISSIONS }
    : { ...MEMBER_PARTICIPANT_PERMISSIONS };
}

/** Read the participants Json column into typed records. */
export function parseParticipants(value: unknown): ParticipantRecord[] {
  return Array.isArray(value) ? (value as ParticipantRecord[]) : [];
}

/** Active participant user ids — the value the participantIds column mirrors. */
export function activeParticipantIds(
  participants: ParticipantRecord[]
): string[] {
  return participants
    .filter((p) => p?.isActive)
    .map((p) => String(p.userId));
}

export function activeParticipantsCount(
  participants: ParticipantRecord[]
): number {
  return participants.filter((p) => p?.isActive).length;
}

export function getActiveParticipant(
  participants: ParticipantRecord[],
  userId: string
): ParticipantRecord | undefined {
  return participants.find(
    (p) => p?.isActive && String(p.userId) === userId
  );
}

export function isParticipantAdmin(
  participants: ParticipantRecord[],
  userId: string
): boolean {
  return (
    getActiveParticipant(participants, userId)?.role ===
    CONVERSATION_ADMIN_ROLE
  );
}

export function canParticipantEditConversation(
  participants: ParticipantRecord[],
  userId: string
): boolean {
  const participant = getActiveParticipant(participants, userId);
  if (!participant) return false;
  return (
    participant.role === CONVERSATION_ADMIN_ROLE ||
    Boolean(participant.permissions?.canEditConversation)
  );
}

export function canParticipantAddMembers(
  participants: ParticipantRecord[],
  userId: string
): boolean {
  const participant = getActiveParticipant(participants, userId);
  if (!participant) return false;
  return (
    participant.role === CONVERSATION_ADMIN_ROLE ||
    Boolean(participant.permissions?.canAddMembers)
  );
}

export function canParticipantRemoveMembers(
  participants: ParticipantRecord[],
  userId: string
): boolean {
  const participant = getActiveParticipant(participants, userId);
  if (!participant) return false;
  return (
    participant.role === CONVERSATION_ADMIN_ROLE ||
    Boolean(participant.permissions?.canRemoveMembers)
  );
}

export function canParticipantDeleteMessages(
  participants: ParticipantRecord[],
  userId: string
): boolean {
  const participant = getActiveParticipant(participants, userId);
  if (!participant) return false;
  return (
    participant.role === CONVERSATION_ADMIN_ROLE ||
    Boolean(participant.permissions?.canDeleteMessages)
  );
}

export function canParticipantDeleteConversation(
  participants: ParticipantRecord[],
  createdById: string | null | undefined,
  userId: string
): boolean {
  const participant = getActiveParticipant(participants, userId);
  if (!participant) return false;
  return (
    participant.role === CONVERSATION_ADMIN_ROLE || createdById === userId
  );
}

export function makeParticipant(
  userId: string,
  role: ConversationParticipantRole = CONVERSATION_MEMBER_ROLE,
  permissions?: Partial<ParticipantPermissions>
): ParticipantRecord {
  return {
    userId,
    role,
    joinedAt: new Date().toISOString(),
    isActive: true,
    permissions: { ...presetPermissions(role), ...permissions },
  };
}

/**
 * Old `conversation.addParticipant` — returns a NEW array. Reactivates an
 * inactive participant (fresh joinedAt, role and role-preset permissions),
 * leaves an already-active participant untouched, appends otherwise.
 */
export function addParticipantRecord(
  participants: ParticipantRecord[],
  userId: string,
  role: ConversationParticipantRole = CONVERSATION_MEMBER_ROLE,
  permissions?: Partial<ParticipantPermissions>
): ParticipantRecord[] {
  const existing = participants.find((p) => String(p.userId) === userId);

  if (existing) {
    if (existing.isActive) return [...participants];
    return participants.map((p) =>
      String(p.userId) === userId
        ? {
            ...p,
            isActive: true,
            joinedAt: new Date().toISOString(),
            role,
            permissions: { ...presetPermissions(role), ...permissions },
          }
        : p
    );
  }

  return [...participants, makeParticipant(userId, role, permissions)];
}

/**
 * Old `conversation.removeParticipant` — deactivates the participant and, when
 * the last active admin leaves a non-individual conversation, promotes the
 * earliest-joined remaining active member (first active in array order) to
 * admin with the admin permission preset.
 */
export function removeParticipantRecord(
  participants: ParticipantRecord[],
  userId: string,
  conversationType: string
): ParticipantRecord[] {
  const index = participants.findIndex((p) => String(p.userId) === userId);
  if (index === -1) return [...participants];

  const wasAdmin = participants[index].role === CONVERSATION_ADMIN_ROLE;
  const next = participants.map((p, i) =>
    i === index ? { ...p, isActive: false } : { ...p }
  );

  const hasActiveAdmin = next.some(
    (p) => p.isActive && p.role === CONVERSATION_ADMIN_ROLE
  );

  if (wasAdmin && conversationType !== "individual" && !hasActiveAdmin) {
    const replacementIndex = next.findIndex((p) => p.isActive);
    if (replacementIndex !== -1) {
      next[replacementIndex] = {
        ...next[replacementIndex],
        role: CONVERSATION_ADMIN_ROLE,
        permissions: { ...ADMIN_PARTICIPANT_PERMISSIONS },
      };
    }
  }

  return next;
}

/**
 * The Mongoose pre-save validation rules. Throws a plain Error carrying the
 * same messages the old hooks produced (handleApiError maps them to 500 just
 * as the old save() rejection did).
 */
export function assertConversationInvariants(conversation: {
  type: string;
  name?: string | null;
  createdById: string;
  participants: ParticipantRecord[];
}): void {
  const activeCount = activeParticipantsCount(conversation.participants);

  if (conversation.type === "individual" && activeCount !== 2) {
    throw new Error(
      "Individual conversations must have exactly 2 active participants"
    );
  }

  if (conversation.type === "group" && !conversation.name) {
    throw new Error("Group conversations must have a name");
  }

  if (conversation.type !== "individual") {
    const hasActiveAdmin = conversation.participants.some(
      (p) => p.isActive && p.role === CONVERSATION_ADMIN_ROLE
    );
    if (activeCount > 0 && !hasActiveAdmin) {
      throw new Error(
        "Group and announcement conversations must have at least one active admin"
      );
    }
  }

  const creatorIsParticipant = conversation.participants.some(
    (p) => String(p.userId) === conversation.createdById && p.isActive
  );
  if (!creatorIsParticipant) {
    throw new Error("Creator must be an active participant");
  }
}

/** Serialized `lastMessage` cache entry (old `updateLastMessage`). */
export function buildLastMessagePayload(
  message: {
    id: string;
    content: string;
    senderId: string;
    createdAt: Date;
    messageType: string | null;
  },
  senderName: string
) {
  return {
    messageId: message.id,
    content: (message.content ?? "").substring(0, 200),
    senderId: message.senderId,
    senderName: senderName || "Unknown",
    createdAt: message.createdAt.toISOString(),
    messageType: message.messageType || "general",
  };
}

/** metadata.totalMessages increment + lastActivity bump for a new message. */
export function bumpConversationMetadata(
  metadata: unknown,
  now: Date = new Date()
): Record<string, unknown> {
  const current =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const totalMessages =
    typeof current.totalMessages === "number" ? current.totalMessages : 0;
  return {
    ...current,
    totalMessages: totalMessages + 1,
    lastActivity: now.toISOString(),
  };
}

/** metadata refresh after a participants mutation. */
export function withParticipantMetadata(
  metadata: unknown,
  participants: ParticipantRecord[]
): Record<string, unknown> {
  const current =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  return {
    ...current,
    totalParticipants: activeParticipantsCount(participants),
  };
}

export function participantsAsJson(
  participants: ParticipantRecord[]
): Prisma.InputJsonValue {
  return participants as unknown as Prisma.InputJsonValue;
}

// ============================================================================
// Response serialization (old Mongoose populate shapes)
// ============================================================================

export interface PopulatedConversationUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
  role: string;
}

interface ConversationRowLike {
  id: string;
  type: string;
  name: string | null;
  participants: unknown;
  createdById: string;
  propertyId: string | null;
  [key: string]: unknown;
}

/**
 * Rebuild the populated response shape the Mongoose routes returned:
 * `participants[].userId` becomes the user document, `propertyId` becomes
 * `{ name, address }`, `createdBy` becomes the creator document. Also mirrors
 * the old virtuals (`activeParticipantsCount`, `displayName`).
 */
export async function serializeConversations<T extends ConversationRowLike>(
  conversations: T[]
): Promise<Record<string, unknown>[]> {
  const userIds = new Set<string>();
  const propertyIds = new Set<string>();

  for (const conversation of conversations) {
    for (const participant of parseParticipants(conversation.participants)) {
      if (participant?.userId) userIds.add(String(participant.userId));
    }
    if (conversation.createdById) userIds.add(conversation.createdById);
    if (conversation.propertyId) propertyIds.add(conversation.propertyId);
  }

  const [users, properties] = await Promise.all([
    userIds.size > 0
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
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

  return conversations.map((conversation) => {
    const participants = parseParticipants(conversation.participants);
    const populatedParticipants = participants.map((participant) => ({
      ...participant,
      userId:
        userMap.get(String(participant.userId)) ?? String(participant.userId),
    }));

    const creator = userMap.get(conversation.createdById);
    const property = conversation.propertyId
      ? propertyMap.get(conversation.propertyId) ?? conversation.propertyId
      : null;

    let displayName: string;
    if (conversation.type === "group" || conversation.type === "announcement") {
      displayName = conversation.name || "Unnamed Group";
    } else if (participants.length >= 2) {
      const first = userMap.get(String(participants[0]?.userId));
      displayName = first
        ? [first.firstName, first.lastName].filter(Boolean).join(" ") ||
          first.email ||
          "Unknown User"
        : "Unknown User";
    } else {
      displayName = "Direct Message";
    }

    return {
      ...conversation,
      participants: populatedParticipants,
      propertyId: property,
      createdBy: creator
        ? {
            id: creator.id,
            firstName: creator.firstName,
            lastName: creator.lastName,
            email: creator.email,
          }
        : conversation.createdById,
      activeParticipantsCount: activeParticipantsCount(participants),
      displayName,
    };
  });
}

/**
 * Unread count rule shared by the conversation routes: messages from other
 * senders that are not globally marked read.
 */
export function unreadMessagesWhere(conversationId: string, userId: string) {
  return {
    conversationId,
    senderId: { not: userId },
    status: { not: "read" },
  };
}
