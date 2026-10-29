/**
 * PropertyPro - Individual Document API Routes
 * Operations for individual documents
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
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { deleteFromR2 } from "@/lib/r2-server";
import {
  AuditAction,
  auditRecordChange,
  recordActivity,
} from "@/lib/audit-domain";
import {
  DOCUMENT_CHANGE_KEYS,
  documentName,
  documentSnapshot,
} from "@/lib/audit/records/document";
import { compact } from "@/lib/audit/records/shared";

// ============================================================================
// GET /api/tenant/documents/[id] - Get a specific document
// ============================================================================

export const GET = withPermissionAndDB("document_access")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }>; tenantProfile?: any }
  ) => {
    try {
      const { id } = await context.params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid document ID", 400);
      }

      const tenant = context.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Find the document
      const document = await db.document.findFirst({
        where: { id },
        include: {
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      if (!document) {
        return createErrorResponse("Document not found", 404);
      }

      // Check permissions - user must be the uploader, tenant, or have shared access
      const canAccess =
        document.uploadedById === user.id ||
        document.tenantId === tenant.id ||
        document.sharedWith?.includes(user.id);

      if (!canAccess) {
        return createErrorResponse("Access denied", 403);
      }

      // Rebuild the populated `tenantId` shape ({ userId }) — plain column now
      const documentTenant = document.tenantId
        ? await db.tenant.findFirst({
            where: { id: document.tenantId },
            select: { id: true, userId: true },
          })
        : null;

      const responseDocument = {
        ...document,
        tenantId: documentTenant ?? document.tenantId,
      };

      return createSuccessResponse({ document: responseDocument });
    } catch (error) {
      return handleApiError(error, "Failed to fetch document");
    }
  }
);

// ============================================================================
// PUT /api/tenant/documents/[id] - Update document metadata
// ============================================================================

export const PUT = withPermissionAndDB("document_access")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }>; tenantProfile?: any }
  ) => {
    try {
      const { id } = await context.params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid document ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const { name, description, type, category, tags } = body;

      const tenant = context.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Find the document
      const document = await db.document.findFirst({ where: { id } });
      if (!document) {
        return createErrorResponse("Document not found", 404);
      }

      // Check permissions - only uploader can update
      if (document.uploadedById !== user.id) {
        return createErrorResponse(
          "Only the uploader can update this document",
          403
        );
      }

      // Update document metadata
      const updateData: Record<string, unknown> = {};
      if (name) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (type) updateData.type = type;
      if (category) updateData.category = category;
      if (tags) {
        updateData.tags = Array.isArray(tags)
          ? tags
          : tags
              .split(",")
              .map((tag: string) => tag.trim())
              .filter((tag: string) => tag.length > 0);
      }

      const updatedDocument = await db.document.update({
        where: { id: document.id },
        data: updateData,
        include: {
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      auditRecordChange({
        action: AuditAction.UPDATE,
        recordType: "document",
        recordId: document.id,
        recordName: documentName(updatedDocument),
        before: documentSnapshot(document),
        after: documentSnapshot(updatedDocument),
        keys: DOCUMENT_CHANGE_KEYS,
      });

      return createSuccessResponse(
        { document: updatedDocument },
        "Document updated successfully"
      );
    } catch (error) {
      return handleApiError(error, "Failed to update document");
    }
  }
);

// ============================================================================
// DELETE /api/tenant/documents/[id] - Delete a document
// ============================================================================

export const DELETE = withPermissionAndDB("document_access")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }>; tenantProfile?: any }
  ) => {
    try {
      const { id } = await context.params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid document ID", 400);
      }

      const tenant = context.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Find the document
      const document = await db.document.findFirst({ where: { id } });
      if (!document) {
        return createErrorResponse("Document not found", 404);
      }

      // Check permissions - only uploader can delete
      if (document.uploadedById !== user.id) {
        return createErrorResponse(
          "Only the uploader can delete this document",
          403
        );
      }

      // Delete from R2 if it exists
      let warningMessage: string | null = null;
      if (document.r2ObjectKey) {
        try {
          const deleted = await deleteFromR2(document.r2ObjectKey);
          if (!deleted) {
            warningMessage = "Failed to delete file from R2 storage";
          }
        } catch (r2Error) {
          warningMessage =
            r2Error instanceof Error
              ? r2Error.message
              : "Remote asset deletion failed";
          // Continue with database deletion even if R2 fails
        }
      }

      // Soft delete the document
      await db.document.update({
        where: { id: document.id },
        data: { deletedAt: new Date() },
      });

      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "document",
        recordId: document.id,
        recordName: documentName(document),
        before: compact(documentSnapshot(document)),
      });

      const response = createSuccessResponse(
        null,
        warningMessage
          ? "Document deleted successfully with remote cleanup warning"
          : "Document deleted successfully"
      );
      if (warningMessage) {
        response.headers.set("x-propertypro-warning", warningMessage);
      }
      return response;
    } catch (error) {
      return handleApiError(error, "Failed to delete document");
    }
  }
);
