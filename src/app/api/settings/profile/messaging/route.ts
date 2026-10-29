/**
 * PropertyPro - My SMS and WhatsApp preferences (Settings → Profile)
 *
 * GET → { sms, whatsapp }: whether the signed-in person receives each.
 * PUT { sms?, whatsapp? } → change them. Turning a channel off stops every
 * message the office sends on it to this person, automated or by hand.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  readMessagingPreferences,
  writeMessagingPreferences,
} from "@/lib/messaging/preferences";
import { auditOwnAccount } from "@/lib/audit/account-events";
import {
  MESSAGING_OPT_AUDIT_KEYS,
  messagingOptSnapshot,
} from "@/lib/audit/settings-keys";

export const GET = withPermissionAndDB("profile_management")(
  async (user: AuthenticatedAccessUser) => {
    try {
      const preferences = await readMessagingPreferences(user.id);
      if (!preferences) return createErrorResponse("User not found", 404);
      return createSuccessResponse(preferences);
    } catch (error) {
      return handleApiError(error, "Failed to load your message preferences");
    }
  },
);

export const PUT = withPermissionAndDB("profile_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const parsed = await parseRequestBody(request);
      const body = (parsed.data ?? {}) as Record<string, unknown>;
      // Read first: opting out of a channel stops every message to this person,
      // so the entry says which way it moved.
      const before = await readMessagingPreferences(user.id);
      const preferences = await writeMessagingPreferences(user.id, {
        sms: typeof body.sms === "boolean" ? body.sms : undefined,
        whatsapp: typeof body.whatsapp === "boolean" ? body.whatsapp : undefined,
      });
      if (!preferences) return createErrorResponse("User not found", 404);
      auditOwnAccount({
        person: user,
        before: messagingOptSnapshot(before),
        after: messagingOptSnapshot(preferences),
        keys: MESSAGING_OPT_AUDIT_KEYS,
      });
      return createSuccessResponse(preferences, "Preferences saved");
    } catch (error) {
      return handleApiError(error, "Failed to save your message preferences");
    }
  },
);
