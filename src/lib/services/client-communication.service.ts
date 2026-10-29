/**
 * PropertyPro - Client communication history
 *
 * One timeline per client, merging two sources:
 *
 *  - LOGGED records (`client_communications`) — the calls, meetings and
 *    letters the product never sees, entered by staff.
 *  - IN-APP messages already in the system, so the history does not pretend
 *    the messaging module never happened.
 *
 * Merging matters: a client's history is only useful if it is complete, and
 * an office that has to check two screens to reconstruct a conversation will
 * check neither.
 */

import { db } from "@/lib/db/prisma";

export const COMMUNICATION_CHANNELS = [
  "call",
  "email",
  "meeting",
  "whatsapp",
  "sms",
  "letter",
  "note",
] as const;

export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const COMMUNICATION_DIRECTIONS = [
  "inbound",
  "outbound",
  "internal",
] as const;

export type CommunicationDirection = (typeof COMMUNICATION_DIRECTIONS)[number];

export function isCommunicationChannel(
  value: unknown,
): value is CommunicationChannel {
  return COMMUNICATION_CHANNELS.includes(value as CommunicationChannel);
}

export interface CommunicationEntry {
  id: string;
  /** "logged" was entered by staff; "message" came from in-app messaging. */
  source: "logged" | "message";
  channel: string;
  direction: string;
  subject: string;
  body: string | null;
  occurredAt: string;
  propertyName: string | null;
  recordedBy: string | null;
  followUpAt: string | null;
  followUpDone: boolean;
  /** Only logged entries can be edited or removed. */
  editable: boolean;
}

export interface CommunicationHistory {
  entries: CommunicationEntry[];
  summary: {
    total: number;
    logged: number;
    messages: number;
    /** Follow-ups that are due and not yet marked done. */
    openFollowUps: number;
    lastContactAt: string | null;
  };
}

export interface CommunicationHistoryOptions {
  channel?: CommunicationChannel;
  limit?: number;
  now?: Date;
}

function personName(user?: {
  firstName?: string | null;
  lastName?: string | null;
} | null): string | null {
  const name = `${user?.firstName ?? ""} ${user?.lastName ?? ""}`.trim();
  return name || null;
}

/** Every recorded interaction with one client, newest first. */
export async function getCommunicationHistory(
  clientId: string,
  options: CommunicationHistoryOptions = {},
): Promise<CommunicationHistory> {
  const now = options.now ?? new Date();
  const take = Math.min(options.limit ?? 100, 300);

  const [logged, messages] = await Promise.all([
    db.clientCommunication.findMany({
      where: {
        clientId,
        deletedAt: null,
        ...(options.channel ? { channel: options.channel } : {}),
      },
      include: {
        property: { select: { name: true } },
        recordedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { occurredAt: "desc" },
      take,
    }),
    // In-app messages the client sent or received. Skipped when the caller is
    // filtering to a specific offline channel, since none of these are it.
    options.channel && options.channel !== "email"
      ? Promise.resolve([])
      : db.message.findMany({
          where: {
            deletedAt: null,
            OR: [{ senderId: clientId }, { recipientId: clientId }],
          },
          include: {
            sender: { select: { firstName: true, lastName: true } },
          },
          orderBy: { createdAt: "desc" },
          take,
        }),
  ]);

  const entries: CommunicationEntry[] = [
    ...logged.map((row) => ({
      id: row.id,
      source: "logged" as const,
      channel: row.channel,
      direction: row.direction,
      subject: row.subject,
      body: row.body,
      occurredAt: row.occurredAt.toISOString(),
      propertyName: row.property?.name ?? null,
      recordedBy: personName(row.recordedBy),
      followUpAt: row.followUpAt ? row.followUpAt.toISOString() : null,
      followUpDone: row.followUpDone,
      editable: true,
    })),
    ...messages.map((row) => ({
      id: row.id,
      source: "message" as const,
      channel: "in_app",
      // From the client's point of view: a message they sent is inbound to
      // the office, one they received is outbound from it.
      direction: row.senderId === clientId ? "inbound" : "outbound",
      subject: row.subject ?? row.content.slice(0, 80),
      body: row.content,
      occurredAt: row.createdAt.toISOString(),
      propertyName: null,
      recordedBy: personName(row.sender),
      followUpAt: null,
      followUpDone: false,
      editable: false,
    })),
  ].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const openFollowUps = logged.filter(
    (row) => row.followUpAt && !row.followUpDone && row.followUpAt <= now,
  ).length;

  return {
    entries: entries.slice(0, take),
    summary: {
      total: entries.length,
      logged: logged.length,
      messages: messages.length,
      openFollowUps,
      lastContactAt: entries[0]?.occurredAt ?? null,
    },
  };
}

/**
 * Follow-ups that are due across every client — the office's call-back list.
 */
export async function dueFollowUps(
  now: Date = new Date(),
  limit = 50,
): Promise<
  Array<{
    id: string;
    clientId: string;
    clientName: string | null;
    subject: string;
    channel: string;
    followUpAt: string;
    overdueDays: number;
  }>
> {
  const rows = await db.clientCommunication.findMany({
    where: {
      deletedAt: null,
      followUpDone: false,
      followUpAt: { not: null, lte: now },
    },
    include: { client: { select: { firstName: true, lastName: true } } },
    orderBy: { followUpAt: "asc" },
    take: limit,
  });

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: personName(row.client),
    subject: row.subject,
    channel: row.channel,
    followUpAt: row.followUpAt!.toISOString(),
    overdueDays: Math.max(
      0,
      Math.floor((now.getTime() - row.followUpAt!.getTime()) / 86_400_000),
    ),
  }));
}
