/**
 * PropertyPro - One property listing
 *
 * GET reads it; PATCH edits its text, price, photos, contacts and licence.
 * What an edit cannot do is change its state — publishing, taking down,
 * archiving and restoring are the status route's, behind their own rights.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  isValidObjectId,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { AuditAction, auditRecordChange } from "@/lib/audit-domain";
import {
  LISTING_CHANGE_KEYS,
  listingName,
  listingPlace,
  listingSnapshot,
} from "@/lib/audit/records/listing";
import { listingFailure } from "@/lib/listings/api";
import { readListingBefore } from "@/lib/listings/audit";
import { accessList, listingAbilities } from "@/lib/listings/permissions";
import { issueLines, listingUpdateSchema } from "@/lib/listings/schemas";
import { getListing, updateListing } from "@/lib/listings/service";

export const GET = withPermissionAndDB(accessList("view"))(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid listing ID", 400);
      }
      const listing = await getListing(user, id);
      // What this caller may do with it, so the screen shows only those controls.
      return createSuccessResponse(
        listing,
        "Listing retrieved successfully",
        undefined,
        { abilities: listingAbilities(user.permissions) },
      );
    } catch (error) {
      return listingFailure(error, "Failed to retrieve the listing");
    }
  },
);

export const PATCH = withPermissionAndDB(accessList("edit"))(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid listing ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) return createErrorResponse("Invalid request body", 400);

      const parsed = listingUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          issueLines(parsed.error).join(", "),
          400,
          undefined,
          "VALIDATION_ERROR",
        );
      }

      // The service answers with the listing after the edit: read it first.
      const before = await readListingBefore(id);
      const updated = await updateListing(user, id, parsed.data);
      auditRecordChange({
        action: AuditAction.UPDATE,
        recordType: "listing",
        recordId: updated.id,
        recordName: listingName(updated),
        before: listingSnapshot(before),
        after: listingSnapshot(updated),
        keys: LISTING_CHANGE_KEYS,
        details: listingPlace(updated),
      });
      return createSuccessResponse(updated, "Listing updated successfully");
    } catch (error) {
      return listingFailure(error, "Failed to update the listing");
    }
  },
);
