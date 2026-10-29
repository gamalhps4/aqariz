/**
 * PropertyPro - Lease Document Upload API
 * API endpoint for uploading documents specifically for leases to R2
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { leaseAllows } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  isValidObjectId,
  withAccessAndDB,
} from "@/lib/api-utils";
import { enforceStorageLimit } from "@/lib/billing/usage";
import { uploadToR2, validateR2Config } from "@/lib/r2-server";
import {
  LEASE_DOCUMENT_UPLOAD_ACCESS,
} from "@/lib/lease-access";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { documentName, documentSnapshot } from "@/lib/audit/records/document";
import { compact } from "@/lib/audit/records/shared";

const r2ConfigValidation = validateR2Config();

// ============================================================================
// POST /api/leases/[id]/documents/upload - Upload documents for a lease
// ============================================================================

export const POST = withAccessAndDB(LEASE_DOCUMENT_UPLOAD_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Ensure R2 is configured
      if (!r2ConfigValidation.isValid) {
        return createErrorResponse(
          `R2 storage is not configured. ${r2ConfigValidation.errors.join(", ")}`,
          500
        );
      }

      // Find the lease
      const lease = await db.lease.findFirst({ where: { id } });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check permissions - tenants can only upload to their own leases
      // tenants can only upload to their own leases — see lib/db/scopes.ts.
      if (!leaseAllows(user, lease)) {
        return createErrorResponse("Access denied", 403);
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

      const incomingType = (formData.get("type") as string) || "lease";
      const incomingCategory = (formData.get("category") as string) || "lease";
      const description = (formData.get("description") as string) || "";
      const tagsString = (formData.get("tags") as string) || "";

      // Sanitize document type/category to match model enums
      const allowedDocTypes = [
        "lease",
        "receipt",
        "notice",
        "insurance",
        "identification",
        "income",
        "maintenance",
        "inspection",
        "other",
      ];
      const allowedDocCategories = [
        "lease",
        "payments",
        "maintenance",
        "insurance",
        "identification",
        "notices",
        "general",
      ];

      const type = allowedDocTypes.includes(incomingType)
        ? incomingType
        : "lease";
      const category = allowedDocCategories.includes(incomingCategory)
        ? incomingCategory
        : "lease";

      if (files.length === 0) {
        return createErrorResponse("No files provided", 400);
      }

      // Validate file types and sizes - Support PDFs and images
      const allowedTypes = [
        "application/pdf",
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/webp",
        "image/avif",
      ];

      const maxFileSize = 10 * 1024 * 1024; // 10MB
      const maxFiles = 10;

      if (files.length > maxFiles) {
        return createErrorResponse(`Maximum ${maxFiles} files allowed`, 400);
      }

      for (const file of files) {
        if (!allowedTypes.includes(file.type)) {
          return createErrorResponse(
            `File type not allowed. Allowed types: PDF, PNG, JPG, JPEG, WEBP, AVIF. Received: ${file.type}`,
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
      const documentUrls = [];

      // Upload each file
      for (const file of files) {
        try {
          let uploadResult: {
            url?: string;
            objectKey?: string;
            success: boolean;
            error?: string;
          };

          if (r2ConfigValidation.isValid) {
            // Upload to R2
            uploadResult = await uploadToR2(file, {
              folder: `PropertyPro/lease-documents/${lease.id}`,
              quality: 85,
            });

            if (!uploadResult.success || !uploadResult.url) {
              throw new Error(uploadResult.error || "R2 upload failed");
            }
          } else {
            return createErrorResponse(
              `R2 storage is not configured. ${r2ConfigValidation.errors.join(
                ", "
              )}`,
              500
            );
          }

          // Create document record
          const document = await db.document.create({
            data: {
              organizationId: lease.organizationId,
              name: file.name,
              description: description || `${type} document for lease`,
              type,
              category,
              fileUrl: uploadResult.url,
              fileSize: file.size,
              mimeType: file.type,
              uploadedById: user.id,
              leaseId: lease.id,
              propertyId: lease.propertyId,
              tenantId: lease.tenantId,
              tags,
              status: "active",
              isRequired: false,
              r2ObjectKey: uploadResult.objectKey,
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
            after: compact(
              documentSnapshot(document, {
                contractNumber: lease.contractNumber,
              }),
            ),
          });

          uploadedDocuments.push(document);
          documentUrls.push(uploadResult.url);
        } catch (uploadError) {
          return createErrorResponse(
            `Failed to upload ${file.name}: ${
              uploadError instanceof Error ? uploadError.message : "Unknown error"
            }`,
            500
          );
        }
      }

      // Update lease with new document URLs
      const updatedLease = await db.lease.update({
        where: { id },
        data: { documents: [...(lease.documents || []), ...documentUrls] },
      });

      return createSuccessResponse(
        {
          message: `Successfully uploaded ${uploadedDocuments.length} document(s)`,
          documents: uploadedDocuments,
          lease: {
            id: updatedLease.id,
            documents: updatedLease.documents,
          },
        },
        "Lease documents uploaded successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
