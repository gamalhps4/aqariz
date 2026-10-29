/**
 * PropertyPro - Ticket Comments API Routes
 * GET, POST operations for ticket comments
 */

import crypto from "crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { ticketAllows, ticketIdentityIds } from "@/lib/db/scopes";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  isValidObjectId,
  withAccessAndDB,
} from "@/lib/api-utils";
import { ticketCommentSchema, validateSchema } from "@/lib/validations";

const TICKET_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "maintenance_view",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const TICKET_WRITE_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: [
    "maintenance_create",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

async function populateCommentUsers(comments: unknown) {
  const list = Array.isArray(comments) ? (comments as any[]) : [];
  const userIds = [
    ...new Set(
      list
        .map((comment) => comment?.userId)
        .filter((id): id is string => typeof id === "string")
    ),
  ];
  if (userIds.length === 0) return list;
  const users = await db.user.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      avatar: true,
      role: true,
    },
  });
  const userMap = new Map(users.map((row) => [row.id, row]));
  return list.map((comment) => ({
    ...comment,
    userId:
      typeof comment?.userId === "string"
        ? userMap.get(comment.userId) ?? comment.userId
        : comment?.userId,
  }));
}

// ============================================================================
// GET /api/tickets/[id]/comments - Get ticket comments
// ============================================================================

export const GET = withAccessAndDB(TICKET_READ_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  {
    params,
    tenantProfile,
  }: { params: Promise<{ id: string }>; tenantProfile?: any },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid ticket ID", 400);
    }

    const ticket = await db.ticket.findFirst({
      where: { id },
      select: { comments: true, tenantId: true },
    });

    if (!ticket) {
      return createErrorResponse("Ticket not found", 404);
    }

    if (!ticketAllows(user, ticketIdentityIds(user, tenantProfile), ticket)) {
      return createErrorResponse("Forbidden", 403);
    }

    let comments = await populateCommentUsers(ticket.comments);
    if (user.isTenant) {
      comments = comments.filter((comment: any) => !comment.isInternal);
    }

    return createSuccessResponse(comments, "Comments fetched successfully");
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/tickets/[id]/comments - Add comment to ticket
// ============================================================================

export const POST = withAccessAndDB(TICKET_WRITE_ACCESS)(async (
  user: AuthenticatedAccessUser,
  request: NextRequest,
  {
    params,
    tenantProfile,
  }: { params: Promise<{ id: string }>; tenantProfile?: any },
) => {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid ticket ID", 400);
    }

    const ticket = await db.ticket.findFirst({ where: { id } });
    if (!ticket) {
      return createErrorResponse("Ticket not found", 404);
    }

    if (!ticketAllows(user, ticketIdentityIds(user, tenantProfile), ticket)) {
      return createErrorResponse("Forbidden", 403);
    }

    const body = await parseRequestBody(request);
    if (!body.success) {
      return createErrorResponse(body.error ?? "Invalid request body", 400);
    }

    const validation = validateSchema(ticketCommentSchema, body.data);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const commentData = validation.data;
    if (user.isTenant) {
      commentData.isInternal = false;
    }

    const existingComments = Array.isArray(ticket.comments)
      ? (ticket.comments as any[])
      : [];

    const newComment = {
      id: crypto.randomUUID(),
      userId: user.id,
      message: commentData.message,
      attachments: commentData.attachments ?? [],
      isInternal: commentData.isInternal ?? false,
      createdAt: new Date().toISOString(),
    };

    const updated = await db.ticket.update({
      where: { id },
      data: { comments: [...existingComments, newComment] },
      select: { comments: true },
    });

    const populated = await populateCommentUsers(updated.comments);
    const latestComment =
      populated[Math.max(populated.length - 1, 0)] ?? null;

    return createSuccessResponse(latestComment, "Comment added successfully");
  } catch (error) {
    return handleApiError(error);
  }
});
