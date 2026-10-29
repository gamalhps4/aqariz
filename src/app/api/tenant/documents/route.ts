/**
 * PropertyPro - Tenant Documents API
 * API endpoints for tenant document management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
} from "@/lib/api-utils";

// ============================================================================
// GET /api/tenant/documents - Get tenant's documents
// ============================================================================

export const GET = withPermissionAndDB("document_access")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const { searchParams } = new URL(request.url);

      // Parse pagination parameters
      const { page = 1, limit = 12 } = parsePaginationParams(searchParams);

      // Get filters
      const type = searchParams.get("type");
      const status = searchParams.get("status");
      const category = searchParams.get("category");
      const search = searchParams.get("search");

      const tenant = context?.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Build query — documents the tenant uploaded, owns, or was shared
      const where: Prisma.DocumentWhereInput = {
        OR: [
          { uploadedById: user.id },
          { tenantId: tenant.id },
          { sharedWith: { has: user.id } },
        ],
      };

      if (type && type !== "all") {
        where.type = type;
      }

      if (status && status !== "all") {
        where.status = status;
      }

      if (category && category !== "all") {
        where.category = category;
      }

      if (search) {
        where.AND = [
          {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { description: { contains: search, mode: "insensitive" } },
              { tags: { has: search } },
            ],
          },
        ];
      }

      // Get documents with pagination
      const documents = await db.document.findMany({
        where,
        include: {
          uploadedBy: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: [{ uploadedAt: "desc" }, { createdAt: "desc" }],
        take: limit,
        skip: (page - 1) * limit,
      });

      const totalDocuments = await db.document.count({ where });
      const totalPages = Math.ceil(totalDocuments / limit);

      return createSuccessResponse({
        documents,
        pagination: {
          page,
          limit,
          total: totalDocuments,
          pages: totalPages,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to fetch documents");
    }
  }
);
