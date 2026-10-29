/**
 * PropertyPro - Presigned Upload API
 *
 * POST /api/upload/presign — mint a short-lived presigned PUT so clients (the
 * mobile app especially) upload files straight to R2 instead of proxying the
 * bytes through this server. The client then PUTs the file to `uploadUrl`
 * with the exact Content-Type it declared here, and references the returned
 * `publicUrl`/`objectKey` in whatever record it creates next.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { createPresignedUpload } from "@/lib/r2-server";
import { hasAnyPermission } from "@/lib/permissions-manager";
import { withRateLimit } from "@/lib/rate-limit";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

const ALLOWED_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

/** Folders any authenticated org member (tenants included) may target. */
const MEMBER_FOLDERS = new Set([
  "documents",
  "maintenance",
  "messages",
  "avatars",
  "tickets",
]);

/**
 * Folders reserved for company staff, each with the rights that write the
 * records its files belong to. Any member of staff could fill any of them:
 * a group that may only view contracts could still upload into `leases`.
 */
const STAFF_FOLDERS: Readonly<Record<string, readonly string[]>> = {
  properties: ["property_create", "property_edit", "property_management"],
  units: ["property_create", "property_edit", "property_management"],
  leases: ["lease_create", "lease_edit", "lease_management"],
  inspections: [
    "inspection_create",
    "inspection_edit",
    "property_management",
    "maintenance_management",
  ],
  expenses: ["expense_create", "expense_edit", "financial_management"],
};

const presignSchema = z.object({
  folder: z
    .string()
    .trim()
    .regex(/^[a-z0-9_-]{2,40}$/i, "Invalid folder"),
  fileName: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(3).max(120),
  size: z
    .number({ required_error: "size is required" })
    .int()
    .positive()
    .max(MAX_UPLOAD_BYTES, "File exceeds the 25MB upload limit"),
});

// Presigns are cheap to mint in bulk — throttle per caller.
export const POST = withRateLimit(
  { windowMs: 60 * 1000, maxRequests: 30 },
  withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json().catch(() => null);
      const parsed = presignSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((e) => e.message).join(", "),
          400,
          undefined,
          "VALIDATION_ERROR",
        );
      }
      const { folder, fileName, contentType, size } = parsed.data;

      if (!ALLOWED_CONTENT_TYPES.has(contentType.toLowerCase())) {
        return createErrorResponse(
          "This file type is not allowed",
          400,
          undefined,
          "UNSUPPORTED_FILE_TYPE",
        );
      }

      const normalizedFolder = folder.toLowerCase();
      const staffRights = Object.prototype.hasOwnProperty.call(
        STAFF_FOLDERS,
        normalizedFolder,
      )
        ? STAFF_FOLDERS[normalizedFolder]
        : null;
      const allowed =
        MEMBER_FOLDERS.has(normalizedFolder) ||
        (staffRights !== null &&
          user.isCompanyStaff &&
          hasAnyPermission(user.permissions, staffRights));
      if (!allowed) {
        return createErrorResponse(
          "You cannot upload to this folder",
          403,
          undefined,
          "FORBIDDEN",
        );
      }

      const presigned = await createPresignedUpload({
        folder: normalizedFolder,
        fileName,
        contentType,
        contentLength: size,
      });

      return createSuccessResponse(
        {
          ...presigned,
          method: "PUT",
          headers: { "Content-Type": contentType },
        },
        "Upload URL created",
      );
    } catch (error) {
      return handleApiError(error);
    }
  }),
);

export const runtime = "nodejs";
