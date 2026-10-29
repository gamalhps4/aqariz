/**
 * PropertyPro SaaS - Test the default SMS/WhatsApp gateway (super-admin)
 *
 * POST { channel, phone } → one short message through the platform's gateway
 * (or the environment's, when none is saved). Outside any office, so it is
 * neither logged against one nor counted toward a quota.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { getPlatformSettings } from "@/lib/platform/settings";
import { translateFor } from "@/lib/i18n/translate";
import { sendPlatformTestMessage } from "@/lib/messaging/dispatch";
import { isMessagingChannel } from "@/lib/messaging/registry";

export const POST = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const parsed = await parseRequestBody(request);
    const body = (parsed.data ?? {}) as Record<string, unknown>;
    if (!isMessagingChannel(body.channel)) {
      return createErrorResponse("Choose SMS or WhatsApp", 400);
    }
    const phone = typeof body.phone === "string" ? body.phone.trim() : "";
    if (!phone) return createErrorResponse("Enter the number to send to", 400);

    const platform = await getPlatformSettings();
    const language =
      typeof body.language === "string" ? body.language : "ar";
    const outcome = await sendPlatformTestMessage(
      body.channel,
      phone,
      translateFor(language, "settings.messaging.testBody", {
        office: platform.general.platformName || "PropertyPro",
      }),
    );
    if (outcome.status === "sent") {
      return createSuccessResponse(outcome, "Test message sent");
    }
    return createErrorResponse(
      outcome.reason ?? "Not sent",
      outcome.status === "failed" ? 502 : 400,
      undefined,
      `${outcome.status}:${outcome.reason ?? ""}`,
    );
  } catch (error) {
    return handleApiError(error, "Failed to send the test message");
  }
  },
);
