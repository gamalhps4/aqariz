/**
 * PropertyPro - Google Calendar Disconnect API
 * Disconnect Google Calendar integration
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";

// ============================================================================
// POST /api/calendar/google/disconnect - Disconnect Google Calendar
// ============================================================================
export const POST = withPermissionAndDB("profile_management")(
  async (user: any, request: NextRequest) => {
  try {
    // Remove Google Calendar integration data (and its encrypted tokens)
    // from the user's integrations Json column
    const currentUser = await db.user.findFirst({ where: { id: user.id } });
    const integrations = (currentUser?.integrations as any) ?? {};
    const { googleCalendar: _removed, ...remainingIntegrations } = integrations;

    await db.user.update({
      where: { id: user.id },
      data: { integrations: remainingIntegrations as Prisma.InputJsonValue },
    });

    return createSuccessResponse(
      { disconnected: true },
      "Google Calendar disconnected successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
  }
);
