/**
 * PropertyPro SaaS - Platform admin profile (super-admin)
 *
 * Platform super-admins have no organization, so the org-scoped profile
 * endpoints (`/api/user/profile`, `/api/settings/profile`) reject them with
 * "Platform administrators must use the platform API". This route runs under
 * `withPlatformAdminAndDB()` and edits the caller's own User row only.
 *
 * Email is intentionally read-only here: changing the login address goes
 * through the verified change-email flow, not a silent profile write.
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
import { isValidPhoneNumber } from "@/lib/utils";
import { recordOperatorAccountChange } from "@/lib/audit/platform-events";
import {
  ADMIN_PROFILE_AUDIT_KEYS,
  userProfileSnapshot,
} from "@/lib/audit/settings-keys";

// Only the fields the console's profile form exposes. Everything else on User
// (role, isActive, organizationId, …) stays out of reach of a profile write.
const PROFILE_SELECT = {
  id: true,
  email: true,
  firstName: true,
  lastName: true,
  name: true,
  phone: true,
  avatar: true,
  bio: true,
  location: true,
  city: true,
  website: true,
  role: true,
  isActive: true,
  emailVerified: true,
  twoFactorEnabled: true,
  lastLogin: true,
  passwordChangedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const optionalText = (max: number, message: string) =>
  z.string().max(max, message).optional();

const profileUpdateSchema = z.object({
  firstName: z.string().trim().min(1, "First name is required").max(50),
  lastName: z.string().trim().min(1, "Last name is required").max(50),
  phone: z
    .string()
    .optional()
    .refine((phone) => !phone?.trim() || isValidPhoneNumber(phone), {
      message: "Enter a valid phone number",
    }),
  bio: optionalText(500, "Bio cannot exceed 500 characters"),
  location: optionalText(100, "Location cannot exceed 100 characters"),
  city: optionalText(50, "City cannot exceed 50 characters"),
  website: z
    .string()
    .optional()
    .refine(
      (website) => {
        if (!website?.trim()) return true;
        try {
          new URL(website);
          return true;
        } catch {
          return false;
        }
      },
      { message: "Enter a valid URL (including https://)" },
    ),
});

async function findSelf(user: AuthenticatedAccessUser) {
  return db.user.findFirst({
    where: { id: user.id },
    select: PROFILE_SELECT,
  });
}

// ============================================================================
// GET /api/admin/profile - Read the signed-in super-admin's profile
// ============================================================================
export const GET = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser) => {
    try {
      const profile = await findSelf(user);
      if (!profile) {
        return createErrorResponse("User not found", 404);
      }
      return createSuccessResponse({ user: profile });
    } catch (error) {
      return handleApiError(error, "Failed to load profile");
    }
  },
);

// ============================================================================
// PUT /api/admin/profile - Update the signed-in super-admin's profile
// ============================================================================
export const PUT = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = profileUpdateSchema.safeParse(body);
      if (!validation.success) {
        return createErrorResponse(
          validation.error.errors.map((e) => e.message).join(", "),
          400,
        );
      }

      const existing = await findSelf(user);
      if (!existing) {
        return createErrorResponse("User not found", 404);
      }

      const input = validation.data;
      // Empty strings clear the optional fields rather than writing "".
      const blankToNull = (value?: string) =>
        value === undefined ? undefined : value.trim() || null;

      const updated = await db.user.update({
        where: { id: existing.id },
        data: {
          firstName: input.firstName.trim(),
          lastName: input.lastName.trim(),
          // `name` is Better Auth's derived display name — keep it in sync.
          name: [input.firstName.trim(), input.lastName.trim()]
            .filter(Boolean)
            .join(" "),
          phone: blankToNull(input.phone),
          bio: blankToNull(input.bio),
          location: blankToNull(input.location),
          city: blankToNull(input.city),
          website: blankToNull(input.website),
        },
        select: PROFILE_SELECT,
      });

      // The operator's own account in the platform log, with what moved.
      await recordOperatorAccountChange({
        actor: user,
        named: updated,
        before: userProfileSnapshot(existing),
        after: userProfileSnapshot(updated),
        keys: ADMIN_PROFILE_AUDIT_KEYS,
      });

      return createSuccessResponse(
        { user: updated },
        "Profile updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update profile");
    }
  },
);
