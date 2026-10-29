/**
 * PropertyPro - Google Calendar Auto-Sync API
 * Manage automatic sync settings for Google Calendar
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

const autoSyncSchema = z.object({
  enabled: z.boolean(),
  calendarId: z.string().optional(),
  syncDirection: z.enum(["import", "export", "bidirectional"]).optional(),
  syncInterval: z.number().min(5).max(1440).optional(), // 5 minutes to 24 hours
});

// ============================================================================
// POST /api/calendar/google/auto-sync - Update auto-sync settings
// ============================================================================
export const POST = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate request body
    const validation = autoSyncSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const { enabled, calendarId, syncDirection, syncInterval } =
      validation.data;

    // Check if user has Google Calendar connected (integrations Json column)
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const integrations = (currentUser?.integrations as any) ?? {};
    const googleCalendar = integrations.googleCalendar;
    if (!googleCalendar?.connected) {
      return createErrorResponse("Google Calendar not connected", 400);
    }

    // Update auto-sync settings inside the integrations Json
    const updatedGoogleCalendar = {
      ...googleCalendar,
      autoSync: enabled,
      ...(calendarId ? { selectedCalendarId: calendarId } : {}),
      ...(syncDirection ? { syncDirection } : {}),
      ...(syncInterval ? { syncInterval } : {}),
    };

    await db.user.update({
      where: { id: user.id },
      data: {
        integrations: {
          ...integrations,
          googleCalendar: updatedGoogleCalendar,
        } as Prisma.InputJsonValue,
      },
    });

    return createSuccessResponse(
      {
        autoSync: enabled,
        calendarId: calendarId ?? googleCalendar.selectedCalendarId,
        syncDirection:
          syncDirection ?? googleCalendar.syncDirection ?? "bidirectional",
        syncInterval: syncInterval ?? googleCalendar.syncInterval ?? 15,
      },
      "Auto-sync settings updated successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// GET /api/calendar/google/auto-sync - Get auto-sync settings
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (
  user: any,
  request: NextRequest,
) => {
  try {
    // Get user's auto-sync settings (integrations Json column)
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const integration = (currentUser?.integrations as any)?.googleCalendar;

    if (!integration?.connected) {
      return createErrorResponse("Google Calendar not connected", 400);
    }

    return createSuccessResponse(
      {
        autoSync: integration.autoSync ?? false,
        calendarId: integration.selectedCalendarId ?? null,
        syncDirection: integration.syncDirection ?? "bidirectional",
        syncInterval: integration.syncInterval ?? 15,
        lastSync: integration.lastSync ?? null,
      },
      "Auto-sync settings retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});
