/**
 * PropertyPro - Publish, take down, archive or restore a listing
 *
 * POST { action }. One route, four actions, three rights:
 *
 *   publish / unpublish  Publish listings   (listing_publish)
 *   archive              Archive listings   (listing_delete)
 *   restore              Edit listings      (listing_edit)
 *
 * Publishing is refused unless the REGA advertising licence number and its
 * expiry are on the listing and the licence has not run out, and the unit is
 * still vacant — with every problem listed, so the office fixes them once.
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
import { AuditAction, AuditSeverity } from "@/lib/audit-service";
import { diffSnapshot, recordActivity } from "@/lib/audit-domain";
import { noteAuditEntry } from "@/lib/audit/scope";
import {
  LISTING_STATE_KEYS,
  listingName,
  listingPlace,
  listingSnapshot,
  listingStateAction,
} from "@/lib/audit/records/listing";
import { listingFailure } from "@/lib/listings/api";
import { readListingBefore } from "@/lib/listings/audit";
import {
  LISTING_ACCESS,
  can,
  type ListingAbility,
} from "@/lib/listings/permissions";
import { listingActionSchema, type ListingAction } from "@/lib/listings/schemas";
import { applyListingAction } from "@/lib/listings/service";

/** The right each action asks for. */
const RIGHT_FOR: Record<ListingAction, ListingAbility> = {
  publish: "publish",
  unpublish: "publish",
  archive: "archive",
  restore: "edit",
};

/** Where a listing stood before the action, when the read for it failed. */
const EXPECTED_FROM: Record<ListingAction, string> = {
  publish: "draft",
  unpublish: "published",
  archive: "draft",
  restore: "archived",
};

// Any one of the three rights opens the route; the action then asks for its own.
const ANY_STATUS_RIGHT = [
  ...new Set([
    ...LISTING_ACCESS.publish,
    ...LISTING_ACCESS.archive,
    ...LISTING_ACCESS.edit,
  ]),
];

export const POST = withPermissionAndDB(ANY_STATUS_RIGHT)(
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
      const parsed = listingActionSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          "action must be publish, unpublish, archive or restore",
          400,
          undefined,
          "VALIDATION_ERROR",
        );
      }

      const { action } = parsed.data;
      if (!can(user.permissions, RIGHT_FOR[action])) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      // The service answers with the listing after the move: read it first,
      // so the entry says from what, and a request that moves nothing
      // (publishing a published ad) is not recorded as a change.
      const before = await readListingBefore(id);
      const listing = await applyListingAction(user, id, action);
      const from =
        typeof before?.status === "string" ? before.status : EXPECTED_FROM[action];
      const kind = listingStateAction(from, listing.status);
      if (!kind) {
        noteAuditEntry();
      } else {
        // Publishing and taking down are a status move (draft ⇄ published),
        // archiving and restoring the archive's own; the first two are the
        // ones worth finding quickly.
        const published = kind === "status_changed";
        const diff = diffSnapshot(
          listingSnapshot(before ?? { status: from }),
          listingSnapshot(listing),
          LISTING_STATE_KEYS,
        );
        void recordActivity({
          action:
            kind === "archive"
              ? AuditAction.ARCHIVE
              : kind === "restore"
                ? AuditAction.RESTORE
                : AuditAction.STATUS_CHANGED,
          recordType: "listing",
          recordId: listing.id,
          recordName: listingName(listing),
          before: diff.before,
          after: diff.after,
          messageParams: published ? { from, to: listing.status } : undefined,
          details: {
            ...listingPlace(listing),
            ...(published
              ? {
                  adLicenceNumber: listing.adLicenceNumber,
                  adLicenceExpiry: listing.adLicenceExpiry,
                }
              : {}),
          },
          severity: published ? AuditSeverity.MEDIUM : AuditSeverity.LOW,
        });
      }
      return createSuccessResponse(listing, "Listing updated successfully");
    } catch (error) {
      return listingFailure(error, "Failed to change the listing");
    }
  },
);
