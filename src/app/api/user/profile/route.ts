/**
 * PropertyPro - User Profile API Routes
 * CRUD operations for user profile management
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
import { ownProfileUpdateSchema } from "@/lib/validations";
import { auditOwnAccount } from "@/lib/audit/account-events";
import {
  USER_PROFILE_AUDIT_KEYS,
  USER_PROFILE_AUDIT_SECRETS,
  userProfileSnapshot,
} from "@/lib/audit/settings-keys";

/** The columns of the person's own row the entry compares, read before the write. */
const PROFILE_BEFORE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  phone: true,
  bio: true,
  location: true,
  city: true,
  website: true,
  address: true,
  role: true,
  avatar: true,
  dateOfBirth: true,
  organizationId: true,
} as const;

// ============================================================================
// GET /api/user/profile - Get current user profile
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (user: any) => {
  try {
    const userId = String(user?.id || "");
    const userEmail = String(user?.email || "").trim().toLowerCase();

    let currentUser = null;

    if (userId && isValidObjectId(userId)) {
      currentUser = await db.user.findFirst({ where: { id: userId } });
    }

    if (!currentUser && userEmail) {
      currentUser = await db.user.findFirst({ where: { email: userEmail } });
    }

    if (!currentUser) {
      return createErrorResponse("User not found", 404);
    }

    return createSuccessResponse({
      user: currentUser,
      message: "Profile retrieved successfully",
    });
  } catch (error) {
    console.error("Get profile error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/user/profile - Update user profile
// ============================================================================
export const PUT = withPermissionAndDB("profile_management")(
  async (user: any, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Only the profile's own fields: role, status, permissions and the
      // like are refused here, not quietly written (see the schema).
      const validation = ownProfileUpdateSchema.safeParse(body);
      if (!validation.success) {
        const errors = validation.error.errors.map((e) => e.message).join(", ");
        return createErrorResponse(`Validation failed: ${errors}`, 400);
      }

      const updateData: Record<string, unknown> = { ...validation.data };
      const userId = String(user?.id || "");
      const userEmail = String(user?.email || "").trim().toLowerCase();

      let currentUser = null;

      if (userId && isValidObjectId(userId)) {
        currentUser = await db.user.findFirst({
          where: { id: userId },
          select: PROFILE_BEFORE_SELECT,
        });
      }

      if (!currentUser && userEmail) {
        currentUser = await db.user.findFirst({
          where: { email: userEmail },
          select: PROFILE_BEFORE_SELECT,
        });
      }

      if (!currentUser) {
        return createErrorResponse("User not found", 404);
      }

      // Only check for conflicts when the email actually changes.
      if (typeof updateData.email === "string") {
        const nextEmail = updateData.email.trim().toLowerCase();
        const currentEmail = String(currentUser.email || "")
          .trim()
          .toLowerCase();

        updateData.email = nextEmail;

        if (nextEmail !== currentEmail) {
          const existingUser = await db.user.findFirst({
            where: {
              email: nextEmail,
              id: { not: currentUser.id },
            },
            select: { id: true },
          });

          if (existingUser) {
            return createErrorResponse("Email already in use", 409);
          }

          // The new address hasn't been confirmed yet — require re-verification.
          updateData.emailVerified = null;
          updateData.emailVerifiedFlag = false;
        }
      }

      // `name` is derived from firstName/lastName (previously a Mongoose hook)
      if (
        updateData.firstName !== undefined ||
        updateData.lastName !== undefined
      ) {
        const first = (updateData.firstName ?? currentUser.firstName) as string;
        const last = (updateData.lastName ?? currentUser.lastName) as string;
        updateData.name = [first, last].filter(Boolean).join(" ");
      }

      // Update user profile
      const updatedUser = await db.user.update({
        where: { id: currentUser.id },
        data: updateData,
      });

      // The person's own account, named by their name after the change; only
      // the fields that moved (the birth date as "set").
      auditOwnAccount({
        person: currentUser,
        named: updatedUser,
        before: userProfileSnapshot(currentUser),
        after: userProfileSnapshot(updatedUser),
        keys: USER_PROFILE_AUDIT_KEYS,
        secretKeys: USER_PROFILE_AUDIT_SECRETS,
      });

      return createSuccessResponse({
        user: updatedUser,
        message: "Profile updated successfully",
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
