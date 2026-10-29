/**
 * PropertyPro - Tenant Maintenance API
 * API endpoints for tenant maintenance request management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { MaintenanceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
  parseRequestBody,
} from "@/lib/api-utils";
import { maintenanceRequestSchema, validateSchema } from "@/lib/validations";

const propertyRefSelect = {
  id: true,
  name: true,
  type: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
} as const;

/** Rebuild the populated `propertyId` shape ({ name, address, type }). */
function mapPropertyRef(property: {
  id: string;
  name: string;
  type: string;
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
}) {
  return {
    id: property.id,
    name: property.name,
    type: property.type,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
    },
  };
}

// ============================================================================
// GET /api/tenant/maintenance - Get tenant's maintenance requests
// ============================================================================

export const GET = withPermissionAndDB("maintenance_requests")(
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
      const status = searchParams.get("status");
      const priority = searchParams.get("priority");
      const category = searchParams.get("category");

      const tenant = context?.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Require at least one active lease for this tenant
      const hasActiveLease = await db.lease.findFirst({
        where: { tenantId: user.id, status: "active" },
        select: { id: true },
      });
      if (!hasActiveLease) {
        return createErrorResponse(
          "You must have an active lease to submit a maintenance request",
          403
        );
      }

      // Build query — tenant self-service: only the signed-in tenant's requests
      const where: Prisma.MaintenanceRequestWhereInput = {
        tenantId: user.id,
      };

      if (status && status !== "all") {
        where.status = status;
      }

      if (priority && priority !== "all") {
        where.priority = priority;
      }

      if (category && category !== "all") {
        where.category = category;
      }

      // Get maintenance requests with pagination
      const maintenanceRequests = await db.maintenanceRequest.findMany({
        where,
        include: {
          property: { select: propertyRefSelect },
          assignedTo: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: (page - 1) * limit,
      });

      const mappedRequests = maintenanceRequests.map((req) => ({
        ...req,
        propertyId: req.property ? mapPropertyRef(req.property) : req.propertyId,
        property: undefined,
      }));

      const totalRequests = await db.maintenanceRequest.count({ where });
      const totalPages = Math.ceil(totalRequests / limit);

      return createSuccessResponse({
        maintenanceRequests: mappedRequests,
        pagination: {
          page,
          limit,
          total: totalRequests,
          pages: totalPages,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to fetch maintenance requests");
    }
  }
);

// ============================================================================
// POST /api/tenant/maintenance - Create a new maintenance request
// ============================================================================

export const POST = withPermissionAndDB("maintenance_requests")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const tenant = context?.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // If leaseId is provided, validate it and get property info
      const normalizeId = (value: unknown): string | undefined => {
        if (!value) return undefined;
        if (typeof value === "string") {
          // Return undefined for empty strings
          const trimmed = value.trim();
          return trimmed === "" ? undefined : trimmed;
        }
        if (typeof value === "object") {
          const maybeObj = value as { _id?: unknown; id?: unknown };
          if (typeof maybeObj._id === "string") {
            return maybeObj._id;
          }
          if (typeof maybeObj.id === "string") {
            return maybeObj.id;
          }
        }
        return undefined;
      };

      let propertyId = normalizeId(body.propertyId);
      let unitId = normalizeId(body.unitId);
      const contactPhone =
        typeof body.contactPhone === "string" && body.contactPhone.trim() !== ""
          ? body.contactPhone.trim()
          : undefined;

      if (body.leaseId) {
        const lease = await db.lease.findFirst({
          where: { id: body.leaseId, tenantId: user.id },
        });

        if (!lease) {
          return createErrorResponse("Lease not found or access denied", 404);
        }

        propertyId = lease.propertyId || propertyId;
        unitId = unitId || normalizeId(lease.unitId);
      }

      if (!propertyId) {
        return createErrorResponse("Property ID is required", 400);
      }

      // Validate unitId if provided
      if (unitId) {
        const property = await db.property.findFirst({
          where: { id: propertyId },
          select: { id: true },
        });
        if (!property) {
          return createErrorResponse("Property not found", 404);
        }

        // Check that the unit exists on the specified property
        const unitExists = await db.unit.findFirst({
          where: { id: unitId, propertyId },
          select: { id: true },
        });

        if (!unitExists) {
          return createErrorResponse(
            "Invalid unit ID. The unit does not exist in the specified property.",
            400
          );
        }
      }

      // Prepare maintenance request data
      const maintenanceData: any = {
        title: body.title,
        description: body.description,
        category: body.category || "Other",
        priority: body.priority || "medium",
        propertyId,
        tenantId: user.id, // Always use User ID for consistency
        status: MaintenanceStatus.SUBMITTED,
        images: body.images || [],
      };

      // Only include unitId if it's defined and not empty
      if (unitId) {
        maintenanceData.unitId = unitId;
      }

      // Only include contactPhone if it's defined and not empty
      if (contactPhone) {
        maintenanceData.contactPhone = contactPhone;
      }

      // Validate the maintenance request data
      const validation = validateSchema(
        maintenanceRequestSchema,
        maintenanceData
      );
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      // Create the maintenance request
      const maintenanceRequest = await db.maintenanceRequest.create({
        data: {
          ...maintenanceData,
          organizationId: user.organizationId!,
        },
        include: {
          property: { select: propertyRefSelect },
          assignedTo: {
            select: { id: true, firstName: true, lastName: true, email: true },
          },
        },
      });

      const responseRequest = {
        ...maintenanceRequest,
        propertyId: maintenanceRequest.property
          ? mapPropertyRef(maintenanceRequest.property)
          : maintenanceRequest.propertyId,
        property: undefined,
      };

      return createSuccessResponse(
        responseRequest,
        "Maintenance request created successfully"
      );
    } catch (error) {
      return handleApiError(error, "Failed to create maintenance request");
    }
  }
);
