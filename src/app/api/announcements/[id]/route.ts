/**
 * PropertyPro - Announcement Detail API
 * Provides detailed announcement data, view tracking, and reactions
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Announcement, Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  parseRequestBody,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  addAnnouncementReaction,
  markAnnouncementAsViewed,
  removeAnnouncementReaction,
  serializeAnnouncements,
} from "../route";
import {
  buildAnnouncementVisibilityFilter,
  mergeInboxFilters,
} from "@/lib/inbox-visibility";

function extractClientIp(request: NextRequest) {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim();
  }
  return request.headers.get("x-real-ip") ?? undefined;
}

/** Old Mongoose virtuals, computed from the Json columns. */
function announcementVirtuals(announcement: Announcement) {
  const views = Array.isArray(announcement.views)
    ? (announcement.views as Array<Record<string, unknown>>)
    : [];
  const reactions = Array.isArray(announcement.reactions)
    ? (announcement.reactions as Array<Record<string, unknown>>)
    : [];

  const reactionCounts = {
    like: 0,
    love: 0,
    helpful: 0,
    important: 0,
    total: 0,
  };
  for (const reaction of reactions) {
    const reactionType = reaction?.type as keyof typeof reactionCounts;
    if (reactionType && reactionType in reactionCounts) {
      reactionCounts[reactionType]++;
      reactionCounts.total++;
    }
  }

  const now = new Date();
  const isActive =
    announcement.status === "published" &&
    (!announcement.expiresAt || announcement.expiresAt > now) &&
    (!announcement.scheduledFor || announcement.scheduledFor <= now);
  const isExpired = Boolean(
    announcement.expiresAt && announcement.expiresAt < now,
  );

  return { viewCount: views.length, reactionCounts, isActive, isExpired };
}

async function loadAnnouncement(
  id: string,
  user: AuthenticatedAccessUser,
  tenantProfile?: any
) {
  const visibility = await buildAnnouncementVisibilityFilter(
    user,
    tenantProfile,
    { activeOnly: !user.isCompanyStaff }
  );
  const document = await db.announcement.findFirst({
    where: mergeInboxFilters(
      { id },
      visibility.where
    ) as Prisma.AnnouncementWhereInput,
  });

  if (!document || !visibility.matches(document)) {
    return null;
  }

  const [announcementObject] = await serializeAnnouncements([document]);

  const reactions = Array.isArray(document.reactions)
    ? (document.reactions as Array<Record<string, unknown>>)
    : [];
  const views = Array.isArray(document.views)
    ? (document.views as Array<Record<string, unknown>>)
    : [];

  const userReaction = reactions.find(
    (reaction) => reaction && String(reaction.userId) === user.id
  )?.type;
  const userHasViewed = views.some(
    (view) => view && String(view.userId) === user.id
  );

  return {
    ...announcementObject,
    ...announcementVirtuals(document),
    id: document.id,
    userReaction: userReaction ?? null,
    userHasViewed,
  };
}

export const GET = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    {
      params,
      tenantProfile,
    }: { params: Promise<{ id: string }>; tenantProfile?: any }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid announcement ID", 400);
      }

      const url = new URL(request.url);
      const trackView = url.searchParams.get("trackView") !== "false";

      let announcement = await loadAnnouncement(id, user, tenantProfile);
      if (!announcement) {
        return createErrorResponse("Announcement not found", 404);
      }

      if (trackView) {
        const ipAddress = extractClientIp(request);
        await markAnnouncementAsViewed(id, user.id, ipAddress);
        announcement = await loadAnnouncement(id, user, tenantProfile);
      }

      return createSuccessResponse(
        { announcement },
        "Announcement retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

export const POST = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    {
      params,
      tenantProfile,
    }: { params: Promise<{ id: string }>; tenantProfile?: any }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid announcement ID", 400);
      }

      const { success, data, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error ?? "Invalid request body", 400);
      }

      const action = data?.action ?? "reaction";
      const visibleAnnouncement = await loadAnnouncement(
        id,
        user,
        tenantProfile
      );
      if (!visibleAnnouncement) {
        return createErrorResponse("Announcement not found", 404);
      }

      switch (action) {
        case "reaction": {
          const reactionType = data?.reactionType;
          if (
            !["like", "love", "helpful", "important"].includes(reactionType)
          ) {
            return createErrorResponse("Invalid reaction type", 400);
          }

          const result = await addAnnouncementReaction(
            id,
            user.id,
            reactionType
          );
          if (!result.success) {
            return createErrorResponse(
              result.error || "Failed to record reaction",
              400
            );
          }
          break;
        }
        case "markViewed": {
          const ipAddress = extractClientIp(request);
          const result = await markAnnouncementAsViewed(id, user.id, ipAddress);
          if (!result.success) {
            return createErrorResponse(
              result.error || "Failed to update view",
              400
            );
          }
          break;
        }
        default:
          return createErrorResponse("Unsupported action", 400);
      }

      const announcement = await loadAnnouncement(id, user, tenantProfile);
      if (!announcement) {
        return createErrorResponse("Announcement not found", 404);
      }

      return createSuccessResponse(
        { announcement },
        action === "reaction"
          ? "Reaction updated successfully"
          : "Announcement marked as viewed"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

export const PUT = withPermissionAndDB("company_settings")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid announcement ID", 400);
      }

      const { success, data, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error ?? "Invalid request body", 400);
      }

      const action = data?.action ?? "update";

      const doc = await db.announcement.findFirst({
        where: { id, deletedAt: null },
      });
      if (!doc) {
        return createErrorResponse("Announcement not found", 404);
      }

      switch (action) {
        case "update": {
          const updates: Record<string, unknown> = { updatedById: user.id };

          if (data.title) updates.title = data.title;
          if (data.content) updates.content = data.content;
          if (data.priority) updates.priority = data.priority;
          if (data.type) updates.type = data.type;
          if (data.targetAudience)
            updates.targetAudience = data.targetAudience;
          if (data.scheduledFor !== undefined)
            updates.scheduledFor = data.scheduledFor
              ? new Date(data.scheduledFor)
              : null;
          if (data.expiresAt !== undefined)
            updates.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
          if (typeof data.isSticky === "boolean")
            updates.isSticky = data.isSticky;
          if (typeof data.allowComments === "boolean")
            updates.allowComments = data.allowComments;

          // Mirror the old pre-save hook status transitions
          const now = new Date();
          const nextScheduledFor =
            updates.scheduledFor !== undefined
              ? (updates.scheduledFor as Date | null)
              : doc.scheduledFor;
          const nextExpiresAt =
            updates.expiresAt !== undefined
              ? (updates.expiresAt as Date | null)
              : doc.expiresAt;

          let nextStatus = doc.status;
          let nextPublishedAt = doc.publishedAt;
          if (
            nextStatus === "scheduled" &&
            nextScheduledFor &&
            nextScheduledFor <= now
          ) {
            nextStatus = "published";
            nextPublishedAt = now;
          }
          if (nextStatus === "published" && nextExpiresAt && nextExpiresAt <= now) {
            nextStatus = "expired";
          }
          if (nextStatus !== doc.status) updates.status = nextStatus;
          if (nextPublishedAt !== doc.publishedAt)
            updates.publishedAt = nextPublishedAt;

          await db.announcement.update({
            where: { id },
            data: updates as Prisma.AnnouncementUpdateInput,
          });
          break;
        }
        case "archive": {
          await db.announcement.update({
            where: { id },
            data: { status: "archived", updatedById: user.id },
          });
          break;
        }
        case "publish": {
          await db.announcement.update({
            where: { id },
            data: {
              status: "published",
              publishedAt: new Date(),
              updatedById: user.id,
            },
          });
          break;
        }
        case "softDelete": {
          await db.announcement.update({
            where: { id },
            data: { deletedAt: new Date(), updatedById: user.id },
          });
          break;
        }
        default:
          return createErrorResponse("Unsupported action", 400);
      }

      const announcement = await loadAnnouncement(id, user);

      return createSuccessResponse(
        { announcement },
        `Announcement ${action === "softDelete" ? "deleted" : action === "archive" ? "archived" : "updated"} successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

export const DELETE = withPermissionAndDB("profile_management")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    {
      params,
      tenantProfile,
    }: { params: Promise<{ id: string }>; tenantProfile?: any }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid announcement ID", 400);
      }

      const url = new URL(request.url);
      const action = url.searchParams.get("action") ?? "reaction";
      const visibleAnnouncement = await loadAnnouncement(
        id,
        user,
        tenantProfile
      );
      if (!visibleAnnouncement) {
        return createErrorResponse("Announcement not found", 404);
      }

      switch (action) {
        case "reaction": {
          const result = await removeAnnouncementReaction(id, user.id);
          if (!result.success) {
            return createErrorResponse(
              result.error || "Failed to remove reaction",
              400
            );
          }
          break;
        }
        default:
          return createErrorResponse("Unsupported action", 400);
      }

      const announcement = await loadAnnouncement(id, user, tenantProfile);
      if (!announcement) {
        return createErrorResponse("Announcement not found", 404);
      }

      return createSuccessResponse(
        { announcement },
        "Reaction removed successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
