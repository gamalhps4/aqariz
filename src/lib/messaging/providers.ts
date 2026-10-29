/**
 * PropertyPro - SMS and WhatsApp delivery
 *
 * One function per provider, each a single HTTP request: Unifonic, Taqnyat,
 * Msegat and Twilio for SMS; the Meta WhatsApp Cloud API and Twilio for
 * WhatsApp. They are called over plain `fetch` rather than an SDK — each is
 * one form or JSON POST, and an SDK per provider would be more code to keep
 * current than the requests themselves.
 *
 * Nothing here reads settings. The caller passes the gateway to send through
 * — an office's own account, the Super Admin's default, or the deployment's
 * environment variables, in that order (see `config.ts` `resolveGateway` and
 * `dispatch.ts`) — so the same request code serves every source.
 *
 * NOTHING here throws. A reminder that cannot be delivered must not take down
 * the sweep that raised it, so every failure comes back as `ok: false` with a
 * reason safe to log (never a credential), and the caller records it.
 */

import { ACTIVE_REGION } from "@/lib/regional/region";
import type { MessagingChannel, MessagingProviderId } from "./registry";

/** What a send attempt did, in a form the caller can log or store. */
export interface DeliveryResult {
  ok: boolean;
  /** The provider's own id for the message, when it gave one. */
  reference?: string;
  /** Why it failed, safe to log — never contains credentials. */
  error?: string;
}

/** The account a message goes out through, credentials in the clear. */
export interface SendGateway {
  channel: MessagingChannel;
  provider: MessagingProviderId;
  credentials: Record<string, string>;
}

export interface OutboundTemplate {
  name: string;
  language: string;
  /** Named parameter → text, only the ones the template's body uses. */
  params: Record<string, string>;
}

export interface OutboundMessage {
  /** E.164, from `toE164`. */
  to: string;
  /** The text; also what a WhatsApp template stands in for in the log. */
  body: string;
  /** Meta: an approved template, needed outside the 24-hour window. */
  template?: OutboundTemplate | null;
  /** Twilio: where its delivery reports for this message go. */
  statusCallbackUrl?: string | null;
}

/** Country calling codes for the regions the product ships in. */
const REGION_CALLING_CODES: Record<string, string> = { SA: "966" };

/**
 * Reduce a phone number to E.164.
 *
 * Numbers arrive from forms in every shape a person might type them —
 * "05x xxx xxxx", "+966 5x…", "00966…" — and every provider below rejects all
 * but the canonical form. A local number typed without a country takes
 * `DEFAULT_COUNTRY_CODE`, else the active region's (Saudi Arabia: 966).
 */
export function toE164(
  raw: string | null | undefined,
  defaultCountry: string = process.env.DEFAULT_COUNTRY_CODE ||
    REGION_CALLING_CODES[ACTIVE_REGION.code] ||
    "",
): string | null {
  if (!raw) return null;

  let digits = String(raw).replace(/[^\d+]/g, "");
  if (digits.startsWith("00")) digits = `+${digits.slice(2)}`;

  if (digits.startsWith("+")) {
    return /^\+\d{7,15}$/.test(digits) ? digits : null;
  }

  const country = defaultCountry.replace(/\D/g, "");
  if (!country) return null;

  // Drop a country code the typist already included, so it is not applied
  // twice: 966501234567 and 9660501234567 are both +966501234567, not
  // +966966501234567. Only when what remains is still long enough to be a
  // national number — otherwise the leading digits are part of the number.
  let national = digits;
  if (national.startsWith(country)) {
    const remainder = national.slice(country.length).replace(/^0+/, "");
    if (remainder.length >= 6) national = remainder;
  }

  // A local number conventionally carries a trunk "0" that the country code
  // replaces: 0501234567 in Saudi Arabia is +966501234567, not +9660501234567.
  const local = national.replace(/^0+/, "");
  if (!local) return null;

  const e164 = `+${country}${local}`;
  return /^\+\d{7,15}$/.test(e164) ? e164 : null;
}

/** The number without its "+", as most providers want it. */
function bare(to: string): string {
  return to.replace(/^\+/, "");
}

function fail(
  gateway: SendGateway,
  detail: string,
): DeliveryResult {
  console.error(
    `[${gateway.channel}/${gateway.provider}] send failed: ${detail}`,
  );
  return { ok: false, error: detail.slice(0, 500) };
}

/**
 * Every provider call goes through here so one timeout rule covers all of
 * them. Without the abort a provider that stops answering would hold a cron
 * worker open until the platform killed it.
 */
async function post(
  url: string,
  init: RequestInit,
  timeoutMs = 10_000,
): Promise<{ ok: boolean; status: number; body: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return {
      ok: response.ok,
      status: response.status,
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

function readJson(body: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body) as unknown;
    return parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function idOf(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : undefined;
}

// ============================================================================
// SMS
// ============================================================================

/**
 * Unifonic REST messaging. The AppSid in the body is the whole of the
 * authentication, so the request is one form POST.
 */
async function unifonic(
  gateway: SendGateway,
  message: OutboundMessage,
): Promise<DeliveryResult> {
  const url =
    process.env.UNIFONIC_API_URL ||
    "https://el.cloud.unifonic.com/rest/SMS/messages";
  const form = new URLSearchParams({
    AppSid: gateway.credentials.appSid,
    Recipient: bare(message.to),
    Body: message.body,
  });
  if (gateway.credentials.senderId) {
    form.set("SenderID", gateway.credentials.senderId);
  }

  const response = await post(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!response.ok) return fail(gateway, `HTTP ${response.status}`);

  // Unifonic answers 200 with `success: false` for a rejected message, so the
  // status code alone is not proof the message was accepted.
  const payload = readJson(response.body);
  if (payload && (payload.success === false || payload.success === "false")) {
    return fail(gateway, String(payload.message ?? "rejected"));
  }
  const data = payload?.data as { MessageID?: unknown } | undefined;
  return { ok: true, reference: idOf(data?.MessageID) };
}

/** Taqnyat: bearer token, JSON body, 201 with the message id. */
async function taqnyat(
  gateway: SendGateway,
  message: OutboundMessage,
): Promise<DeliveryResult> {
  const response = await post("https://api.taqnyat.sa/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gateway.credentials.apiToken}`,
    },
    body: JSON.stringify({
      recipients: [bare(message.to)],
      body: message.body,
      sender: gateway.credentials.senderId,
    }),
  });
  const payload = readJson(response.body);
  if (!response.ok) {
    return fail(
      gateway,
      String(payload?.message ?? `HTTP ${response.status}`),
    );
  }
  return { ok: true, reference: idOf(payload?.messageId) };
}

/**
 * Msegat. It answers 200 for rejected messages too; only code "1" or "M0000"
 * means the message was accepted.
 */
async function msegat(
  gateway: SendGateway,
  message: OutboundMessage,
): Promise<DeliveryResult> {
  const response = await post("https://www.msegat.com/gw/sendsms.php", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userName: gateway.credentials.userName,
      apiKey: gateway.credentials.apiKey,
      numbers: bare(message.to),
      userSender: gateway.credentials.senderId,
      msg: message.body,
      msgEncoding: "UTF8",
    }),
  });
  if (!response.ok) return fail(gateway, `HTTP ${response.status}`);
  const payload = readJson(response.body);
  const code = String(payload?.code ?? "");
  if (code !== "1" && code !== "M0000") {
    return fail(
      gateway,
      `${code || "rejected"}${payload?.message ? ` ${String(payload.message)}` : ""}`,
    );
  }
  return { ok: true, reference: idOf(payload?.id) };
}

/**
 * Twilio's Messages resource, for SMS and WhatsApp alike: WhatsApp is the
 * same request with "whatsapp:" on both numbers. A sender starting "MG" is a
 * Messaging Service rather than a number.
 */
async function twilio(
  gateway: SendGateway,
  message: OutboundMessage,
): Promise<DeliveryResult> {
  const { accountSid, authToken, senderId } = gateway.credentials;
  const whatsapp = gateway.channel === "whatsapp";
  const address = (value: string) =>
    whatsapp && !value.startsWith("whatsapp:") ? `whatsapp:${value}` : value;

  const form = new URLSearchParams({ To: address(message.to), Body: message.body });
  if (/^MG[0-9a-f]{32}$/i.test(senderId)) {
    form.set("MessagingServiceSid", senderId);
  } else {
    form.set("From", address(senderId));
  }
  if (message.statusCallbackUrl) {
    form.set("StatusCallback", message.statusCallbackUrl);
  }

  const response = await post(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: form.toString(),
    },
  );
  const payload = readJson(response.body);
  if (!response.ok) {
    return fail(
      gateway,
      String(payload?.message ?? `HTTP ${response.status}`),
    );
  }
  return { ok: true, reference: idOf(payload?.sid) };
}

// ============================================================================
// WhatsApp
// ============================================================================

/** Graph API version for the Cloud API; override with WHATSAPP_API_VERSION. */
const META_API_VERSION = "v23.0";

/**
 * The Cloud API's body for a template with named parameters. Meta refuses an
 * empty parameter, so a value with nothing in it is sent as a dash.
 */
export function metaTemplatePayload(
  to: string,
  template: OutboundTemplate,
): Record<string, unknown> {
  const parameters = Object.entries(template.params).map(([name, text]) => ({
    type: "text",
    parameter_name: name,
    text: text.trim() || "-",
  }));
  return {
    messaging_product: "whatsapp",
    to: bare(to),
    type: "template",
    template: {
      name: template.name,
      language: { code: template.language },
      ...(parameters.length > 0
        ? { components: [{ type: "body", parameters }] }
        : {}),
    },
  };
}

/**
 * WhatsApp Cloud API (Meta). Free text only reaches someone who wrote to the
 * business in the last 24 hours; a rent reminder needs an approved template,
 * which the caller passes when one is set up for the event.
 */
async function meta(
  gateway: SendGateway,
  message: OutboundMessage,
): Promise<DeliveryResult> {
  const version = process.env.WHATSAPP_API_VERSION || META_API_VERSION;
  const url = `https://graph.facebook.com/${version}/${encodeURIComponent(gateway.credentials.phoneNumberId)}/messages`;
  const payload = message.template
    ? metaTemplatePayload(message.to, message.template)
    : {
        messaging_product: "whatsapp",
        to: bare(message.to),
        type: "text",
        text: { preview_url: false, body: message.body },
      };

  const response = await post(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gateway.credentials.accessToken}`,
    },
    body: JSON.stringify(payload),
  });
  const parsed = readJson(response.body);
  if (!response.ok) {
    const error = parsed?.error as { message?: string; code?: number } | undefined;
    return fail(
      gateway,
      error?.message
        ? `${error.code ? `${error.code} ` : ""}${error.message}`
        : `HTTP ${response.status}`,
    );
  }
  const messages = parsed?.messages as Array<{ id?: string }> | undefined;
  return { ok: true, reference: messages?.[0]?.id };
}

// ============================================================================
// Entry point
// ============================================================================

const SENDERS: Record<
  MessagingChannel,
  Partial<
    Record<
      MessagingProviderId,
      (gateway: SendGateway, message: OutboundMessage) => Promise<DeliveryResult>
    >
  >
> = {
  sms: { unifonic, taqnyat, msegat, twilio },
  whatsapp: { meta, twilio },
};

/** Send one message through a gateway. Never throws. */
export async function deliverMessage(
  gateway: SendGateway,
  message: OutboundMessage,
): Promise<DeliveryResult> {
  const send = SENDERS[gateway.channel][gateway.provider];
  if (!send) {
    return { ok: false, error: `Unknown ${gateway.channel} provider "${gateway.provider}"` };
  }
  if (!message.body.trim() && !message.template) {
    return { ok: false, error: "Empty message body" };
  }
  try {
    return await send(gateway, message);
  } catch (error) {
    const reason =
      (error as Error)?.name === "AbortError"
        ? "Provider did not answer in time"
        : ((error as Error)?.message ?? "Request failed");
    return fail(gateway, reason);
  }
}
