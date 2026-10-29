import { z } from "zod";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import { UserRole } from "@/types";
export const dynamic = "force-dynamic";
import { db } from "@/lib/db/prisma";
import type { Announcement, Prisma } from "@/generated/prisma/client";
import { NextRequest } from "next/server";
import { messagingService } from "@/lib/services/messaging.service";
import {
  buildAnnouncementVisibilityFilter,
  mergeInboxFilters,
} from "@/lib/inbox-visibility";
import { businessDayEnd, businessDayStart, parseBusinessDay } from "@/lib/dates/business-day";

// ============================================================================
// VALIDATION SCHEMAS
// ============================================================================

const createAnnouncementSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long"),
  content: z
    .string()
    .min(1, "Content is required")
    .max(5000, "Content too long"),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  type: z
    .enum(["general", "maintenance", "policy", "emergency", "event", "system"])
    .default("general"),
  targetAudience: z.object({
    roles: z.array(z.nativeEnum(UserRole)).optional(),
    propertyIds: z.array(z.string()).optional(),
    userIds: z.array(z.string()).optional(),
    tenantIds: z.array(z.string()).optional(),
    includeAll: z.boolean().default(false),
  }),
  scheduledFor: z
    .string()
    .transform((str) => new Date(str))
    .optional(),
  expiresAt: z
    .string()
    .transform((str) => new Date(str))
    .optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string(),
        fileUrl: z.string(),
        fileSize: z.number(),
        fileType: z.string(),
      }),
    )
    .default([]),
  actionButton: z
    .object({
      text: z.string().max(50),
      url: z.string(),
    })
    .optional(),
  isSticky: z.boolean().default(false),
  allowComments: z.boolean().default(true),
});

const querySchema = z.object({
  status: z
    .enum(["draft", "scheduled", "published", "expired", "archived"])
    .optional(),
  type: z
    .enum(["general", "maintenance", "policy", "emergency", "event", "system"])
    .optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  activeOnly: z.coerce.boolean().default(false),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

const ANNOUNCEMENT_ORDER_BY: Prisma.AnnouncementOrderByWithRelationInput[] = [
  { isSticky: "desc" },
  { publishedAt: { sort: "desc", nulls: "last" } },
  { createdAt: "desc" },
];

/**
 * Rebuild the populated response shape the Mongoose routes returned:
 * `createdBy` becomes the creator document and the ids inside
 * `targetAudience.propertyIds` become `{ name, address }` documents.
 */
export async function serializeAnnouncements(
  announcements: Announcement[],
): Promise<Record<string, unknown>[]> {
  const userIds = new Set<string>();
  const propertyIds = new Set<string>();

  for (const announcement of announcements) {
    if (announcement.createdById) userIds.add(announcement.createdById);
    const audience =
      announcement.targetAudience &&
      typeof announcement.targetAudience === "object" &&
      !Array.isArray(announcement.targetAudience)
        ? (announcement.targetAudience as Record<string, unknown>)
        : {};
    if (Array.isArray(audience.propertyIds)) {
      for (const id of audience.propertyIds) {
        if (typeof id === "string" && id) propertyIds.add(id);
      }
    }
  }

  const [users, properties] = await Promise.all([
    userIds.size > 0
      ? db.user.findMany({
          where: { id: { in: [...userIds] } },
          select: { id: true, firstName: true, lastName: true, email: true },
        })
      : Promise.resolve([]),
    propertyIds.size > 0
      ? db.property.findMany({
          where: { id: { in: [...propertyIds] } },
          select: {
            id: true,
            name: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
            addressCountry: true,
          },
        })
      : Promise.resolve([]),
  ]);

  const userMap = new Map(users.map((u) => [u.id, u]));
  const propertyMap = new Map(
    properties.map((p) => [
      p.id,
      {
        id: p.id,
        name: p.name,
        address: {
          street: p.addressStreet,
          city: p.addressCity,
          state: p.addressState,
          zipCode: p.addressZipCode,
          country: p.addressCountry,
        },
      },
    ]),
  );

  return announcements.map((announcement) => {
    const audience =
      announcement.targetAudience &&
      typeof announcement.targetAudience === "object" &&
      !Array.isArray(announcement.targetAudience)
        ? (announcement.targetAudience as Record<string, unknown>)
        : {};

    const populatedPropertyIds = Array.isArray(audience.propertyIds)
      ? audience.propertyIds.map((id: unknown) =>
          typeof id === "string" ? propertyMap.get(id) ?? id : id,
        )
      : audience.propertyIds;

    return {
      ...announcement,
      createdBy:
        userMap.get(announcement.createdById) ?? announcement.createdById,
      targetAudience: { ...audience, propertyIds: populatedPropertyIds },
    };
  });
}

// ============================================================================
// GET /api/announcements - Get announcements
// ============================================================================
export const GET = withPermissionAndDB("profile_management")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  context?: { tenantProfile?: any },
) => {
  try {
    const { searchParams } = new URL(request.url);
    const queryParams = Object.fromEntries(searchParams.entries());

    // Validate query parameters
    const validation = querySchema.safeParse(queryParams);
    if (!validation.success) {
      return createErrorResponse(
        `Invalid query parameters: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const {
      status,
      type,
      priority,
      activeOnly,
      page,
      limit,
      search,
      from,
      to,
    } = validation.data;

    const queryClauses: Record<string, any>[] = [];
    const forceAudienceScope = activeOnly || !user.isCompanyStaff;

    let visibility: Awaited<
      ReturnType<typeof buildAnnouncementVisibilityFilter>
    > | null = null;

    if (forceAudienceScope) {
      visibility = await buildAnnouncementVisibilityFilter(
        user,
        context?.tenantProfile,
        { activeOnly: true },
      );
      queryClauses.push(visibility.where);
    } else {
      queryClauses.push({ deletedAt: null });
    }

    // Admin/Manager view - all announcements with filtering
    if (status && !forceAudienceScope) queryClauses.push({ status });
    if (type) queryClauses.push({ type });
    if (priority) queryClauses.push({ priority });

    // Text search
    if (search?.trim()) {
      const term = search.trim();
      queryClauses.push({
        OR: [
          { title: { contains: term, mode: "insensitive" } },
          { content: { contains: term, mode: "insensitive" } },
        ],
      });
    }

    // Date range filter (createdAt)
    if (from || to) {
      const dateQuery: Record<string, Date> = {};

      // Whole days on the office's calendar (Riyadh).
      const fromDay = parseBusinessDay(from);
      if (fromDay) dateQuery.gte = businessDayStart(fromDay);

      const toDay = parseBusinessDay(to);
      if (toDay) dateQuery.lte = businessDayEnd(toDay);

      if (Object.keys(dateQuery).length > 0) {
        queryClauses.push({ createdAt: dateQuery });
      }
    }

    const where = mergeInboxFilters(
      ...queryClauses,
    ) as Prisma.AnnouncementWhereInput;

    // Execute query with pagination. Audience targeting lives in the
    // targetAudience Json, so restricted callers filter in JS before slicing.
    const skip = (page - 1) * limit;

    let rows: Announcement[];
    let total: number;

    if (visibility?.isRestricted) {
      const allRows = await db.announcement.findMany({
        where,
        orderBy: ANNOUNCEMENT_ORDER_BY,
      });
      const visible = allRows.filter((announcement) =>
        visibility!.matches(announcement),
      );
      total = visible.length;
      rows = visible.slice(skip, skip + limit);
    } else {
      [rows, total] = await Promise.all([
        db.announcement.findMany({
          where,
          orderBy: ANNOUNCEMENT_ORDER_BY,
          skip,
          take: limit,
        }),
        db.announcement.count({ where }),
      ]);
    }

    const announcements = await serializeAnnouncements(rows);

    return createSuccessResponse(
      {
        announcements,
        total,
        page,
        totalPages: Math.ceil(total / limit),
      },
      "Announcements retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/announcements - Create announcement
// ============================================================================
export const POST = withPermissionAndDB("company_settings")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error ?? "Invalid request body", 400);
    }

    // Validate request body
    const validation = createAnnouncementSchema.safeParse(body);
    if (!validation.success) {
      console.error(
        "❌ Announcement validation failed:",
        validation.error.errors,
      );
      return createErrorResponse(
        `Validation failed: ${validation.error.errors
          .map((e) => e.message)
          .join(", ")}`,
        400,
      );
    }

    const announcementData = validation.data;

    // Validate target audience
    if (!announcementData?.targetAudience?.includeAll) {
      const hasTargets =
        (announcementData.targetAudience.roles &&
          announcementData.targetAudience.roles.length > 0) ||
        (announcementData.targetAudience.propertyIds &&
          announcementData.targetAudience.propertyIds.length > 0) ||
        (announcementData.targetAudience.userIds &&
          announcementData.targetAudience.userIds.length > 0) ||
        (announcementData.targetAudience.tenantIds &&
          announcementData.targetAudience.tenantIds.length > 0);

      if (!hasTargets) {
        return createErrorResponse(
          "Target audience must be specified or includeAll must be true",
          400,
        );
      }
    }

    // Create the announcement
    const announcement = await messagingService.createAnnouncement(
      announcementData,
      user.id,
    );

    return createSuccessResponse(
      announcement,
      "Announcement created successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// Helper functions for announcement management
// ============================================================================

export async function getAnnouncementsForUser(
  userId: string,
  userRole: UserRole,
  propertyIds: string[] = [],
  limit: number = 10,
) {
  try {
    // Active announcements: published, inside the schedule/expiry window
    const now = new Date();
    const rows = await db.announcement.findMany({
      where: {
        deletedAt: null,
        status: "published",
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
          { OR: [{ scheduledFor: null }, { scheduledFor: { lte: now } }] },
        ],
      },
      orderBy: [
        { isSticky: "desc" },
        { publishedAt: { sort: "desc", nulls: "last" } },
      ],
    });

    // Targeting lives in the targetAudience Json — filter in JS
    const targeted = rows.filter((announcement) => {
      const audience =
        announcement.targetAudience &&
        typeof announcement.targetAudience === "object" &&
        !Array.isArray(announcement.targetAudience)
          ? (announcement.targetAudience as Record<string, any>)
          : {};

      if (audience.includeAll === true) return true;

      const roles = Array.isArray(audience.roles)
        ? audience.roles.map(String)
        : [];
      if (roles.includes(String(userRole))) return true;

      const userIds = Array.isArray(audience.userIds)
        ? audience.userIds.map(String)
        : [];
      if (userIds.includes(userId)) return true;

      const audiencePropertyIds = Array.isArray(audience.propertyIds)
        ? audience.propertyIds.map(String)
        : [];
      if (
        propertyIds.length > 0 &&
        audiencePropertyIds.some((id) => propertyIds.includes(id))
      ) {
        return true;
      }

      return false;
    });

    const announcements = await serializeAnnouncements(targeted);

    return {
      success: true,
      announcements: announcements.slice(0, limit),
    };
  } catch (error) {
    console.error("Failed to get announcements for user:", error);
    return {
      success: false,
      announcements: [],
    };
  }
}

export async function markAnnouncementAsViewed(
  announcementId: string,
  userId: string,
  ipAddress?: string,
) {
  try {
    const announcement = await db.announcement.findFirst({
      where: { id: announcementId, deletedAt: null },
    });
    if (!announcement) {
      return { success: false, error: "Announcement not found" };
    }

    const views = Array.isArray(announcement.views)
      ? (announcement.views as Array<Record<string, unknown>>)
      : [];

    // Only record the first view per user
    const alreadyViewed = views.some(
      (view) => view && String(view.userId) === userId,
    );

    if (!alreadyViewed) {
      await db.announcement.update({
        where: { id: announcementId },
        data: {
          views: [
            ...views,
            { userId, viewedAt: new Date().toISOString(), ipAddress },
          ] as Prisma.InputJsonValue,
        },
      });
    }

    return { success: true };
  } catch (error) {
    console.error("Failed to mark announcement as viewed:", error);
    return { success: false, error: "Failed to update view" };
  }
}

export async function addAnnouncementReaction(
  announcementId: string,
  userId: string,
  reactionType: "like" | "love" | "helpful" | "important",
) {
  try {
    const announcement = await db.announcement.findFirst({
      where: { id: announcementId, deletedAt: null },
    });
    if (!announcement) {
      return { success: false, error: "Announcement not found" };
    }

    const reactions = Array.isArray(announcement.reactions)
      ? (announcement.reactions as Array<Record<string, unknown>>)
      : [];

    // Replace any existing reaction from this user
    const withoutUser = reactions.filter(
      (reaction) => !reaction || String(reaction.userId) !== userId,
    );

    await db.announcement.update({
      where: { id: announcementId },
      data: {
        reactions: [
          ...withoutUser,
          { userId, type: reactionType, createdAt: new Date().toISOString() },
        ] as Prisma.InputJsonValue,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to add announcement reaction:", error);
    return { success: false, error: "Failed to add reaction" };
  }
}

export async function removeAnnouncementReaction(
  announcementId: string,
  userId: string,
) {
  try {
    const announcement = await db.announcement.findFirst({
      where: { id: announcementId, deletedAt: null },
    });
    if (!announcement) {
      return { success: false, error: "Announcement not found" };
    }

    const reactions = Array.isArray(announcement.reactions)
      ? (announcement.reactions as Array<Record<string, unknown>>)
      : [];

    await db.announcement.update({
      where: { id: announcementId },
      data: {
        reactions: reactions.filter(
          (reaction) => !reaction || String(reaction.userId) !== userId,
        ) as Prisma.InputJsonValue,
      },
    });

    return { success: true };
  } catch (error) {
    console.error("Failed to remove announcement reaction:", error);
    return { success: false, error: "Failed to remove reaction" };
  }
}
