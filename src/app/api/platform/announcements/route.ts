/**
 * PropertyPro SaaS - Platform announcements (tenant side)
 *
 * The notices the calling user should see right now: published, inside their
 * window, and addressed to everyone or to their role. `platform_announcements`
 * is a read-all global catalog under RLS, so this needs no bypass.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const now = new Date();
      const announcements = await db.platformAnnouncement.findMany({
        where: {
          publishedAt: { not: null, lte: now },
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          AND: [{ OR: [{ endsAt: null }, { endsAt: { gte: now } }] }],
          // Audience is filtered in memory below: the set is tiny (take: 10)
          // and a third OR group here would fight the two above.
        },
        orderBy: [{ level: "asc" }, { publishedAt: "desc" }],
        take: 10,
      });

      return createSuccessResponse(
        announcements
          .filter(
            (announcement) =>
              !announcement.audience || announcement.audience === user.role,
          )
          .map((announcement) => ({
            id: announcement.id,
            title: announcement.title,
            body: announcement.body,
            level: announcement.level,
            dismissible: announcement.dismissible,
            linkLabel: announcement.linkLabel,
            linkUrl: announcement.linkUrl,
            publishedAt: announcement.publishedAt,
          })),
      );
    } catch (error) {
      return handleApiError(error, "Failed to load announcements");
    }
  },
);
