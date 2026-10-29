/**
 * PropertyPro - Individual Unit API Routes
 * Handle CRUD operations for individual units
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { validateSchema } from "@/lib/validations";
import {
  buildUnitFeatures,
  buildUnitScalarData,
  presentUnit,
} from "@/lib/property-units";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

/** The unit statuses the codebase actually sets/compares (lease lifecycle,
 * property status sync, PropertyStatus contract). */
const UNIT_STATUS_VALUES = [
  "available",
  "occupied",
  "maintenance",
  "unavailable",
] as const;

/** Legacy forms send "" / null for "not provided" — treat both as absent. */
const emptyToUndefined = (value: unknown) =>
  value === "" || value === null ? undefined : value;

const nonnegativeNumber = z.preprocess(
  emptyToUndefined,
  z.coerce.number().finite().nonnegative().optional(),
);

/** Bounded parking/utilities/appliances group passed through to `features`. */
const featureGroupSchema = z
  .record(z.union([z.string().max(100), z.number(), z.boolean()]))
  .refine(
    (group) => Object.keys(group).length <= 50,
    "Too many feature entries",
  )
  .optional();

// Partial update: every field is optional; fields not sent keep their current
// value. Unknown keys (the flat feature/appliance flags) pass through to
// buildUnitFeatures; the scalar columns are validated here.
const updateUnitSchema = z
  .object({
    unitNumber: z
      .string()
      .trim()
      .min(1, "Unit number is required")
      .max(50, "Unit number too long")
      .optional(),
    unitType: z.preprocess(
      emptyToUndefined,
      z.string().trim().max(100).optional(),
    ),
    floor: z.preprocess(emptyToUndefined, z.coerce.number().int().optional()),
    bedrooms: nonnegativeNumber,
    bathrooms: nonnegativeNumber,
    squareFootage: nonnegativeNumber,
    rentAmount: nonnegativeNumber,
    securityDeposit: nonnegativeNumber,
    status: z.preprocess(
      emptyToUndefined,
      z
        .string()
        .trim()
        .toLowerCase()
        .pipe(z.enum(UNIT_STATUS_VALUES))
        .optional(),
    ),
    notes: z.string().max(5000).nullish(),
    images: z.array(z.string().max(2048)).max(100).optional(),
    attachments: z.array(z.unknown()).max(100).optional(),
    amenities: z.array(z.string().max(100)).max(100).optional(),
    appliances: featureGroupSchema,
    parking: featureGroupSchema,
    utilities: featureGroupSchema,
  })
  .passthrough();

// GET /api/properties/[id]/units/[unitId] - Get a specific unit
export const GET = withPermissionAndDB("property_view")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; unitId: string }> },
  ) => {
  try {
    // Await params before using its properties
    const { id, unitId } = await params;

    // Verify property exists and user has access
    // Scoped: a building this caller does not hold does not resolve, and
    // the 404 below answers.
    const property = await db.property.findFirst({
      where: withScope({ id }, propertyScope(user)),
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    // Get the specific unit
    const unit = await db.unit.findFirst({
      where: { id: unitId, propertyId: id },
    });

    if (!unit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    return NextResponse.json(presentUnit(unit));
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
  }
);

// PUT /api/properties/[id]/units/[unitId] - Update a specific unit
export const PUT = withPermissionAndDB("property_edit")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; unitId: string }> },
  ) => {
  try {
    // Await params before using its properties
    const { id, unitId } = await params;

    // Verify property exists and user has access
    // Scoped: a building this caller does not hold does not resolve, and
    // the 404 below answers.
    const property = await db.property.findFirst({
      where: withScope({ id }, propertyScope(user)),
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    // Find the existing unit
    const existingUnit = await db.unit.findFirst({
      where: { id: unitId, propertyId: id },
    });

    if (!existingUnit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    const rawBody = await request.json();

    const validation = validateSchema(updateUnitSchema, rawBody);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }
    const body = validation.data;

    // Check if unit number already exists for this property (excluding current unit)
    if (
      body.unitNumber !== undefined &&
      body.unitNumber !== existingUnit.unitNumber
    ) {
      const duplicateUnit = await db.unit.findFirst({
        where: {
          propertyId: id,
          unitNumber: body.unitNumber,
          id: { not: unitId },
        },
      });

      if (duplicateUnit) {
        return NextResponse.json(
          { error: "Unit number already exists for this property" },
          { status: 400 }
        );
      }
    }

    // Transform the update data: scalar columns from the body (fields not
    // sent keep their current value) and the rebuilt features Json column
    // (flat flags + parking/utilities/appliances groups, legacy semantics).
    const updateData: Record<string, any> = {
      ...buildUnitScalarData(body),
      features: buildUnitFeatures(
        body,
        existingUnit.features,
      ) as Prisma.InputJsonValue,
    };

    const nextStatus = updateData.status ?? existingUnit.status;
    if (String(nextStatus).toLowerCase() === "occupied") {
      const activeLease = await db.lease.findFirst({
        where: { propertyId: id, unitId, status: LeaseStatus.ACTIVE },
      });
      if (!activeLease) {
        updateData.status = "available";
        updateData.currentTenantId = null;
        updateData.currentLeaseId = null;
      } else {
        updateData.status = nextStatus;
        updateData.currentTenantId = activeLease.tenantId;
        updateData.currentLeaseId = activeLease.id;
      }
    } else {
      updateData.currentTenantId = null;
      updateData.currentLeaseId = null;
    }

    // Check if unit status is changing to trigger property synchronization
    const oldUnitStatus = existingUnit.status;
    const newUnitStatus = updateData.status ?? existingUnit.status;
    const statusChanged = oldUnitStatus !== newUnitStatus;

    // Update the unit
    const updatedUnit = await db.unit.update({
      where: { id: unitId },
      data: updateData,
    });

    // Trigger property status synchronization if unit status changed
    let syncWarning: string | null = null;

    if (statusChanged) {
      try {
        const { propertyStatusSynchronizer } = await import(
          "@/lib/services/property-status-sync.service"
        );

        await propertyStatusSynchronizer.syncAfterUnitStatusChange(
          id,
          unitId,
          oldUnitStatus as any,
          newUnitStatus as any,
          {
            triggeredBy: `unit-api-update:${unitId}`,
            logChanges: true,
          }
        );
      } catch (syncError) {
        const baseWarning =
          "Unit updated but status synchronization could not be verified";
        syncWarning =
          syncError instanceof Error && syncError.message
            ? `${baseWarning}: ${syncError.message}`
            : baseWarning;
      }
    }

    const responsePayload = NextResponse.json(presentUnit(updatedUnit));
    if (syncWarning) {
      responsePayload.headers.set("x-propertypro-warning", syncWarning);
    }

    return responsePayload;
  } catch (error: any) {
    if (error?.code === "P2002") {
      return NextResponse.json(
        { error: "Unit number already exists for this property" },
        { status: 400 }
      );
    }
    if (error?.name === "ValidationError") {
      return NextResponse.json(
        { error: "Validation error", details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
  }
);

// DELETE /api/properties/[id]/units/[unitId] - Delete a specific unit
export const DELETE = withPermissionAndDB("property_edit")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; unitId: string }> },
  ) => {
  try {
    // Await params before using its properties
    const { id, unitId } = await params;

    // Verify property exists and user has access
    // Scoped: a building this caller does not hold does not resolve, and
    // the 404 below answers.
    const property = await db.property.findFirst({
      where: withScope({ id }, propertyScope(user)),
      select: { id: true },
    });
    if (!property) {
      return NextResponse.json(
        { error: "Property not found" },
        { status: 404 }
      );
    }

    // Find the existing unit
    const existingUnit = await db.unit.findFirst({
      where: { id: unitId, propertyId: id },
    });

    if (!existingUnit) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Check if unit has active lease or tenant
    if (existingUnit.currentTenantId || existingUnit.currentLeaseId) {
      return NextResponse.json(
        {
          error: "Cannot delete unit with active tenant or lease",
          // For the delete dialog to say in the reader's language.
          code: "UNIT_OCCUPIED",
        },
        { status: 400 }
      );
    }

    // ARCHIVE, never destroy. Units are one of the archive categories, and
    // permanent deletion belongs to the System Owner through the archive.
    //
    // This also fixes what the previous hard delete could not do: a unit with
    // lease history was simply undeletable, because leases keep a foreign key
    // to it. Archiving keeps that history intact and still takes the unit out
    // of every listing — and the partial unique index on (property, unit
    // number) covers live rows only, so the number can be re-used at once.
    await db.unit.update({
      where: { id: unitId },
      data: { deletedAt: new Date() },
    });

    void recordActivity({
      action: AuditAction.ARCHIVE,
      recordType: "unit",
      recordId: unitId,
      recordName: existingUnit.unitNumber ?? null,
      details: { propertyId: id },
    });

    // The images stay. An archived unit can be restored, and a restore that
    // brings back a unit whose pictures were destroyed with its deletion is
    // not a restore. They go at the archive's permanent delete
    // (lib/stored-files.ts).

    // Trigger property status synchronization after unit deletion
    // (also refreshes totalUnits/isMultiUnit)
    let syncWarning: string | null = null;

    try {
      const { propertyStatusSynchronizer } = await import(
        "@/lib/services/property-status-sync.service"
      );

      await propertyStatusSynchronizer.syncPropertyStatus(id, {
        triggeredBy: `unit-deletion:${unitId}`,
        logChanges: true,
      });
    } catch (syncError) {
      const baseWarning =
        "Unit deleted but status synchronization could not be verified";
      syncWarning =
        syncError instanceof Error && syncError.message
          ? `${baseWarning}: ${syncError.message}`
          : baseWarning;
    }

    const responsePayload = NextResponse.json({
      message: "Unit deleted successfully",
    });
    if (syncWarning) {
      responsePayload.headers.set("x-propertypro-warning", syncWarning);
    }

    return responsePayload;
  } catch (error) {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
  }
);
