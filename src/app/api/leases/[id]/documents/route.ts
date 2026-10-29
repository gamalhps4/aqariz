/**
 * PropertyPro - Lease Documents API
 * API endpoint for managing lease documents
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseAllows, leaseScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { validateSchema } from "@/lib/validations";
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
// GET /api/leases/[id]/documents - Get all documents for a lease
// ============================================================================

export const GET = withAccessAndDB(LEASE_DOCUMENT_READ_ACCESS)(
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

      // Get query parameters
      const url = new URL(request.url);
      const page = parseInt(url.searchParams.get("page") || "1");
      const limit = parseInt(url.searchParams.get("limit") || "20");
      const type = url.searchParams.get("type");
      const category = url.searchParams.get("category");
      const search = url.searchParams.get("search");

      // Build query
      const where: Prisma.DocumentWhereInput = {
        leaseId: lease.id,
        deletedAt: null,
      };

      if (type) {
        where.type = type;
      }

      if (category) {
        where.category = category;
      }

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { tags: { has: search } },
        ];
      }

      // Get total count and documents with pagination
      const [total, documents] = await Promise.all([
        db.document.count({ where }),
        db.document.findMany({
          where,
          include: {
            uploadedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit,
        }),
      ]);

      // Calculate pagination info
      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPrevPage = page > 1;

      return createSuccessResponse({
        documents,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage,
          hasPrevPage,
        },
        lease: {
          id: lease.id,
          documentsCount: total,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/leases/[id]/documents - Add document URL to lease
// ============================================================================

export const POST = withPermissionAndDB([
  "document_management",
  "lease_edit",
  "lease_management",
])(
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

      const body = await request.json();

      const validation = validateSchema(
        z.object({
          documentUrl: z.string().min(1, "Document URL is required").max(2000),
          name: z.string().max(200).optional(),
          description: z.string().max(1000).optional(),
          type: z.string().max(100).default("lease"),
          category: z.string().max(100).default("lease"),
        }),
        body
      );
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { documentUrl, name, description, type, category } =
        validation.data;

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

      // Check if document URL already exists
      if (lease.documents.includes(documentUrl)) {
        return createErrorResponse("Document URL already exists", 400);
      }

      // Add document URL to lease
      const updatedLease = await db.lease.update({
        where: { id },
        data: { documents: [...lease.documents, documentUrl] },
      });

      // Create document record if additional info provided
      let document = null;
      if (name || description) {
        document = await db.document.create({
          data: {
            organizationId: lease.organizationId,
            name: name || "Lease Document",
            description: description || "Document for lease",
            type,
            category,
            fileUrl: documentUrl,
            fileSize: 0, // Unknown for external URLs
            mimeType: "application/octet-stream", // Unknown for external URLs
            uploadedById: user.id,
            leaseId: lease.id,
            propertyId: lease.propertyId,
            tenantId: lease.tenantId,
            status: "active",
            isRequired: false,
          },
          include: {
            uploadedBy: {
              select: { id: true, firstName: true, lastName: true },
            },
          },
        });
      }

      // A file attached by address: named by what the office called it. With
      // no document row there is only the link on the contract, so no id.
      void recordActivity({
        action: AuditAction.DOCUMENT_UPLOAD,
        recordType: "document",
        recordId: document?.id ?? null,
        recordName: documentName(document) ?? name ?? null,
        after: compact(
          document
            ? documentSnapshot(document, { contractNumber: lease.contractNumber })
            : { documentType: type, category, contractNumber: lease.contractNumber },
        ),
      });

      return createSuccessResponse({
        message: "Document added successfully",
        documentUrl,
        document,
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
