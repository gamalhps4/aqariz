/**
 * PropertyPro SaaS - Platform settings service (DB-backed)
 *
 * Platform-wide configuration lives in a single `PlatformSettings` document,
 * managed from the Platform Console (`/admin/settings`). This module is the read
 * path for the admin editor API, the public maintenance/status endpoint, and the
 * email transport.
 *
 * Mirrors `@/lib/marketing/landing`: a short in-memory cache keeps hot reads
 * cheap (mutations call `invalidatePlatformSettingsCache()`), and
 * `DEFAULT_PLATFORM_SETTINGS` is both the one-time seed and the fallback when the
 * database is empty or momentarily unavailable.
 *
 * Secrets (the SMTP password) are stored encrypted and never leave the server in
 * raw form: `getPublicPlatformSettings()` redacts them to a boolean, while
 * the mailer's `getEmailConfig()` (lib/services/email-config.service.ts)
 * decrypts it on demand.
 */

import { db } from "@/lib/db/prisma";
import { processCache } from "@/lib/process-cache";
import { Prisma } from "@/generated/prisma/client";
import { bypassOrgScope } from "@/lib/tenancy/context";
import {
  APP_CURRENCY,
  DEFAULT_CURRENCY,
  DEFAULT_LANGUAGE,
  DEFAULT_TIMEZONE,
} from "@/lib/regional/region";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlatformGeneralSettings {
  platformName: string;
  supportEmail: string;
  logoLight: string;
  logoDark: string;
  favicon: string;
  defaultCurrency: string;
  defaultTimezone: string;
  defaultLanguage: string;
}

export interface PlatformRegistrationSettings {
  allowSignups: boolean;
  requireEmailVerification: boolean;
  defaultTrialDays: number;
}

export interface PlatformMaintenanceSettings {
  enabled: boolean;
  message: string;
}

export interface PlatformEmailSettings {
  fromName: string;
  fromEmail: string;
  smtpHost: string;
  smtpPort: number;
  smtpSecure: boolean;
  smtpUser: string;
  /** Encrypted envelope (or ""); server-only. */
  smtpPasswordEncrypted: string;
}

/** Full settings, including the encrypted secret. Server-only. */
export interface PlatformSettingsData {
  general: PlatformGeneralSettings;
  registration: PlatformRegistrationSettings;
  maintenance: PlatformMaintenanceSettings;
  email: PlatformEmailSettings;
}

/** Client-safe shape: the encrypted password is reduced to a boolean. */
export interface PublicPlatformSettings {
  general: PlatformGeneralSettings;
  registration: PlatformRegistrationSettings;
  maintenance: PlatformMaintenanceSettings;
  email: Omit<PlatformEmailSettings, "smtpPasswordEncrypted"> & {
    smtpPasswordSet: boolean;
  };
}

// ---------------------------------------------------------------------------
// Defaults (mirrors the model defaults; also the one-time seed + fallback)
// ---------------------------------------------------------------------------

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettingsData = {
  general: {
    platformName: "PropertyPro",
    supportEmail: "",
    logoLight: "",
    logoDark: "",
    favicon: "",
    // The market this deployment ships for (lib/regional/region.ts) — these
    // were US defaults, so every new office opened in dollars.
    defaultCurrency: DEFAULT_CURRENCY,
    defaultTimezone: DEFAULT_TIMEZONE,
    defaultLanguage: DEFAULT_LANGUAGE,
  },
  registration: {
    allowSignups: true,
    requireEmailVerification: false,
    defaultTrialDays: 14,
  },
  maintenance: {
    enabled: false,
    message:
      "We're performing scheduled maintenance and will be back shortly.",
  },
  email: {
    fromName: "PropertyPro",
    fromEmail: "",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: "",
    smtpPasswordEncrypted: "",
  },
};

// ---------------------------------------------------------------------------
// Cache
// ---------------------------------------------------------------------------

// Shared by the console's routes and the pages they revalidate
// (lib/process-cache): a per-module cache left pages on the old name.
const cache = processCache<PlatformSettingsData>("platform-settings", 60_000);

export function invalidatePlatformSettingsCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// Merge helpers — DB document over defaults so newly-added fields always have a
// sensible value even on an old document.
// ---------------------------------------------------------------------------

function mergeGroup<T extends object>(fallback: T, stored: unknown): T {
  if (!stored || typeof stored !== "object") return { ...fallback };
  return { ...fallback, ...(stored as Partial<T>) };
}

function toSettingsData(doc: Record<string, unknown> | null): PlatformSettingsData {
  if (!doc) return DEFAULT_PLATFORM_SETTINGS;
  return {
    general: {
      ...mergeGroup(DEFAULT_PLATFORM_SETTINGS.general, doc.general),
      // Riyal whatever an older row holds (lib/regional/region).
      defaultCurrency: APP_CURRENCY,
    },
    registration: mergeGroup(DEFAULT_PLATFORM_SETTINGS.registration, doc.registration),
    maintenance: mergeGroup(DEFAULT_PLATFORM_SETTINGS.maintenance, doc.maintenance),
    email: mergeGroup(DEFAULT_PLATFORM_SETTINGS.email, doc.email),
  };
}

// ---------------------------------------------------------------------------
// Read API
// ---------------------------------------------------------------------------

/** Full settings (server-only — includes the encrypted SMTP password). */
export async function getPlatformSettings(): Promise<PlatformSettingsData> {
  const fresh = cache.fresh();
  if (fresh) return fresh;
  try {
    await ensurePlatformSettingsSeeded();
    // platform_settings is world-readable, but keep the bypass so this read
    // works identically from any context (signup, mailer, background jobs).
    const doc = await bypassOrgScope(() =>
      db.platformSettings.findFirst({ where: { singleton: "primary" } }),
    );
    const data = toSettingsData(doc as Record<string, unknown> | null);
    cache.set(data);
    return data;
  } catch (error) {
    // Keep callers working even if the database is momentarily unavailable.
    console.error("Failed to load platform settings; using defaults", error);
    return cache.last() ?? DEFAULT_PLATFORM_SETTINGS;
  }
}

/** Client-safe settings: the SMTP password is reduced to a boolean. */
export async function getPublicPlatformSettings(): Promise<PublicPlatformSettings> {
  const { email, ...rest } = await getPlatformSettings();
  const { smtpPasswordEncrypted, ...publicEmail } = email;
  return {
    ...rest,
    email: { ...publicEmail, smtpPasswordSet: Boolean(smtpPasswordEncrypted) },
  };
}

// ---------------------------------------------------------------------------
// Seeding (one-time, from DEFAULT_PLATFORM_SETTINGS)
// ---------------------------------------------------------------------------

let seedChecked = false;

/**
 * Seed the singleton on a brand-new database. Idempotent and race-safe:
 * concurrent inserts collide on the unique `singleton` index and are ignored.
 * Never overwrites admin-edited content (only seeds when no document exists).
 */
export async function ensurePlatformSettingsSeeded(): Promise<void> {
  if (seedChecked) return;
  try {
    const existing = await bypassOrgScope(() =>
      db.platformSettings.findFirst({
        where: { singleton: "primary" },
        select: { id: true },
      }),
    );
    if (!existing) {
      // Writes to platform_settings are platform-only under RLS; the one-time
      // seed runs under an explicit bypass. The upsert never overwrites
      // admin-edited content (update is a no-op).
      await bypassOrgScope(() =>
        db.platformSettings.upsert({
          where: { singleton: "primary" },
          update: {},
          create: {
            singleton: "primary",
            general:
              DEFAULT_PLATFORM_SETTINGS.general as unknown as Prisma.InputJsonValue,
            registration:
              DEFAULT_PLATFORM_SETTINGS.registration as unknown as Prisma.InputJsonValue,
            maintenance:
              DEFAULT_PLATFORM_SETTINGS.maintenance as unknown as Prisma.InputJsonValue,
            email:
              DEFAULT_PLATFORM_SETTINGS.email as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      invalidatePlatformSettingsCache();
    }
    seedChecked = true;
  } catch (error) {
    // Duplicate-key races during concurrent seeding are expected and harmless.
    console.error("Platform settings seeding skipped due to error", error);
  }
}
