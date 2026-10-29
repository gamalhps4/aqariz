/**
 * PropertyPro - Conversation Contacts API
 * Returns active users available to add to conversations
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  withPermissionAndDB,
  createErrorResponse,
  createSuccessResponse,
} from "@/lib/api-utils";
import { tenantRecordScope } from "@/lib/db/scopes";
import {
  contactRoleWhere,
  roleList,
  visibleContactRoles,
} from "@/lib/conversation-contacts";

export const GET = withPermissionAndDB("profile_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const search = searchParams.get("search")?.trim() ?? "";
      const limit = Math.min(
        Number.parseInt(searchParams.get("limit") ?? "50", 10) || 50,
        200
      );

      // The roles asked for, cut down to the ones this caller may see; a
      // building-limited employee's tenants are those of their buildings.
      const roleWhere = contactRoleWhere({
        visible: visibleContactRoles(user),
        requested: roleList(searchParams.get("roles")),
        excluded: roleList(searchParams.get("excludeRoles")),
        tenantScope: tenantRecordScope(user),
      });

      const where: Prisma.UserWhereInput = {
        id: { not: user.id },
        isActive: true,
        deletedAt: null,
        AND: [
          roleWhere as Prisma.UserWhereInput,
          ...(search
            ? [
                {
                  OR: [
                    { firstName: { contains: search, mode: "insensitive" } },
                    { lastName: { contains: search, mode: "insensitive" } },
                    { email: { contains: search, mode: "insensitive" } },
                  ],
                } satisfies Prisma.UserWhereInput,
              ]
            : []),
        ],
      };

      const users = await db.user.findMany({
        where,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          role: true,
          avatar: true,
          isActive: true,
        },
        orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
        take: limit,
      });

      const formatted = users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
        role: u.role,
        avatar: u.avatar ?? null,
        isActive: u.isActive,
      }));

      return createSuccessResponse({
        users: formatted,
        total: formatted.length,
      });
    } catch (error) {
      console.error("Failed to fetch conversation contacts:", error);
      return createErrorResponse("Failed to fetch contacts", 500);
    }
  }
);
