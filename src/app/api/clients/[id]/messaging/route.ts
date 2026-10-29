/**
 * PropertyPro - Texting a tenant or owner by hand
 *
 * `[id]` is the client's USER id, as in the communication history beside it.
 *
 * GET   → what can be sent: each channel's state for the office, the
 *         client's number, and whether they opted out of each channel.
 * POST  { channel, body, subject? } → send through the office's gateway. A
 *         message that went out is recorded in the client's communication
 *         history (ClientCommunication, outbound) and linked from the log.
 * PATCH { sms?, whatsapp? } → record that the client asked to stop (false) or
 *         to receive again (true) on a channel.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { sendMessage } from "@/lib/messaging/dispatch";
import { linkMessageToCommunication } from "@/lib/messaging/log";
import {
  messagingPreferencesOf,
  writeMessagingPreferences,
} from "@/lib/messaging/preferences";
import {
  getOfficeMessagingSettings,
  resolveMessagingGateway,
} from "@/lib/messaging/store";
import { toE164 } from "@/lib/messaging/providers";
import {
  isMessagingChannel,
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "@/lib/messaging/registry";

type Params = { params: Promise<{ id: string }> };

const MAX_BODY = 1000;

async function findClient(id: string) {
  if (!isValidObjectId(id)) return null;
  return db.user.findFirst({
    where: { id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      notificationPreferences: true,
    },
  });
}

export const GET = withPermissionAndDB(["tenant_management", "user_view"])(
  async (_user: AuthenticatedAccessUser, _request: NextRequest, { params }: Params) => {
    try {
      const { id } = await params;
      const client = await findClient(id);
      if (!client) return createErrorResponse("Client not found", 404);

      const office = await getOfficeMessagingSettings();
      const channels = {} as Record<
        MessagingChannel,
        { enabled: boolean; ready: boolean }
      >;
      for (const channel of MESSAGING_CHANNELS) {
        channels[channel] = {
          enabled: office[channel].enabled,
          ready: Boolean(await resolveMessagingGateway(channel, office)),
        };
      }

      return createSuccessResponse({
        channels,
        phone: client.phone ?? null,
        phoneUsable: Boolean(toE164(client.phone)),
        receives: messagingPreferencesOf(client.notificationPreferences),
      });
    } catch (error) {
      return handleApiError(error, "Failed to load the message options");
    }
  },
);

export const POST = withPermissionAndDB(["tenant_management", "user_management"], {
  // Every call is a paid message.
  rateLimit: { windowMs: 60_000, maxRequests: 20 },
})(async (user: AuthenticatedAccessUser, request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    const client = await findClient(id);
    if (!client) return createErrorResponse("Client not found", 404);

    const parsed = await parseRequestBody(request);
    const body = (parsed.data ?? {}) as Record<string, unknown>;
    if (!isMessagingChannel(body.channel)) {
      return createErrorResponse("Choose SMS or WhatsApp", 400);
    }
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) return createErrorResponse("Write the message first", 400);
    if (text.length > MAX_BODY) {
      return createErrorResponse(`Keep the message under ${MAX_BODY} characters`, 400);
    }
    const subject =
      (typeof body.subject === "string" && body.subject.trim().slice(0, 200)) ||
      text.split("\n")[0].slice(0, 80);

    const outcome = await sendMessage({
      channel: body.channel,
      purpose: "manual",
      recipient: { userId: client.id },
      body: text,
      sentById: user.id,
    });

    if (outcome.status !== "sent") {
      return createErrorResponse(
        outcome.reason ?? "Not sent",
        outcome.status === "failed" ? 502 : 400,
        undefined,
        `${outcome.status}:${outcome.reason ?? ""}`,
      );
    }

    const communication = await db.clientCommunication.create({
      data: {
        organizationId: user.organizationId!,
        clientId: client.id,
        channel: body.channel,
        direction: "outbound",
        subject,
        body: text,
        occurredAt: new Date(),
        recordedById: user.id,
      } as Prisma.ClientCommunicationUncheckedCreateInput,
    });
    if (outcome.logId) {
      await linkMessageToCommunication(outcome.logId, communication.id);
    }

    return createSuccessResponse({ communication, outcome }, "Message sent");
  } catch (error) {
    return handleApiError(error, "Failed to send the message");
  }
});

export const PATCH = withPermissionAndDB(["tenant_management", "user_management"])(
  async (_user: AuthenticatedAccessUser, request: NextRequest, { params }: Params) => {
    try {
      const { id } = await params;
      const client = await findClient(id);
      if (!client) return createErrorResponse("Client not found", 404);

      const parsed = await parseRequestBody(request);
      const body = (parsed.data ?? {}) as Record<string, unknown>;
      const receives = await writeMessagingPreferences(client.id, {
        sms: typeof body.sms === "boolean" ? body.sms : undefined,
        whatsapp: typeof body.whatsapp === "boolean" ? body.whatsapp : undefined,
      });
      return createSuccessResponse({ receives }, "Preferences saved");
    } catch (error) {
      return handleApiError(error, "Failed to save the preferences");
    }
  },
);
