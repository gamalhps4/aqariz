/**
 * PropertyPro - Letting a stranger write to the office
 *
 * The public page of a listing has a form anyone can submit, so what stands
 * between it and the inbox is this file, and it is deliberately the kind of
 * code a test can read:
 *
 *   1. A HONEYPOT. The form carries a field a person never sees and never
 *      fills (`website`). A bot that fills every input fills it. Such a
 *      submission is answered exactly as a good one is — "received" — so the
 *      bot has no signal to tune against, and is simply not stored. The check
 *      comes before validation for the same reason: a bot is told nothing about
 *      what was wrong with its message.
 *   2. VALIDATION. A name, a phone number that is a real phone number (stored
 *      as E.164 so the office can dial it and open WhatsApp from it), an email
 *      if one is given, a message of a sensible length.
 *   3. A RATE LIMIT PER SOURCE. Two windows, a short one against a burst and a
 *      long one against a slow trickle, counted per hashed source address. The
 *      counter is passed in, so this file does not own a Redis connection and
 *      the test does not need one.
 *
 * The source address is never stored or logged in the clear: it is hashed with
 * a server secret (HMAC), which is enough to see that one source is flooding a
 * listing and not enough to say who it is.
 */

import { createHmac } from "node:crypto";
import { z } from "zod";
import { INQUIRY_LIMITS } from "./constants";
import {
  HONEYPOT_FIELD,
  type InquiryErrorCode,
  type InquiryField,
} from "./inquiry-fields";
import { parsePhone } from "./phone";

export { HONEYPOT_FIELD };
export type { InquiryErrorCode, InquiryField };

export interface InquiryData {
  name: string;
  /** E.164. */
  phone: string;
  email: string | null;
  message: string | null;
}

export type InquiryOutcome =
  | { kind: "honeypot" }
  | { kind: "invalid"; errors: Partial<Record<InquiryField, InquiryErrorCode>> }
  | { kind: "ok"; data: InquiryData };

const emailShape = z.string().email();

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Judge one submission. `body` is whatever the request carried — anything.
 */
export function evaluateInquiry(body: unknown): InquiryOutcome {
  const input =
    body && typeof body === "object" ? (body as Record<string, unknown>) : {};

  // The honeypot first: a bot learns nothing from a validation message.
  if (text(input[HONEYPOT_FIELD]) !== "") return { kind: "honeypot" };

  const errors: Partial<Record<InquiryField, InquiryErrorCode>> = {};

  const name = text(input.name).replace(/\s+/g, " ");
  if (name.length < INQUIRY_LIMITS.nameMin) errors.name = "name_required";
  else if (name.length > INQUIRY_LIMITS.name) errors.name = "name_too_long";

  const parsedPhone = parsePhone(input.phone);
  if (!parsedPhone) errors.phone = "phone_invalid";

  const email = text(input.email);
  if (
    email &&
    (email.length > INQUIRY_LIMITS.email || !emailShape.safeParse(email).success)
  ) {
    errors.email = "email_invalid";
  }

  const message = text(input.message);
  if (message.length > INQUIRY_LIMITS.message) errors.message = "message_too_long";

  if (Object.keys(errors).length > 0 || !parsedPhone) {
    return { kind: "invalid", errors };
  }
  return {
    kind: "ok",
    data: {
      name,
      phone: parsedPhone.e164,
      email: email ? email.toLowerCase() : null,
      message: message || null,
    },
  };
}

/** The windows a source is held to. A source over either is told to wait. */
export const INQUIRY_RATE_RULES = [
  { name: "burst", windowMs: 10 * 60 * 1000, maxRequests: 3 },
  { name: "day", windowMs: 24 * 60 * 60 * 1000, maxRequests: 12 },
] as const;

/** What a rate counter answers — the shape lib/rate-limit's checkRateLimitByKey has. */
export type RateCounter = (
  key: string,
  windowMs: number,
  maxRequests: number,
) => Promise<{ success: boolean; resetTime: number }>;

export type RateDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/**
 * Count one submission from this source against every window, and say whether
 * it may go through. The first window to refuse ends the check, so a refused
 * submission does not spend the longer window's budget.
 */
export async function checkInquiryRate(
  counter: RateCounter,
  sourceHash: string,
  now: number = Date.now(),
): Promise<RateDecision> {
  for (const rule of INQUIRY_RATE_RULES) {
    const result = await counter(
      `listing-inquiry:${rule.name}:${sourceHash}`,
      rule.windowMs,
      rule.maxRequests,
    );
    if (!result.success) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((result.resetTime - now) / 1000)),
      };
    }
  }
  return { allowed: true };
}

const DEFAULT_HASH_SECRET = "propertypro-listing-inquiries";

/** The server secret the source address is hashed with. */
export function inquiryHashSecret(): string {
  return (
    process.env.LISTING_INQUIRY_HASH_SECRET ||
    process.env.BETTER_AUTH_SECRET ||
    process.env.AUTH_SECRET ||
    DEFAULT_HASH_SECRET
  );
}

/**
 * A source address as a keyed hash — stable for the same address and secret,
 * unrelated to it otherwise, and short enough to index.
 */
export function hashSource(
  address: string,
  secret: string = inquiryHashSecret(),
): string {
  return createHmac("sha256", secret).update(address.trim()).digest("hex").slice(0, 32);
}
