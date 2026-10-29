/**
 * PropertyPro SaaS - Platform admin password change (super-admin)
 *
 * Mirrors `/api/user/change-password` for the org-less platform admin, which
 * the org-scoped route rejects. Same credential helpers, so changing the
 * password still stamps `passwordChangedAt` and evicts other sessions.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  hasPasswordCredential,
  setUserPassword,
  verifyUserPassword,
} from "@/lib/auth-credentials";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { recordOperatorPasswordChange } from "@/lib/audit/platform-events";

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
      )
      .max(
        PASSWORD_MAX_LENGTH,
        `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters`,
      ),
    confirmPassword: z.string().min(1, "Password confirmation is required"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "New password must be different from the current password",
    path: ["newPassword"],
  });

// ============================================================================
// POST /api/admin/profile/password - Change the caller's own password
// ============================================================================
export const POST = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = changePasswordSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          validation.error.errors.map((e) => e.message).join(", "),
          400,
        );
      }

      const { currentPassword, newPassword } = validation.data;

      const existing = await db.user.findFirst({
        where: { id: user.id },
        select: { id: true },
      });
      if (!existing) {
        return createErrorResponse("User not found", 404);
      }

      // OAuth-only accounts have no credential to verify against.
      if (!(await hasPasswordCredential(existing.id))) {
        return createErrorResponse(
          "Your account has no password set. Use the password reset flow to create one.",
          400,
        );
      }

      if (!(await verifyUserPassword(existing.id, currentPassword))) {
        return createErrorResponse("Current password is incorrect", 400);
      }

      await setUserPassword(existing.id, newPassword);

      // The event alone — never a value.
      await recordOperatorPasswordChange(user);

      return createSuccessResponse(
        { message: "Password changed successfully" },
        "Password changed successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to change password");
    }
  },
);
