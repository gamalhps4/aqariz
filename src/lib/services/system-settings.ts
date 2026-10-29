/**
 * Per-organization system settings reader (system_settings table — one row per
 * org, sections stored as Json). Replaces the Mongoose
 * `SystemSettingsNew.getSettings()` static. Runs under the caller's org
 * context; the nested sections are intentionally loose-typed — their shapes
 * are owned by the settings routes' zod schemas.
 */

import { db } from "@/lib/db/prisma";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";

export interface OrgSystemSettings {
  id: string;
  organizationId: string;
  branding?: any;
  email?: any;
  payment?: any;
  paymentGateways?: any;
  security?: any;
  maintenance?: any;
  integrations?: any;
  application?: any;
  notifications?: any;
  backup?: any;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export async function getOrgSystemSettings(): Promise<OrgSystemSettings | null> {
  const row = await db.systemSettings.findFirst({ where: { isActive: true } });
  return row as unknown as OrgSystemSettings | null;
}

/**
 * Default section contents for a fresh organization row — mirrors the old
 * Mongoose `SystemSettingsNew.createDefaultSettings()` document so readers
 * (email/payment settings screens, config resolvers) see the same shape.
 */
export const DEFAULT_SYSTEM_SETTINGS_SECTIONS = {
  branding: {
    companyName: "PropertyPro",
    primaryColor: "#3b82f6",
    secondaryColor: "#64748b",
    accentColor: "#06b6d4",
  },
  email: {
    enabled: false,
    smtpPort: 587,
    encryption: "tls",
    testMode: true,
    dailyLimit: 1000,
  },
  payment: {
    currency: DEFAULT_CURRENCY,
    taxRate: 0,
    processingFee: 0,
    allowedPaymentMethods: ["card", "bank_transfer"],
  },
  paymentGateways: {
    defaultProvider: "stripe",
    stripe: { enabled: false },
    paypal: { enabled: false, mode: "sandbox" },
  },
  // No `security` section.
  //
  // One used to be seeded here (requireEmailVerification, passwordMinLength,
  // sessionTimeout, maxLoginAttempts, enableTwoFactor, enableRateLimiting,
  // rateLimitRequests, rateLimitWindow) with no editor and no reader — a row
  // of knobs that looked like policy and enforced nothing. Every one of those
  // controls is real, and lives somewhere a per-tenant Json blob cannot reach:
  //
  //   password rules       → src/lib/password-policy.ts
  //   lockout / attempts   → src/lib/lockout-policy.ts
  //   session lifetime     → session.expiresIn in src/lib/better-auth.ts
  //   rate limits          → src/lib/rate-limit.ts + the api-utils wrappers
  //   two-factor           → the twoFactor() plugin; per-user, not per-org
  //   email verification   → platform settings `registration`, enforced in
  //                          withAccessAndDB
  //
  // They are platform-wide security invariants on purpose: a tenant must not
  // be able to lower them for their own organization.
  maintenance: {
    enabled: false,
    showCountdown: true,
  },
  application: {
    siteName: "PropertyPro",
    siteUrl: "http://localhost:3000",
    timezone: "America/New_York",
    language: "en",
    dateFormat: "MM/DD/YYYY",
    timeFormat: "12h",
    maxFileSize: 10,
    allowedFileTypes: ["jpg", "jpeg", "png", "gif", "pdf", "doc", "docx"],
    enableRegistration: true,
    requireInvitation: false,
    defaultUserRole: "tenant",
  },
  notifications: {
    enableEmailNotifications: true,
    enableSMSNotifications: false,
    enablePushNotifications: true,
    defaultNotificationSettings: { email: true, sms: false, push: true },
    retentionDays: 90,
  },
  backup: {
    enabled: false,
    frequency: "weekly",
    retentionDays: 30,
    includeFiles: true,
    encryptBackups: true,
    storageProvider: "local",
  },
};

/**
 * Get the organization's settings row, creating it with defaults when
 * missing (replaces `getSettings()` + `createDefaultSettings()` pairs).
 * One row per organization — `organizationId` is unique.
 */
export async function getOrCreateOrgSystemSettings(
  organizationId: string,
): Promise<OrgSystemSettings> {
  const row = await db.systemSettings.upsert({
    where: { organizationId },
    update: {},
    create: { organizationId, ...DEFAULT_SYSTEM_SETTINGS_SECTIONS },
  });
  return row as unknown as OrgSystemSettings;
}
