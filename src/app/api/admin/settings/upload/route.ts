/**
 * PropertyPro SaaS - Platform branding upload (super-admin)
 *
 * Platform super-admins have no organization, so the org-scoped branding upload
 * (`/api/upload/branding`, guarded by role — branding is on every plan)
 * rejects them. This endpoint runs under `withPlatformAdminAndDB()` and uploads
 * platform logos/favicons to R2, returning the same `{ data: { url, ... } }`
 * shape the shared `LogoUpload` component already consumes.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { uploadBrandingAsset, validateR2Config } from "@/lib/r2-server";

const ALLOWED_TYPES = [
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
];

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
      const file = formData.get("file") as File | null;
      const type = formData.get("type") as string | null; // 'logo' | 'favicon'
      const variant = formData.get("variant") as string | null; // 'light' | 'dark'

      if (!file) return createErrorResponse("No file provided", 400);
      if (!type) return createErrorResponse("Type is required", 400);

      if (!ALLOWED_TYPES.includes(file.type)) {
        return createErrorResponse(
          "Invalid file type. Only PNG, JPEG, WebP, and ICO files are allowed.",
          400,
        );
      }
      if (file.size > 2 * 1024 * 1024) {
        return createErrorResponse("File size must be less than 2MB", 400);
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await uploadBrandingAsset(
        buffer,
        file.name,
        type as "logo" | "favicon",
        (variant as "light" | "dark" | undefined) ?? undefined,
      );

      return createSuccessResponse({
        url: result.url,
        objectKey: result.objectKey,
        metadata: result.metadata,
        optimizedUrls: result.optimizedUrls,
        validation: result.validation,
        message: "File uploaded successfully",
      });
    } catch (error) {
      return handleApiError(error, "Failed to upload branding asset");
    }
  },
);
