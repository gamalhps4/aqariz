/**
 * PropertyPro - Profile Settings API Routes
 * CRUD operations for user profile settings using a dedicated table
 *
 * Storage (Postgres, one row per user): every profile field (names, contact,
 * social links, emergency contact, preferences, …) lives in the `profile`
 * Json column; the row itself only carries identity/metadata columns
 * (userId/organizationId/isActive/version). The API request/response shape
 * stays FLAT — the helpers below map flat ⇄ Json on every read/write.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  withPermissionAndDB,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import { profileSettingsSchema } from "@/lib/validations";
import { DEFAULT_LANGUAGE, DEFAULT_TIMEZONE } from "@/lib/regional/region";
import { auditOwnAccount } from "@/lib/audit/account-events";
import {
  PROFILE_SETTINGS_AUDIT_KEYS,
  PROFILE_SETTINGS_AUDIT_SECRETS,
  profileSettingsSnapshot,
} from "@/lib/audit/settings-keys";
import {
  rateLimit,
  rateLimitConfigs,
  createRateLimitResponse,
  addSecurityHeaders,
  sanitizeInput,
  userBasedKeyGenerator,
} from "@/lib/rate-limit";

// ============================================================================
// FLAT ⇄ JSON MAPPING
// ============================================================================

const DEFAULT_PROFILE_PREFERENCES = {
  preferredContactMethod: "email",
  language: DEFAULT_LANGUAGE,
  timezone: DEFAULT_TIMEZONE,
  newsletter: false,
  marketingEmails: false,
};

/** Default profile content (mirrors the old schema defaults). */
function buildDefaultProfile(seed: Record<string, any> = {}) {
  return {
    gender: "prefer_not_to_say",
    preferences: { ...DEFAULT_PROFILE_PREFERENCES },
    ...cleanProfileData(seed),
  };
}

/** Drop undefined values and make the payload Json-safe (Dates → ISO). */
function cleanProfileData(data: Record<string, any>): Record<string, any> {
  const cleaned: Record<string, any> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    cleaned[key] = value instanceof Date ? value.toISOString() : value;
  }
  return cleaned;
}

type ProfileRow = NonNullable<
  Awaited<ReturnType<typeof findProfileRow>>
>;

/** Row → flat API object (old Mongoose document shape). */
function flattenProfileRow(row: ProfileRow): Record<string, any> {
  return {
    ...((row.profile as Record<string, any>) ?? {}),
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function findProfileRow(userId: string) {
  return db.profileSettings.findFirst({ where: { userId, isActive: true } });
}

/**
 * The entry for a save of the person's own profile extras (job, social links,
 * contact preferences). It is the person's own account, not an office setting;
 * name, phone and address are saved by /api/user/profile in the same click and
 * recorded there. Only what moved is kept, personal details (birth date,
 * emergency contact) as "set".
 */
function auditProfileSave(
  user: Parameters<typeof auditOwnAccount>[0]["person"],
  before: unknown,
  after: unknown,
): void {
  auditOwnAccount({
    person: user,
    before: profileSettingsSnapshot(before),
    after: profileSettingsSnapshot(after),
    keys: PROFILE_SETTINGS_AUDIT_KEYS,
    secretKeys: PROFILE_SETTINGS_AUDIT_SECRETS,
  });
}

/** Get-or-create the single profile row for a user (upsert by userId). */
function getOrCreateProfileRow(
  userId: string,
  organizationId: string,
  seed: Record<string, any> = {},
) {
  return db.profileSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      organizationId,
      profile: buildDefaultProfile(seed),
    },
  });
}

// ============================================================================
// GET /api/settings/profile - Get user profile settings
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const userId = user.id;

    // Find existing profile settings, creating defaults when missing
    let profileSettings: Record<string, any> | null = null;
    try {
      const row = await getOrCreateProfileRow(userId, user.organizationId, {
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        email: user.email || "",
      });
      profileSettings = flattenProfileRow(row);
    } catch (createError) {
      console.error("Error creating default profile:", createError);
      // If creation fails, return null to indicate no settings exist
      profileSettings = null;
    }

    // Return response with settings (even if null)
    const response = createSuccessResponse({
      settings: profileSettings,
      message: profileSettings
        ? "Profile settings retrieved successfully"
        : "No profile settings found",
      hasSettings: !!profileSettings,
    });

    return addSecurityHeaders(response);
  } catch (error) {
    console.error("Get profile settings error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/settings/profile - Update profile settings
// ============================================================================
export const PUT = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const userId = user.id;

    // Rate limiting
    const limiter = rateLimit({
      ...rateLimitConfigs.settingsUpdate,
      keyGenerator: () => userBasedKeyGenerator(userId),
    });

    const rateLimitResult = await limiter.check(request);
    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        "Too many profile updates. Please try again later.",
        rateLimitResult.resetTime,
      );
    }

    // Parse and validate request body
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Sanitize input data
    const sanitizedBody = sanitizeInput(body);

    // Validate the request body
    const validation = profileSettingsSchema.safeParse(sanitizedBody);
    if (!validation.success) {
      const errors = validation.error.errors.map((e) => e.message).join(", ");
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const profileData = cleanProfileData(validation.data);

    // Update or create profile settings (upsert by userId)
    const existing = await findProfileRow(userId);
    const mergedProfile = {
      ...((existing?.profile as Record<string, any>) ?? buildDefaultProfile()),
      ...profileData,
      updatedBy: userId,
    };

    const row = await db.profileSettings.upsert({
      where: { userId },
      update: { profile: mergedProfile, version: { increment: 1 } },
      create: {
        userId,
        organizationId: user.organizationId,
        profile: mergedProfile,
      },
    });
    auditProfileSave(
      user,
      existing?.profile ?? buildDefaultProfile(),
      row.profile,
    );

    const response = createSuccessResponse({
      settings: flattenProfileRow(row),
      message: "Profile settings updated successfully",
    });

    return addSecurityHeaders(response);
  } catch (error) {
    console.error("Update profile settings error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// PATCH /api/settings/profile - Partial update profile settings
// ============================================================================
export const PATCH = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const userId = user.id;

    // Rate limiting
    const limiter = rateLimit({
      ...rateLimitConfigs.settingsUpdate,
      keyGenerator: () => userBasedKeyGenerator(userId),
    });

    const rateLimitResult = await limiter.check(request);
    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        "Too many profile updates. Please try again later.",
        rateLimitResult.resetTime,
      );
    }

    // Parse and validate request body
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Sanitize input data
    const sanitizedBody = sanitizeInput(body);

    // Validate the request body (partial validation)
    const validation = profileSettingsSchema.partial().safeParse(sanitizedBody);
    if (!validation.success) {
      const errors = validation.error.errors.map((e) => e.message).join(", ");
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    const profileData = cleanProfileData(validation.data);

    // Find existing settings
    const existing = await findProfileRow(userId);

    let row: ProfileRow;
    if (!existing) {
      // Create new settings if they don't exist
      row = await db.profileSettings.upsert({
        where: { userId },
        update: {},
        create: {
          userId,
          organizationId: user.organizationId,
          profile: buildDefaultProfile({
            ...profileData,
            createdBy: userId,
          }),
        },
      });
    } else {
      // Update existing settings (per-field merge, like the old
      // Object.assign + save)
      row = await db.profileSettings.update({
        where: { userId },
        data: {
          profile: {
            ...((existing.profile as Record<string, any>) ?? {}),
            ...profileData,
            updatedBy: userId,
          },
          version: { increment: 1 },
        },
      });
    }

    auditProfileSave(
      user,
      existing?.profile ?? buildDefaultProfile(),
      row.profile,
    );

    const response = createSuccessResponse({
      settings: flattenProfileRow(row),
      message: "Profile settings updated successfully",
    });

    return addSecurityHeaders(response);
  } catch (error) {
    console.error("Patch profile settings error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// DELETE /api/settings/profile - Reset profile settings to defaults
// ============================================================================
export const DELETE = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const userId = user.id;

    // Rate limiting
    const limiter = rateLimit({
      ...rateLimitConfigs.settingsUpdate,
      keyGenerator: () => userBasedKeyGenerator(userId),
    });

    const rateLimitResult = await limiter.check(request);
    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        "Too many profile updates. Please try again later.",
        rateLimitResult.resetTime,
      );
    }

    // Read before the reset, so the entry can say what was cleared.
    const existing = await findProfileRow(userId);

    // Reset the (single) row back to defaults — one row per user in
    // Postgres, so "deactivate + recreate" becomes an in-place reset.
    const defaultProfile = buildDefaultProfile({
      firstName: user.firstName || "",
      lastName: user.lastName || "",
      email: user.email || "",
      createdBy: userId,
    });

    const row = await db.profileSettings.upsert({
      where: { userId },
      update: {
        profile: defaultProfile,
        isActive: true,
        version: { increment: 1 },
      },
      create: {
        userId,
        organizationId: user.organizationId,
        profile: defaultProfile,
      },
    });

    auditProfileSave(user, existing?.profile ?? null, row.profile);

    const response = createSuccessResponse({
      settings: flattenProfileRow(row),
      message: "Profile settings reset to defaults successfully",
    });

    return addSecurityHeaders(response);
  } catch (error) {
    console.error("Delete profile settings error:", error);
    return handleApiError(error);
  }
});
