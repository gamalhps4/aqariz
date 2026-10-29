/**
 * PropertyPro SaaS - Landing page image upload (platform admin)
 *
 * Platform super-admins have no organization context, so the org-scoped image
 * upload route (`/api/upload/images`, guarded by `withPermissionAndDB`) rejects
 * them. This endpoint runs under `withPlatformAdminAndDB()` and uploads landing
 * imagery to R2.
 *
 * The response is deliberately the *same* `{ success, images, count }` envelope
 * `/api/upload/images` returns — not the console's usual `{ success, data }` —
 * so the shared `<ImageUpload>` component can be pointed here with nothing but
 * its `endpoint` prop.
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

/** Landing imagery is a small, fixed set of hero/card/mockup slots. */
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
      // `files` is what <ImageUpload> sends; `file` keeps the single-file form
      // working for any caller still posting it.
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

      const options = { folder: "PropertyPro/landing", quality: "auto" };
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
