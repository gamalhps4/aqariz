/**
 * PropertyPro SaaS - Verification status
 *
 * Tiny read the dashboard gate uses to decide whether to render the app or the
 * "confirm your email" screen. Deliberately exempt from the verification gate
 * itself (see VERIFICATION_EXEMPT_PREFIXES) — a blocked account still has to
 * be able to ask why it is blocked.
 */

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { getPlatformSettings } from "@/lib/platform/settings";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const { registration } = await getPlatformSettings();
      return createSuccessResponse({
        // Mirrors the server gate: only self-registered owners are held to it.
        required:
          registration.requireEmailVerification &&
          user.isOrganizationOwner === true,
        verified: Boolean(user.emailVerified),
        email: user.email,
      });
    } catch (error) {
      return handleApiError(error, "Failed to read verification status");
    }
  },
);
