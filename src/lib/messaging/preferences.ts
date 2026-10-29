import "server-only";

/**
 * PropertyPro - Opting out of SMS and WhatsApp
 *
 * `User.notificationPreferences.sms` / `.whatsapp` set to `false` means the
 * person asked not to get messages on that channel; anything else (unset,
 * true) means they get them. The send path (`dispatch.ts`) honours it for
 * every automated and manual message, and logs the blocked attempt.
 *
 * Set by the person themselves (Settings → Profile) or by staff recording
 * their request (the client's communication log).
 */

import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { isOptedOut } from "./decide";

export interface MessagingPreferences {
  /** Receives SMS. */
  sms: boolean;
  /** Receives WhatsApp. */
  whatsapp: boolean;
}

function preferencesRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function messagingPreferencesOf(value: unknown): MessagingPreferences {
  return {
    sms: !isOptedOut(value, "sms"),
    whatsapp: !isOptedOut(value, "whatsapp"),
  };
}

/** Read under the caller's organization (RLS). Null when no such user. */
export async function readMessagingPreferences(
  userId: string,
): Promise<MessagingPreferences | null> {
  const user = await db.user.findFirst({
    where: { id: userId },
    select: { notificationPreferences: true },
  });
  return user ? messagingPreferencesOf(user.notificationPreferences) : null;
}

/** Change one or both channels, leaving every other preference as it was. */
export async function writeMessagingPreferences(
  userId: string,
  change: Partial<MessagingPreferences>,
): Promise<MessagingPreferences | null> {
  const user = await db.user.findFirst({
    where: { id: userId },
    select: { notificationPreferences: true },
  });
  if (!user) return null;
  const next = { ...preferencesRecord(user.notificationPreferences) };
  if (typeof change.sms === "boolean") next.sms = change.sms;
  if (typeof change.whatsapp === "boolean") next.whatsapp = change.whatsapp;
  await db.user.update({
    where: { id: userId },
    data: { notificationPreferences: next as Prisma.InputJsonValue },
  });
  return messagingPreferencesOf(next);
}
