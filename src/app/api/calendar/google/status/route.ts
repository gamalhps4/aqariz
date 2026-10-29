/**
 * PropertyPro - Google Calendar Status API
 * Get Google Calendar integration status and settings
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
// import { googleCalendarService } from "@/lib/services/google-calendar.service";
// import { decryptSensitiveValue } from "@/lib/security/field-encryption";

// ============================================================================
// GET /api/calendar/google/status - Get Google Calendar integration status
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(
  async (user: any, request: NextRequest) => {
  try {
    // Get user's Google Calendar integration data (integrations Json column)
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const integrations = (currentUser?.integrations as any) ?? {};
    const integration = integrations.googleCalendar;

    if (!integration?.connected) {
      return createSuccessResponse(
        {
          connected: false,
          lastSync: null,
          syncEnabled: false,
          calendars: [],
          selectedCalendarId: null,
          syncDirection: "bidirectional",
        },
        "Google Calendar not connected"
      );
    }

    // TODO: Re-enable when google-calendar.service is implemented
    return createSuccessResponse(
      {
        connected: false,
        lastSync: null,
        syncEnabled: false,
        calendars: [],
        selectedCalendarId: null,
        syncDirection: "bidirectional",
        error: "Google Calendar integration temporarily disabled",
      },
      "Google Calendar integration temporarily disabled"
    );
    /*
    // Tokens are stored app-encrypted inside the integrations Json —
    // decrypt them when handing them to the Google client.
    googleCalendarService.setCredentials({
      access_token: decryptSensitiveValue(integration.accessToken),
      refresh_token: decryptSensitiveValue(integration.refreshToken),
      expiry_date: integration.expiryDate
        ? new Date(integration.expiryDate).getTime()
        : undefined,
    });

    try {
      // Get user's calendar list
      const calendars = await googleCalendarService.getCalendarList();

      return createSuccessResponse(
        {
          connected: true,
          lastSync: integration.lastSync || null,
          syncEnabled: integration.autoSync || false,
          calendars,
          selectedCalendarId: integration.selectedCalendarId || null,
          syncDirection: integration.syncDirection || "bidirectional",
          connectedAt: integration.connectedAt,
        },
        "Status retrieved successfully"
      );
    } catch (error) {
      console.error("Failed to fetch calendar list:", error);

      // If token is expired, mark as disconnected
      if (
        error.message.includes("invalid_grant") ||
        error.message.includes("unauthorized")
      ) {
        await db.user.update({
          where: { id: user.id },
          data: {
            integrations: {
              ...integrations,
              googleCalendar: { ...integration, connected: false },
            },
          },
        });

        return createSuccessResponse(
          {
            connected: false,
            lastSync: null,
            syncEnabled: false,
            calendars: [],
            selectedCalendarId: null,
            syncDirection: "bidirectional",
            error: "Token expired, please reconnect",
          },
          "Google Calendar token expired"
        );
      }

      throw error;
    }
    */
  } catch (error) {
    return handleApiError(error);
  }
  }
);
