/**
 * PropertyPro - Reset Password API
 * Handle password reset from reset tokens
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
  validateInvitationToken,
  markTokenAsUsed,
} from "@/lib/invitation-utils";
import { z } from "zod";
import { runWithOrgContext } from "@/lib/tenancy/context";
import { withRateLimit, rateLimitConfigs } from "@/lib/rate-limit";
import { AuditAction, recordAccountEvent } from "@/lib/audit-domain";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  setUserPassword,
} from "@/lib/auth-credentials";

// Reset password validation schema
const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Token is required"),
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`
      )
      .max(
        PASSWORD_MAX_LENGTH,
        `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters`
      ),
    confirmPassword: z.string().min(1, "Password confirmation is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// ============================================================================
// POST /api/auth/reset-password - Reset password with token
// ============================================================================
export const POST = withRateLimit(rateLimitConfigs.passwordReset, handleResetPassword);

async function handleResetPassword(request: NextRequest) {
  try {
    // Parse request body
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    // Validate request data
    const validation = resetPasswordSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map((err) => err.message);
      return createErrorResponse(errors.join(", "), 400);
    }

    const { token, password } = validation.data;

    // Validate reset token
    const tokenResult = await validateInvitationToken(token, "password_reset");
    if (!tokenResult.success || !tokenResult.invitation) {
      return createErrorResponse("Invalid or expired reset token", 400);
    }

    const resetToken = tokenResult.invitation;

    return runWithOrgContext(
      {
        organizationId: resetToken.organizationId,
        isPlatformAdmin: false,
      },
      async () => {
        const user = resetToken.userId
          ? await db.user.findFirst({ where: { id: resetToken.userId } })
          : null;
        if (!user) {
          return createErrorResponse("User not found", 404);
        }

        if (!user.isActive) {
          return createErrorResponse("Account is deactivated", 403);
        }

        // Writes the Better Auth credential, stamps passwordChangedAt, and
        // revokes every existing session — resetting a password must evict
        // whoever prompted the reset.
        await setUserPassword(user.id, password);
        await markTokenAsUsed(token);

        await recordAccountEvent({
          action: AuditAction.PASSWORD_RESET,
          user,
          request,
        });

        return createSuccessResponse(
          {
            message: "Password reset successfully",
            email: user.email,
          },
          "Password has been reset successfully",
        );
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// ============================================================================
// GET /api/auth/reset-password - Validate reset token
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return createErrorResponse("Token is required", 400);
    }

    // Validate reset token
    const tokenResult = await validateInvitationToken(token, "password_reset");
    if (!tokenResult.success || !tokenResult.invitation) {
      return createErrorResponse("Invalid or expired reset token", 400);
    }

    const resetToken = tokenResult.invitation;

    return runWithOrgContext(
      {
        organizationId: resetToken.organizationId,
        isPlatformAdmin: false,
      },
      async () => {
        const user = resetToken.userId
          ? await db.user.findFirst({ where: { id: resetToken.userId } })
          : null;
        if (!user) {
          return createErrorResponse("User not found", 404);
        }

        if (!user.isActive) {
          return createErrorResponse("Account is deactivated", 403);
        }

        return createSuccessResponse(
          {
            valid: true,
            email: resetToken.email,
            userName: `${user.firstName} ${user.lastName}`,
            expiresAt: resetToken.expiresAt,
          },
          "Token is valid",
        );
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
