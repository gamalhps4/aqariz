/**
 * PropertyPro SaaS - Send a test email (super-admin)
 *
 * Validates the currently-saved SMTP configuration by sending a short test
 * message to the requesting super-admin. Save settings first — this uses the
 * persisted/effective config (DB over env) resolved by the mailer.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { emailService } from "@/lib/services/email.service";
import { getPlatformSettings } from "@/lib/platform/settings";

export const POST = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const recipient = user.email;
      if (!recipient) {
        return createErrorResponse(
          "Your account has no email address to send a test to",
          400,
        );
      }

      const { general } = await getPlatformSettings();
      const platformName = general.platformName || "PropertyPro";

      const result = await emailService.sendEmail({
        to: recipient,
        subject: `${platformName} — SMTP test email`,
        text: `This is a test email from ${platformName}. Your SMTP settings are working.`,
        html: `<p>This is a test email from <strong>${platformName}</strong>.</p><p>Your SMTP settings are working correctly.</p>`,
      });

      if (!result.success) {
        return createErrorResponse(
          result.error || "Failed to send test email",
          502,
        );
      }

      return createSuccessResponse(
        { messageId: result.messageId, recipient },
        `Test email sent to ${recipient}`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to send test email");
    }
  },
);
