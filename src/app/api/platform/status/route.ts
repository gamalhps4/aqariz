/**
 * PropertyPro SaaS - Public platform status
 *
 * Unauthenticated endpoint exposing the minimal platform state any client may
 * need: maintenance mode and the platform name. Deliberately does NOT return the
 * rest of the settings (email/registration config stays private). Read by the
 * dashboard `MaintenanceNotice` gate.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  createSuccessResponse,
  handleApiError,
} from "@/lib/api-utils";
import { getPublicPlatformSettings } from "@/lib/platform/settings";
import { configuredSocialProviders } from "@/lib/better-auth";

export const GET = async (_request: NextRequest) => {
  try {
    const settings = await getPublicPlatformSettings();
    return createSuccessResponse({
      platformName: settings.general.platformName,
      maintenance: settings.maintenance,
      allowSignups: settings.registration.allowSignups,
      // Which OAuth buttons the sign-in page should render. Names only — no
      // client ids, no secrets.
      socialProviders: configuredSocialProviders,
    });
  } catch (error) {
    return handleApiError(error, "Failed to load platform status");
  }
};
