/**
 * PropertyPro - File Upload API Route
 * Handle file uploads for avatars, logos, and documents
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  withPermissionAndDB,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from "@/lib/api-utils";
import { deleteFromR2, uploadToR2, validateR2Config } from "@/lib/r2-server";
import { extractObjectKey } from "@/lib/r2";

// File upload configuration
const UPLOAD_CONFIG = {
  maxFileSize: 10 * 1024 * 1024, // 10MB
  allowedImageTypes: [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ],
  allowedDocumentTypes: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
};

/**
 * Validate file type and size
 */
function validateFile(
  file: File,
  uploadType: string
): { isValid: boolean; error?: string } {
  // Check file size
  if (file.size > UPLOAD_CONFIG.maxFileSize) {
    return {
      isValid: false,
      error: `File size exceeds ${
        UPLOAD_CONFIG.maxFileSize / 1024 / 1024
      }MB limit`,
    };
  }

  // Check file type based on upload type
  const allowedTypes =
    uploadType === "document"
      ? [
          ...UPLOAD_CONFIG.allowedImageTypes,
          ...UPLOAD_CONFIG.allowedDocumentTypes,
        ]
      : UPLOAD_CONFIG.allowedImageTypes;

  if (!allowedTypes.includes(file.type)) {
    return {
      isValid: false,
      error: `File type ${file.type} is not allowed`,
    };
  }

  return { isValid: true };
}

function extractR2ObjectKey(url: string): string | null {
  const extracted = extractObjectKey(url);
  if (extracted) return extracted;

  try {
    const publicUrl = process.env.R2_PUBLIC_URL || "";
    if (!publicUrl || !url.includes(publicUrl)) return null;
    const urlObj = new URL(url);
    const key = urlObj.pathname.startsWith("/")
      ? urlObj.pathname.slice(1)
      : urlObj.pathname;
    return key || null;
  } catch {
    return null;
  }
}

function isR2FileUrl(url: string): boolean {
  const publicUrl =
    process.env.R2_PUBLIC_URL || process.env.NEXT_PUBLIC_R2_PUBLIC_URL || "";
  return (
    (publicUrl.length > 0 && url.includes(publicUrl)) ||
    url.includes("r2.cloudflarestorage.com")
  );
}

// ============================================================================
// POST /api/upload - Upload files
// ============================================================================
export const POST = withPermissionAndDB([
  "profile_management",
  "document_management",
])(async (user: any, request: NextRequest) => {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File;
    const uploadType = formData.get("type") as string;
    const oldFileUrl = formData.get("oldFileUrl") as string;
    const folder = (formData.get("folder") as string) || "";

    if (!file) {
      return createErrorResponse("No file provided", 400);
    }

    if (!uploadType) {
      return createErrorResponse("Upload type is required", 400);
    }

    // Validate upload type
    const validTypes = ["avatar", "logo", "favicon", "document"];
    if (!validTypes.includes(uploadType)) {
      return createErrorResponse("Invalid upload type", 400);
    }

    // Validate file
    const validation = validateFile(file, uploadType);
    if (!validation.isValid) {
      return createErrorResponse(validation.error!, 400);
    }

    const r2Validation = validateR2Config();
    if (!r2Validation.isValid) {
      return createErrorResponse(
        `R2 storage is not configured. ${r2Validation.errors.join(", ")}`,
        500
      );
    }

    const uploadResult = await uploadToR2(file, {
      folder:
        folder.trim() || `PropertyPro/uploads/${uploadType}/${user.id}`,
      quality: 85,
    });

    if (!uploadResult.success || !uploadResult.url) {
      return createErrorResponse(uploadResult.error || "R2 upload failed", 500);
    }

    if (oldFileUrl && isR2FileUrl(oldFileUrl)) {
      const objectKey = extractR2ObjectKey(oldFileUrl);
      if (objectKey) {
        await deleteFromR2(objectKey);
      }
    }

    return createSuccessResponse({
      url: uploadResult.url,
      filename: uploadResult.objectKey?.split("/").pop() || "",
      objectKey: uploadResult.objectKey,
      originalName: file.name,
      size: uploadResult.bytes ?? file.size,
      type: file.type,
      uploadType,
      storage: "r2",
      message: "File uploaded successfully",
    });
  } catch (error) {
    console.error("Upload error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// DELETE /api/upload - Delete files
// ============================================================================
export const DELETE = withPermissionAndDB([
  "profile_management",
  "document_management",
])(async (user: any, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const fileUrl = searchParams.get("url");

    if (!fileUrl) {
      return createErrorResponse("File URL is required", 400);
    }

    if (!isR2FileUrl(fileUrl)) {
      return createErrorResponse("Only R2-hosted files can be deleted", 400);
    }

    const objectKey = extractR2ObjectKey(fileUrl);
    if (!objectKey || !(await deleteFromR2(objectKey))) {
      return createErrorResponse("File was not found in this organization", 404);
    }

    return createSuccessResponse({
      message: "File deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    return handleApiError(error);
  }
});

// ============================================================================
// GET /api/upload - Get upload configuration
// ============================================================================
export async function GET() {
  try {
    return createSuccessResponse({
      maxFileSize: UPLOAD_CONFIG.maxFileSize,
      allowedImageTypes: UPLOAD_CONFIG.allowedImageTypes,
      allowedDocumentTypes: UPLOAD_CONFIG.allowedDocumentTypes,
    });
  } catch (error) {
    console.error("Get upload config error:", error);
    return handleApiError(error);
  }
}
