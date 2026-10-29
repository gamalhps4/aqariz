/**
 * PropertyPro SaaS - Platform announcement actions
 *
 * PATCH publishes, unpublishes or edits; DELETE removes. Unpublishing is kept
 * distinct from deleting because pulling a notice down in a hurry should not
 * also destroy what it said.
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

const patchSchema = z.object({
  title: z.string().trim().min(1).max(140).optional(),
  body: z.string().trim().min(1).max(4000).optional(),
  level: z.enum(["info", "warning", "critical"]).optional(),
  audience: z.string().trim().min(1).nullable().optional(),
  dismissible: z.boolean().optional(),
  startsAt: z.string().datetime().nullable().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  linkLabel: z.string().trim().max(60).nullable().optional(),
  linkUrl: z.string().trim().url().max(500).nullable().optional(),
  published: z.boolean().optional(),
});

export const PATCH = withPlatformAdminAndDB()(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = patchSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const existing = await db.platformAnnouncement.findFirst({
        where: { id },
      });
      if (!existing) {
        return createErrorResponse("Announcement not found", 404);
      }

      const { published, startsAt, endsAt, ...rest } = parsed.data;
      const data: Record<string, unknown> = { ...rest };

      if (startsAt !== undefined) {
        data.startsAt = startsAt ? new Date(startsAt) : null;
      }
      if (endsAt !== undefined) {
        data.endsAt = endsAt ? new Date(endsAt) : null;
      }
      if (published !== undefined) {
        // Re-publishing stamps a fresh date so "when did this go out" stays
        // honest.
        data.publishedAt = published ? new Date() : null;
      }

      const announcement = await db.platformAnnouncement.update({
        where: { id },
        data,
      });

      await recordPlatformAudit({
        actor: user,
        action: "announcement.updated",
        targetType: "announcement",
        targetId: announcement.id,
        targetName: announcement.title,
        summary:
          published === undefined
            ? `Edited announcement "${announcement.title}"`
            : published
              ? `Published announcement "${announcement.title}"`
              : `Unpublished announcement "${announcement.title}"`,
      });

      return createSuccessResponse(announcement, "Announcement updated");
    } catch (error) {
      return handleApiError(error, "Failed to update the announcement");
    }
  },
);

export const DELETE = withPlatformAdminAndDB()(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;
      const existing = await db.platformAnnouncement.findFirst({
        where: { id },
        select: { id: true, title: true },
      });
      if (!existing) {
        return createErrorResponse("Announcement not found", 404);
      }

      await db.platformAnnouncement.delete({ where: { id } });

      await recordPlatformAudit({
        actor: user,
        action: "announcement.deleted",
        targetType: "announcement",
        targetId: existing.id,
        targetName: existing.title,
        summary: `Deleted announcement "${existing.title}"`,
      });

      return createSuccessResponse({ id }, "Announcement deleted");
    } catch (error) {
      return handleApiError(error, "Failed to delete the announcement");
    }
  },
);
