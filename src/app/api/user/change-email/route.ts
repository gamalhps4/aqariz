/**
 * PropertyPro - Change Email API
 * Authenticated user requests an email change. A verification link is sent to
 * the NEW address; the change only applies once that link is confirmed.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  withPermissionAndDB,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  createEmailChangeToken,
  sendEmailChangeVerification,
} from "@/lib/invitation-utils";
import { z } from "zod";
import {
  hasPasswordCredential,
  verifyUserPassword,
} from "@/lib/auth-credentials";
import { auditOwnAccount } from "@/lib/audit/account-events";

const changeEmailSchema = z.object({
  currentPassword: z.string().min(1, "Current password is required"),
  newEmail: z
    .string()
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),
});

// ============================================================================
// POST /api/user/change-email - Request an email change (sends verification)
// ============================================================================
export const POST = withPermissionAndDB("profile_management")(
  async (sessionUser: any, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = changeEmailSchema.safeParse(body);
      if (!validation.success) {
        const errors = validation.error.errors.map((e) => e.message);
        return createErrorResponse(errors.join(", "), 400);
      }

      const { currentPassword, newEmail } = validation.data;

      const userId = String(sessionUser?.id || "");
      const userEmail = String(sessionUser?.email || "").trim().toLowerCase();

      let user = null;
      if (userId && isValidObjectId(userId)) {
        user = await db.user.findFirst({ where: { id: userId } });
      }
      if (!user && userEmail) {
        user = await db.user.findFirst({ where: { email: userEmail } });
      }

      if (!user) {
        return createErrorResponse("User not found", 404);
      }

      // Require a password to authorize a login-identifier change.
      if (!(await hasPasswordCredential(user.id))) {
        return createErrorResponse(
          "Your account has no password set. Set a password before changing your email.",
          400
        );
      }

      const isValid = await verifyUserPassword(user.id, currentPassword);
      if (!isValid) {
        return createErrorResponse("Current password is incorrect", 400);
      }

      if (newEmail === String(user.email).toLowerCase()) {
        return createErrorResponse(
          "The new email is the same as your current email",
          400
        );
      }

      // Ensure the new email isn't already taken.
      const existing = await db.user.findFirst({
        where: {
          email: newEmail,
          id: { not: user.id },
        },
        select: { id: true },
      });
      if (existing) {
        return createErrorResponse("Email already in use", 409);
      }

      const tokenResult = await createEmailChangeToken(user.id, newEmail);
      if (!tokenResult.success || !tokenResult.token) {
        return createErrorResponse(
          tokenResult.error || "Failed to start email change",
          500
        );
      }

      const userName = `${user.firstName} ${user.lastName}`;
      const sendResult = await sendEmailChangeVerification(
        tokenResult.token,
        userName
      );
      if (!sendResult.success) {
        return createErrorResponse(
          sendResult.error || "Failed to send verification email",
          500
        );
      }

      // Asked for, not applied: the address changes when the link sent to the
      // new one is followed (confirm-email-change records that). The password
      // that authorised it is never recorded.
      auditOwnAccount({
        person: user,
        before: { pendingEmail: null },
        after: { pendingEmail: newEmail },
        details: { email: user.email },
        messageKey: "admin.audit.msg.email_change_requested",
      });

      return createSuccessResponse(
        { message: "Verification email sent", newEmail },
        `A confirmation link has been sent to ${newEmail}. Click it to complete the change.`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
