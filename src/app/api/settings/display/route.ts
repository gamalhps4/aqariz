/**
 * PropertyPro - Display Settings API Routes
 * Enhanced CRUD operations specifically for display settings
 *
 * Storage (Postgres, one row per user): known display fields live in flat
 * columns (theme/language/timezone/currency/dateFormat/timeFormat/contrast/
 * compact/rtl/navColor/customCSS/isActive/version); every other display
 * preference (fonts, density, colorScheme, dashboard, tables, charts,
 * accessibility, dashboardLayout, itemsPerPage, …) lives in the `preferences`
 * Json group and branding (logos/colors/company info + r2 asset metadata) in
 * the `branding` Json group. The API request/response shape stays FLAT — the
 * helpers below map flat ⇄ columns+Json on every read/write.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withAccessAndDB,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { displaySettingsSchema } from "@/lib/validations";
import {
  rateLimit,
  rateLimitConfigs,
  createRateLimitResponse,
  addSecurityHeaders,
  userBasedKeyGenerator,
} from "@/lib/rate-limit";
import { z } from "zod";
import { deleteFromR2 } from "@/lib/r2-server";
import { getOrganizationName } from "@/lib/utils/company-info-server";
import { ACTIVE_REGION } from "@/lib/regional/region";
import { isR2Url, extractObjectKey } from "@/lib/r2";
// Display & branding is one app-wide setting; every reader/writer resolves the
// same owner via this shared helper so branding never diverges across surfaces.
import { resolveGlobalDisplayOwnerId } from "@/lib/utils/global-display-owner";
import { hasPermission } from "@/lib/permissions-manager";
import { auditSettingsChange } from "@/lib/audit-domain";
import {
  BRANDING_AUDIT_KEYS,
  DISPLAY_AUDIT_KEYS,
  brandingSnapshot,
  displaySnapshot,
} from "@/lib/audit/settings-keys";

/**
 * Who may change display & branding.
 *
 * It is one setting for the whole organization, which is what the
 * `system_settings` permission is for. The handlers used to ask `isAdmin`,
 * and a permission group is never that: one ticked "System settings" was
 * shown the screen by the menu and refused by every save. Of the built-in
 * roles only the Administrator holds the permission, so nothing changes for
 * them — a Manager's `company_settings` still passes the wrapper and no
 * further.
 */
const canChangeDisplaySettings = (user: AuthenticatedAccessUser) =>
  hasPermission(user.permissions, "system_settings");

// ============================================================================
// FLAT ⇄ COLUMNS/JSON MAPPING
// ============================================================================

type FlatDisplaySettings = Record<string, any>;

/** Fields stored as real columns on the display_settings table. */
const DISPLAY_COLUMN_KEYS = [
  "theme",
  "language",
  "timezone",
  "currency",
  "dateFormat",
  "timeFormat",
  "contrast",
  "compact",
  "rtl",
  "navColor",
  "customCSS",
] as const;

/** Row metadata that must never be written from request payloads. */
const RESERVED_KEYS = new Set([
  "id",
  "_id",
  "__v",
  "organizationId",
  "userId",
  "isActive",
  "version",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "branding",
]);

/**
 * What an office's display settings open with: the market this deployment
 * ships for (lib/regional/region.ts). These were US values — dollars, New
 * York time, month-first dates — written over the schema's own SAR/Arabic
 * defaults the first time an office's settings were read, so every amount in
 * a new office's dashboard came out with a "$".
 */
const DEFAULT_DISPLAY_COLUMNS = {
  theme: "system",
  language: ACTIVE_REGION.language,
  timezone: ACTIVE_REGION.timezone,
  currency: ACTIVE_REGION.currency,
  dateFormat: ACTIVE_REGION.dateFormat,
  timeFormat: ACTIVE_REGION.timeFormat,
  contrast: false,
  compact: false,
  rtl: ACTIVE_REGION.rtl,
  navColor: "integrate",
};

/** Everything the old document kept flat that now lives in `preferences`. */
const DEFAULT_DISPLAY_PREFERENCES = {
  numberFormat: "US",
  compactMode: false,
  sidebarCollapsed: false,
  showAvatars: true,
  animationsEnabled: true,
  highContrast: false,
  fontSize: "medium",
  fontFamily: "Inter",
  lineHeight: "normal",
  density: "comfortable",
  colorScheme: {
    primary: "#3b82f6",
    secondary: "#64748b",
    accent: "#06b6d4",
    background: "#ffffff",
    surface: "#f8fafc",
    text: "#1e293b",
  },
  dashboard: {
    defaultView: "grid",
    itemsPerPage: 20,
    showQuickActions: true,
    showRecentActivity: true,
    showNotifications: true,
    autoRefresh: false,
    refreshInterval: 300,
  },
  tables: {
    defaultPageSize: 10,
    showRowNumbers: false,
    enableSorting: true,
    enableFiltering: true,
    stickyHeaders: true,
    zebra: true,
  },
  charts: {
    defaultType: "bar",
    showDataLabels: true,
    showLegend: true,
    showGrid: true,
    animateOnLoad: true,
  },
  accessibility: {
    reduceMotion: false,
    highContrast: false,
    largeText: false,
    screenReader: false,
    keyboardNavigation: true,
  },
  dashboardLayout: "grid",
  itemsPerPage: 25,
};

const DEFAULT_DISPLAY_BRANDING = {
  logoLight: "/images/logo-light.png",
  logoDark: "/images/logo-dark.png",
  favicon: "/favicon.ico",
  primaryColor: "#3B82F6",
  secondaryColor: "#64748B",
  r2: {},
};

/** The complete default settings object in the (flat) API shape. */
function buildDefaultFlatSettings(): FlatDisplaySettings {
  return {
    ...DEFAULT_DISPLAY_COLUMNS,
    ...DEFAULT_DISPLAY_PREFERENCES,
    branding: { ...DEFAULT_DISPLAY_BRANDING },
  };
}

type DisplayRow = Awaited<ReturnType<typeof getOrCreateDisplayRow>>;

/** Row → flat API object (old Mongoose document shape). */
function flattenDisplayRow(row: DisplayRow): FlatDisplaySettings {
  const preferences = (row.preferences as Record<string, any>) ?? {};
  const branding = (row.branding as Record<string, any>) ?? {};
  return {
    ...preferences,
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    theme: row.theme,
    language: row.language,
    timezone: row.timezone,
    currency: row.currency,
    dateFormat: row.dateFormat,
    timeFormat: row.timeFormat,
    contrast: row.contrast,
    compact: row.compact,
    rtl: row.rtl,
    navColor: row.navColor,
    ...(row.customCSS != null ? { customCSS: row.customCSS } : {}),
    ...(Object.keys(branding).length > 0 ? { branding } : {}),
    isActive: row.isActive,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Get-or-create the single settings row for a user (defaults on create). */
async function getOrCreateDisplayRow(userId: string, organizationId: string) {
  return db.displaySettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      organizationId,
      ...DEFAULT_DISPLAY_COLUMNS,
      preferences: DEFAULT_DISPLAY_PREFERENCES,
      branding: DEFAULT_DISPLAY_BRANDING,
    },
  });
}

/**
 * The activity entries for a save: one per area that moved — display and
 * language, and branding (logos, colours, company details) — each with only
 * the fields that changed. The preferences drawer saves on every tweak; a save
 * that moves none of the compared fields records nothing at all.
 */
function auditDisplaySave(before: DisplayRow, after: DisplayRow): void {
  auditSettingsChange({
    area: "display",
    before: displaySnapshot(flattenDisplayRow(before)),
    after: displaySnapshot(flattenDisplayRow(after)),
    keys: DISPLAY_AUDIT_KEYS,
  });
  auditSettingsChange({
    area: "branding",
    before: brandingSnapshot(before.branding),
    after: brandingSnapshot(after.branding),
    keys: BRANDING_AUDIT_KEYS,
  });
}

/**
 * Apply a flat (validated) settings object to the row: known keys → columns,
 * `branding` → branding Json (wholesale, the callers pre-merge), everything
 * else → merged into the `preferences` Json. Version increments on update.
 */
async function applyDisplayUpdate(
  userId: string,
  flatData: FlatDisplaySettings,
  currentRow: DisplayRow,
) {
  const columnKeys = DISPLAY_COLUMN_KEYS as readonly string[];
  const columns: Record<string, any> = {};
  const preferences: Record<string, any> = {
    ...((currentRow.preferences as Record<string, any>) ?? {}),
  };
  let branding: Record<string, any> | undefined;
  let preferencesTouched = false;

  for (const [key, value] of Object.entries(flatData)) {
    if (value === undefined) continue;
    if (key === "branding") {
      // The browser icon is the platform's (Super Admin → Settings); an
      // office's save always stores the default, whatever it sends.
      branding = {
        ...(value as Record<string, unknown>),
        favicon: DEFAULT_DISPLAY_BRANDING.favicon,
      };
      continue;
    }
    if (columnKeys.includes(key)) {
      columns[key] = value;
      continue;
    }
    if (RESERVED_KEYS.has(key)) continue;
    preferences[key] = value;
    preferencesTouched = true;
  }

  return db.displaySettings.update({
    where: { userId },
    data: {
      ...columns,
      ...(branding !== undefined ? { branding } : {}),
      ...(preferencesTouched ? { preferences } : {}),
      version: { increment: 1 },
    },
  });
}

/**
 * Delete old branding images from R2 when they are being replaced
 */
async function deleteOldBrandingImages(
  currentBranding: any,
  newBranding: any,
): Promise<void> {
  const imagesToDelete: string[] = [];

  // Check each branding image type
  const imageTypes = ["logoLight", "logoDark", "favicon"] as const;

  for (const imageType of imageTypes) {
    const currentUrl = currentBranding?.[imageType];
    const newUrl = newBranding?.[imageType];

    // If the URL is changing and the old URL exists, delete it
    if (currentUrl && newUrl && currentUrl !== newUrl) {
      imagesToDelete.push(currentUrl);
    }
  }

  // Delete all old images
  if (imagesToDelete.length > 0) {
    try {
      const deleteResults = await Promise.allSettled(
        imagesToDelete.map(async (url) => {
          // Extract object key from URL
          let objectKey: string | null = url;
          if (url.startsWith("http://") || url.startsWith("https://")) {
            if (isR2Url(url)) {
              objectKey = extractObjectKey(url);
            } else {
              console.warn(`Skipping non-R2 URL: ${url}`);
              return false;
            }
          }

          if (!objectKey) {
            console.warn(`Could not extract object key from: ${url}`);
            return false;
          }

          return await deleteFromR2(objectKey);
        }),
      );

      deleteResults.forEach((result, index) => {
        if (result.status === "fulfilled" && result.value) {
        } else if (result.status === "rejected") {
          console.warn(
            `Failed to delete old branding image from R2: ${imagesToDelete[index]}`,
            result.reason,
          );
        }
      });
    } catch (error) {
      console.error("Error deleting old branding images:", error);
      // Don't throw - continue with the update even if deletion fails
    }
  }
}

// Enhanced validation schema for partial updates
const partialDisplaySettingsSchema = displaySettingsSchema.partial();

// Bulk update schema
const bulkUpdateSchema = z.object({
  operations: z.array(
    z.object({
      field: z.string(),
      value: z.any(),
      operation: z.enum(["set", "unset", "merge"]).default("set"),
    }),
  ),
});

// ============================================================================
// GET /api/settings/display - Get display settings with enhanced features
// ============================================================================
export const GET = withAccessAndDB({})(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const settingsOwnerId =
      (await resolveGlobalDisplayOwnerId()) ?? user.id;
    const url = new URL(request.url);
    const includeDefaults = url.searchParams.get("includeDefaults") === "true";
    const format = url.searchParams.get("format") ?? "json";

    let row = await getOrCreateDisplayRow(
      settingsOwnerId,
      user.organizationId!,
    );

    // Backfill legacy rows that predate the branding group.
    const currentBranding = (row.branding as Record<string, any>) ?? {};
    if (Object.keys(currentBranding).length === 0) {
      const preferences = {
        ...((row.preferences as Record<string, any>) ?? {}),
      };
      if (!preferences.dashboardLayout) preferences.dashboardLayout = "grid";
      if (!preferences.itemsPerPage) preferences.itemsPerPage = 25;

      row = await db.displaySettings.update({
        where: { userId: settingsOwnerId },
        data: {
          branding: {
            logoLight: "/images/logo-light.png",
            logoDark: "/images/logo-dark.png",
            favicon: "/favicon.ico",
            primaryColor: "#3B82F6",
            secondaryColor: "#64748B",
          },
          preferences,
          version: { increment: 1 },
        },
      });
    }

    const displaySettings = flattenDisplayRow(row);

    // Until the office types a company name into its branding, its invoices
    // and receipts are issued under the name it signed up with. Only looked
    // up when it is needed.
    const brandingName = (row.branding as Record<string, any> | null)
      ?.companyName;
    const organizationName = brandingName ? null : await getOrganizationName();

    let responseData = {
      settings: displaySettings,
      metadata: {
        lastUpdated: row.updatedAt,
        version: row.version ?? 1,
        ...(organizationName ? { organizationName } : {}),
      },
    };

    if (includeDefaults) {
      const defaultSettings = buildDefaultFlatSettings();
      responseData = {
        ...responseData,
        defaults: defaultSettings,
        isDefault:
          JSON.stringify(displaySettings) === JSON.stringify(defaultSettings),
      } as any;
    }

    if (format === "export") {
      responseData = {
        version: "1.0",
        timestamp: new Date().toISOString(),
        settings: displaySettings,
        metadata: {
          exportedBy: user.id,
          exportedAt: new Date().toISOString(),
          lastUpdated: row.updatedAt,
          version: row.version ?? 1,
        },
      } as any;
    }

    const response = createSuccessResponse(responseData);
    return addSecurityHeaders(response);
  } catch (error) {
    console.error("Get display settings error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/settings/display - Complete update display settings
// ============================================================================
export const PUT = withPermissionAndDB(["company_settings", "system_settings"])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!canChangeDisplaySettings(user)) {
        return addSecurityHeaders(
          createErrorResponse(
            "You do not have permission to change display & branding settings.",
            403,
          ),
        );
      }

      const actorId = user.id;
      const settingsOwnerId =
        (await resolveGlobalDisplayOwnerId()) ?? user.id;

      const limiter = rateLimit({
        ...rateLimitConfigs.settingsUpdate,
        keyGenerator: () => userBasedKeyGenerator(actorId),
      });

      const rateLimitResult = await limiter.check(request);
      if (!rateLimitResult.success) {
        return createRateLimitResponse(
          "Too many display updates. Please try again later.",
          rateLimitResult.resetTime,
        );
      }

      // Parse request body
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error ?? "Invalid request body", 400);
      }

      // Validate complete update data
      const validation = displaySettingsSchema.safeParse(body);
      if (!validation.success) {
        const errors = validation.error.errors
          .map((e) => `${e.path.join(".")}: ${e.message}`)
          .join(", ");
        return createErrorResponse(`Validation failed: ${errors}`, 400);
      }

      // Get or create settings
      const row = await getOrCreateDisplayRow(
        settingsOwnerId,
        user.organizationId!,
      );

      // Delete old branding images from R2 if they are being replaced
      if (validation.data.branding) {
        await deleteOldBrandingImages(
          row.branding as Record<string, any>,
          validation.data.branding,
        );
      }

      // Update settings completely
      const updatedRow = await applyDisplayUpdate(
        settingsOwnerId,
        validation.data,
        row,
      );
      auditDisplaySave(row, updatedRow);

      const response = createSuccessResponse({
        settings: flattenDisplayRow(updatedRow),
        message: "Display settings updated successfully",
      });

      return addSecurityHeaders(response);
    } catch (error) {
      console.error("PUT display settings error:", error);
      return handleApiError(error);
    }
  },
);

// ============================================================================
// PATCH /api/settings/display - Partial update display settings
// ============================================================================
export const PATCH = withPermissionAndDB([
  "company_settings",
  "system_settings",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (!canChangeDisplaySettings(user)) {
      return addSecurityHeaders(
        createErrorResponse(
          "You do not have permission to change display & branding settings.",
          403,
        ),
      );
    }

    const actorId = user.id;
    const settingsOwnerId = (await resolveGlobalDisplayOwnerId()) ?? user.id;

    // Rate limiting
    const limiter = rateLimit({
      ...rateLimitConfigs.settingsUpdate,
      keyGenerator: () => userBasedKeyGenerator(actorId),
    });

    const rateLimitResult = await limiter.check(request);
    if (!rateLimitResult.success) {
      return createRateLimitResponse(
        "Too many display updates. Please try again later.",
        rateLimitResult.resetTime,
      );
    }

    // Parse request body
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate partial update data
    const validation = partialDisplaySettingsSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return createErrorResponse(`Validation failed: ${errors}`, 400);
    }

    // Get current settings
    const row = await getOrCreateDisplayRow(
      settingsOwnerId,
      user.organizationId!,
    );

    // Merge with existing settings (deep merge for nested objects like branding)
    const currentDisplay = flattenDisplayRow(row);

    // Delete old branding images from R2 if they are being replaced
    if (validation.data.branding) {
      await deleteOldBrandingImages(
        currentDisplay.branding,
        validation.data.branding,
      );
    }

    const updatedDisplay = {
      ...currentDisplay,
      ...validation.data,
      // Deep merge branding object if it exists in the update
      ...(validation.data.branding && {
        branding: {
          ...currentDisplay.branding,
          ...validation.data.branding,
        },
      }),
    };

    // Validate the complete merged settings
    const completeValidation = displaySettingsSchema.safeParse(updatedDisplay);
    if (!completeValidation.success) {
      const errors = completeValidation.error.errors
        .map((e) => `${e.path.join(".")}: ${e.message}`)
        .join(", ");
      return createErrorResponse(
        `Complete settings validation failed: ${errors}`,
        400,
      );
    }

    // Update settings
    const updatedRow = await applyDisplayUpdate(
      settingsOwnerId,
      completeValidation.data,
      row,
    );
    auditDisplaySave(row, updatedRow);

    const response = createSuccessResponse({
      settings: flattenDisplayRow(updatedRow),
      message: "Display settings updated successfully",
      updatedFields: Object.keys(validation.data),
    });

    return addSecurityHeaders(response);
  } catch (error) {
    console.error("Patch display settings error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/settings/display - Bulk operations and advanced features
// ============================================================================
export const POST = withPermissionAndDB([
  "company_settings",
  "system_settings",
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (!canChangeDisplaySettings(user)) {
      return addSecurityHeaders(
        createErrorResponse(
          "You do not have permission to change display & branding settings.",
          403,
        ),
      );
    }

    const settingsOwnerId = (await resolveGlobalDisplayOwnerId()) ?? user.id;
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    const { action, ...data } = body;

    switch (action) {
      case "reset": {
        // Reset to default settings (ensure the row exists first)
        const rowBeforeReset = await getOrCreateDisplayRow(
          settingsOwnerId,
          user.organizationId!,
        );

        const updatedRow = await db.displaySettings.update({
          where: { userId: settingsOwnerId },
          data: {
            ...DEFAULT_DISPLAY_COLUMNS,
            customCSS: null,
            preferences: DEFAULT_DISPLAY_PREFERENCES,
            branding: DEFAULT_DISPLAY_BRANDING,
            version: { increment: 1 },
          },
        });

        auditDisplaySave(rowBeforeReset, updatedRow);

        return createSuccessResponse({
          settings: flattenDisplayRow(updatedRow),
          message: "Display settings reset to defaults",
        });
      }

      case "bulk": {
        // Bulk update operations
        const bulkValidation = bulkUpdateSchema.safeParse(data);
        if (!bulkValidation.success) {
          return createErrorResponse("Invalid bulk operation format", 400);
        }

        const row = await getOrCreateDisplayRow(
          settingsOwnerId,
          user.organizationId!,
        );

        const currentSettingsBulk: Record<string, any> = {
          ...flattenDisplayRow(row),
        };

        // Apply bulk operations
        for (const operation of bulkValidation.data.operations) {
          const { field, value, operation: op } = operation;

          switch (op) {
            case "set": {
              // Set field value using dot notation
              const keys = field.split(".");
              let target = currentSettingsBulk;
              for (let i = 0; i < keys.length - 1; i++) {
                if (!target[keys[i]]) target[keys[i]] = {};
                target = target[keys[i]];
              }
              target[keys[keys.length - 1]] = value;
              break;
            }

            case "unset": {
              // Remove field
              const unsetKeys = field.split(".");
              let unsetTarget = currentSettingsBulk;
              for (let i = 0; i < unsetKeys.length - 1; i++) {
                if (!unsetTarget[unsetKeys[i]]) break;
                unsetTarget = unsetTarget[unsetKeys[i]];
              }
              delete unsetTarget[unsetKeys[unsetKeys.length - 1]];
              break;
            }

            case "merge": {
              // Merge object values
              if (typeof value === "object" && value !== null) {
                const mergeKeys = field.split(".");
                let mergeTarget = currentSettingsBulk;
                for (let i = 0; i < mergeKeys.length - 1; i++) {
                  if (!mergeTarget[mergeKeys[i]])
                    mergeTarget[mergeKeys[i]] = {};
                  mergeTarget = mergeTarget[mergeKeys[i]];
                }
                mergeTarget[mergeKeys[mergeKeys.length - 1]] = {
                  ...mergeTarget[mergeKeys[mergeKeys.length - 1]],
                  ...value,
                };
              }
              break;
            }
          }
        }

        // Validate final settings
        const finalValidation =
          displaySettingsSchema.safeParse(currentSettingsBulk);
        if (!finalValidation.success) {
          return createErrorResponse(
            "Bulk operations resulted in invalid settings",
            400,
          );
        }

        const bulkUpdatedRow = await applyDisplayUpdate(
          settingsOwnerId,
          finalValidation.data,
          row,
        );
        auditDisplaySave(row, bulkUpdatedRow);

        return createSuccessResponse({
          settings: finalValidation.data,
          message: "Bulk operations completed successfully",
          operationsApplied: bulkValidation.data.operations.length,
        });
      }

      default:
        return createErrorResponse("Invalid action", 400);
    }
  } catch (error) {
    console.error("POST display settings error:", error);
    return handleApiError(error);
  }
});
