import "server-only";

/**
 * PropertyPro - Handling a delivery report
 *
 * Shared by the two webhook routes:
 *
 *   /api/messaging/webhook/<provider>             the platform's gateway
 *   /api/messaging/webhook/<provider>/<org-slug>  an office's own account
 *
 * A report is believed only when it carries a valid signature made with a
 * secret stored for that scope: the office's own Twilio auth token or Meta app
 * secret, or the platform's (saved default, then environment). The office
 * route runs inside the office's organization context, so a report can only
 * move that office's messages; the platform route matches across offices, but
 * only messages that went through the platform's gateway.
 */

import { NextResponse } from "next/server";
import type { ChannelGateway } from "./config";
import { applyStatusReports } from "./log";
import {
  decryptSecret,
  environmentGateway,
  getOfficeMessagingSettings,
  getPlatformMessagingSettings,
} from "./store";
import {
  metaHandshake,
  parseMetaStatuses,
  parseTwilioStatus,
  verifyMetaSignature,
  verifyTwilioSignature,
} from "./webhooks";
import { MESSAGING_CHANNELS, type MessagingProviderId } from "./registry";

export type WebhookScope = "platform" | "office";

function plain(gateway: ChannelGateway, key: string, encrypted: boolean): string {
  const value = gateway.credentials[key];
  if (!value) return "";
  if (!encrypted) return value;
  try {
    return decryptSecret(value) || "";
  } catch {
    return "";
  }
}

/** Every stored account of this provider in the scope, credentials in clear. */
async function accountsFor(
  scope: WebhookScope,
  provider: MessagingProviderId,
): Promise<Array<{ gateway: ChannelGateway; encrypted: boolean }>> {
  const accounts: Array<{ gateway: ChannelGateway; encrypted: boolean }> = [];
  if (scope === "office") {
    const office = await getOfficeMessagingSettings();
    for (const channel of MESSAGING_CHANNELS) {
      const settings = office[channel];
      if (settings.useOwnGateway && settings.provider === provider) {
        accounts.push({ gateway: settings, encrypted: true });
      }
    }
    return accounts;
  }
  const { settings } = await getPlatformMessagingSettings();
  for (const channel of MESSAGING_CHANNELS) {
    if (settings[channel].provider === provider) {
      accounts.push({ gateway: settings[channel], encrypted: true });
    }
    const env = environmentGateway(channel);
    if (env?.provider === provider) {
      accounts.push({ gateway: env, encrypted: false });
    }
  }
  return accounts;
}

/**
 * The URL Twilio signed: the one the send named, built from APP_URL. Behind
 * a proxy `request.url` can carry the internal host and scheme instead.
 */
function signedUrl(request: Request): string {
  const configured = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  const url = new URL(request.url);
  if (!configured) return url.toString();
  return `${configured.trim().replace(/\/+$/, "")}${url.pathname}${url.search}`;
}

/** Meta's subscription handshake (GET). */
export async function handleWebhookHandshake(
  request: Request,
  provider: string,
  scope: WebhookScope,
): Promise<Response> {
  if (provider !== "meta") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const params = new URL(request.url).searchParams;
  for (const { gateway } of await accountsFor(scope, "meta")) {
    // The verify token is a text field, stored as typed.
    const challenge = metaHandshake(params, plain(gateway, "verifyToken", false));
    if (challenge !== null) {
      return new Response(challenge, {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    }
  }
  return NextResponse.json({ error: "Verification failed" }, { status: 403 });
}

/** A delivery report (POST). */
export async function handleDeliveryWebhook(
  request: Request,
  provider: string,
  scope: WebhookScope,
): Promise<Response> {
  if (provider !== "twilio" && provider !== "meta") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const raw = await request.text();
  const accounts = await accountsFor(scope, provider);

  if (provider === "twilio") {
    const params = Object.fromEntries(new URLSearchParams(raw));
    const signature = request.headers.get("x-twilio-signature");
    const url = signedUrl(request);
    const verified = accounts.some(({ gateway, encrypted }) =>
      verifyTwilioSignature(
        plain(gateway, "authToken", encrypted),
        url,
        params,
        signature,
      ),
    );
    if (!verified) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
    }
    const report = parseTwilioStatus(params);
    if (report) await applyStatusReports("twilio", [report], scope);
    return new Response(null, { status: 204 });
  }

  const signature = request.headers.get("x-hub-signature-256");
  const verified = accounts.some(({ gateway, encrypted }) =>
    verifyMetaSignature(plain(gateway, "appSecret", encrypted), raw, signature),
  );
  if (!verified) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }
  let payload: unknown = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  await applyStatusReports("meta", parseMetaStatuses(payload), scope);
  // Meta retries anything but a 200.
  return NextResponse.json({ received: true });
}
