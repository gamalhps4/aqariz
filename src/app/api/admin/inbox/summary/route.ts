/**
 * PropertyPro SaaS - Console inbox counts
 *
 * Feeds the sidebar badge, so it stays deliberately cheap: two counts, no rows.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const [unreadMessages, draftAnnouncements] = await Promise.all([
        bypassOrgScope(() =>
          db.contactMessage.count({ where: { isRead: false, isArchived: false } }),
        ),
        bypassOrgScope(() =>
          db.platformAnnouncement.count({ where: { publishedAt: null } }),
        ),
      ]);

      return createSuccessResponse({
        unreadMessages,
        draftAnnouncements,
        inbox: unreadMessages,
      });
    } catch (error) {
      return handleApiError(error, "Failed to load inbox counts");
    }
  },
);
