/**
 * PropertyPro - What the caller can hand an employee
 *
 * GET /api/users/assignable-buildings → the compounds and buildings the
 * caller may assign, for the new-employee form, which has no employee yet to
 * ask /api/users/[id]/building-scope about. The same list that route offers,
 * from the same rules (lib/building-assignment.ts).
 *
 * `mustRestrict` is true when the caller is limited to some buildings
 * themselves: whoever they add must be limited to buildings of theirs.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { USER_CREATE_PERMISSIONS } from "@/lib/permissions-manager";
import { loadAssignable } from "@/lib/building-assignment";

export const GET = withPermissionAndDB([
  ...USER_CREATE_PERMISSIONS,
  "role_management",
])(async (user: AuthenticatedAccessUser, _request: NextRequest) => {
  try {
    const assignable = await loadAssignable(user);
    return createSuccessResponse({
      assignable,
      mustRestrict: user.scopedPropertyIds !== undefined,
    });
  } catch (error) {
    return handleApiError(error, "Failed to load assignable buildings");
  }
});
