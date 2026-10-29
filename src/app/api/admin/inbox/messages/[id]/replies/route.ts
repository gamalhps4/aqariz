/**
 * PropertyPro SaaS - Console inbox: reply to a contact message
 *
 * The reply is stored first and emailed second. A dead SMTP box then costs the
 * operator a resend, not the text they just wrote — and the thread records
 * exactly why the email never left.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
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
import { emailService } from "@/lib/email-service";

const replySchema = z.object({
  body: z.string().trim().min(1, "Write a reply first").max(5000),
  /** Answering usually closes the thread; the console can say otherwise. */
  close: z.boolean().default(false),
});

export const POST = withPlatformAdminAndDB()(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;
      const { success, data: payload, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = replySchema.safeParse(payload);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const message = await bypassOrgScope(() =>
        db.contactMessage.findFirst({
          where: { id },
          select: { id: true, name: true, email: true, subject: true },
        }),
      );
      if (!message) return createErrorResponse("Message not found", 404);

      const authorName =
        `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || user.email;

      const reply = await bypassOrgScope(() =>
        db.contactMessageReply.create({
          data: {
            contactMessageId: message.id,
            body: parsed.data.body,
            authorId: user.id,
            authorName,
            authorEmail: user.email,
          },
        }),
      );

      let emailSent = false;
      let emailError: string | null = null;
      try {
        emailSent = await emailService.sendNotification(
          message.email,
          message.name,
          `Re: ${message.subject}`,
          parsed.data.body,
        );
      } catch (sendError) {
        emailError =
          sendError instanceof Error
            ? sendError.message.slice(0, 300)
            : "Unknown email error";
      }

      const [updatedReply, updatedMessage] = await bypassOrgScope(() =>
        Promise.all([
          db.contactMessageReply.update({
            where: { id: reply.id },
            data: { emailSent, emailError },
          }),
          db.contactMessage.update({
            where: { id: message.id },
            data: {
              status: parsed.data.close ? "closed" : "replied",
              lastReplyAt: new Date(),
              isRead: true,
              readAt: new Date(),
              readById: user.id,
            },
            select: {
              id: true,
              status: true,
              isRead: true,
              lastReplyAt: true,
            },
          }),
        ]),
      );

      await recordPlatformAudit({
        actor: user,
        action: "contact.replied",
        targetType: "contact_message",
        targetId: message.id,
        targetName: message.subject,
        summary: `Replied to ${message.name} about "${message.subject}"`,
        metadata: { emailSent, closed: parsed.data.close },
      });

      return createSuccessResponse(
        { reply: updatedReply, message: updatedMessage },
        emailSent
          ? "Reply sent"
          : "Reply saved, but the email could not be delivered",
      );
    } catch (error) {
      return handleApiError(error, "Failed to send the reply");
    }
  },
);
