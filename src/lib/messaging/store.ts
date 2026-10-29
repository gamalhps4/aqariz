import "server-only";

/**
 * PropertyPro - Where the messaging settings live
 *
 *   - An office's settings: `system_settings.integrations.messaging`, under
 *     the office's own row-level security. `integrations` was an empty group
 *     no screen wrote, so the messaging settings need no new column.
 *   - The Super Admin's default gateway: `platform_settings.messaging`, read
 *     and written with raw SQL — the column arrives with migration
 *     20261004113500_messaging and the Prisma field is `@ignore` until it is
 *     applied everywhere (the same arrangement as the platform module
 *     switches). A missing column reads as "no default gateway".
 *
 * Both are cached briefly: a reminder sweep sends hundreds of messages for one
 * office, and each would otherwise read the same two rows again. A save
 * clears the cache, so a change applies to the next message.
 */

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { bypassOrgScope, getOrgContext } from "@/lib/tenancy/context";
import {
  getOrCreateOrgSystemSettings,
  getOrgSystemSettings,
} from "@/lib/services/system-settings";
import { ensurePlatformSettingsSeeded } from "@/lib/platform/settings";
import {
  decryptSensitiveValue,
  encryptSensitiveValue,
} from "@/lib/security/field-encryption";
import { isMissingSchemaError } from "@/lib/db/missing-schema";
import {
  envGateway,
  normalizeOfficeSettings,
  normalizePlatformSettings,
  resolveGateway,
  type OfficeMessagingSettings,
  type PlatformMessagingSettings,
  type ResolvedGateway,
} from "./config";
import type { MessagingChannel } from "./registry";

const OFFICE_TTL_MS = 30_000;
const PLATFORM_TTL_MS = 60_000;

const officeCache = new Map<
  string,
  { value: OfficeMessagingSettings; at: number }
>();
let platformCache: {
  value: PlatformMessagingSettings;
  available: boolean;
  at: number;
} | null = null;

export const encryptSecret = (value: string) => encryptSensitiveValue(value);
export const decryptSecret = (value: string) => decryptSensitiveValue(value);

/** Meta's webhook verify token, made up for the office. */
export function generateVerifyToken(): string {
  return randomBytes(18).toString("base64url");
}

// ============================================================================
// The office's settings
// ============================================================================

function officeId(): string | null {
  return getOrgContext()?.organizationId ?? null;
}

/** The current organization's messaging settings (defaults when unset). */
export async function getOfficeMessagingSettings(): Promise<OfficeMessagingSettings> {
  const organizationId = officeId();
  const cached = organizationId ? officeCache.get(organizationId) : undefined;
  if (cached && Date.now() - cached.at < OFFICE_TTL_MS) return cached.value;

  const row = await getOrgSystemSettings();
  const integrations = (row?.integrations ?? {}) as Record<string, unknown>;
  const value = normalizeOfficeSettings(integrations.messaging);
  if (organizationId) officeCache.set(organizationId, { value, at: Date.now() });
  return value;
}

/** Store an office's settings, leaving the rest of `integrations` as it was. */
export async function saveOfficeMessagingSettings(
  organizationId: string,
  userId: string,
  next: OfficeMessagingSettings,
): Promise<OfficeMessagingSettings> {
  const row = await getOrCreateOrgSystemSettings(organizationId);
  const integrations = {
    ...((row.integrations as Record<string, unknown>) ?? {}),
    messaging: next,
  };
  await db.systemSettings.update({
    where: { organizationId },
    data: {
      integrations: integrations as unknown as Prisma.InputJsonValue,
      updatedById: userId,
      version: { increment: 1 },
    },
  });
  officeCache.delete(organizationId);
  return next;
}

// ============================================================================
// The Super Admin's default gateway
// ============================================================================

export class MessagingMigrationRequiredError extends Error {
  statusCode = 409;
  code = "MIGRATION_REQUIRED";
  constructor() {
    super(
      "The default messaging gateway needs migration 20261004113500_messaging to be applied first.",
    );
    this.name = "MessagingMigrationRequiredError";
  }
}

export async function getPlatformMessagingSettings(): Promise<{
  settings: PlatformMessagingSettings;
  /** False while the migration that adds the column has not been applied. */
  available: boolean;
}> {
  if (platformCache && Date.now() - platformCache.at < PLATFORM_TTL_MS) {
    return { settings: platformCache.value, available: platformCache.available };
  }
  try {
    const rows = await bypassOrgScope(() =>
      db.$queryRaw<Array<{ messaging: unknown }>>`
        SELECT "messaging" FROM "platform_settings"
        WHERE "singleton" = 'primary'
        LIMIT 1
      `,
    );
    const value = normalizePlatformSettings(rows[0]?.messaging ?? null);
    platformCache = { value, available: true, at: Date.now() };
    return { settings: value, available: true };
  } catch (error) {
    const available = !isMissingSchemaError(error);
    if (available) {
      console.error("Failed to read the default messaging gateway", error);
    }
    // No default gateway rather than a failed send path.
    const value = normalizePlatformSettings(null);
    if (!available) {
      platformCache = { value, available, at: Date.now() };
    }
    return { settings: value, available };
  }
}

export async function savePlatformMessagingSettings(
  next: PlatformMessagingSettings,
): Promise<PlatformMessagingSettings> {
  await ensurePlatformSettingsSeeded();
  const payload = JSON.stringify(next);
  try {
    await bypassOrgScope(() =>
      db.$executeRaw`
        UPDATE "platform_settings"
        SET "messaging" = ${payload}::jsonb, "updatedAt" = NOW()
        WHERE "singleton" = 'primary'
      `,
    );
  } catch (error) {
    if (isMissingSchemaError(error)) throw new MessagingMigrationRequiredError();
    throw error;
  }
  platformCache = { value: next, available: true, at: Date.now() };
  return next;
}

// ============================================================================
// The gateway a send uses
// ============================================================================

/** The deployment's environment-variable gateway for a channel, if any. */
export function environmentGateway(channel: MessagingChannel) {
  return envGateway(channel, process.env);
}

/**
 * The gateway for a channel: the office's own account if it chose one, else
 * the Super Admin's default, else the environment's.
 */
export async function resolveMessagingGateway(
  channel: MessagingChannel,
  office: OfficeMessagingSettings | null,
): Promise<ResolvedGateway | null> {
  const { settings: platform } = await getPlatformMessagingSettings();
  return resolveGateway(
    channel,
    office,
    platform,
    environmentGateway(channel),
    decryptSecret,
  );
}

/** The platform's own gateway for a channel (Super Admin test sends). */
export async function resolvePlatformGateway(
  channel: MessagingChannel,
): Promise<ResolvedGateway | null> {
  return resolveMessagingGateway(channel, null);
}
