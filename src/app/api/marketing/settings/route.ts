/**
 * PropertyPro - The office's listing details
 *
 * GET reads them (anyone who works with listings sees the licence status the
 * screens warn about); PUT saves the brokerage licence (FAL) and the default
 * phone and WhatsApp numbers, for those who hold Manage listings or Company
 * settings. See lib/listings/settings.ts.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { auditSettingsChange } from "@/lib/audit-domain";
import { OFFICE_SETTINGS_KEYS } from "@/lib/audit/records/listing";
import { listingFailure } from "@/lib/listings/api";
import { LISTING_ACCESS, accessList } from "@/lib/listings/permissions";
import { issueLines } from "@/lib/listings/schemas";
import { officeSettingsSchema } from "@/lib/listings/settings";
import {
  getOfficeSettings,
  saveOfficeSettings,
} from "@/lib/listings/settings.service";

// Anyone who can do anything with listings may read how the office stands.
const ANY_LISTING_RIGHT = [
  ...new Set(Object.values(LISTING_ACCESS).flatMap((list) => [...list])),
];

export const GET = withPermissionAndDB(ANY_LISTING_RIGHT)(
  async (user: AuthenticatedAccessUser) => {
    try {
      const settings = await getOfficeSettings(user);
      return createSuccessResponse(settings, "Settings retrieved successfully");
    } catch (error) {
      return listingFailure(error, "Failed to retrieve the settings");
    }
  },
);

export const PUT = withPermissionAndDB(accessList("settings"))(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body } = await parseRequestBody(request);
      if (!success) return createErrorResponse("Invalid request body", 400);

      const parsed = officeSettingsSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          issueLines(parsed.error).join(", "),
          400,
          undefined,
          "VALIDATION_ERROR",
        );
      }

      const { before, after } = await saveOfficeSettings(user, parsed.data);
      // The brokerage licence and the default contact numbers: only what moved.
      // The licence is not a secret, so it is recorded as it is. A save that
      // changes nothing records nothing.
      auditSettingsChange({
        area: "marketing",
        before: before as unknown as Record<string, unknown>,
        after: after as unknown as Record<string, unknown>,
        keys: OFFICE_SETTINGS_KEYS,
      });
      return createSuccessResponse(after, "Settings saved successfully");
    } catch (error) {
      return listingFailure(error, "Failed to save the settings");
    }
  },
);
