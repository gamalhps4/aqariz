/**
 * PropertyPro - Single Compound API
 * Read one compound with its child properties and portfolio rollup, edit it,
 * or archive it. Archiving detaches its properties; it never deletes them.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { compoundScope, propertyScope, withScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { compoundUpdateSchema, validateSchema } from "@/lib/validations";
import {
  COMPOUND_OWNER_SELECT,
  getCompoundStats,
  presentCompound,
} from "@/lib/compounds";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

const COMPOUND_PROPERTY_SELECT = {
  id: true,
  name: true,
  type: true,
  status: true,
  addressStreet: true,
  addressCity: true,
  addressDistrict: true,
  totalUnits: true,
  isMultiUnit: true,
  images: true,
  ownerId: true,
  createdAt: true,
} as const;

// ============================================================================
// GET /api/compounds/[id]
// ============================================================================

export const GET = withPermissionAndDB("property_view")(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid compound ID", 400);
      }

      // A compound is reachable through one building in it, which is not the
      // same as holding the rest: the buildings listed, and the rollup below,
      // are the caller's own. Both used to cover the whole compound.
      const compound = await db.compound.findFirst({
        where: { id, ...compoundScope(user) },
        include: {
          owner: COMPOUND_OWNER_SELECT,
          manager: COMPOUND_OWNER_SELECT,
          properties: {
            where: withScope({ deletedAt: null }, propertyScope(user)),
            select: COMPOUND_PROPERTY_SELECT,
            orderBy: { name: "asc" },
          },
        },
      });

      if (!compound) {
        return createErrorResponse("Compound not found", 404);
      }

      const stats = await getCompoundStats(compound.id, user);

      return createSuccessResponse(
        { ...presentCompound(compound), stats },
        "Compound retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve compound");
    }
  },
);

// ============================================================================
// PATCH /api/compounds/[id]
// ============================================================================

export const PATCH = withPermissionAndDB("property_edit")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid compound ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const existing = await db.compound.findFirst({
        where: { id, ...compoundScope(user) },
        select: { id: true },
      });
      if (!existing) {
        return createErrorResponse("Compound not found", 404);
      }

      const validation = validateSchema(compoundUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const input = validation.data;
      const organizationId = user.organizationId!;

      if (input.code !== undefined && input.code) {
        const clash = await db.compound.findFirst({
          where: { code: input.code.trim(), deletedAt: null, id: { not: id } },
          select: { id: true },
        });
        if (clash) {
          return createErrorResponse(
            "Another compound already uses this code",
            409,
          );
        }
      }

      const data: Prisma.CompoundUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.code !== undefined) data.code = input.code?.trim() || null;
      if (input.description !== undefined) {
        data.description = input.description || null;
      }
      if (input.address) {
        data.addressStreet = input.address.street;
        data.addressCity = input.address.city;
        data.addressDistrict = input.address.district;
        data.addressState = input.address.state;
        data.addressZipCode = input.address.zipCode;
        data.addressCountry = input.address.country;
      }
      if (input.totalArea !== undefined) data.totalArea = input.totalArea;
      if (input.yearBuilt !== undefined) data.yearBuilt = input.yearBuilt;
      if (input.amenities !== undefined) {
        data.amenities = input.amenities as unknown as Prisma.InputJsonValue;
      }
      if (input.attachments !== undefined) {
        data.attachments = input.attachments as unknown as Prisma.InputJsonValue;
      }
      if (input.images !== undefined) data.images = input.images;
      if (input.notes !== undefined) data.notes = input.notes || null;
      if (input.ownerId !== undefined) {
        data.owner = input.ownerId
          ? { connect: { id: input.ownerId } }
          : { disconnect: true };
      }
      if (input.managerId !== undefined) {
        data.manager = input.managerId
          ? { connect: { id: input.managerId } }
          : { disconnect: true };
      }

      await runWithOrgTransaction(async (tx) => {
        await tx.compound.update({ where: { id }, data });

        // `propertyIds`, when sent, is the complete membership list: attach
        // what is new, detach what dropped off. Detaching only clears the FK —
        // the property and everything under it is untouched.
        //
        // Complete, that is, for the buildings this caller holds. Both writes
        // are scoped as the attach in POST /api/compounds is. Unscoped, the
        // list an employee narrowed to two of a compound's buildings sent
        // back detached all the others, and any building in the office could
        // be pulled into a compound they were assigned — and so into their
        // own reach.
        if (input.propertyIds) {
          await tx.property.updateMany({
            where: withScope(
              {
                compoundId: id,
                id: { notIn: input.propertyIds },
                organizationId,
              },
              propertyScope(user),
            ),
            data: { compoundId: null },
          });
          if (input.propertyIds.length > 0) {
            await tx.property.updateMany({
              where: withScope(
                {
                  id: { in: input.propertyIds },
                  organizationId,
                  deletedAt: null,
                },
                propertyScope(user),
              ),
              data: { compoundId: id },
            });
          }
        }
      });

      const updated = await db.compound.findFirst({
        where: { id, ...compoundScope(user) },
        include: {
          owner: COMPOUND_OWNER_SELECT,
          manager: COMPOUND_OWNER_SELECT,
          properties: {
            where: withScope({ deletedAt: null }, propertyScope(user)),
            select: COMPOUND_PROPERTY_SELECT,
            orderBy: { name: "asc" },
          },
        },
      });

      return createSuccessResponse(
        updated ? presentCompound(updated) : updated,
        "Compound updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update compound");
    }
  },
);

// ============================================================================
// DELETE /api/compounds/[id]
// ============================================================================

export const DELETE = withPermissionAndDB("property_delete")(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid compound ID", 400);
      }

      const compound = await db.compound.findFirst({
        where: { id, ...compoundScope(user) },
        select: { id: true, name: true },
      });
      if (!compound) {
        return createErrorResponse("Compound not found", 404);
      }

      // Reachable through one building is not the same as the caller's to
      // dissolve. Deleting detaches every building in the compound, so it
      // takes someone who holds all of them.
      const held = propertyScope(user);
      if (Object.keys(held).length > 0) {
        const beyond = await db.property.count({
          where: { compoundId: id, NOT: held },
        });
        if (beyond > 0) {
          return createErrorResponse(
            "This compound holds buildings that are not assigned to you",
            403,
          );
        }
      }

      const detached = await runWithOrgTransaction(async (tx) => {
        // Detach first, then archive. A compound is a grouping: removing it
        // must leave every child property — and its contracts, units and
        // payments — fully intact and independently manageable.
        const { count } = await tx.property.updateMany({
          where: { compoundId: id },
          data: { compoundId: null },
        });

        await tx.compound.update({
          where: { id },
          data: { deletedAt: new Date() },
        });

        return count;
      });

      void recordActivity({
        action: AuditAction.ARCHIVE,
        recordType: "compound",
        recordId: id,
        recordName: compound.name,
        details: { detachedProperties: detached },
      });

      return createSuccessResponse(
        { id, detachedProperties: detached },
        detached > 0
          ? `Compound deleted — ${detached} propert${detached === 1 ? "y" : "ies"} kept and detached`
          : "Compound deleted successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to delete compound");
    }
  },
);
