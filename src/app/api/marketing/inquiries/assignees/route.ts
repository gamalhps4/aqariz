/**
 * PropertyPro - Who an inquiry can be handed to
 *
 * The office's own staff whose role carries the inbox right — what the
 * assignee picker lists. Its own route because the people list belongs to the
 * Employees screen's right (View users), which an inbox worker may not hold.
 */

export const dynamic = "force-dynamic";

import {
  createSuccessResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { listingFailure } from "@/lib/listings/api";
import { assignableStaff } from "@/lib/listings/inquiries.service";
import { accessList } from "@/lib/listings/permissions";

export const GET = withPermissionAndDB(accessList("inquiries"))(async () => {
  try {
    const staff = await assignableStaff();
    return createSuccessResponse(staff, "Staff retrieved successfully");
  } catch (error) {
    return listingFailure(error, "Failed to retrieve the staff");
  }
});
