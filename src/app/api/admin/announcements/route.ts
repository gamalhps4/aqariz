/**
 * PropertyPro SaaS - Platform announcements (operator side)
 *
 * Broadcast a notice to every tenant — a maintenance window, an incident, a
 * release note. Previously impossible: `Announcement` is org-scoped, so an
 * operator had no way to say anything to everyone at once.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { recordPlatformAudit } from "@/lib/platform/audit";

const announcementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(140),
  body: z.string().trim().min(1, "Message is required").max(4000),
  level: z.enum(["info", "warning", "critical"]).default("info"),
  // Null/absent means everyone; otherwise the notice is shown to one role.
  audience: z.string().trim().min(1).nullable().optional(),
  dismissible: z.boolean().default(true),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  linkLabel: z.string().trim().max(60).nullable().optional(),
  linkUrl: z.string().trim().url().max(500).nullable().optional(),
  publish: z.boolean().default(false),
});

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const announcements = await db.platformAnnouncement.findMany({
        orderBy: [{ publishedAt: "desc" }, { createdAt: "desc" }],
        take: 100,
      });
      const now = new Date();
      return createSuccessResponse(
        announcements.map((announcement) => ({
          ...announcement,
          // Three states an operator needs to tell apart at a glance.
          state: !announcement.publishedAt
            ? "draft"
            : announcement.endsAt && announcement.endsAt < now
              ? "ended"
              : announcement.startsAt && announcement.startsAt > now
                ? "scheduled"
                : "live",
        })),
      );
    } catch (error) {
      return handleApiError(error, "Failed to load announcements");
    }
  },
);

export const POST = withPlatformAdminAndDB()(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = announcementSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }
      const { publish, ...fields } = parsed.data;

      if (fields.startsAt && fields.endsAt && fields.endsAt <= fields.startsAt) {
        return createErrorResponse("The end time must be after the start", 400);
      }

      const announcement = await db.platformAnnouncement.create({
        data: {
          ...fields,
          audience: fields.audience ?? null,
          startsAt: fields.startsAt ? new Date(fields.startsAt) : null,
          endsAt: fields.endsAt ? new Date(fields.endsAt) : null,
          linkLabel: fields.linkLabel ?? null,
          linkUrl: fields.linkUrl ?? null,
          publishedAt: publish ? new Date() : null,
          createdById: user.id,
        },
      });

      await recordPlatformAudit({
        actor: user,
        action: "announcement.created",
        targetType: "announcement",
        targetId: announcement.id,
        targetName: announcement.title,
        summary: publish
          ? `Published announcement "${announcement.title}"`
          : `Drafted announcement "${announcement.title}"`,
        metadata: { level: announcement.level, audience: announcement.audience },
      });

      return createSuccessResponse(
        announcement,
        publish ? "Announcement published" : "Draft saved",
      );
    } catch (error) {
      return handleApiError(error, "Failed to create the announcement");
    }
  },
);
