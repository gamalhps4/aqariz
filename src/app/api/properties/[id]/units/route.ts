/**
 * PropertyPro - Units API Routes
 * Handle CRUD operations for property units
 */

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { validateSchema } from "@/lib/validations";
import {
  buildUnitFeatures,
  buildUnitScalarData,
  presentUnit,
} from "@/lib/property-units";
import { enforcePlanLimit } from "@/lib/billing/entitlements";

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

// Unknown keys (the flat feature/appliance flags) pass through to
// buildUnitFeatures; the scalar columns are validated here.
const createUnitSchema = z
  .object({
    unitNumber: z
      .string({ required_error: "Unit number is required" })
      .trim()
      .min(1, "Unit number is required")
      .max(50, "Unit number too long"),
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

// Staff only, as before, and now the permission as well. The role alone used
// to be the whole gate, which every permission group passes — a group with no
// property permission ticked could list a building's units and add to them.
// These are the permissions the single-unit routes beside this one ask for.
const STAFF_ONLY = { roles: [UserRole.MANAGER] };

// GET /api/properties/[id]/units - Get all units for a property
export const GET = withPermissionAndDB("property_view", STAFF_ONLY)(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      // Await params before using its properties
      const { id } = await params;

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

      // Units live in their own table now
      const units = await db.unit.findMany({
        where: { propertyId: id },
        orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
      });

      return NextResponse.json(units.map((unit) => presentUnit(unit)));
    } catch (error) {
      return NextResponse.json(
        { error: "Internal server error" },
        { status: 500 }
      );
    }
  }
);

// POST /api/properties/[id]/units - Create a new unit
export const POST = withPermissionAndDB("property_edit", STAFF_ONLY)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      // Await params before using its properties
      const { id } = await params;

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

      const rawBody = await request.json();

      const validation = validateSchema(createUnitSchema, rawBody);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const body = validation.data;

      // Check if unit number already exists for this property
      const existingUnit = await db.unit.findFirst({
        where: { propertyId: id, unitNumber: body.unitNumber },
      });

      if (existingUnit) {
        return NextResponse.json(
          { error: "Unit number already exists for this property" },
          { status: 400 }
        );
      }

      await enforcePlanLimit(
        user.organizationId!,
        "units",
        await db.unit.count({ where: { deletedAt: null } }),
      );

      // Scalar columns + the features Json column (flat flags plus the
      // parking/utilities/appliances groups, mirroring the legacy handling)
      const newUnit = await db.unit.create({
        data: {
          ...buildUnitScalarData(body),
          unitNumber: body.unitNumber,
          organizationId: user.organizationId!,
          propertyId: id,
          features: buildUnitFeatures(body) as Prisma.InputJsonValue,
        },
      });

      // Trigger property status synchronization after unit creation
      // (also refreshes totalUnits/isMultiUnit)
      let syncWarning: string | null = null;

      try {
        const { propertyStatusSynchronizer } = await import(
          "@/lib/services/property-status-sync.service"
        );

        await propertyStatusSynchronizer.syncPropertyStatus(id, {
          triggeredBy: `unit-creation:${newUnit.id}`,
          logChanges: true,
        });
      } catch (syncError) {
        const baseWarning =
          "Unit created but status synchronization could not be verified";
        syncWarning =
          syncError instanceof Error && syncError.message
            ? `${baseWarning}: ${syncError.message}`
            : baseWarning;
      }

      const responsePayload = NextResponse.json(presentUnit(newUnit), {
        status: 201,
      });
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

      // The plan's unit limit (402) and other typed errors keep their status
      // and message; this used to answer every one of them with a 500.
      return handleApiError(error, "Failed to create the unit");
    }
  }
);
