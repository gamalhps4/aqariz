/**
 * PropertyPro - Subjects a statement can be run for
 *
 * The compound, building and unit statements each need a picker of their own,
 * and the payments filter panel cannot supply one: it derives its unit list
 * from contracts, so a unit that has never been let would be missing — which
 * is exactly the unit an office reaches for a statement to explain.
 *
 * One request rather than three, and scoped the same way every other property
 * read is, so a narrowed employee is only ever offered what they may open.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { propertyScope } from "@/lib/db/scopes";

const LIMIT = 500;

export const GET = withPermissionAndDB([
  "property_view",
  "property_management",
  "financial_reports",
])(async (user: AuthenticatedAccessUser, _request: NextRequest) => {
  try {
    const scope = propertyScope(user);

    const [properties, units] = await Promise.all([
      db.property.findMany({
        where: { deletedAt: null, ...scope },
        select: {
          id: true,
          name: true,
          addressCity: true,
          addressDistrict: true,
          compound: { select: { id: true, name: true, code: true } },
        },
        orderBy: { name: "asc" },
        take: LIMIT,
      }),
      db.unit.findMany({
        where: { deletedAt: null, property: { deletedAt: null, ...scope } },
        select: {
          id: true,
          unitNumber: true,
          status: true,
          property: { select: { id: true, name: true } },
        },
        orderBy: [{ propertyId: "asc" }, { unitNumber: "asc" }],
        take: LIMIT,
      }),
    ]);

    // Compounds come from the buildings the caller can see rather than from a
    // read of their own: a compound whose every building is outside the
    // caller's assignment is not a subject they may run.
    const compounds = new Map<string, string>();
    for (const property of properties) {
      if (property.compound) {
        compounds.set(
          property.compound.id,
          property.compound.code
            ? `${property.compound.name} (${property.compound.code})`
            : property.compound.name,
        );
      }
    }

    return createSuccessResponse(
      {
        compounds: [...compounds.entries()]
          .map(([id, label]) => ({ id, label }))
          .sort((a, b) => a.label.localeCompare(b.label)),
        properties: properties.map((property) => ({
          id: property.id,
          label: property.name,
          hint:
            [property.addressDistrict, property.addressCity]
              .filter(Boolean)
              .join(" · ") || null,
        })),
        // Named by building first: a bare "12" means nothing to whoever is
        // choosing, and unit numbers repeat across buildings.
        units: units.map((unit) => ({
          id: unit.id,
          label: `${unit.property.name} · ${unit.unitNumber}`,
          hint: String(unit.status).toLowerCase(),
          propertyId: unit.property.id,
        })),
      },
      "Statement subjects retrieved",
    );
  } catch (error) {
    return handleApiError(error, "Failed to load statement subjects");
  }
});
