/**
 * PropertyPro - Message a tenant about one payment
 *
 * The WhatsApp and SMS icons beside each row on the Payments page.
 *
 * GET               → what would be sent: the event (receipt, reminder or
 *                     overdue notice), its text, the tenant and their number,
 *                     and whether each channel is set up for the office.
 * POST { channel }  → send it through the office's gateway. A message that
 *                     went out joins the tenant's communication history, as
 *                     one sent from their client page does.
 *
 * The text comes from the payment (lib/payments/payment-message); the office
 * does not type it, so a WhatsApp through Meta can go as the event's
 * approved template.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { paymentScope } from "@/lib/db/scopes";
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
  getOfficeMessagingSettings,
  resolveMessagingGateway,
} from "@/lib/messaging/store";
import { toE164 } from "@/lib/messaging/providers";
import {
  isMessagingChannel,
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "@/lib/messaging/registry";
import { paymentMessageFor } from "@/lib/payments/payment-message";

type Params = { params: Promise<{ id: string }> };

// The office's payment desk: whoever may work a payment may tell its tenant.
const PAYMENT_DESK = ["payment_edit", "payment_processing", "financial_management"];

export const GET = withPermissionAndDB(PAYMENT_DESK)(
  async (user: AuthenticatedAccessUser, _request: NextRequest, { params }: Params) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) return createErrorResponse("Invalid payment ID", 400);

      const built = await paymentMessageFor(id, paymentScope(user));
      if (!built.ok) return createErrorResponse(built.error, built.status);

      const office = await getOfficeMessagingSettings();
      const channels = {} as Record<MessagingChannel, { enabled: boolean; ready: boolean }>;
      for (const channel of MESSAGING_CHANNELS) {
        channels[channel] = {
          enabled: office[channel].enabled,
          ready: Boolean(await resolveMessagingGateway(channel, office)),
        };
      }

      return createSuccessResponse({
        event: built.event,
        body: built.message.body,
        recipient: {
          id: built.tenantId,
          name: built.tenantName,
          phone: built.phone,
          phoneUsable: Boolean(toE164(built.phone)),
        },
        channels,
      });
    } catch (error) {
      return handleApiError(error, "Failed to prepare the message");
    }
  },
);

export const POST = withPermissionAndDB(PAYMENT_DESK, {
  // Every call is a paid message.
  rateLimit: { windowMs: 60_000, maxRequests: 20 },
})(async (user: AuthenticatedAccessUser, request: NextRequest, { params }: Params) => {
  try {
    const { id } = await params;
    if (!isValidObjectId(id)) return createErrorResponse("Invalid payment ID", 400);

    const parsed = await parseRequestBody(request);
    const channel = (parsed.data as Record<string, unknown> | undefined)?.channel;
    if (!isMessagingChannel(channel)) {
      return createErrorResponse("Choose SMS or WhatsApp", 400);
    }

    const built = await paymentMessageFor(id, paymentScope(user));
    if (!built.ok) return createErrorResponse(built.error, built.status);

    const outcome = await sendMessage({
      channel,
      purpose: "manual",
      event: built.event,
      recipient: { userId: built.tenantId },
      body: built.message.body,
      templateParams: built.message.templateParams,
      language: built.language,
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
        clientId: built.tenantId,
        channel,
        direction: "outbound",
        subject: built.message.body.split("\n")[0].slice(0, 80),
        body: built.message.body,
        occurredAt: new Date(),
        recordedById: user.id,
      } as Prisma.ClientCommunicationUncheckedCreateInput,
    });
    if (outcome.logId) {
      await linkMessageToCommunication(outcome.logId, communication.id);
    }

    return createSuccessResponse({ outcome, event: built.event }, "Message sent");
  } catch (error) {
    return handleApiError(error, "Failed to send the message");
  }
});
