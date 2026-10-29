/**
 * PropertyPro - Available Units API Route
 * Get available units for a specific property
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { propertyScope, withScope } from "@/lib/db/scopes";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { presentUnit } from "@/lib/property-units";

// ============================================================================
// GET /api/properties/[id]/units/available - Get available units for property
// ============================================================================

export const GET = withPermissionAndDB("property_view")(
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

      // Find the property
      // Scoped: a building this caller does not hold does not resolve, and
      // the 404 below answers.
      const property = await db.property.findFirst({
        where: withScope({ id }, propertyScope(user)),
        select: { id: true },
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      // Filter available units - handle both lowercase and uppercase status values
      const availableUnits = await db.unit.findMany({
        where: {
          propertyId: id,
          status: { equals: "available", mode: "insensitive" },
        },
        orderBy: [{ createdAt: "asc" }, { unitNumber: "asc" }],
      });

      return createSuccessResponse(
        availableUnits.map((unit) => presentUnit(unit)),
        "Available units retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
