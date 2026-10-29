import { NextRequest } from "next/server";
import { uploadToR2 } from "@/lib/r2-server";
import {
  withPermissionAndDB,
  createErrorResponse,
  createSuccessResponse,
} from "@/lib/api-utils";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { uploadedFileSnapshot } from "@/lib/audit/records/document";
import { compact } from "@/lib/audit/records/shared";

// Allowed file types for property attachments
const ALLOWED_ATTACHMENT_TYPES = [
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain",
  "text/csv",

  // Images
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",

  // Archives
  "application/zip",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES_PER_REQUEST = 5;

export const POST = withPermissionAndDB("document_management", {
  rateLimit: { windowMs: 60 * 1000, maxRequests: 20 },
})(async (
  user: any,
  request: NextRequest
) => {
  try {
    const formData = await request.formData();
    const files = formData.getAll("files") as File[];

    if (!files || files.length === 0) {
      return createErrorResponse("No files provided", 400);
    }

    if (files.length > MAX_FILES_PER_REQUEST) {
      return createErrorResponse(
        `Cannot upload more than ${MAX_FILES_PER_REQUEST} files at once`,
        400
      );
    }

    const uploadResults = [];
    const errors = [];

    for (const file of files) {
      // Validate file type
      if (!ALLOWED_ATTACHMENT_TYPES.includes(file.type)) {
        errors.push(`File ${file.name}: Unsupported file type ${file.type}`);
        continue;
      }

      // Validate file size
      if (file.size > MAX_FILE_SIZE) {
        errors.push(
          `File ${file.name}: File size exceeds ${
            MAX_FILE_SIZE / 1024 / 1024
          }MB limit`
        );
        continue;
      }

      // Upload file to R2
      const uploadResult = await uploadToR2(file, {
        folder: "PropertyPro/attachments",
      });
      if (uploadResult.success) {
        // The file is kept on the property being filled in, which saves it
        // later: this entry says who put which file there.
        void recordActivity({
          action: AuditAction.DOCUMENT_UPLOAD,
          recordType: "document",
          recordName: file.name,
          after: compact(uploadedFileSnapshot(file)),
        });
        uploadResults.push({
          fileName: file.name,
          fileUrl: uploadResult.url!,
          fileSize: uploadResult.bytes || file.size,
          fileType: file.type,
          uploadedAt: new Date(),
          uploadedBy: user.id,
        });
      } else {
        errors.push(`File ${file.name}: ${uploadResult.error}`);
      }
    }

    if (uploadResults.length === 0) {
      return createErrorResponse(
        `Failed to upload any files. Errors: ${errors.join(", ")}`,
        400
      );
    }

    const response = {
      attachments: uploadResults,
      errors: errors.length > 0 ? errors : undefined,
    };

    return createSuccessResponse(response, "Files uploaded successfully");
  } catch (error) {
    console.error("File upload error:", error);
    return createErrorResponse("Failed to upload files", 500);
  }
});

// Get upload configuration
export const GET = withPermissionAndDB("document_management")(async (
  user: any,
  request: NextRequest
) => {
  try {
    const config = {
      maxFileSize: MAX_FILE_SIZE,
      maxFilesPerRequest: MAX_FILES_PER_REQUEST,
      allowedTypes: ALLOWED_ATTACHMENT_TYPES,
      uploadUrl: "/api/upload/attachments",
    };

    return createSuccessResponse(config, "Upload configuration retrieved");
  } catch (error) {
    console.error("Get upload config error:", error);
    return createErrorResponse("Failed to get upload configuration", 500);
  }
});
