/**
 * PropertyPro - Delivery reports from messaging providers
 *
 * Two providers report what happened to a message after they accepted it:
 *
 *   - Twilio posts a form to the status callback URL the send named, signed
 *     with the account's auth token (`X-Twilio-Signature`);
 *   - Meta posts JSON to the one webhook set up on the WhatsApp app, signed
 *     with the app secret (`X-Hub-Signature-256`), after a one-time GET
 *     handshake that echoes a verify token.
 *
 * Unifonic, Taqnyat and Msegat report nothing back to us; their messages stay
 * "sent" in the log.
 *
 * Pure functions: the routes under `api/messaging/webhook` pick the stored
 * secret, verify, parse, and update the log.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageStatus } from "./registry";

export interface StatusReport {
  /** The provider's message id, as stored in `message_logs.providerMessageId`. */
  reference: string;
  status: MessageStatus;
  error?: string;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ============================================================================
// Twilio
// ============================================================================

/**
 * Twilio's request signature: HMAC-SHA1 over the full URL it called followed
 * by every POST parameter, sorted by name, each name directly followed by its
 * value; base64.
 */
export function twilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
): string {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function verifyTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string | null,
): boolean {
  if (!authToken || !signature) return false;
  return safeEqual(twilioSignature(authToken, url, params), signature);
}

const TWILIO_STATUSES: Record<string, MessageStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  undelivered: "undelivered",
  failed: "failed",
  canceled: "failed",
};

/** A Twilio status callback's report, or null for an in-between state. */
export function parseTwilioStatus(
  params: Record<string, string>,
): StatusReport | null {
  const reference = params.MessageSid || params.SmsSid;
  const status = TWILIO_STATUSES[(params.MessageStatus || "").toLowerCase()];
  if (!reference || !status) return null;
  const code = params.ErrorCode;
  return {
    reference,
    status,
    ...(code && code !== "0"
      ? { error: `${code}${params.ErrorMessage ? ` ${params.ErrorMessage}` : ""}` }
      : {}),
  };
}

// ============================================================================
// Meta (WhatsApp Cloud API)
// ============================================================================

export function verifyMetaSignature(
  appSecret: string,
  rawBody: string,
  header: string | null,
): boolean {
  if (!appSecret || !header?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret)
    .update(rawBody, "utf8")
    .digest("hex");
  return safeEqual(`sha256=${expected}`, header);
}

/**
 * The subscription handshake: Meta sends `hub.mode=subscribe`, the verify
 * token the office typed into the app, and a challenge to echo back.
 */
export function metaHandshake(
  params: URLSearchParams,
  verifyToken: string,
): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  const token = params.get("hub.verify_token") ?? "";
  if (!safeEqual(token, verifyToken)) return null;
  return params.get("hub.challenge");
}

const META_STATUSES: Record<string, MessageStatus> = {
  sent: "sent",
  delivered: "delivered",
  read: "read",
  failed: "failed",
};

/** Every status in a Meta webhook payload; incoming messages are ignored. */
export function parseMetaStatuses(payload: unknown): StatusReport[] {
  const reports: StatusReport[] = [];
  const entries = (payload as { entry?: unknown })?.entry;
  if (!Array.isArray(entries)) return reports;
  for (const entry of entries) {
    const changes = (entry as { changes?: unknown })?.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      const statuses = (change as { value?: { statuses?: unknown } })?.value
        ?.statuses;
      if (!Array.isArray(statuses)) continue;
      for (const item of statuses) {
        const record = item as {
          id?: unknown;
          status?: unknown;
          errors?: Array<{ code?: unknown; title?: unknown; message?: unknown }>;
        };
        const status = META_STATUSES[String(record.status ?? "")];
        if (typeof record.id !== "string" || !status) continue;
        const error = record.errors?.[0];
        reports.push({
          reference: record.id,
          status,
          ...(error
            ? {
                error: [error.code, error.title ?? error.message]
                  .filter(Boolean)
                  .join(" "),
              }
            : {}),
        });
      }
    }
  }
  return reports;
}
