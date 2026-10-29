/**
 * PropertyPro - Change Password API
 * Allows an authenticated user to change their own password.
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
import { z } from "zod";
import {
  hasPasswordCredential,
  setUserPassword,
  verifyUserPassword,
} from "@/lib/auth-credentials";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from "@/lib/password-policy";
import { AuditAction } from "@/lib/audit-domain";
import { auditOwnAccount } from "@/lib/audit/account-events";

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
// POST /api/user/change-password - Change own password
// ============================================================================
export const POST = withPermissionAndDB("profile_management")(
  async (sessionUser: any, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = changePasswordSchema.safeParse(body);
      if (!validation.success) {
        const errors = validation.error.errors.map((e) => e.message);
        return createErrorResponse(errors.join(", "), 400);
      }

      const { currentPassword, newPassword } = validation.data;

      // Resolve the caller's user row (the credential lives on the Better
      // Auth account record, not the user).
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

      // OAuth-only accounts have no password set yet.
      if (!(await hasPasswordCredential(user.id))) {
        return createErrorResponse(
          "Your account has no password set. Use the password reset flow to create one.",
          400
        );
      }

      const isvalid = await verifyUserPassword(user.id, currentPassword);
      if (!isvalid) {
        return createErrorResponse("Current password is incorrect", 400);
      }

      // Writes the Better Auth credential, stamps passwordChangedAt, and
      // revokes every other session — a password change must evict whoever
      // else might be holding one.
      await setUserPassword(user.id, newPassword);

      // The event alone: who changed their own password, never a value.
      auditOwnAccount({ person: user, action: AuditAction.PASSWORD_CHANGED });

      return createSuccessResponse(
        { message: "Password changed successfully" },
        "Password changed successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
