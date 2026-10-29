/**
 * PropertyPro SaaS - Platform settings API (super-admin)
 *
 * GET  → redacted platform settings (SMTP password reduced to a boolean).
 * PUT  → validate, encrypt a newly-supplied SMTP password (blank = keep
 *        existing), upsert the singleton, invalidate the cache, and audit.
 */

export const dynamic = "force-dynamic";

import { revalidatePath } from "next/cache";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { encryptSensitiveValue } from "@/lib/security/field-encryption";
import {
  getPlatformSettings,
  getPublicPlatformSettings,
  invalidatePlatformSettingsCache,
} from "@/lib/platform/settings";
import { platformSettingsUpdateSchema } from "@/lib/validations";
import { recordPlatformSettingsChange } from "@/lib/audit/platform-events";
import {
  PLATFORM_SETTINGS_AUDIT_KEYS,
  PLATFORM_SETTINGS_AUDIT_SECRETS,
  platformSettingsSnapshot,
} from "@/lib/audit/settings-keys";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const settings = await getPublicPlatformSettings();
      return createSuccessResponse({ settings });
    } catch (error) {
      return handleApiError(error, "Failed to load platform settings");
    }
  },
);

export const PUT = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await parseRequestBody(request);
      if (!body.success) return createErrorResponse("Invalid JSON body", 400);

      const parsed = platformSettingsUpdateSchema.safeParse(body.data);
      if (!parsed.success) {
        // Surface the offending field so the message is actionable instead of a
        // bare "String must contain at least 1 character(s)".
        const issue = parsed.error.issues[0];
        const field = issue?.path.join(".");
        return createErrorResponse(
          issue
            ? field
              ? `${field}: ${issue.message}`
              : issue.message
            : "Invalid platform settings",
          400,
        );
      }

      // Write-only secret: keep the stored password unless a new one is supplied.
      const current = await getPlatformSettings();
      const { smtpPassword, ...emailFields } = parsed.data.email;
      const smtpPasswordEncrypted =
        smtpPassword && smtpPassword.length > 0
          ? encryptSensitiveValue(smtpPassword) || ""
          : current.email.smtpPasswordEncrypted;

      // The settings groups are Json columns; the encrypted SMTP password
      // stays inside the email Json.
      const update = {
        general: parsed.data.general as unknown as Prisma.InputJsonValue,
        registration:
          parsed.data.registration as unknown as Prisma.InputJsonValue,
        maintenance:
          parsed.data.maintenance as unknown as Prisma.InputJsonValue,
        email: {
          ...emailFields,
          smtpPasswordEncrypted,
        } as unknown as Prisma.InputJsonValue,
      };

      const saved = await db.platformSettings.upsert({
        where: { singleton: "primary" },
        update,
        create: { singleton: "primary", ...update },
      });

      invalidatePlatformSettingsCache();
      // The platform brand renders in the header shared by every public route
      // (landing, pricing, contact, legal, auth), and those pages are ISR-cached
      // on their own cadences. Revalidating the root layout purges the whole
      // tree, so a name/logo edit lands everywhere at once instead of only on
      // the homepage.
      revalidatePath("/", "layout");

      // The before and after (`current` is what was stored until this save):
      // only the fields that moved. The SMTP password is compared but only
      // ever recorded as "set"; logos by file name.
      await recordPlatformSettingsChange({
        actor: user,
        targetId: saved.id,
        targetName: parsed.data.general.platformName,
        summary: "Platform settings updated",
        before: platformSettingsSnapshot(current),
        after: platformSettingsSnapshot({
          general: parsed.data.general,
          registration: parsed.data.registration,
          maintenance: parsed.data.maintenance,
          email: { ...emailFields, smtpPasswordEncrypted },
        }),
        keys: PLATFORM_SETTINGS_AUDIT_KEYS,
        secretKeys: PLATFORM_SETTINGS_AUDIT_SECRETS,
      });

      return createSuccessResponse(
        { settings: await getPublicPlatformSettings() },
        "Platform settings saved",
      );
    } catch (error) {
      return handleApiError(error, "Failed to save platform settings");
    }
  },
);
