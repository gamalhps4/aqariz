import "server-only";

/**
 * PropertyPro - Sending an SMS or WhatsApp message for an office
 *
 * The one path every message takes — automated notices, a staff member's
 * message to a tenant or owner, and the settings screen's test send:
 *
 *   1. the office's settings: the channel on, the event switched on for it;
 *   2. the recipient: not opted out (`notificationPreferences.sms/whatsapp`
 *      set to false), with a usable number;
 *   3. the gateway: the office's own account, else the Super Admin's
 *      default, else the environment's (`store.ts`);
 *   4. the package quota, for messages on the platform's gateway;
 *   5. for WhatsApp through Meta, the event's approved template in the
 *      recipient's language;
 *   6. the provider call, and a row in `message_logs` with the outcome.
 *
 * Runs inside the office's organization context (a request, or a cron sweep's
 * `forEachOrganization`). Never throws: the outcome says what happened.
 */

import { db } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import {
  effectivePlanOf,
  EFFECTIVE_PLAN_SELECT,
  organizationRowHasModule,
} from "@/lib/billing/entitlements";
import { getPlanByKey } from "@/lib/billing/plans";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { pickTemplate, type ResolvedGateway } from "./config";
import {
  decideSend,
  isOptedOut,
  TEST_SENDS_PER_DAY,
  testRecipientAllowed,
  type SkipReason,
} from "./decide";
import {
  countQuotaMessagesThisMonth,
  countTestSendsToday,
  recordMessage,
} from "./log";
import { deliverMessage, toE164, type OutboundTemplate } from "./providers";
import {
  getOfficeMessagingSettings,
  resolveMessagingGateway,
  resolvePlatformGateway,
} from "./store";
import type {
  BlockReason,
  GatewaySource,
  MessagePurpose,
  MessagingChannel,
  MessagingEvent,
} from "./registry";

/** The menu module that opens Settings → Messaging; sending follows it. */
export const MESSAGING_MODULE_KEY = "settings.messaging";

export interface SendMessageInput {
  channel: MessagingChannel;
  purpose: MessagePurpose;
  /** The automated event; null for manual and test sends. */
  event?: MessagingEvent | null;
  recipient: {
    userId?: string | null;
    /** Overrides the user's own number (test sends, a typed number). */
    phone?: string | null;
    name?: string | null;
  };
  body: string;
  /** Values for the event's named template parameters. */
  templateParams?: Record<string, string>;
  /** "ar" or "en": which template language. Defaults to the office's. */
  language?: string;
  sentById?: string | null;
  /** A test send: the sender's own number on file (decide.ts). */
  testerPhone?: string | null;
  communicationId?: string | null;
}

export interface SendOutcome {
  status: "sent" | "failed" | "blocked" | "skipped";
  /** Skip or block reason, or the provider's error. */
  reason?: SkipReason | BlockReason | string;
  logId?: string | null;
  reference?: string;
  source?: GatewaySource;
}

// ============================================================================
// What the office's package allows, read once per office per sweep
// ============================================================================

interface OfficeContext {
  moduleEnabled: boolean;
  quotaLimit: number | null;
  slug: string | null;
  at: number;
}

const CONTEXT_TTL_MS = 30_000;
const contexts = new Map<string, OfficeContext>();

async function officeContext(organizationId: string): Promise<OfficeContext> {
  const cached = contexts.get(organizationId);
  if (cached && Date.now() - cached.at < CONTEXT_TTL_MS) return cached;

  const organization = await db.organization.findFirst({
    where: { id: organizationId },
    select: { ...EFFECTIVE_PLAN_SELECT, slug: true },
  });
  let moduleEnabled = false;
  let quotaLimit: number | null = null;
  if (organization) {
    const [enabled, plan] = await Promise.all([
      organizationRowHasModule(organization, MESSAGING_MODULE_KEY),
      effectivePlanOf(organization).then((key) => getPlanByKey(key)),
    ]);
    moduleEnabled = enabled;
    quotaLimit = plan?.limits.messagesPerMonth ?? null;
  }
  const context: OfficeContext = {
    moduleEnabled,
    quotaLimit,
    slug: organization?.slug ?? null,
    at: Date.now(),
  };
  if (contexts.size > 500) contexts.clear();
  contexts.set(organizationId, context);
  return context;
}

/** Forget an office's cached package (after a settings save). */
export function forgetOfficeMessagingContext(organizationId: string): void {
  contexts.delete(organizationId);
}

function applicationOrigin(): string | null {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  return configured ? configured.trim().replace(/\/+$/, "") : null;
}

/**
 * Where Twilio reports on a message: the office's own URL for its own
 * account (verified with its token), the platform's for the shared one.
 */
function statusCallbackUrl(
  gateway: ResolvedGateway,
  slug: string | null,
): string | null {
  if (gateway.provider !== "twilio") return null;
  const origin = applicationOrigin();
  if (!origin) return null;
  if (gateway.source === "office") {
    return slug ? `${origin}/api/messaging/webhook/twilio/${slug}` : null;
  }
  return `${origin}/api/messaging/webhook/twilio`;
}

function templateFor(
  gateway: ResolvedGateway,
  event: MessagingEvent,
  language: string,
  values: Record<string, string>,
): OutboundTemplate | null {
  const template = pickTemplate(gateway.templates, event, language);
  if (!template) return null;
  const params: Record<string, string> = {};
  for (const name of template.params) params[name] = values[name] ?? "";
  return { name: template.name, language: template.language, params };
}

// ============================================================================
// Sending
// ============================================================================

export async function sendMessage(input: SendMessageInput): Promise<SendOutcome> {
  try {
    return await send(input);
  } catch (error) {
    console.error(`[${input.channel}] send path failed`, error);
    return { status: "failed", reason: (error as Error)?.message ?? "Error" };
  }
}

async function send(input: SendMessageInput): Promise<SendOutcome> {
  const organizationId = getOrgContext()?.organizationId;
  if (!organizationId) return { status: "skipped", reason: "not_configured" };

  const { channel, purpose } = input;
  const event = input.event ?? null;
  const [office, context] = await Promise.all([
    getOfficeMessagingSettings(),
    officeContext(organizationId),
  ]);

  const user = input.recipient.userId
    ? await db.user.findFirst({
        where: { id: input.recipient.userId },
        select: {
          firstName: true,
          lastName: true,
          phone: true,
          notificationPreferences: true,
        },
      })
    : null;
  const to = toE164(input.recipient.phone ?? user?.phone ?? null);
  const recipientName =
    input.recipient.name ??
    ([user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || null);

  const gateway = await resolveMessagingGateway(channel, office);
  const onPlatform = Boolean(gateway && gateway.source !== "office");
  const test = purpose === "test";
  // Counted from the log at every send, never kept: a count held in one
  // server process is not what the others have sent.
  const [used, testsToday] = await Promise.all([
    onPlatform && context.quotaLimit !== null
      ? countQuotaMessagesThisMonth()
      : Promise.resolve(0),
    test ? countTestSendsToday() : Promise.resolve(0),
  ]);

  // Meta delivers business-initiated WhatsApp only as an approved template.
  // An event message goes as the event's template whoever sent it: the
  // automatic ones, and one an office sends by hand about a payment (the
  // Payments page icons, lib/payments/payment-message).
  const needsTemplate =
    channel === "whatsapp" && gateway?.provider === "meta" && event !== null;
  const template =
    needsTemplate && gateway && event
      ? templateFor(
          gateway,
          event,
          input.language ?? (await recipientLocale({ organizationId })).language,
          input.templateParams ?? {},
        )
      : null;

  const decision = decideSend({
    purpose,
    moduleEnabled: context.moduleEnabled,
    channelEnabled: office[channel].enabled,
    // The per-event switches decide what goes out on its own; an office
    // sending a message by hand has already decided.
    eventEnabled:
      event && purpose === "automation" ? office.events[event][channel] : true,
    hasGateway: Boolean(gateway),
    optedOut: isOptedOut(user?.notificationPreferences, channel),
    hasPhone: Boolean(to),
    needsTemplate,
    hasTemplate: Boolean(template),
    quota: onPlatform ? { limit: context.quotaLimit, used } : null,
    testRecipientAllowed: test
      ? testRecipientAllowed({
          source: gateway?.source ?? null,
          to,
          ownPhone: toE164(input.testerPhone ?? null),
        })
      : undefined,
    testsToday: test ? { used: testsToday, limit: TEST_SENDS_PER_DAY } : null,
  });

  const base = {
    organizationId,
    channel,
    event,
    purpose,
    recipientUserId: input.recipient.userId ?? null,
    recipientName,
    toNumber: to,
    body: input.body,
    sentById: input.sentById ?? null,
    communicationId: input.communicationId ?? null,
  };

  if (decision.action === "skip") {
    return { status: "skipped", reason: decision.reason };
  }
  if (decision.action === "block") {
    const logId = await recordMessage({
      ...base,
      provider: gateway?.provider ?? "none",
      gatewaySource: gateway?.source ?? "none",
      status: "blocked",
      blockReason: decision.reason,
      countsTowardQuota: false,
    });
    return { status: "blocked", reason: decision.reason, logId };
  }

  const resolved = gateway!;
  const result = await deliverMessage(resolved, {
    to: to!,
    body: input.body,
    template,
    statusCallbackUrl: statusCallbackUrl(resolved, context.slug),
  });
  const counts = result.ok && onPlatform;

  const logId = await recordMessage({
    ...base,
    provider: resolved.provider,
    gatewaySource: resolved.source,
    status: result.ok ? "sent" : "failed",
    templateName: template?.name ?? null,
    providerMessageId: result.reference ?? null,
    error: result.ok ? null : (result.error ?? null),
    countsTowardQuota: counts,
  });
  return {
    status: result.ok ? "sent" : "failed",
    reason: result.ok ? undefined : result.error,
    logId,
    reference: result.reference,
    source: resolved.source,
  };
}

/**
 * The Super Admin's test send: the platform's gateway (or the environment's),
 * outside any office, so nothing is logged against one.
 */
export async function sendPlatformTestMessage(
  channel: MessagingChannel,
  phone: string,
  body: string,
): Promise<SendOutcome> {
  const gateway = await resolvePlatformGateway(channel);
  if (!gateway) return { status: "skipped", reason: "not_configured" };
  const to = toE164(phone);
  if (!to) return { status: "blocked", reason: "no_phone" };
  const result = await deliverMessage(gateway, { to, body });
  return {
    status: result.ok ? "sent" : "failed",
    reason: result.ok ? undefined : result.error,
    reference: result.reference,
    source: gateway.source,
  };
}
