/**
 * PropertyPro - Whether a message goes out
 *
 * The rules in one pure function, in the order they apply:
 *
 *   skipped (not logged — nothing was asked of this channel):
 *     the package leaves Messaging out, the office has the channel off, the
 *     office has this event off for the channel, or no gateway is set up;
 *   blocked (logged, so the office can see why someone was not reached):
 *     the recipient opted out, has no usable number, a WhatsApp event has no
 *     approved template, or the platform-gateway quota is used up;
 *   otherwise it is sent.
 *
 * A test send skips the office's channel and event switches (it exists to try
 * the gateway before turning it on) and the opt-out (the number is typed in),
 * but not the package: a package without Messaging sends no tests either. On
 * the platform's gateway a test is a message the platform pays for, so it goes
 * only to the sender's own Saudi mobile number; on the office's own account,
 * to any number. Either way, a few a day.
 */

import type { BlockReason, GatewaySource, MessagePurpose } from "./registry";

/** Test sends an office may make in a day (Riyadh), on any gateway. */
export const TEST_SENDS_PER_DAY = 10;

/** A Saudi mobile number in E.164: +966 5x xxx xxxx. */
export function isSaudiMobile(e164: string | null | undefined): boolean {
  return /^\+9665\d{8}$/.test(e164 ?? "");
}

/**
 * Whether a test may go to `to` (E.164). On the office's own account it may
 * go anywhere: the office pays. On the platform's (or the deployment's), only
 * to the sender's own number on file, and only a Saudi mobile.
 */
export function testRecipientAllowed(input: {
  source: GatewaySource | null;
  to: string | null;
  /** The sender's own number on file, in E.164. */
  ownPhone: string | null;
}): boolean {
  if (input.source === "office") return true;
  return Boolean(input.to) && input.to === input.ownPhone && isSaudiMobile(input.to);
}

export type SkipReason =
  | "module_off"
  | "channel_off"
  | "event_off"
  | "not_configured";

export type SendDecision =
  | { action: "send" }
  | { action: "skip"; reason: SkipReason }
  | { action: "block"; reason: BlockReason };

export interface SendDecisionInput {
  purpose: MessagePurpose;
  moduleEnabled: boolean;
  channelEnabled: boolean;
  /** The office's switch for this event and channel; true when no event. */
  eventEnabled: boolean;
  hasGateway: boolean;
  optedOut: boolean;
  hasPhone: boolean;
  /** WhatsApp through Meta for an automated event needs a template. */
  needsTemplate: boolean;
  hasTemplate: boolean;
  /** Platform-gateway quota; null when the office pays (its own account). */
  quota: { limit: number | null; used: number } | null;
  /** A test send: whether its number may be used (`testRecipientAllowed`). */
  testRecipientAllowed?: boolean;
  /** A test send: the office's tests today, and how many it may make. */
  testsToday?: { used: number; limit: number } | null;
}

export function decideSend(input: SendDecisionInput): SendDecision {
  const test = input.purpose === "test";
  if (!input.moduleEnabled) return { action: "skip", reason: "module_off" };
  if (!test) {
    if (!input.channelEnabled) return { action: "skip", reason: "channel_off" };
    if (!input.eventEnabled) return { action: "skip", reason: "event_off" };
  }
  if (!input.hasGateway) return { action: "skip", reason: "not_configured" };
  if (!test && input.optedOut) return { action: "block", reason: "opted_out" };
  if (!input.hasPhone) return { action: "block", reason: "no_phone" };
  if (test) {
    // Missing means refused: a caller that forgot to ask gets no free test.
    if (input.testRecipientAllowed !== true) {
      return { action: "block", reason: "test_recipient" };
    }
    if (!input.testsToday || input.testsToday.used >= input.testsToday.limit) {
      return { action: "block", reason: "test_daily_limit" };
    }
  }
  if (input.needsTemplate && !input.hasTemplate) {
    return { action: "block", reason: "no_template" };
  }
  if (
    input.quota &&
    input.quota.limit !== null &&
    input.quota.used >= input.quota.limit
  ) {
    return { action: "block", reason: "quota_exceeded" };
  }
  return { action: "send" };
}

/** Whether a recipient's preferences opt them out of a channel. */
export function isOptedOut(
  preferences: unknown,
  channel: "sms" | "whatsapp",
): boolean {
  if (!preferences || typeof preferences !== "object") return false;
  return (preferences as Record<string, unknown>)[channel] === false;
}
