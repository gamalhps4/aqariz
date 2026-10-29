/**
 * PropertyPro - Forgot Password API
 * Handle password reset requests
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  createPasswordResetToken,
  sendPasswordResetEmail,
} from "@/lib/invitation-utils";
import { z } from "zod";
import {
  bypassOrgScope,
  runWithOrgContext,
} from "@/lib/tenancy/context";
import { withRateLimit, rateLimitConfigs } from "@/lib/rate-limit";
import { AuditAction, recordAccountEvent } from "@/lib/audit-domain";

// Forgot password validation schema
const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email("Please enter a valid email address")
    .toLowerCase()
    .trim(),
});

// ============================================================================
// POST /api/auth/forgot-password - Request password reset
// ============================================================================
export const POST = withRateLimit(rateLimitConfigs.passwordReset, handleForgotPassword);

async function handleForgotPassword(request: NextRequest) {
  try {
    // Parse request body
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    // Validate request data
    const validation = forgotPasswordSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map((err) => err.message);
      return createErrorResponse(errors.join(", "), 400);
    }

    const { email } = validation.data;

    // Find user by email
    const user = await bypassOrgScope(() =>
      db.user.findFirst({ where: { email } }),
    );

    // Always return success to prevent email enumeration attacks
    // But only send email if user exists
    // `user.email` is re-checked rather than assumed: an email is optional on
    // a person's record, and the reset link has nowhere to go without one.
    // The response below stays identical either way — the whole point of this
    // branch is that the caller cannot tell what was found.
    if (user?.isActive && user.organizationId && user.email) {
      // Bound outside the callback: narrowing a property does not survive
      // into a closure, and the address is what the token is issued against.
      const recipientEmail = user.email;
      await runWithOrgContext(
        {
          organizationId: user.organizationId,
          isPlatformAdmin: false,
        },
        async () => {
          const tokenResult = await createPasswordResetToken(
            user.id,
            recipientEmail,
          );

          if (tokenResult.success && tokenResult.token) {
            const userName = `${user.firstName} ${user.lastName}`;
            await sendPasswordResetEmail(tokenResult.token, userName);
          }
        },
      );

      // Only for an account that exists — and nothing in the response says
      // whether it did. Whoever asked, the entry is the account's.
      await recordAccountEvent({
        action: AuditAction.PASSWORD_RESET_REQUESTED,
        user: {
          id: user.id,
          email: recipientEmail,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          organizationId: user.organizationId,
        },
        request,
      });
    }

    // Always return success response for security
    return createSuccessResponse(
      {
        message:
          "If an account with that email exists, a password reset link has been sent.",
        email,
      },
      "Password reset request processed"
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// ============================================================================
// GET /api/auth/forgot-password - Get forgot password information
// ============================================================================
export async function GET() {
  return createSuccessResponse(
    {
      message: "Password reset endpoint is available",
      process: [
        "1. Submit email address",
        "2. System checks if account exists",
        "3. If account exists, password reset email is sent",
        "4. User clicks link in email to reset password",
        "5. User sets new password",
      ],
      security: [
        "Email enumeration protection - always returns success",
        "Reset tokens expire in 1 hour",
        "Only one active reset token per user",
        "Tokens are single-use only",
      ],
    },
    "Forgot password endpoint information"
  );
}
