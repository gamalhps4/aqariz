import "server-only";

/**
 * PropertyPro - The message log (`message_logs`)
 *
 * Every SMS and WhatsApp message an office sends, or tried to and was stopped
 * from sending, is one row: what was sent to whom, through which gateway,
 * what the provider said, and — where the provider reports back — whether it
 * arrived. The package quota is counted from here.
 *
 * Writes never throw into the send path: a message that went out but could
 * not be logged is still a message that went out. A database without the
 * migration simply has no log (and no quota usage) until it is applied.
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import { startOfBusinessDay } from "@/lib/dates/business-day";
import {
  statusAdvances,
  type BlockReason,
  type GatewaySource,
  type MessagePurpose,
  type MessageStatus,
  type MessagingChannel,
  type MessagingEvent,
  type MessagingProviderId,
} from "./registry";
import type { StatusReport } from "./webhooks";

export interface MessageLogInput {
  organizationId: string;
  channel: MessagingChannel;
  provider: MessagingProviderId | "none";
  gatewaySource: GatewaySource | "none";
  event: MessagingEvent | null;
  purpose: MessagePurpose;
  status: MessageStatus;
  blockReason?: BlockReason | null;
  recipientUserId?: string | null;
  recipientName?: string | null;
  toNumber?: string | null;
  body: string;
  templateName?: string | null;
  providerMessageId?: string | null;
  error?: string | null;
  countsTowardQuota: boolean;
  sentById?: string | null;
  communicationId?: string | null;
}

/** Write one log row. Returns its id, or null when it could not be written. */
export async function recordMessage(
  input: MessageLogInput,
): Promise<string | null> {
  try {
    const row = await db.messageLog.create({
      data: {
        organizationId: input.organizationId,
        channel: input.channel,
        provider: input.provider,
        gatewaySource: input.gatewaySource,
        event: input.event,
        purpose: input.purpose,
        status: input.status,
        blockReason: input.blockReason ?? null,
        recipientUserId: input.recipientUserId ?? null,
        recipientName: input.recipientName?.slice(0, 200) ?? null,
        toNumber: input.toNumber ?? null,
        body: input.body.slice(0, 2000),
        templateName: input.templateName ?? null,
        providerMessageId: input.providerMessageId ?? null,
        error: input.error?.slice(0, 500) ?? null,
        countsTowardQuota: input.countsTowardQuota,
        sentById: input.sentById ?? null,
        communicationId: input.communicationId ?? null,
      } as Prisma.MessageLogUncheckedCreateInput,
      select: { id: true },
    });
    return row.id;
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("Failed to write the message log", error);
    }
    return null;
  }
}

/** Link a logged message to the communication entry it produced. */
export async function linkMessageToCommunication(
  logId: string,
  communicationId: string,
): Promise<void> {
  try {
    await db.messageLog.update({
      where: { id: logId },
      data: { communicationId },
    });
  } catch (error) {
    console.error("Failed to link the message log entry", error);
  }
}

/**
 * The first instant of the current calendar month, in UTC — the window every
 * monthly plan limit is measured over (billing/usage.ts), so the quota resets
 * at the same moment as the invoice limit.
 */
export function startOfQuotaMonth(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * Messages the current organization sent this month through the platform's
 * gateway — what the package quota counts. 0 when there is no log yet.
 */
export async function countQuotaMessagesThisMonth(): Promise<number> {
  try {
    return await db.messageLog.count({
      where: {
        countsTowardQuota: true,
        createdAt: { gte: startOfQuotaMonth() },
      },
    });
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("Failed to count this month's messages", error);
    }
    return 0;
  }
}

/**
 * Test sends the current organization made today (Riyadh's day) that reached
 * a provider — what the daily test cap counts. Blocked attempts cost nothing
 * and are not counted.
 */
export async function countTestSendsToday(now: Date = new Date()): Promise<number> {
  try {
    return await db.messageLog.count({
      where: {
        purpose: "test",
        status: { not: "blocked" },
        createdAt: { gte: startOfBusinessDay(now) },
      },
    });
  } catch (error) {
    if (!isMissingSchemaError(error)) {
      console.error("Failed to count today's test messages", error);
    }
    return 0;
  }
}

/**
 * Apply delivery reports. Each moves its message forward only (a late
 * "delivered" never undoes a "read"). `scope` limits which rows a report may
 * touch: an office's webhook its own messages, the platform's webhook the
 * messages that went through the platform's gateway.
 */
export async function applyStatusReports(
  provider: MessagingProviderId,
  reports: StatusReport[],
  scope: "office" | "platform",
): Promise<number> {
  let applied = 0;
  for (const report of reports) {
    try {
      const run = async () => {
        const rows = await db.messageLog.findMany({
          where: {
            provider,
            providerMessageId: report.reference,
            gatewaySource:
              scope === "office" ? "office" : { in: ["platform", "env"] },
          },
          select: { id: true, status: true },
          take: 5,
        });
        for (const row of rows) {
          if (!statusAdvances(row.status as MessageStatus, report.status)) {
            continue;
          }
          await db.messageLog.update({
            where: { id: row.id },
            data: {
              status: report.status,
              statusUpdatedAt: new Date(),
              ...(report.error ? { error: report.error.slice(0, 500) } : {}),
            },
          });
          applied += 1;
        }
      };
      // The platform's gateway carries every office's messages: its reports
      // are matched across organizations by the provider's own message id.
      await (scope === "platform" ? bypassOrgScope(run) : run());
    } catch (error) {
      if (!isMissingSchemaError(error)) {
        console.error("Failed to apply a delivery report", error);
      }
    }
  }
  return applied;
}

export interface MessageLogFilters {
  channel?: MessagingChannel;
  status?: MessageStatus;
  event?: MessagingEvent;
  search?: string;
  page: number;
  limit: number;
}

export interface MessageLogRow {
  id: string;
  channel: string;
  provider: string;
  gatewaySource: string;
  event: string | null;
  purpose: string;
  status: string;
  blockReason: string | null;
  recipientUserId: string | null;
  recipientName: string | null;
  toNumber: string | null;
  body: string;
  templateName: string | null;
  error: string | null;
  createdAt: Date;
  statusUpdatedAt: Date | null;
}

/** One page of the current organization's log, newest first. */
export async function listMessageLogs(filters: MessageLogFilters): Promise<{
  rows: MessageLogRow[];
  total: number;
  available: boolean;
}> {
  const where: Prisma.MessageLogWhereInput = {
    ...(filters.channel ? { channel: filters.channel } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.event ? { event: filters.event } : {}),
    ...(filters.search
      ? {
          OR: [
            { recipientName: { contains: filters.search, mode: "insensitive" } },
            { toNumber: { contains: filters.search.replace(/[^\d+]/g, "") || filters.search } },
            { body: { contains: filters.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  try {
    const [rows, total] = await Promise.all([
      db.messageLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
        select: {
          id: true,
          channel: true,
          provider: true,
          gatewaySource: true,
          event: true,
          purpose: true,
          status: true,
          blockReason: true,
          recipientUserId: true,
          recipientName: true,
          toNumber: true,
          body: true,
          templateName: true,
          error: true,
          createdAt: true,
          statusUpdatedAt: true,
        },
      }),
      db.messageLog.count({ where }),
    ]);
    return { rows, total, available: true };
  } catch (error) {
    if (isMissingSchemaError(error)) return { rows: [], total: 0, available: false };
    throw error;
  }
}
