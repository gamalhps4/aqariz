/**
 * PropertyPro SaaS - Platform admin avatar (super-admin)
 *
 * The org-scoped upload (`/api/upload/images`) and avatar (`/api/user/avatar`)
 * endpoints refuse an org-less caller, so the console uploads the super-admin's
 * avatar here: one multipart POST that stores the image in R2 and writes the
 * URL onto the User row, plus a DELETE that clears it.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { deleteFromR2, uploadToR2, validateR2Config } from "@/lib/r2-server";
import { extractObjectKey, isR2Url, validateImageFile } from "@/lib/r2";
import { recordOperatorAccountChange } from "@/lib/audit/platform-events";
import { fileNameOf } from "@/lib/audit/settings-keys";

const MAX_BYTES = 5 * 1024 * 1024;

/** Best-effort cleanup of the avatar the new one replaces. Never fatal. */
async function removeStoredAvatar(avatar: string | null | undefined) {
  if (!avatar || !isR2Url(avatar)) return;
  try {
    const objectKey = extractObjectKey(avatar);
    if (objectKey) await deleteFromR2(objectKey);
  } catch (error) {
    console.warn("Failed to delete previous platform admin avatar:", error);
  }
}

// ============================================================================
// POST /api/admin/profile/avatar - Upload and set the caller's avatar
// ============================================================================
export const POST = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const r2 = validateR2Config();
      if (!r2.isValid) {
        return createErrorResponse(
          `R2 storage is not configured. ${r2.errors.join(", ")}`,
          500,
        );
      }

      const formData = await request.formData();
      const file = formData.get("file") as File | null;

      if (!file) {
        return createErrorResponse("No file provided", 400);
      }
      if (file.size > MAX_BYTES) {
        return createErrorResponse("Image must be smaller than 5MB", 400);
      }

      const validation = validateImageFile(file);
      if (!validation.isValid) {
        return createErrorResponse(validation.error || "Invalid image", 400);
      }

      const existing = await db.user.findFirst({
        where: { id: user.id },
        select: { id: true, avatar: true },
      });
      if (!existing) {
        return createErrorResponse("User not found", 404);
      }

      const result = await uploadToR2(file, {
        folder: "PropertyPro/avatars",
        quality: 85,
        width: 400,
        height: 400,
      });

      if (!result.success || !result.url) {
        return createErrorResponse(result.error || "Upload failed", 500);
      }

      const updated = await db.user.update({
        where: { id: existing.id },
        data: { avatar: result.url },
        select: { id: true, avatar: true },
      });

      if (existing.avatar && existing.avatar !== result.url) {
        await removeStoredAvatar(existing.avatar);
      }

      // The photo by file name, never its URL.
      await recordOperatorAccountChange({
        actor: user,
        before: { avatar: fileNameOf(existing.avatar) },
        after: { avatar: fileNameOf(updated.avatar) },
        keys: ["avatar"],
      });

      return createSuccessResponse(
        { avatar: updated.avatar },
        "Avatar updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update avatar");
    }
  },
);

// ============================================================================
// DELETE /api/admin/profile/avatar - Clear the caller's avatar
// ============================================================================
export const DELETE = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser) => {
    try {
      const existing = await db.user.findFirst({
        where: { id: user.id },
        select: { id: true, avatar: true },
      });
      if (!existing) {
        return createErrorResponse("User not found", 404);
      }

      await db.user.update({
        where: { id: existing.id },
        data: { avatar: null },
      });
      await removeStoredAvatar(existing.avatar);

      // A removed photo is an update of the account, not a deleted account
      // (which is what the wrapper's basic entry for a DELETE would say).
      await recordOperatorAccountChange({
        actor: user,
        before: { avatar: fileNameOf(existing.avatar) },
        after: { avatar: null },
        keys: ["avatar"],
      });

      return createSuccessResponse({ avatar: null }, "Avatar removed");
    } catch (error) {
      return handleApiError(error, "Failed to remove avatar");
    }
  },
);
