/**
 * PropertyPro SaaS - Console inbox: contact messages
 *
 * The operator-side list behind /admin/inbox. Mirrors the tenant dashboard's
 * conversation list: newest first, unread surfaced, searchable, paginated.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  type AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";

const PAGE_SIZE_OPTIONS = [20, 50, 100];
const DEFAULT_PAGE_SIZE = 20;

const STATUSES = new Set(["new", "open", "replied", "closed"]);
const TOPICS = new Set(["support", "sales", "billing", "security"]);

/** The left-rail tabs. Archived is its own view so it never dilutes the queue. */
type View = "all" | "unread" | "starred" | "archived";

function buildFilter(params: URLSearchParams): Prisma.ContactMessageWhereInput {
  const view = (params.get("view") || "all") as View;
  const status = params.get("status") || "all";
  const topic = params.get("topic") || "all";
  const query = params.get("query")?.trim() || "";

  const filter: Prisma.ContactMessageWhereInput = {
    isArchived: view === "archived",
  };

  if (view === "unread") filter.isRead = false;
  if (view === "starred") filter.isStarred = true;
  if (STATUSES.has(status)) filter.status = status;
  if (TOPICS.has(topic)) filter.topic = topic;
  if (query) {
    filter.OR = [
      { name: { contains: query, mode: "insensitive" } },
      { email: { contains: query, mode: "insensitive" } },
      { company: { contains: query, mode: "insensitive" } },
      { subject: { contains: query, mode: "insensitive" } },
      { message: { contains: query, mode: "insensitive" } },
    ];
  }

  return filter;
}

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const params = request.nextUrl.searchParams;
      const requestedPage = Number.parseInt(params.get("page") || "1", 10);
      const page =
        Number.isFinite(requestedPage) && requestedPage > 0 ? requestedPage : 1;
      const requestedSize = Number.parseInt(
        params.get("pageSize") || String(DEFAULT_PAGE_SIZE),
        10,
      );
      const pageSize = PAGE_SIZE_OPTIONS.includes(requestedSize)
        ? requestedSize
        : DEFAULT_PAGE_SIZE;

      const filter = buildFilter(params);

      const [rows, total, unread, archived] = await Promise.all([
        bypassOrgScope(() =>
          db.contactMessage.findMany({
            where: filter,
            // Unread first, then newest: the queue reads the way it is worked.
            orderBy: [{ isRead: "asc" }, { createdAt: "desc" }],
            skip: (page - 1) * pageSize,
            take: pageSize,
            select: {
              id: true,
              topic: true,
              name: true,
              email: true,
              company: true,
              subject: true,
              message: true,
              status: true,
              isRead: true,
              isStarred: true,
              isArchived: true,
              lastReplyAt: true,
              createdAt: true,
              _count: { select: { replies: true } },
            },
          }),
        ),
        bypassOrgScope(() => db.contactMessage.count({ where: filter })),
        bypassOrgScope(() =>
          db.contactMessage.count({ where: { isRead: false, isArchived: false } }),
        ),
        bypassOrgScope(() => db.contactMessage.count({ where: { isArchived: true } })),
      ]);

      return createSuccessResponse({
        messages: rows.map(({ _count, message, ...row }) => ({
          ...row,
          // The list only needs a preview; the thread view fetches the rest.
          preview: message.length > 180 ? `${message.slice(0, 180)}…` : message,
          replyCount: _count.replies,
        })),
        counts: { unread, archived },
        pagination: {
          page,
          pageSize,
          total,
          totalPages: Math.max(1, Math.ceil(total / pageSize)),
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to load the inbox");
    }
  },
);
