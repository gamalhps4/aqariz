/**
 * PropertyPro - Individual Inspection API Routes
 * CRUD operations for individual inspection management
 */

import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { inspectionAllows, inspectionScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  isValidObjectId,
  withAccessAndDB,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { inspectionUpdateSchema, validateSchema } from "@/lib/validations";

const INSPECTION_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "inspection_view",
    "property_view",
    "property_management",
    "maintenance_view",
    "maintenance_management",
  ],
  match: "any" as const,
};

// Editing and deleting an inspection are separate rights; the property and
// maintenance umbrellas still cover both.
const INSPECTION_EDIT_PERMISSIONS = [
  "inspection_edit",
  "property_management",
  "maintenance_management",
] as const;
const INSPECTION_DELETE_PERMISSIONS = [
  "inspection_delete",
  "property_management",
  "maintenance_management",
] as const;

const INSPECTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatar: true,
} as const;

function propertyWithAddress(
  property: Record<string, unknown> | null | undefined
) {
  if (!property) return null;
  return {
    ...property,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
      country: property.addressCountry,
    },
  };
}

async function loadInspectionTenant(
  tenantId: string | null,
  withAvatar = false
) {
  if (!tenantId) return null;
  return db.user.findFirst({
    where: { id: tenantId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      ...(withAvatar ? { avatar: true } : {}),
    },
  });
}

async function loadInspectionLease(leaseId: string | null) {
  if (!leaseId) return null;
  const lease = await db.lease.findFirst({
    where: { id: leaseId },
    select: {
      id: true,
      startDate: true,
      endDate: true,
      status: true,
      terms: true,
    },
  });
  if (!lease) return null;
  return {
    id: lease.id,
    startDate: lease.startDate,
    endDate: lease.endDate,
    status: lease.status,
    terms: { rentAmount: (lease.terms as any)?.rentAmount },
  };
}

function transformInspection(
  inspection: Record<string, unknown> & {
    property?: Record<string, unknown> | null;
    inspector?: Record<string, unknown> | null;
    propertyId: string;
    inspectorId: string;
  },
  tenant: Record<string, unknown> | null,
  lease: Record<string, unknown> | null
) {
  const property = propertyWithAddress(inspection.property);
  return {
    ...inspection,
    propertyId: property ?? inspection.propertyId,
    tenantId: tenant,
    inspectorId: inspection.inspector ?? inspection.inspectorId,
    leaseId: lease,
    property,
    tenant: tenant ? { user: tenant } : null,
    inspector: inspection.inspector,
    lease: lease || null,
  };
}

// ============================================================================
// GET /api/inspections/[id] - Get a specific inspection
// ============================================================================

export const GET = withAccessAndDB(INSPECTION_READ_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;
    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid inspection ID", 400);
    }

    const inspection = await db.inspection.findFirst({
      where: { id, ...inspectionScope(user) },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            type: true,
            isMultiUnit: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
            addressCountry: true,
            units: true,
          },
        },
        inspector: { select: INSPECTOR_SELECT },
      },
    });

    if (!inspection) {
      return createErrorResponse("Inspection not found", 404);
    }

    // See lib/db/scopes.ts.
    if (!inspectionAllows(user, inspection)) {
      return createErrorResponse(
        "You can only view inspections related to you",
        403,
      );
    }

    const [tenant, lease] = await Promise.all([
      loadInspectionTenant(inspection.tenantId, true),
      loadInspectionLease(inspection.leaseId),
    ]);

    return createSuccessResponse(
      transformInspection(inspection as never, tenant, lease),
      "Inspection retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// PUT /api/inspections/[id] - Update an inspection
// ============================================================================

const UPDATABLE_INSPECTION_FIELDS = [
  "propertyId",
  "tenantId",
  "leaseId",
  "type",
  "status",
  "scheduledDate",
  "completedDate",
  "inspectorId",
  "items",
  "overallCondition",
  "tenantSignature",
  "inspectorSignature",
  "photos",
  "notes",
] as const;

export const PUT = withPermissionAndDB([...INSPECTION_EDIT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid inspection ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const inspection = await db.inspection.findFirst({
        where: { id, ...inspectionScope(user) },
      });
      if (!inspection) {
        return createErrorResponse("Inspection not found", 404);
      }

      // Cannot edit completed inspections
      if (inspection.status === "completed") {
        return createErrorResponse("Cannot edit a completed inspection", 400);
      }

      const validation = validateSchema(inspectionUpdateSchema as any, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const updateData = validation.data as any;

      // Prevent changing certain fields after inspection has started
      if (inspection.status === "in_progress") {
        delete updateData.propertyId;
        delete updateData.type;
        delete updateData.scheduledDate;
      }

      const data: Record<string, unknown> = {};
      for (const field of UPDATABLE_INSPECTION_FIELDS) {
        if (updateData[field] !== undefined) {
          data[field] = updateData[field];
        }
      }

      const updated = await db.inspection.update({
        where: { id },
        data: data as Prisma.InspectionUpdateInput,
        include: {
          property: {
            select: {
              id: true,
              name: true,
              type: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
            },
          },
          inspector: { select: INSPECTOR_SELECT },
        },
      });

      const [tenant, lease] = await Promise.all([
        loadInspectionTenant(updated.tenantId),
        loadInspectionLease(updated.leaseId),
      ]);

      return createSuccessResponse(
        transformInspection(updated as never, tenant, lease),
        "Inspection updated successfully",
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
);

// ============================================================================
// DELETE /api/inspections/[id] - Delete an inspection (soft delete)
// ============================================================================

export const DELETE = withPermissionAndDB([...INSPECTION_DELETE_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid inspection ID", 400);
      }

      const inspection = await db.inspection.findFirst({
        where: { id, ...inspectionScope(user) },
      });
      if (!inspection) {
        return createErrorResponse("Inspection not found", 404);
      }

      if (inspection.status === "completed") {
        return createErrorResponse(
          "Cannot delete a completed inspection.",
          409,
        );
      }

      await db.inspection.update({
        where: { id },
        data: { deletedAt: new Date() },
      });

      return createSuccessResponse(
        { id: inspection.id },
        "Inspection deleted successfully",
      );
    } catch (error) {
      return handleApiError(error);
    }
  },
);

// ============================================================================
// PATCH /api/inspections/[id] - Status transitions and actions
// ============================================================================

export const PATCH = withAccessAndDB(INSPECTION_READ_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid inspection ID", 400);
    }

    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    const inspection = await db.inspection.findFirst({
      where: { id, ...inspectionScope(user) },
    });
    if (!inspection) {
      return createErrorResponse("Inspection not found", 404);
    }

    // See lib/db/scopes.ts.
    if (!inspectionAllows(user, inspection)) {
      return createErrorResponse(
        "You can only modify inspections related to you",
        403,
      );
    }

    const { action, ...data } = body;
    const items = Array.isArray(inspection.items)
      ? ([...(inspection.items as any[])] as any[])
      : [];
    const update: Record<string, unknown> = {};

    switch (action) {
      case "start":
        if (user.isTenant) {
          return createErrorResponse("Tenants cannot start inspections", 403);
        }
        if (inspection.status !== "scheduled") {
          return createErrorResponse(
            "Can only start a scheduled inspection",
            400,
          );
        }
        update.status = "in_progress";
        break;

      case "complete":
        if (user.isTenant) {
          return createErrorResponse(
            "Tenants cannot complete inspections",
            403,
          );
        }
        if (inspection.status !== "in_progress") {
          return createErrorResponse(
            "Can only complete an in-progress inspection",
            400,
          );
        }
        // Route-level rule: overall condition is required to complete
        if (!data.overallCondition) {
          return createErrorResponse(
            "Overall condition is required to complete an inspection",
            400,
          );
        }
        update.status = "completed";
        update.completedDate = new Date();
        update.overallCondition = data.overallCondition;
        if (data.notes) update.notes = data.notes;
        break;

      case "cancel":
        if (user.isTenant) {
          return createErrorResponse("Tenants cannot cancel inspections", 403);
        }
        if (inspection.status === "completed") {
          return createErrorResponse(
            "Cannot cancel a completed inspection",
            400,
          );
        }
        update.status = "cancelled";
        if (data.reason) update.notes = data.reason;
        break;

      case "addItem":
        if (user.isTenant) {
          return createErrorResponse(
            "Tenants cannot add inspection items",
            403,
          );
        }
        if (!data.room || !data.item || !data.condition) {
          return createErrorResponse(
            "Room, item, and condition are required",
            400,
          );
        }
        update.items = [
          ...items,
          {
            id: crypto.randomUUID(),
            room: data.room,
            item: data.item,
            condition: data.condition,
            notes: data.notes || "",
            photos: data.photos || [],
            requiresAttention: ["poor", "damaged"].includes(data.condition),
          },
        ];
        break;

      case "updateItem": {
        if (user.isTenant) {
          return createErrorResponse(
            "Tenants cannot update inspection items",
            403,
          );
        }
        // Items can be addressed by array index or by their generated id
        let itemIndex: number = data.itemIndex;
        if (itemIndex === undefined && data.itemId) {
          itemIndex = items.findIndex((item) => item?.id === data.itemId);
        }
        if (itemIndex === undefined || itemIndex < 0) {
          return createErrorResponse("Valid item index is required", 400);
        }
        if (itemIndex >= items.length) {
          return createErrorResponse("Item index out of range", 400);
        }
        const updatedItem = { ...items[itemIndex] };
        if (data.condition) updatedItem.condition = data.condition;
        if (data.notes !== undefined) updatedItem.notes = data.notes;
        if (data.photos) updatedItem.photos = data.photos;
        updatedItem.requiresAttention = ["poor", "damaged"].includes(
          data.condition || updatedItem.condition,
        );
        items[itemIndex] = updatedItem;
        update.items = items;
        break;
      }

      case "addTenantSignature":
        if (!data.signature) {
          return createErrorResponse("Signature data is required", 400);
        }
        update.tenantSignature = {
          signedAt: new Date().toISOString(),
          signature: data.signature,
          ipAddress: data.ipAddress || "",
        };
        break;

      case "addInspectorSignature":
        if (user.isTenant) {
          return createErrorResponse(
            "Tenants cannot add inspector signatures",
            403,
          );
        }
        if (!data.signature) {
          return createErrorResponse("Signature data is required", 400);
        }
        update.inspectorSignature = {
          signedAt: new Date().toISOString(),
          signature: data.signature,
        };
        break;

      default:
        return createErrorResponse("Invalid action specified", 400);
    }

    const saved = await db.inspection.update({
      where: { id },
      data: update as Prisma.InspectionUpdateInput,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            type: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
            addressCountry: true,
          },
        },
        inspector: { select: INSPECTOR_SELECT },
      },
    });

    const tenant = await loadInspectionTenant(saved.tenantId);
    const property = propertyWithAddress(saved.property as never);

    return createSuccessResponse(
      {
        ...saved,
        propertyId: property ?? saved.propertyId,
        tenantId: tenant,
        inspectorId: saved.inspector ?? saved.inspectorId,
        property: undefined,
        inspector: undefined,
      },
      `Inspection ${action} completed successfully`,
    );
  } catch (error) {
    return handleApiError(error);
  }
});
