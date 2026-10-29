/**
 * PropertyPro SaaS - The default SMS and WhatsApp gateway (super-admin)
 *
 * Offices that have not connected their own provider account send through
 * this one, up to their package's monthly message quota.
 *
 * GET → the gateway per channel (secrets reduced to "set"), whether the
 *       database has the column yet, what the environment configures, and the
 *       webhook URLs for delivery reports.
 * PUT → { sms?, whatsapp? }: on/off, provider, credentials (a secret left
 *       blank keeps the stored one), WhatsApp templates.
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
import { resolveApplicationOrigin } from "@/lib/billing/origin";
import { recordPlatformSettingsChange } from "@/lib/audit/platform-events";
import {
  MESSAGING_AUDIT_SECRETS,
  messagingAuditKeys,
  messagingSnapshot,
} from "@/lib/audit/settings-keys";
import {
  applyGatewayPatch,
  gatewayMissing,
  gatewayView,
  type PlatformMessagingSettings,
} from "@/lib/messaging/config";
import {
  encryptSecret,
  environmentGateway,
  generateVerifyToken,
  getPlatformMessagingSettings,
  savePlatformMessagingSettings,
} from "@/lib/messaging/store";
import {
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "@/lib/messaging/registry";

function buildResponse(
  settings: PlatformMessagingSettings,
  available: boolean,
  origin: string,
) {
  const channels = {} as Record<MessagingChannel, unknown>;
  const env = {} as Record<MessagingChannel, string | null>;
  for (const channel of MESSAGING_CHANNELS) {
    channels[channel] = {
      enabled: settings[channel].enabled,
      ...gatewayView(channel, settings[channel]),
    };
    const fromEnv = environmentGateway(channel);
    env[channel] =
      fromEnv && gatewayMissing(channel, fromEnv).length === 0
        ? fromEnv.provider
        : null;
  }
  return {
    ...channels,
    available,
    env,
    webhooks: {
      meta: `${origin}/api/messaging/webhook/meta`,
      twilio: `${origin}/api/messaging/webhook/twilio`,
    },
  };
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { settings, available } = await getPlatformMessagingSettings();
      return createSuccessResponse(
        buildResponse(settings, available, resolveApplicationOrigin(request)),
      );
    } catch (error) {
      return handleApiError(error, "Failed to load the messaging gateway");
    }
  },
);

export const PUT = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const parsed = await parseRequestBody(request);
      if (!parsed.success || !parsed.data || typeof parsed.data !== "object") {
        return createErrorResponse("Invalid JSON body", 400);
      }
      const body = parsed.data as Record<string, unknown>;
      const { settings: current } = await getPlatformMessagingSettings();
      const next: PlatformMessagingSettings = {
        sms: current.sms,
        whatsapp: current.whatsapp,
      };

      for (const channel of MESSAGING_CHANNELS) {
        const patch = body[channel];
        if (!patch || typeof patch !== "object") continue;
        const input = patch as Record<string, unknown>;
        const gateway = applyGatewayPatch(
          channel,
          current[channel],
          input,
          encryptSecret,
          generateVerifyToken,
        );
        const enabled =
          typeof input.enabled === "boolean"
            ? input.enabled
            : current[channel].enabled;
        if (enabled) {
          const missing = gatewayMissing(channel, gateway);
          if (missing.length > 0) {
            return createErrorResponse(
              `Missing ${missing.join(", ")}`,
              400,
              undefined,
              `missing_fields:${channel}:${missing.join(",")}`,
            );
          }
        }
        next[channel] = { ...gateway, enabled };
      }

      await savePlatformMessagingSettings(next);
      // The before and after: channels on or off, provider, sender, templates.
      // Credentials are compared but only ever recorded as "set". Named by the
      // area code, which the console words in the reader's language.
      await recordPlatformSettingsChange({
        actor: user,
        targetId: "messaging",
        targetName: "messaging",
        summary: "Default SMS/WhatsApp gateway updated",
        before: messagingSnapshot(current, { office: false }),
        after: messagingSnapshot(next, { office: false }),
        keys: messagingAuditKeys({ office: false }),
        secretKeys: MESSAGING_AUDIT_SECRETS,
      });

      return createSuccessResponse(
        buildResponse(next, true, resolveApplicationOrigin(request)),
        "Messaging gateway saved",
      );
    } catch (error) {
      return handleApiError(error, "Failed to save the messaging gateway");
    }
  },
);
