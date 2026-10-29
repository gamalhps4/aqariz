/**
 * PropertyPro SaaS - Impersonation status
 *
 * Feeds the support banner. Exempt from the read-only guard by being a GET,
 * and from the verification gate because it lives under /api/auth.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { db } from "@/lib/db/prisma";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      if (!user.impersonatedBy) {
        return createSuccessResponse({ impersonating: false });
      }

      const [organization, profile] = await Promise.all([
        db.organization.findFirst({
          where: { id: user.organizationId! },
          select: { name: true },
        }),
        db.user.findFirst({
          where: { id: user.id },
          select: { role: true, phone: true, avatar: true },
        }),
      ]);

      return createSuccessResponse({
        impersonating: true,
        email: user.email,
        organizationName: organization?.name ?? null,
        operatorEmail: user.impersonatedBy.email,
        // The customer as the browser's session hook models a user: Better
        // Auth's own get-session keeps answering with the operator, whom the
        // dashboard would send back to /admin. See lib/auth-client.
        user: {
          id: user.id,
          email: user.email,
          role: profile?.role ?? user.originalRole,
          isActive: true,
          organizationId: user.organizationId,
          firstName: user.firstName,
          lastName: user.lastName,
          phone: profile?.phone ?? undefined,
          avatar: profile?.avatar ?? undefined,
          image: profile?.avatar ?? undefined,
          name:
            [user.firstName, user.lastName].filter(Boolean).join(" ") ||
            undefined,
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to read impersonation status");
    }
  },
);
