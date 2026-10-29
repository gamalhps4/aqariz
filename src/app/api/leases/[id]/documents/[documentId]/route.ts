/**
 * PropertyPro - Lease Document Management API
 * API endpoint for managing individual lease documents
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { leaseAllows, leaseScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import {
  LEASE_DOCUMENT_READ_ACCESS,
  canManageLeaseDocuments,
} from "@/lib/lease-access";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { documentName, documentSnapshot } from "@/lib/audit/records/document";
import { compact } from "@/lib/audit/records/shared";

// ============================================================================
// DELETE /api/leases/[id]/documents/[documentId] - Delete a lease document
// ============================================================================

export const DELETE = withPermissionAndDB([
  "document_management",
  "lease_edit",
  "lease_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; documentId: string }> }
  ) => {
    try {
      const { id, documentId } = await params;

      if (!isValidObjectId(id) || !isValidObjectId(documentId)) {
        return createErrorResponse("Invalid lease ID or document ID", 400);
      }

      // Find the lease
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      if (!canManageLeaseDocuments(user)) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      // Find the document
      const document = await db.document.findFirst({
        where: { id: documentId },
      });
      if (!document) {
        return createErrorResponse("Document not found", 404);
      }

      // Verify document belongs to this lease
      if (document.leaseId !== lease.id) {
        return createErrorResponse(
          "Document does not belong to this lease",
          400
        );
      }

      // The file is kept. Deleting a document archives its row like every
      // other delete in the product, and the stored file goes with the
      // contract at the archive's permanent delete (archive.service), which
      // collects every document the contract ever had. Destroying it here
      // left an archived row pointing at nothing.

      // Remove document URL from lease documents array
      const updatedLease = await db.lease.update({
        where: { id },
        data: {
          documents: lease.documents.filter((url) => url !== document.fileUrl),
        },
      });

      // Soft delete the document
      await db.document.update({
        where: { id: documentId },
        data: { deletedAt: new Date() },
      });

      void recordActivity({
        action: AuditAction.DELETE,
        recordType: "document",
        recordId: document.id,
        recordName: documentName(document),
        before: compact(
          documentSnapshot(document, { contractNumber: lease.contractNumber }),
        ),
      });

      return createSuccessResponse({
        message: "Document deleted successfully",
        documentId: document.id,
        lease: {
          id: updatedLease.id,
          documents: updatedLease.documents,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// GET /api/leases/[id]/documents/[documentId] - Get a specific lease document
// ============================================================================

export const GET = withAccessAndDB(LEASE_DOCUMENT_READ_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; documentId: string }> }
  ) => {
    try {
      const { id, documentId } = await params;

      if (!isValidObjectId(id) || !isValidObjectId(documentId)) {
        return createErrorResponse("Invalid lease ID or document ID", 400);
      }

      // Find the lease
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Check permissions - tenants can only access their own lease documents
      // tenants can only access their own lease documents — see lib/db/scopes.ts.
      if (!leaseAllows(user, lease)) {
        return createErrorResponse("Access denied", 403);
      }

      // Find the document
      const document = await db.document.findFirst({
        where: { id: documentId },
        include: {
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
      });

      if (!document) {
        return createErrorResponse("Document not found", 404);
      }

      // Verify document belongs to this lease
      if (document.leaseId !== lease.id) {
        return createErrorResponse(
          "Document does not belong to this lease",
          400
        );
      }

      // Update download count and last downloaded date
      const updatedDocument = await db.document.update({
        where: { id: documentId },
        data: {
          downloadCount: { increment: 1 },
          lastDownloadedAt: new Date(),
        },
      });

      // Populate related information (was Mongoose populate)
      const property = document.propertyId
        ? await db.property.findFirst({
            where: { id: document.propertyId },
            select: {
              id: true,
              name: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
            },
          })
        : null;

      const responseDocument = {
        ...updatedDocument,
        uploadedBy: document.uploadedBy,
        leaseId: {
          id: lease.id,
          startDate: lease.startDate,
          endDate: lease.endDate,
        },
        propertyId: property
          ? {
              id: property.id,
              name: property.name,
              address: {
                street: property.addressStreet,
                city: property.addressCity,
                state: property.addressState,
                zipCode: property.addressZipCode,
                country: property.addressCountry,
              },
            }
          : document.propertyId,
      };

      return createSuccessResponse({
        document: responseDocument,
        lease: {
          id: lease.id,
          startDate: lease.startDate,
          endDate: lease.endDate,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
