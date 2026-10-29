/**
 * PropertyPro - Google Calendar OAuth API
 * Handle Google Calendar OAuth authentication
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
// import { googleCalendarService } from "@/lib/services/google-calendar.service";

// ============================================================================
// POST /api/calendar/google/auth - Initiate Google Calendar OAuth
// ============================================================================
export const POST = withPermissionAndDB("profile_management")(
  async (user: any, request: NextRequest) => {
  try {
    // Check if Google OAuth is configured
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
      return createErrorResponse(
        "Google Calendar integration is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.",
        503
      );
    }

    // TODO: Re-enable when google-calendar.service is implemented
    return createErrorResponse(
      "Google Calendar integration is temporarily disabled",
      503
    );
    /*
    try {
      // Generate OAuth URL
      const authUrl = googleCalendarService.generateAuthUrl(session.user.id);

      return createSuccessResponse(
        { authUrl },
        "OAuth URL generated successfully"
      );
    } catch (serviceError) {
      console.error("Google Calendar service error:", serviceError);
      return createErrorResponse(
        `Failed to generate OAuth URL: ${serviceError.message}`,
        500
      );
    }
    */
  } catch (error) {
    return handleApiError(error);
  }
  }
);

// ============================================================================
// GET /api/calendar/google/auth - Get OAuth status
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(
  async (user: any, request: NextRequest) => {
  try {
    // Check if user has Google Calendar tokens stored
    // In a real implementation, you would check the database for stored tokens
    const hasTokens = false; // Placeholder

    return createSuccessResponse(
      {
        configured: !!(
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ),
        connected: hasTokens,
      },
      "OAuth status retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
  }
);
