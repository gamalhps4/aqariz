/**
 * PropertyPro SaaS - Console inbox: one contact thread
 *
 * GET returns the message with its reply history; PATCH is the triage surface
 * (read, star, archive, status); DELETE removes the thread for good.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { recordPlatformAudit } from "@/lib/platform/audit";

const patchSchema = z.object({
  isRead: z.boolean().optional(),
  isStarred: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  status: z.enum(["new", "open", "replied", "closed"]).optional(),
});

const THREAD_SELECT = {
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
  submittedById: true,
  createdAt: true,
  replies: {
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      body: true,
      authorId: true,
      authorName: true,
      authorEmail: true,
      emailSent: true,
      emailError: true,
      createdAt: true,
    },
  },
} satisfies Prisma.ContactMessageSelect;

export const GET = withPlatformAdminAndDB()(
  async (
    _user: AuthenticatedAccessUser,
    _request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;
      const message = await bypassOrgScope(() =>
        db.contactMessage.findFirst({ where: { id }, select: THREAD_SELECT }),
      );
      if (!message) return createErrorResponse("Message not found", 404);

      return createSuccessResponse(message);
    } catch (error) {
      return handleApiError(error, "Failed to load the message");
    }
  },
);

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

      const existing = await bypassOrgScope(() =>
        db.contactMessage.findFirst({
          where: { id },
          select: { id: true, subject: true, name: true },
        }),
      );
      if (!existing) return createErrorResponse("Message not found", 404);

      const { isRead, isArchived, ...rest } = parsed.data;
      const data: Prisma.ContactMessageUpdateInput = { ...rest };

      if (isRead !== undefined) {
        data.isRead = isRead;
        // Who opened it and when is worth keeping; clearing it on unread keeps
        // the stamp honest rather than frozen at the first read.
        data.readAt = isRead ? new Date() : null;
        data.readById = isRead ? user.id : null;
      }
      if (isArchived !== undefined) {
        data.isArchived = isArchived;
        data.archivedAt = isArchived ? new Date() : null;
      }

      const message = await bypassOrgScope(() =>
        db.contactMessage.update({ where: { id }, data, select: THREAD_SELECT }),
      );

      // Reading a message is not a control action — only real triage is logged,
      // otherwise the platform trail fills up with "opened an email".
      const audited = Object.keys(parsed.data).some((key) => key !== "isRead");
      if (audited) {
        await recordPlatformAudit({
          actor: user,
          action: "contact.updated",
          targetType: "contact_message",
          targetId: message.id,
          targetName: message.subject,
          summary: `Updated contact message "${message.subject}" from ${message.name}`,
          metadata: {
            status: message.status,
            isArchived: message.isArchived,
            isStarred: message.isStarred,
          },
        });
      }

      return createSuccessResponse(message, "Message updated");
    } catch (error) {
      return handleApiError(error, "Failed to update the message");
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
      const existing = await bypassOrgScope(() =>
        db.contactMessage.findFirst({
          where: { id },
          select: { id: true, subject: true, name: true },
        }),
      );
      if (!existing) return createErrorResponse("Message not found", 404);

      // Replies cascade with the thread (FK ON DELETE CASCADE).
      await bypassOrgScope(() => db.contactMessage.delete({ where: { id } }));

      await recordPlatformAudit({
        actor: user,
        action: "contact.deleted",
        targetType: "contact_message",
        targetId: existing.id,
        targetName: existing.subject,
        summary: `Deleted contact message "${existing.subject}" from ${existing.name}`,
      });

      return createSuccessResponse({ id }, "Message deleted");
    } catch (error) {
      return handleApiError(error, "Failed to delete the message");
    }
  },
);
