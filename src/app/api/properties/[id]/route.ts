/**
 * PropertyPro - Individual Property API Routes
 * CRUD operations for individual properties
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { compoundScope, propertyScope, withScope } from "@/lib/db/scopes";
import { propertyAllows, TENANT_PROPERTY_LEASE_STATUSES } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, PropertyStatus } from "@/types";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { propertyUpdateSchema, validateSchema } from "@/lib/validations";
import {
  assertCategorySlug,
  assertUnitTypeSlugs,
  UnknownCategoryError,
} from "@/lib/property-categories";
import {
  buildUnitFeatures,
  buildUnitScalarData,
  presentProperty,
} from "@/lib/property-units";
import { syncPropertyDerivedState } from "@/lib/services/property-status-sync.service";
import { deleteFromR2 } from "@/lib/r2-server";
import { isR2Url, extractObjectKey } from "@/lib/r2";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

const OWNER_MANAGER_SELECT = {
  select: { id: true, firstName: true, lastName: true, email: true },
} as const;

const PROPERTY_INCLUDE = {
  owner: OWNER_MANAGER_SELECT,
  manager: OWNER_MANAGER_SELECT,
  units: {
    where: { deletedAt: null },
    orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
  },
} satisfies Prisma.PropertyInclude;

// ============================================================================
// GET /api/properties/[id] - Get a specific property
// ============================================================================

export const GET = withAccessAndDB({
  roles: [UserRole.TENANT],
  permissions: ["property_view"],
  match: "any",
})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // Find the property with its units and owner/manager details. Scoped:
      // a building this caller does not hold does not resolve, and the 404
      // below answers.
      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
        include: PROPERTY_INCLUDE,
      });

      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      // A tenant's entitlement runs through a lease, which the scoped query
      // above already checked — propertyAllows refuses tenants by design (see
      // lib/db/scopes.ts), and calling it first shut every tenant out of their
      // own building, which left the maintenance and ticket forms with nothing
      // to choose.
      if (user.isTenant) {
        // Only what a tenant needs: their own units, and no owner or manager
        // contact details, other tenants' rents or the building's documents.
        const leases = await db.lease.findMany({
          where: {
            tenantId: user.id,
            propertyId: property.id,
            status: { in: [...TENANT_PROPERTY_LEASE_STATUSES] },
          },
          select: { unitId: true },
        });
        const leasedUnits = new Set(leases.map((lease) => lease.unitId));
        const presented = presentProperty(
          {
            ...property,
            units: property.units.filter((unit) => leasedUnits.has(unit.id)),
          },
          { deriveStatus: true },
        );
        delete presented.ownerId;
        delete presented.managerId;
        delete presented.attachments;
        return createSuccessResponse(presented, "Property retrieved successfully");
      }
      // An owner's and staff's entitlement is answerable from the row itself.
      if (!propertyAllows(user, property)) {
        return createErrorResponse("Access denied", 403);
      }

      // Legacy shape: nested address, populated ownerId/managerId, embedded
      // units array, and status derived from unit statuses for display.
      const propertyObject = presentProperty(property, { deriveStatus: true });

      return createSuccessResponse(
        propertyObject,
        "Property retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/properties/[id] - Update a specific property
// ============================================================================

export const PUT = withPermissionAndDB("property_edit")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Find the property. Scoped: the writes to the building and its units
      // below are keyed on the id from the URL, so this lookup is what keeps
      // them inside the caller's buildings.
      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      // Validate update data (partial schema; ownership fields are excluded
      // from the update schema entirely)
      const validation = validateSchema(propertyUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const updateData = validation.data;

      // Categories live in `property_categories` now — zod checked shape only.
      //
      // Only slugs the edit actually *changes* are checked against the active
      // list. A category can be deactivated after records were filed under it;
      // re-validating an unchanged value would make those records uneditable,
      // forcing the user to reclassify a building just to fix its address.
      try {
        if (updateData.type && updateData.type !== property.type) {
          await assertCategorySlug(user.organizationId!, "property", updateData.type);
        }

        if (updateData.units?.length) {
          const existingUnitTypes = new Set(
            (
              await db.unit.findMany({
                where: { propertyId: id, deletedAt: null },
                select: { unitType: true },
              })
            ).map((unit) => unit.unitType),
          );
          await assertUnitTypeSlugs(
            user.organizationId!,
            updateData.units
              .map((unit) => unit.unitType)
              .filter((slug) => !existingUnitTypes.has(slug)),
          );
        }
      } catch (categoryError) {
        if (categoryError instanceof UnknownCategoryError) {
          return createErrorResponse(categoryError.message, 400);
        }
        throw categoryError;
      }

      // Compound membership is editable here, including detaching (null).
      // Scoped: the compound comes from the body, and a building moved into
      // one the caller cannot reach would make that compound reachable.
      if (updateData.compoundId) {
        const compound = await db.compound.findFirst({
          where: withScope(
            { id: updateData.compoundId },
            compoundScope(user),
          ),
          select: { id: true },
        });
        if (!compound) {
          return createErrorResponse("Compound not found", 400);
        }
      }

      // Split out relation/derived/legacy fields; map address to flat columns
      const {
        units,
        address,
        amenities,
        attachments,
        images,
        compoundId,
        features: _features,
        ...propertyUpdateData
      } = updateData;

      const data: Prisma.PropertyUpdateInput = { ...propertyUpdateData };
      // Explicit null means "take this property out of its compound"; the
      // property itself, and everything under it, is untouched either way.
      if (compoundId !== undefined) {
        data.compound = compoundId
          ? { connect: { id: compoundId } }
          : { disconnect: true };
      }
      if (address) {
        data.addressStreet = address.street;
        data.addressCity = address.city;
        data.addressDistrict = address.district;
        data.addressState = address.state;
        data.addressZipCode = address.zipCode;
        data.addressCountry = address.country;
      }
      if (amenities !== undefined) {
        data.amenities = amenities as unknown as Prisma.InputJsonValue;
      }
      if (attachments !== undefined) {
        data.attachments = attachments as unknown as Prisma.InputJsonValue;
      }
      if (images !== undefined) data.images = images;

      await db.property.update({ where: { id }, data });

      // Reconcile units if provided (the form always submits the full array).
      // Units are matched by unitNumber so existing unit ids — and any lease
      // references to them — are preserved.
      if (units && Array.isArray(units)) {
        const existingUnits = await db.unit.findMany({
          where: { propertyId: id },
        });
        const byNumber = new Map(
          existingUnits.map((unit) => [unit.unitNumber, unit]),
        );
        const incomingNumbers = new Set(units.map((unit) => unit.unitNumber));

        // Only the units this edit ADDS count against the plan: the rest are
        // already on the books. Without this the unit cap was enforced on the
        // dedicated create endpoint and nowhere else, so an organization at
        // its limit could add units indefinitely by editing the property.
        const addedUnits = units.filter(
          (unit) => !byNumber.has(unit.unitNumber),
        ).length;
        if (addedUnits > 0) {
          await enforcePlanLimit(
            user.organizationId!,
            "units",
            await db.unit.count({ where: { deletedAt: null } }),
            addedUnits,
          );
        }

        for (const unit of units) {
          const existing = byNumber.get(unit.unitNumber);
          if (existing) {
            await db.unit.update({
              where: { id: existing.id },
              data: {
                ...buildUnitScalarData(unit),
                features: buildUnitFeatures(
                  unit,
                  existing.features,
                ) as Prisma.InputJsonValue,
              },
            });
          } else {
            await db.unit.create({
              data: {
                ...buildUnitScalarData(unit),
                unitNumber: unit.unitNumber,
                organizationId: user.organizationId!,
                propertyId: id,
                features: buildUnitFeatures(unit) as Prisma.InputJsonValue,
              },
            });
          }
        }

        // Units dropped from the form are ARCHIVED, not destroyed — units are
        // one of the archive categories, and permanent deletion belongs to
        // the System Owner through the archive. Archiving also handles what
        // the old hard delete could not: a unit with lease history used to be
        // undeletable (a foreign-key error swallowed by a `continue`), so it
        // silently stayed on the property.
        //
        // The partial unique index on (property, unit number) covers live
        // rows only, so the number is free for immediate re-use.
        const removable = existingUnits.filter(
          (existing) =>
            !incomingNumbers.has(existing.unitNumber) &&
            !existing.currentTenantId &&
            !existing.currentLeaseId,
        );
        if (removable.length > 0) {
          await db.unit.updateMany({
            where: { id: { in: removable.map((unit) => unit.id) } },
            data: { deletedAt: new Date() },
          });
        }

        // Recompute derived state (status/totalUnits/isMultiUnit)
        await syncPropertyDerivedState(id, {
          triggeredBy: `property-update:${user.id}`,
          logChanges: true,
        });
      }

      const updated = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
        include: PROPERTY_INCLUDE,
      });

      return createSuccessResponse(
        updated ? presentProperty(updated) : updated,
        "Property updated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/properties/[id] - Delete a specific property (soft delete)
// ============================================================================

export const DELETE = withPermissionAndDB("property_delete")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      // Find the property, including soft-deleted rows. Scoped: a building
      // this caller does not hold does not resolve, so it cannot be archived
      // by guessing its id. `deletedAt` stays at the top level, where the
      // soft-delete filter looks for it.
      const property = await db.property.findFirst({
        where: withScope({ id, deletedAt: undefined }, propertyScope(user)),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }
      // If already soft-deleted, return appropriate error
      if (property.deletedAt) {
        return createErrorResponse("Property has already been deleted", 410);
      }

      // Check if property has active leases
      const activeLeases = await db.lease.count({
        where: { propertyId: id, status: { in: ["active", "pending"] } },
      });

      if (activeLeases > 0) {
        return createErrorResponse(
          "Cannot delete property with active leases. Please terminate all leases first.",
          409
        );
      }

      // Soft delete: keep the row (and its images) so it can be restored
      await db.property.update({
        where: { id },
        data: { deletedAt: new Date(), status: PropertyStatus.UNAVAILABLE },
      });

      void recordActivity({
        action: AuditAction.ARCHIVE,
        recordType: "property",
        recordId: id,
        recordName: property.name,
        before: { status: property.status },
      });

      return createSuccessResponse({ id }, "Property deleted successfully");
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/properties/[id] - Partial update (status change, etc.)
// ============================================================================

export const PATCH = withPermissionAndDB("property_edit")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid property ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Find the property. Scoped, as in PUT: the update below is keyed on
      // the id from the URL.
      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      // Handle specific patch operations
      const { action, ...data } = body;
      const update: Prisma.PropertyUpdateInput = {};

      switch (action) {
        case "updateStatus":
          if (!data.status) {
            return createErrorResponse("Status is required", 400);
          }
          update.status = data.status;
          break;

        case "addImages":
          if (!Array.isArray(data.images)) {
            return createErrorResponse("Images array is required", 400);
          }
          update.images = [...property.images, ...data.images];
          break;

        case "removeImages": {
          if (!Array.isArray(data.images)) {
            return createErrorResponse("Images array is required", 400);
          }

          // Delete images from storage (R2) before removing from database
          const deletePromises = data.images.map(async (imageUrl: string) => {
            try {
              // Extract object key from URL
              let objectKey: string | null = imageUrl;
              if (
                imageUrl.startsWith("http://") ||
                imageUrl.startsWith("https://")
              ) {
                if (isR2Url(imageUrl)) {
                  objectKey = extractObjectKey(imageUrl);
                } else {
                  console.warn(`Skipping non-R2 URL: ${imageUrl}`);
                  return;
                }
              }

              if (!objectKey) {
                console.warn(`Could not extract object key from: ${imageUrl}`);
                return;
              }

              const deleted = await deleteFromR2(objectKey);
              if (deleted) {
              } else {
                console.warn(
                  `Failed to delete image from storage: ${imageUrl}`
                );
              }
            } catch (error) {
              console.error(
                `Error deleting image from storage: ${imageUrl}`,
                error
              );
              // Continue even if storage deletion fails
            }
          });

          // Wait for all storage deletions to complete
          await Promise.allSettled(deletePromises);

          // Remove images from database
          update.images = property.images.filter(
            (img) => !data.images.includes(img)
          );
          break;
        }

        case "addAmenities": {
          if (!Array.isArray(data.amenities)) {
            return createErrorResponse("Amenities array is required", 400);
          }
          const currentAmenities = Array.isArray(property.amenities)
            ? (property.amenities as any[])
            : [];
          update.amenities = [
            ...currentAmenities,
            ...data.amenities,
          ] as Prisma.InputJsonValue;
          break;
        }

        case "removeAmenities": {
          if (!Array.isArray(data.amenityNames)) {
            return createErrorResponse("Amenity names array is required", 400);
          }
          const currentAmenities = Array.isArray(property.amenities)
            ? (property.amenities as any[])
            : [];
          update.amenities = currentAmenities.filter(
            (amenity: any) => !data.amenityNames.includes(amenity?.name)
          ) as Prisma.InputJsonValue;
          break;
        }

        default:
          return createErrorResponse("Invalid action", 400);
      }

      await db.property.update({ where: { id }, data: update });

      const updated = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
        include: {
          units: {
            where: { deletedAt: null },
            orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
          },
        },
      });

      return createSuccessResponse(
        updated ? presentProperty(updated) : updated,
        `Property ${action} completed successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
