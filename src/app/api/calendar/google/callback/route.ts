/**
 * PropertyPro - Google Calendar OAuth Callback API
 * Handle Google Calendar OAuth callback and token exchange
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import {
  createErrorResponse,
} from "@/lib/api-utils";
// import { db } from "@/lib/db/prisma";
// import { googleCalendarService } from "@/lib/services/google-calendar.service";
// import { encryptSensitiveValue } from "@/lib/security/field-encryption";

// ============================================================================
// GET /api/calendar/google/callback - Handle OAuth callback
// ============================================================================
export const GET = async (request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const code = searchParams.get("code");
    const state = searchParams.get("state"); // Contains user ID
    const error = searchParams.get("error");

    if (error) {
      console.error("Google OAuth error:", error);
      return redirect("/dashboard/calendar?error=oauth_failed");
    }

    if (!code || !state) {
      return createErrorResponse("Missing authorization code or state", 400);
    }

    // TODO: Re-enable when google-calendar.service is implemented
    return redirect("/dashboard/calendar?error=integration_disabled");
    /*
    try {
      // Exchange code for tokens
      const tokens = await googleCalendarService.exchangeCodeForTokens(code);

      // Store the tokens app-encrypted inside the user's integrations Json
      const currentUser = await db.user.findFirst({ where: { id: state } });
      const integrations = (currentUser?.integrations as any) ?? {};

      await db.user.update({
        where: { id: state },
        data: {
          integrations: {
            ...integrations,
            googleCalendar: {
              accessToken: encryptSensitiveValue(tokens.access_token),
              refreshToken: encryptSensitiveValue(tokens.refresh_token),
              expiryDate: tokens.expiry_date
                ? new Date(tokens.expiry_date).toISOString()
                : null,
              connected: true,
              connectedAt: new Date().toISOString(),
            },
          },
        },
      });

      // Redirect to calendar page with success message
      return redirect("/dashboard/calendar?success=google_connected");
    } catch (error) {
      console.error("Token exchange failed:", error);
      return redirect("/dashboard/calendar?error=token_exchange_failed");
    }
    */
  } catch (error) {
    console.error("OAuth callback error:", error);
    return redirect("/dashboard/calendar?error=callback_failed");
  }
};
