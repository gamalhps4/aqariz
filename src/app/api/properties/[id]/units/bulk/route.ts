/**
 * PropertyPro - Add several units to a building at once
 *
 * POST /api/properties/[id]/units/bulk
 *
 * The "Add multiple units" dialog sends the list it previewed — each row a
 * unit number, the type and the shared rent/status/floor — and this creates
 * all of them or none. The list is checked as a whole first: names that are
 * empty, too long, repeated in the list or already used in the building
 * (lib/units/bulk-names, the same rules the dialog shows), and the plan's
 * unit limit for the full count, so a save can never stop half way through.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
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
import {
  MAX_BULK_UNITS,
  MAX_UNIT_NUMBER_LENGTH,
  findNameProblems,
} from "@/lib/units/bulk-names";

const UNIT_STATUS_VALUES = [
  "available",
  "occupied",
  "maintenance",
  "unavailable",
] as const;

const bulkUnitsSchema = z.object({
  units: z
    .array(
      z.object({
        unitNumber: z.string().trim().min(1).max(MAX_UNIT_NUMBER_LENGTH),
      }),
    )
    .min(1, "Add at least one unit")
    .max(MAX_BULK_UNITS, `At most ${MAX_BULK_UNITS} units at a time`),
  unitType: z.string().trim().min(1).max(100),
  floor: z.coerce.number().int().optional(),
  rentAmount: z.coerce.number().finite().nonnegative().optional(),
  status: z.enum(UNIT_STATUS_VALUES).default("available"),
});

// The permission and role the single-unit create beside this one asks for.
const STAFF_ONLY = { roles: [UserRole.MANAGER] };

export const POST = withPermissionAndDB("property_edit", STAFF_ONLY)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;

      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
        select: { id: true },
      });
      if (!property) return createErrorResponse("Property not found", 404);

      const validation = validateSchema(bulkUnitsSchema, await request.json());
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { units, unitType, floor, rentAmount, status } = validation.data;
      const names = units.map((unit) => unit.unitNumber);

      // Live units only (the client's default filter): the unique index on a
      // building's unit numbers applies to live rows, and an archived unit's
      // number is free to reuse.
      const existing = await db.unit.findMany({
        where: { propertyId: id },
        select: { unitNumber: true },
      });
      const problems = findNameProblems(
        names,
        existing.map((unit) => unit.unitNumber),
      );
      if (problems.size > 0) {
        const listed = [...problems.entries()]
          .slice(0, 10)
          .map(([index, problem]) =>
            problem === "exists"
              ? `"${names[index]}" already exists in this building`
              : problem === "duplicate"
                ? `"${names[index]}" appears more than once`
                : `row ${index + 1} has no usable name`,
          );
        return createErrorResponse(
          [...new Set(listed)].join("; "),
          409,
          undefined,
          "DUPLICATE",
        );
      }

      await enforcePlanLimit(
        user.organizationId!,
        "units",
        await db.unit.count({ where: { deletedAt: null } }),
        names.length,
      );

      // One INSERT for the whole list. A create per unit is a round trip per
      // unit inside one transaction, and a long list over a slow link to the
      // database ran past the transaction's time limit — the client's
      // "it fails" on a large building.
      const created = await runWithOrgTransaction((tx) =>
        tx.unit.createManyAndReturn({
          data: names.map((unitNumber) => {
            const body = { unitNumber, unitType, floor, rentAmount, status };
            return {
              ...buildUnitScalarData(body),
              unitNumber,
              organizationId: user.organizationId!,
              propertyId: id,
              features: buildUnitFeatures(body) as Prisma.InputJsonValue,
            } as Prisma.UnitCreateManyInput;
          }),
        }),
      );

      // Once for the whole batch: totalUnits, isMultiUnit and the building's
      // status follow its units.
      let warning: string | undefined;
      try {
        const { propertyStatusSynchronizer } = await import(
          "@/lib/services/property-status-sync.service"
        );
        await propertyStatusSynchronizer.syncPropertyStatus(id, {
          triggeredBy: `unit-bulk-creation:${created.length}`,
          logChanges: true,
        });
      } catch {
        warning = "Units created but the building's status could not be refreshed";
      }

      return createSuccessResponse(
        { created: created.length, units: created.map((unit) => presentUnit(unit)) },
        warning ?? `${created.length} units created`,
      );
    } catch (error) {
      if ((error as { code?: string })?.code === "P2002") {
        return createErrorResponse(
          "One of these unit numbers was just used in this building. Refresh and try again.",
          409,
          undefined,
          "DUPLICATE",
        );
      }
      return handleApiError(error, "Failed to create the units");
    }
  },
);
