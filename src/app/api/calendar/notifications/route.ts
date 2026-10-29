/**
 * PropertyPro - Calendar Notification Preferences API
 * Manage user notification preferences for calendar events
 *
 * Preferences live under the `calendar` key of the user's
 * notificationPreferences Json column.
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

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const notificationSettingsSchema = z.object({
  email: z
    .object({
      enabled: z.boolean().default(true),
      invitations: z.boolean().default(true),
      reminders: z.boolean().default(true),
      updates: z.boolean().default(true),
      cancellations: z.boolean().default(true),
      dailyDigest: z.boolean().default(false),
      weeklyDigest: z.boolean().default(true),
    })
    .optional(),

  sms: z
    .object({
      enabled: z.boolean().default(false),
      reminders: z.boolean().default(false),
      urgentUpdates: z.boolean().default(false),
    })
    .optional(),

  push: z
    .object({
      enabled: z.boolean().default(true),
      reminders: z.boolean().default(true),
      updates: z.boolean().default(true),
      invitations: z.boolean().default(true),
    })
    .optional(),

  reminderTiming: z
    .object({
      default: z.array(z.number()).default([15, 60]),
      highPriority: z.array(z.number()).default([15, 60, 1440]),
      lowPriority: z.array(z.number()).default([60]),
    })
    .optional(),

  digestTiming: z
    .object({
      dailyTime: z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .default("08:00"),
      weeklyDay: z.number().min(0).max(6).default(1),
      weeklyTime: z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .default("09:00"),
    })
    .optional(),

  quietHours: z
    .object({
      enabled: z.boolean().default(true),
      startTime: z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .default("22:00"),
      endTime: z
        .string()
        .regex(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/)
        .default("08:00"),
      timezone: z.string().default("local"),
    })
    .optional(),
});

// ============================================================================
// Default notification settings
// ============================================================================
const defaultNotificationSettings = {
  email: {
    enabled: true,
    invitations: true,
    reminders: true,
    updates: true,
    cancellations: true,
    dailyDigest: false,
    weeklyDigest: true,
  },
  sms: {
    enabled: false,
    reminders: false,
    urgentUpdates: false,
  },
  push: {
    enabled: true,
    reminders: true,
    updates: true,
    invitations: true,
  },
  reminderTiming: {
    default: [15, 60], // 15 minutes and 1 hour before
    highPriority: [15, 60, 1440], // 15 min, 1 hour, 1 day before
    lowPriority: [60], // 1 hour before
  },
  digestTiming: {
    dailyTime: "08:00",
    weeklyDay: 1, // Monday
    weeklyTime: "09:00",
  },
  quietHours: {
    enabled: true,
    startTime: "22:00",
    endTime: "08:00",
    timezone: "local",
  },
};

function readPreferences(user: { notificationPreferences: unknown } | null) {
  const prefs =
    user &&
    typeof user.notificationPreferences === "object" &&
    user.notificationPreferences !== null &&
    !Array.isArray(user.notificationPreferences)
      ? (user.notificationPreferences as Record<string, unknown>)
      : {};
  const calendar =
    typeof prefs.calendar === "object" &&
    prefs.calendar !== null &&
    !Array.isArray(prefs.calendar)
      ? (prefs.calendar as Record<string, any>)
      : null;
  return { prefs, calendar };
}

async function writeCalendarPreferences(
  userId: string,
  prefs: Record<string, unknown>,
  calendarSettings: unknown
) {
  await db.user.update({
    where: { id: userId },
    data: {
      notificationPreferences: {
        ...prefs,
        calendar: calendarSettings,
      } as Prisma.InputJsonValue,
    },
  });
}

// ============================================================================
// GET /api/calendar/notifications - Get notification preferences
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    // Get user's notification preferences
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const { calendar } = readPreferences(currentUser);
    const notificationSettings = calendar || defaultNotificationSettings;

    return createSuccessResponse(
      notificationSettings,
      "Notification preferences retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/calendar/notifications - Update notification preferences
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
    const validation = notificationSettingsSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const newSettings = validation.data;

    // Get current user settings
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const { prefs, calendar } = readPreferences(currentUser);
    const currentSettings = calendar || defaultNotificationSettings;

    // Merge with existing settings
    const updatedSettings = {
      ...currentSettings,
      ...newSettings,
      email: { ...currentSettings.email, ...newSettings.email },
      sms: { ...currentSettings.sms, ...newSettings.sms },
      push: { ...currentSettings.push, ...newSettings.push },
      reminderTiming: {
        ...currentSettings.reminderTiming,
        ...newSettings.reminderTiming,
      },
      digestTiming: {
        ...currentSettings.digestTiming,
        ...newSettings.digestTiming,
      },
      quietHours: { ...currentSettings.quietHours, ...newSettings.quietHours },
    };

    // Update user's notification preferences
    await writeCalendarPreferences(user.id, prefs, updatedSettings);

    return createSuccessResponse(
      updatedSettings,
      "Notification preferences updated successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PATCH /api/calendar/notifications - Update specific preference
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

    // Get current user settings
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const { prefs, calendar } = readPreferences(currentUser);
    const currentSettings = calendar || defaultNotificationSettings;

    // Update specific setting (copy along the path, then set the leaf)
    const keys = String(path).split(".");
    const updatedSettings: Record<string, any> = { ...currentSettings };
    let current: Record<string, any> = updatedSettings;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      current[key] =
        typeof current[key] === "object" &&
        current[key] !== null &&
        !Array.isArray(current[key])
          ? { ...current[key] }
          : {};
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;

    // Save updated settings
    await writeCalendarPreferences(user.id, prefs, updatedSettings);

    return createSuccessResponse(
      updatedSettings,
      "Notification preference updated successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// DELETE /api/calendar/notifications - Reset to default preferences
// ============================================================================
export const DELETE = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    // Reset to default notification settings
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const { prefs } = readPreferences(currentUser);
    await writeCalendarPreferences(user.id, prefs, defaultNotificationSettings);

    return createSuccessResponse(
      defaultNotificationSettings,
      "Notification preferences reset to defaults",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// Helper function to get user notification preferences
// ============================================================================
export async function getUserNotificationPreferences(userId: string) {
  try {
    const user = await db.user.findFirst({ where: { id: userId } });
    const { calendar } = readPreferences(user);
    return calendar || defaultNotificationSettings;
  } catch (error) {
    console.error("Failed to get user notification preferences:", error);
    return defaultNotificationSettings;
  }
}

// ============================================================================
// Helper function to check if notifications should be sent
// ============================================================================
export function shouldSendNotification(
  preferences: any,
  notificationType: string,
  eventPriority: string = "MEDIUM",
  currentTime: Date = new Date(),
): boolean {
  // Check if notification type is enabled
  const typeEnabled = preferences.email?.[notificationType] ?? false;
  if (!typeEnabled) return false;

  // Check quiet hours
  if (preferences.quietHours?.enabled) {
    const currentHour = currentTime.getHours();
    const currentMinute = currentTime.getMinutes();
    const currentTimeMinutes = currentHour * 60 + currentMinute;

    const [startHour, startMinute] = preferences.quietHours.startTime
      .split(":")
      .map(Number);
    const [endHour, endMinute] = preferences.quietHours.endTime
      .split(":")
      .map(Number);

    const startTimeMinutes = startHour * 60 + startMinute;
    const endTimeMinutes = endHour * 60 + endMinute;

    // Handle overnight quiet hours (e.g., 22:00 to 08:00)
    if (startTimeMinutes > endTimeMinutes) {
      if (
        currentTimeMinutes >= startTimeMinutes ||
        currentTimeMinutes <= endTimeMinutes
      ) {
        // Only allow urgent notifications during quiet hours
        return eventPriority === "HIGH" && notificationType === "urgentUpdates";
      }
    } else {
      // Same day quiet hours
      if (
        currentTimeMinutes >= startTimeMinutes &&
        currentTimeMinutes <= endTimeMinutes
      ) {
        return eventPriority === "HIGH" && notificationType === "urgentUpdates";
      }
    }
  }

  return true;
}

// ============================================================================
// Helper function to get reminder times for event priority
// ============================================================================
export function getReminderTimes(
  preferences: any,
  eventPriority: string = "MEDIUM",
): number[] {
  const priorityKey = eventPriority.toLowerCase() + "Priority";
  return (
    preferences.reminderTiming?.[priorityKey] ??
    preferences.reminderTiming?.default ?? [15, 60]
  );
}
