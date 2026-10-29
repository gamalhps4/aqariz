/**
 * PropertyPro - Messaging settings API (Settings → Messaging)
 *
 * GET  → the office's SMS and WhatsApp settings (secrets reduced to "set"),
 *        whether the platform's default gateway can carry each channel, this
 *        month's quota usage, and the webhook URLs for delivery reports.
 * PUT  → per channel: on/off, own account or the platform's, provider,
 *        credentials (a secret left blank keeps the stored one), WhatsApp
 *        templates; and the per-event switches.
 *
 * The provider list and fields come from src/lib/messaging/registry.ts.
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
import { resolveApplicationOrigin } from "@/lib/billing/origin";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { getPlanByKey } from "@/lib/billing/plans";
import {
  applyGatewayPatch,
  gatewayMissing,
  gatewayView,
  normalizeEventSwitches,
  type OfficeMessagingSettings,
} from "@/lib/messaging/config";
import {
  encryptSecret,
  generateVerifyToken,
  getOfficeMessagingSettings,
  resolvePlatformGateway,
  saveOfficeMessagingSettings,
} from "@/lib/messaging/store";
import { countQuotaMessagesThisMonth } from "@/lib/messaging/log";
import { forgetOfficeMessagingContext } from "@/lib/messaging/dispatch";
import {
  MESSAGING_CHANNELS,
  type MessagingChannel,
} from "@/lib/messaging/registry";
import { auditSettingsChange } from "@/lib/audit-domain";
import {
  MESSAGING_AUDIT_SECRETS,
  messagingAuditKeys,
  messagingSnapshot,
} from "@/lib/audit/settings-keys";

async function buildResponse(
  settings: OfficeMessagingSettings,
  organizationId: string,
  origin: string,
) {
  const channels = {} as Record<MessagingChannel, unknown>;
  const platform = {} as Record<
    MessagingChannel,
    { ready: boolean; provider: string | null }
  >;
  for (const channel of MESSAGING_CHANNELS) {
    const office = settings[channel];
    channels[channel] = {
      enabled: office.enabled,
      useOwnGateway: office.useOwnGateway,
      ...gatewayView(channel, office),
    };
    const shared = await resolvePlatformGateway(channel);
    platform[channel] = {
      ready: Boolean(shared),
      provider: shared?.provider ?? null,
    };
  }

  const [organization, used, planKey] = await Promise.all([
    db.organization.findFirst({ select: { slug: true } }),
    countQuotaMessagesThisMonth(),
    getEffectivePlan(organizationId),
  ]);
  const plan = await getPlanByKey(planKey);
  const slug = organization?.slug;

  return {
    ...channels,
    events: settings.events,
    platform,
    usage: {
      used,
      limit: plan?.limits.messagesPerMonth ?? null,
      planName: plan?.name ?? null,
    },
    webhooks: slug
      ? {
          meta: `${origin}/api/messaging/webhook/meta/${slug}`,
          twilio: `${origin}/api/messaging/webhook/twilio/${slug}`,
        }
      : null,
  };
}

export const GET = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const settings = await getOfficeMessagingSettings();
      return createSuccessResponse(
        await buildResponse(
          settings,
          user.organizationId!,
          resolveApplicationOrigin(request),
        ),
      );
    } catch (error) {
      return handleApiError(error, "Failed to load the messaging settings");
    }
  },
);

export const PUT = withPermissionAndDB("system_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const parsed = await parseRequestBody(request);
      if (!parsed.success || !parsed.data || typeof parsed.data !== "object") {
        return createErrorResponse("Invalid request body", 400);
      }
      const body = parsed.data as Record<string, unknown>;
      const current = await getOfficeMessagingSettings();
      const next: OfficeMessagingSettings = {
        sms: { ...current.sms },
        whatsapp: { ...current.whatsapp },
        events: current.events,
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
        const settings = {
          ...gateway,
          enabled:
            typeof input.enabled === "boolean"
              ? input.enabled
              : current[channel].enabled,
          useOwnGateway:
            typeof input.useOwnGateway === "boolean"
              ? input.useOwnGateway
              : current[channel].useOwnGateway,
        };
        // An office that sends through its own account must have all of it:
        // a half-filled account would silently send nothing.
        if (settings.useOwnGateway) {
          const missing = gatewayMissing(channel, settings);
          if (missing.length > 0) {
            return createErrorResponse(
              `Missing ${missing.join(", ")}`,
              400,
              undefined,
              `missing_fields:${channel}:${missing.join(",")}`,
            );
          }
        }
        next[channel] = settings;
      }

      if (body.events !== undefined) {
        next.events = normalizeEventSwitches(body.events);
      }

      await saveOfficeMessagingSettings(user.organizationId!, user.id, next);

      // One entry: channels on or off, own account or the platform's, provider,
      // sender, templates and event switches that moved. Credentials are
      // compared but recorded only as "set".
      auditSettingsChange({
        area: "messaging",
        before: messagingSnapshot(current, { office: true }),
        after: messagingSnapshot(next, { office: true }),
        keys: messagingAuditKeys({ office: true }),
        secretKeys: MESSAGING_AUDIT_SECRETS,
      });

      forgetOfficeMessagingContext(user.organizationId!);

      return createSuccessResponse(
        await buildResponse(
          next,
          user.organizationId!,
          resolveApplicationOrigin(request),
        ),
        "Messaging settings saved",
      );
    } catch (error) {
      return handleApiError(error, "Failed to save the messaging settings");
    }
  },
);
