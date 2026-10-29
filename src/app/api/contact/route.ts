/**
 * PropertyPro SaaS - Public contact form intake
 *
 * The marketing contact page used to hand visitors a `mailto:` link, which put
 * every enquiry in someone's personal mailbox with no trail. This endpoint
 * lands the same message in the operator console inbox (/admin/inbox) instead,
 * so it can be triaged, replied to and audited in one place.
 *
 * Unauthenticated by design — anyone may write in — so it is defended by an
 * IP rate limit, a honeypot field and hard length caps rather than a session.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { withRateLimit, getClientIp } from "@/lib/rate-limit";
import { getPlatformSettings } from "@/lib/platform/settings";
import { emailService } from "@/lib/email-service";
import { auth } from "@/lib/auth";

export const CONTACT_TOPICS = [
  "support",
  "sales",
  "billing",
  "security",
] as const;

const contactSchema = z.object({
  topic: z.enum(CONTACT_TOPICS).default("support"),
  name: z.string().trim().min(2, "Please tell us your name").max(120),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Please enter a valid email address")
    .max(200),
  company: z.string().trim().max(160).optional().nullable(),
  subject: z.string().trim().min(3, "Please add a subject").max(160),
  message: z
    .string()
    .trim()
    .min(20, "Please give us a little more detail (at least 20 characters)")
    .max(5000),
  /** Hidden field: a real person never fills it, a naive bot fills everything. */
  website: z.string().max(0).optional().or(z.literal("")),
});

/** Five enquiries an hour per IP — generous for a person, useless for a bot. */
const CONTACT_LIMIT = {
  windowMs: 60 * 60 * 1000,
  maxRequests: 5,
};

export const POST = withRateLimit(CONTACT_LIMIT, handleContact);

async function handleContact(request: NextRequest) {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) return createErrorResponse(error!, 400);

    const parsed = contactSchema.safeParse(body);
    if (!parsed.success) {
      return createErrorResponse(
        parsed.error.errors.map((issue) => issue.message).join(", "),
        400,
      );
    }

    const { website, ...fields } = parsed.data;
    // Honeypot tripped: answer as if it worked so the bot has nothing to tune.
    if (website) {
      return createSuccessResponse({ received: true }, "Message received");
    }

    // Signed-in senders get their account stamped on the thread so the console
    // can tell a customer apart from a stranger; failure here is irrelevant.
    let submittedById: string | null = null;
    try {
      const session = await auth();
      submittedById = session?.user?.id ?? null;
    } catch {
      submittedById = null;
    }

    const contactMessage = await bypassOrgScope(() =>
      db.contactMessage.create({
        data: {
          topic: fields.topic,
          name: fields.name,
          email: fields.email,
          company: fields.company?.trim() || null,
          subject: fields.subject,
          message: fields.message,
          submittedById,
          ipAddress: getClientIp(request),
          userAgent: request.headers.get("user-agent")?.slice(0, 500) || null,
        },
        select: { id: true, createdAt: true },
      }),
    );

    // Best effort: the message is already safely stored, so a dead SMTP box
    // must not turn a delivered enquiry into an error for the sender.
    void notifyOperators(fields).catch((notifyError) => {
      console.error("Contact notification failed:", notifyError);
    });

    return createSuccessResponse(
      { id: contactMessage.id, received: true },
      "Thanks — your message is with us. We reply on business days.",
    );
  } catch (error) {
    return handleApiError(error, "Failed to send your message");
  }
}

async function notifyOperators(fields: {
  topic: string;
  name: string;
  email: string;
  company?: string | null;
  subject: string;
  message: string;
}) {
  const { general } = await getPlatformSettings();
  const inbox = general.supportEmail?.trim();
  if (!inbox) return;

  const appUrl = process.env.APP_URL || "http://localhost:3000";
  await emailService.sendNotification(
    inbox,
    general.platformName || "Team",
    `[${fields.topic}] ${fields.subject}`,
    [
      `${fields.name} <${fields.email}> sent a message through the contact form.`,
      fields.company ? `Organization: ${fields.company}` : "",
      "",
      fields.message,
    ]
      .filter(Boolean)
      .join("\n"),
    { text: "Open in the console", url: `${appUrl}/admin/inbox` },
  );
}
