/**
 * PropertyPro - What each permission group is called
 *
 * GET /api/roles/names → every group the organization has had, by its stored
 * name, with its label and Arabic name. Nothing else: not what it may do, not
 * who is in it.
 *
 * A user row carries a group's stored name — a key the server made, "group_2"
 * for one named in Arabic — and screens that list people printed that key.
 * Naming the group needs its labels, and GET /api/roles, which has them,
 * gives a caller without Manage roles only their own group, since it also
 * carries every group's permissions. A group's name is no secret among the
 * staff who see its members, so this answers every member of staff.
 *
 * Switched-off and archived groups are included: their members keep the name
 * on their user rows and are still listed under it.
 *
 * A static segment beside /api/roles/[id], so it answers before [id] would —
 * which is why the role screen addresses a group by its id, never its name.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";

export const GET = withAccessAndDB({
  roles: [UserRole.ADMIN, UserRole.MANAGER],
})(async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
  try {
    const rows = await db.role.findMany({
      where: { isSystem: false },
      select: {
        name: true,
        label: true,
        labelAr: true,
        isActive: true,
        deletedAt: true,
      },
      // The live group first where an archived one shares its name.
      orderBy: [{ deletedAt: { sort: "desc", nulls: "first" } }],
    });

    const seen = new Set<string>();
    const groups = rows
      .filter((row) => {
        if (seen.has(row.name)) return false;
        seen.add(row.name);
        return true;
      })
      .map((row) => ({
        name: row.name,
        label: row.label,
        labelAr: row.labelAr,
        isActive: row.isActive && !row.deletedAt,
      }));

    return createSuccessResponse({ groups });
  } catch (error) {
    return handleApiError(error, "Failed to load group names");
  }
});
