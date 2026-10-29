/**
 * PropertyPro - Vacant units a listing can be started for
 *
 * What the "new listing" screen offers: units that are vacant, not deleted,
 * in a building the caller may see, with no live listing of this type yet —
 * and the facts the form starts from (rooms, area, rent, photos, the
 * building's amenities) — and whether this caller may also advertise a
 * property that is not in the system.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { isListingType } from "@/lib/listings/constants";
import { listingFailure, queryText } from "@/lib/listings/api";
import { LISTING_ACCESS, listingAbilities } from "@/lib/listings/permissions";
import { advertisesBeyondBuildings, listCandidateUnits } from "@/lib/listings/service";

export const GET = withPermissionAndDB([
  ...new Set([...LISTING_ACCESS.create, ...LISTING_ACCESS.edit]),
])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = request.nextUrl;
    const asked = searchParams.get("type");
    const type = isListingType(asked) ? asked : "rent";
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") ?? "50", 10) || 50),
    );
    const units = await listCandidateUnits(user, {
      type,
      search: queryText(searchParams, "search"),
      limit,
    });
    return createSuccessResponse(
      units,
      "Vacant units retrieved successfully",
      undefined,
      {
        abilities: listingAbilities(user.permissions),
        // Whether the screen offers "not in the system": only to someone
        // who sees every building (a listing with no building is outside a
        // narrower view, so its maker could not find it again).
        standaloneAllowed: advertisesBeyondBuildings(user),
      },
    );
  } catch (error) {
    return listingFailure(error, "Failed to retrieve the vacant units");
  }
});
