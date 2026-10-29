/**
 * PropertyPro - Send Email Verification API
 * Authenticated user requests a verification link for their CURRENT email.
 * Clicking the link confirms ownership and sets emailVerified.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  withPermissionAndDB,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  createEmailVerificationToken,
  sendEmailVerificationLink,
} from "@/lib/invitation-utils";

const USER_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  emailVerified: true,
  isActive: true,
} as const;

// ============================================================================
// POST /api/user/send-verification-email - Send a verification link to self
// ============================================================================
export const POST = withPermissionAndDB("profile_management")(
  async (sessionUser: any, _request: NextRequest) => {
    try {
      const userId = String(sessionUser?.id || "");
      const userEmail = String(sessionUser?.email || "").trim().toLowerCase();

      let user = null;
      if (userId && isValidObjectId(userId)) {
        user = await db.user.findFirst({
          where: { id: userId },
          select: USER_SELECT,
        });
      }
      if (!user && userEmail) {
        user = await db.user.findFirst({
          where: { email: userEmail },
          select: USER_SELECT,
        });
      }

      if (!user) {
        return createErrorResponse("User not found", 404);
      }

      if (!user.isActive) {
        return createErrorResponse("Account is deactivated", 403);
      }

      if (!user.email) {
        return createErrorResponse(
          "This account has no email address to verify. Add one first.",
          400,
        );
      }

      if (user.emailVerified) {
        return createErrorResponse("Your email is already verified", 400);
      }

      const tokenResult = await createEmailVerificationToken(
        user.id,
        user.email
      );
      if (!tokenResult.success || !tokenResult.token) {
        return createErrorResponse(
          tokenResult.error || "Failed to start email verification",
          500
        );
      }

      const userName = `${user.firstName} ${user.lastName}`.trim();
      const sendResult = await sendEmailVerificationLink(
        tokenResult.token,
        userName
      );
      if (!sendResult.success) {
        return createErrorResponse(
          sendResult.error || "Failed to send verification email",
          500
        );
      }

      return createSuccessResponse(
        { message: "Verification email sent", email: user.email },
        `A verification link has been sent to ${user.email}. Click it to verify your email.`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
