/**
 * PropertyPro - Test send (Settings → Messaging)
 *
 * POST { channel, phone } → one short message through the gateway the office
 * would use for that channel right now (its own account, or the platform's),
 * so an office can try its credentials before switching the channel on. Test
 * sends are logged like any other, and on the platform's gateway they count
 * toward the package quota — they are real messages.
 *
 * A package without Messaging sends none. On the office's own account a test
 * may go to any number; on the platform's only to the sender's own Saudi
 * mobile number on file, so the platform's account is not a free SMS relay
 * for a trial office. Ten a day either way (lib/messaging/decide.ts).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { db } from "@/lib/db/prisma";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { translateFor } from "@/lib/i18n/translate";
import { sendMessage } from "@/lib/messaging/dispatch";
import { officeName } from "@/lib/messaging/events";
import { isMessagingChannel } from "@/lib/messaging/registry";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

export const POST = withPermissionAndDB("system_settings", {
  // Every call is a paid message.
  rateLimit: { windowMs: 60_000, maxRequests: 5 },
})(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const parsed = await parseRequestBody(request);
    const body = (parsed.data ?? {}) as Record<string, unknown>;
    if (!isMessagingChannel(body.channel)) {
      return createErrorResponse("Choose SMS or WhatsApp", 400);
    }
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!phone) return createErrorResponse("Enter the number to send to", 400);

    const [locale, sender] = await Promise.all([
      recipientLocale(),
      db.user.findFirst({ where: { id: user.id }, select: { phone: true } }),
    ]);
    const outcome = await sendMessage({
      channel: body.channel,
      purpose: "test",
      recipient: { phone, name: null },
      body: translateFor(locale, "settings.messaging.testBody", {
        office: await officeName(),
      }),
      sentById: user.id,
      testerPhone: sender?.phone ?? null,
    });

    if (outcome.status === "sent") {
      // A real, paid message went out; the API wrapper would call it an email
      // sent (a path ending in /test).
      void recordActivity({
        action: AuditAction.SMS_SENT,
        recordType: "settings",
        recordId: "messaging",
        recordName: "messaging",
        messageKey: "admin.audit.msg.settings_test_message",
        messageParams: {
          channel: body.channel === "whatsapp" ? "WhatsApp" : "SMS",
        },
      });
      return createSuccessResponse(outcome, "Test message sent");
    }
    // The page words the reason; the code carries it.
    return createErrorResponse(
      outcome.reason ?? "Not sent",
      outcome.status === "failed" ? 502 : 400,
      undefined,
      `${outcome.status}:${outcome.reason ?? ""}`,
    );
  } catch (error) {
    return handleApiError(error, "Failed to send the test message");
  }
});
