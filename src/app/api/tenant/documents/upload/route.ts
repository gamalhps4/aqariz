/**
 * PropertyPro - Document Upload API
 * API endpoint for uploading tenant documents to R2
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { enforceStorageLimit } from "@/lib/billing/usage";
import { uploadToR2, validateR2Config } from "@/lib/r2-server";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { documentName, documentSnapshot } from "@/lib/audit/records/document";
import { compact } from "@/lib/audit/records/shared";
import { promises as fs } from "fs";
import { join } from "path";

const r2ConfigValidation = validateR2Config();
const isR2Configured = r2ConfigValidation.isValid;

type TenantContext = {
  tenantProfile?: {
    id: string;
  } | null;
};

async function ensureDirectory(path: string) {
  await fs.mkdir(path, { recursive: true });
}

async function saveFileLocally(
  tenantId: string,
  fileName: string,
  buffer: Buffer
) {
  const relativeDir = join("uploads", "tenant-documents", tenantId);
  const basePath = join(process.cwd(), "public", relativeDir);
  await ensureDirectory(basePath);

  const sanitizedName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
  const finalName = `${Date.now()}-${sanitizedName}`;
  const absolutePath = join(basePath, finalName);
  await fs.writeFile(absolutePath, buffer);

  return {
    url: `/${relativeDir}/${finalName}`,
    objectKey: finalName,
  };
}

// ============================================================================
// POST /api/tenant/documents/upload - Upload documents
// ============================================================================

export const POST = withPermissionAndDB("document_access")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: TenantContext
  ) => {
    try {
      const tenant = context?.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      const formData = await request.formData();
      const files = formData.getAll("files") as File[];
      // Storage is a billed resource: check the whole batch before any of it
      // reaches R2, so a rejected upload leaves no orphaned objects behind.
      await enforceStorageLimit(
        user.organizationId!,
        files.reduce((total, file) => total + (file?.size ?? 0), 0),
        files.length,
      );

      const type = (formData.get("type") as string) || "other";
      const category = (formData.get("category") as string) || "general";
      const description = (formData.get("description") as string) || "";
      const tagsString = (formData.get("tags") as string) || "";

      if (files.length === 0) {
        return createErrorResponse("No files provided", 400);
      }

      // Validate file types and sizes
      const allowedTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "text/plain",
      ];

      const maxFileSize = 10 * 1024 * 1024; // 10MB
      const maxFiles = 10;

      if (files.length > maxFiles) {
        return createErrorResponse(`Maximum ${maxFiles} files allowed`, 400);
      }

      for (const file of files) {
        if (!allowedTypes.includes(file.type)) {
          return createErrorResponse(
            `File type ${file.type} not allowed. Allowed types: PDF, DOC, DOCX, JPG, PNG, WEBP, TXT`,
            400
          );
        }

        if (file.size > maxFileSize) {
          return createErrorResponse(
            `File ${file.name} exceeds maximum size of 10MB`,
            400
          );
        }
      }

      // Parse tags
      const tags = tagsString
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const uploadedDocuments = [];
      const failedFiles: string[] = [];

      // Upload each file
      for (const file of files) {
        try {
          let uploadResult: {
            url?: string;
            objectKey?: string;
            success: boolean;
            error?: string;
          };

          if (isR2Configured) {
            // Upload to R2
            uploadResult = await uploadToR2(file, {
              folder: `PropertyPro/tenant-documents/${tenant.id}`,
              quality: 85,
            });

            if (!uploadResult.success || !uploadResult.url) {
              throw new Error(uploadResult.error || "R2 upload failed");
            }
          } else {
            // Fallback to local storage
            const bytes = await file.arrayBuffer();
            const buffer = Buffer.from(bytes);
            const localResult = await saveFileLocally(
              tenant.id,
              file.name,
              buffer
            );
            uploadResult = { ...localResult, success: true };
          }

          // Create document record
          const document = await db.document.create({
            data: {
              organizationId: user.organizationId!,
              name: file.name,
              description: description || `${type} document`,
              type,
              category,
              fileUrl: uploadResult.url!,
              fileSize: file.size,
              mimeType: file.type,
              uploadedById: user.id,
              tenantId: tenant.id,
              tags,
              status: "active",
              isRequired: false,
              r2ObjectKey: isR2Configured ? uploadResult.objectKey : undefined,
            },
            include: {
              uploadedBy: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          });

          // One entry per file: each is its own record, found by its name.
          void recordActivity({
            action: AuditAction.DOCUMENT_UPLOAD,
            recordType: "document",
            recordId: document.id,
            recordName: documentName(document),
            after: compact(documentSnapshot(document)),
          });

          uploadedDocuments.push(document);
        } catch (uploadError) {
          console.error(`Failed to upload ${file.name}:`, uploadError);
          failedFiles.push(file.name);
          // Continue processing remaining files
        }
      }

      if (uploadedDocuments.length === 0) {
        return createErrorResponse("Failed to upload any documents", 500);
      }

      const storageProviderMessage = isR2Configured
        ? "documents to R2"
        : "documents (stored locally)";

      const response = createSuccessResponse(
        {
          documents: uploadedDocuments,
          uploaded: uploadedDocuments.length,
          total: files.length,
          failed: failedFiles,
        },
        `Successfully uploaded ${uploadedDocuments.length} of ${files.length} ${storageProviderMessage}`
      );

      if (failedFiles.length > 0) {
        const truncatedList = failedFiles.slice(0, 5).join(", ");
        const suffix = failedFiles.length > 5 ? "…" : "";
        response.headers.set(
          "x-propertypro-warning",
          `Failed to upload: ${truncatedList}${suffix}`
        );
      }

      return response;
    } catch (error) {
      return handleApiError(error);
    }
  }
);
