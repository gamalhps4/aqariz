/**
 * PropertyPro SaaS - Blog image upload (platform admin)
 *
 * The landing editor's upload (`/api/admin/landing/upload`), for blog covers
 * and the images placed in a post: platform super-admins have no
 * organization, so the org-scoped `/api/upload/images` refuses them. Same
 * guard, same validation, same R2 upload, and the same `{ success, images,
 * count }` envelope, so the shared `<ImageUpload>` works against it unchanged.
 * Only the folder differs, keeping blog imagery apart from the landing page's.
 *
 * The addresses it returns are on the R2 public host, which is what the blog
 * API's image check (lib/blog/image-hosts.ts) and the site's
 * Content-Security-Policy allow.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { uploadMultipleToR2, uploadToR2, validateR2Config } from "@/lib/r2-server";
import { validateImageFile } from "@/lib/r2";

/** A cover, or a few pictures dropped into a post at once. */
const MAX_FILES = 10;

export const POST = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const r2 = validateR2Config();
      if (!r2.isValid) {
        return createErrorResponse(
          `R2 storage is not configured. ${r2.errors.join(", ")}`,
          500,
        );
      }

      const formData = await request.formData();
      // `files` is what <ImageUpload> and the post editor send; `file` keeps
      // the single-file form working.
      const files = [
        ...(formData.getAll("files") as File[]),
        ...(formData.getAll("file") as File[]),
      ].filter((entry): entry is File => entry instanceof File);

      if (files.length === 0) {
        return createErrorResponse("No file provided", 400);
      }
      if (files.length > MAX_FILES) {
        return createErrorResponse(
          `Too many files — upload at most ${MAX_FILES} at a time`,
          400,
        );
      }

      const invalid = files
        .map((file, index) => ({ index, result: validateImageFile(file) }))
        .filter((entry) => !entry.result.isValid);
      if (invalid.length > 0) {
        return createErrorResponse(
          invalid
            .map((entry) => `File ${entry.index + 1}: ${entry.result.error}`)
            .join(", "),
          400,
        );
      }

      const options = { folder: "PropertyPro/blog", quality: "auto" };
      const results =
        files.length === 1
          ? [await uploadToR2(files[0], options)]
          : await uploadMultipleToR2(files, options);

      const failed = results.filter((result) => !result.success || !result.url);
      if (failed.length > 0) {
        return createErrorResponse(
          failed.map((result) => result.error || "R2 upload failed").join(", "),
          500,
        );
      }

      const images = results.map((result) => ({
        url: result.url,
        publicId: result.objectKey,
        objectKey: result.objectKey,
        width: result.width,
        height: result.height,
        format: result.format,
        bytes: result.bytes,
      }));

      return NextResponse.json({ success: true, images, count: images.length });
    } catch (error) {
      return handleApiError(error, "Failed to upload image");
    }
  },
);
