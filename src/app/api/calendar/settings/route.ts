/**
 * PropertyPro - Calendar Settings API
 * Manage user calendar preferences and settings
 *
 * All preferences live in a single `settings` Json column on the
 * calendar_settings row (one row per user, unique userId).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import { z } from "zod";
import { auditSettingsChange } from "@/lib/audit-domain";
import {
  CALENDAR_AUDIT_KEYS,
  calendarSnapshot,
} from "@/lib/audit/settings-keys";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const calendarSettingsSchema = z.object({
  defaultView: z
    .enum(["dayGridMonth", "timeGridWeek", "timeGridDay", "listWeek"])
    .optional(),
  weekends: z.boolean().optional(),
  firstDay: z.number().min(0).max(6).optional(),
  timezone: z.string().optional(),

  businessHours: z
    .object({
      enabled: z.boolean().optional(),
      startTime: z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .optional(),
      endTime: z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .optional(),
      daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
    })
    .optional(),

  slotDuration: z
    .string()
    .regex(/^[0-9]{2}:[0-5][0-9]$/)
    .optional(),
  snapDuration: z
    .string()
    .regex(/^[0-9]{2}:[0-5][0-9]$/)
    .optional(),
  defaultEventDuration: z
    .string()
    .regex(/^[0-9]{2}:[0-5][0-9]$/)
    .optional(),

  defaultEventType: z.string().optional(),
  defaultEventPriority: z.string().optional(),
  defaultReminders: z.array(z.number().min(0)).optional(),

  emailNotifications: z
    .object({
      invitations: z.boolean().optional(),
      reminders: z.boolean().optional(),
      updates: z.boolean().optional(),
      cancellations: z.boolean().optional(),
    })
    .optional(),

  showWeekNumbers: z.boolean().optional(),
  showDeclinedEvents: z.boolean().optional(),
  eventLimit: z.number().min(1).max(10).optional(),

  eventColors: z.record(z.string()).optional(),
});

// ============================================================================
// DEFAULTS (mirror the retired Mongoose schema defaults)
// ============================================================================

const DEFAULT_CALENDAR_SETTINGS = {
  defaultView: "dayGridMonth",
  weekends: true,
  firstDay: 0, // Sunday
  timezone: "local",
  businessHours: {
    enabled: true,
    startTime: "09:00",
    endTime: "17:00",
    daysOfWeek: [1, 2, 3, 4, 5], // Monday to Friday
  },
  slotDuration: "00:30",
  snapDuration: "00:15",
  defaultEventDuration: "01:00",
  defaultEventType: "GENERAL",
  defaultEventPriority: "MEDIUM",
  defaultReminders: [15], // 15 minutes before
  emailNotifications: {
    invitations: true,
    reminders: true,
    updates: true,
    cancellations: true,
  },
  showWeekNumbers: false,
  showDeclinedEvents: false,
  eventLimit: 3,
  eventColors: {
    LEASE_RENEWAL: "#3b82f6",
    PROPERTY_INSPECTION: "#10b981",
    MAINTENANCE_APPOINTMENT: "#f59e0b",
    PROPERTY_SHOWING: "#8b5cf6",
    TENANT_MEETING: "#6366f1",
    RENT_COLLECTION: "#059669",
    MOVE_IN: "#06b6d4",
    MOVE_OUT: "#ef4444",
    GENERAL: "#6b7280",
  },
  integrations: {
    googleCalendar: {
      enabled: false,
      autoSync: false,
      syncDirection: "bidirectional",
    },
  },
} as const;

type SettingsObject = Record<string, unknown>;

function isPlainObject(value: unknown): value is SettingsObject {
  return (
    typeof value === "object" && value !== null && !Array.isArray(value)
  );
}

/** Deep-merge overrides over defaults (objects merge; everything else replaces). */
function mergeSettings(
  base: SettingsObject,
  overrides: SettingsObject
): SettingsObject {
  const result: SettingsObject = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = mergeSettings(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/** Set a dotted-path value inside a settings object, copying along the path. */
function setSettingsPath(
  settings: SettingsObject,
  path: string,
  value: unknown
): SettingsObject {
  const keys = path.split(".");
  const result: SettingsObject = { ...settings };
  let cursor: SettingsObject = result;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const next = cursor[key];
    cursor[key] = isPlainObject(next) ? { ...next } : {};
    cursor = cursor[key] as SettingsObject;
  }
  cursor[keys[keys.length - 1]] = value;
  return result;
}

/**
 * One activity entry for a save: the preferences that moved, compared with the
 * defaults filled in (as the page shows them) so an untouched default is not a
 * change. These are the person's own view of the calendar.
 */
function auditCalendarSave(before: unknown, after: unknown): void {
  const effective = (settings: unknown) =>
    calendarSnapshot(
      mergeSettings(
        DEFAULT_CALENDAR_SETTINGS as unknown as SettingsObject,
        isPlainObject(settings) ? settings : {}
      )
    );
  auditSettingsChange({
    area: "calendar",
    before: effective(before),
    after: effective(after),
    keys: CALENDAR_AUDIT_KEYS,
  });
}

async function getOrCreateForUser(userId: string, organizationId: string) {
  return db.calendarSettings.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      organizationId,
      settings: DEFAULT_CALENDAR_SETTINGS as unknown as Prisma.InputJsonValue,
    },
  });
}

/** Response keeps the pre-Prisma shape: preference fields at the top level. */
function toResponse(row: {
  id: string;
  userId: string;
  settings: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  const stored = isPlainObject(row.settings) ? row.settings : {};
  return {
    id: row.id,
    userId: row.userId,
    ...mergeSettings(
      DEFAULT_CALENDAR_SETTINGS as unknown as SettingsObject,
      stored
    ),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================================
// GET /api/calendar/settings - Get user calendar settings
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    // Get or create settings for user
    const settings = await getOrCreateForUser(user.id, user.organizationId);

    return createSuccessResponse(
      toResponse(settings),
      "Calendar settings retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/calendar/settings - Update user calendar settings
// ============================================================================
export const PUT = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate request body
    const validation = calendarSettingsSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const updateData = validation.data as SettingsObject;

    // Get or create settings for user, then merge the update into the Json
    const existing = await getOrCreateForUser(user.id, user.organizationId);
    const stored = isPlainObject(existing.settings) ? existing.settings : {};
    const nextSettings = mergeSettings(stored, updateData);

    const updated = await db.calendarSettings.update({
      where: { userId: user.id },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    auditCalendarSave(stored, updated.settings);

    return createSuccessResponse(
      toResponse(updated),
      "Calendar settings updated successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PATCH /api/calendar/settings - Update specific setting
// ============================================================================
export const PATCH = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    const { path, value } = body;

    if (!path || value === undefined) {
      return createErrorResponse("Path and value are required", 400);
    }

    // Get or create settings for user
    const existing = await getOrCreateForUser(user.id, user.organizationId);
    const stored = isPlainObject(existing.settings) ? existing.settings : {};

    // Update specific setting path inside the Json object
    const nextSettings = setSettingsPath(stored, String(path), value);

    const updated = await db.calendarSettings.update({
      where: { userId: user.id },
      data: { settings: nextSettings as Prisma.InputJsonValue },
    });
    auditCalendarSave(stored, updated.settings);

    return createSuccessResponse(
      toResponse(updated),
      "Calendar setting updated successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// DELETE /api/calendar/settings - Reset settings to defaults
// ============================================================================
export const DELETE = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    // Get or create settings for user, then reset the Json to defaults
    const existing = await getOrCreateForUser(user.id, user.organizationId);

    const updated = await db.calendarSettings.update({
      where: { userId: user.id },
      data: {
        settings: DEFAULT_CALENDAR_SETTINGS as unknown as Prisma.InputJsonValue,
      },
    });
    auditCalendarSave(existing.settings, updated.settings);

    return createSuccessResponse(
      toResponse(updated),
      "Calendar settings reset to defaults",
    );
  } catch (error) {
    return handleApiError(error);
  }
});
