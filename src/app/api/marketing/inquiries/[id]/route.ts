/**
 * PropertyPro - Work one listing inquiry
 *
 * PATCH changes where it stands (new, contacted, closed), who has it, and the
 * office's notes. What the stranger wrote is never edited.
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
  INQUIRY_CHANGE_KEYS,
  inquirySnapshot,
} from "@/lib/audit/records/listing";
import { statusMove } from "@/lib/audit/records/shared";
import { listingFailure } from "@/lib/listings/api";
import { readInquiryBefore } from "@/lib/listings/audit";
import { updateInquiry } from "@/lib/listings/inquiries.service";
import { accessList } from "@/lib/listings/permissions";
import { inquiryUpdateSchema, issueLines } from "@/lib/listings/schemas";

export const PATCH = withPermissionAndDB(accessList("inquiries"))(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid inquiry ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) return createErrorResponse("Invalid request body", 400);

      const parsed = inquiryUpdateSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          issueLines(parsed.error).join(", "),
          400,
          undefined,
          "VALIDATION_ERROR",
        );
      }

      // The service answers with the inquiry after the change: read it first.
      const before = inquirySnapshot(await readInquiryBefore(id));
      const updated = await updateInquiry(user, id, parsed.data);
      const after = inquirySnapshot(updated);
      const move = statusMove(before, after);
      // Named by who wrote it; the entry says what the office did with it —
      // the status, who has it, the notes — never the visitor's own words.
      auditRecordChange({
        action: move ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
        recordType: "listing_inquiry",
        recordId: updated.id,
        recordName: updated.name,
        before,
        after,
        keys: INQUIRY_CHANGE_KEYS,
        messageParams: move ?? undefined,
        // A listing for a property not in the system has no unit or
        // building; its address (or district and city) says which it is.
        details: updated.listing.place
          ? { address: updated.listing.place }
          : {
              unitNumber: updated.listing.unitNumber,
              propertyName: updated.listing.propertyName,
            },
      });
      return createSuccessResponse(updated, "Inquiry updated successfully");
    } catch (error) {
      return listingFailure(error, "Failed to update the inquiry");
    }
  },
);
