/**
 * PropertyPro - A message from a listing's public page
 *
 * POST /api/public/listings/{id}/inquiries — anyone may write; nobody is
 * signed in. What stands between the form and the office's inbox is
 * lib/listings/inquiry-guard.ts: a honeypot field a person never fills, a
 * check that the phone number is a phone number, and a rate limit per
 * (hashed) source address — a short window against a burst and a long one
 * against a trickle.
 *
 * The listing must be on the public page right now (published, licence
 * current, unit vacant, office live): a message for a draft, an expired ad or
 * somebody else's listing is answered "not found", the same as an id that
 * never existed.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createErrorResponse, createSuccessResponse } from "@/lib/api-utils";
import {
  checkRateLimitByKey,
  createRateLimitResponse,
  getClientIp,
} from "@/lib/rate-limit";
import {
  checkInquiryRate,
  evaluateInquiry,
  hashSource,
} from "@/lib/listings/inquiry-guard";
import { recordInquiry } from "@/lib/listings/public";

/** A message is a few lines; anything bigger is not one. */
const MAX_BODY_BYTES = 10 * 1024;

const RECEIVED = "Thanks — the office will get back to you soon.";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(id)) {
      return createErrorResponse("Listing not found", 404);
    }

    const declared = Number(request.headers.get("content-length") ?? "0");
    if (declared > MAX_BODY_BYTES) {
      return createErrorResponse("The message is too large", 413);
    }
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return createErrorResponse("The message is too large", 413);
    }
    let body: unknown = null;
    try {
      body = JSON.parse(text);
    } catch {
      return createErrorResponse("Invalid request body", 400);
    }

    const outcome = evaluateInquiry(body);

    // A bot is answered as a person is, and stored nowhere.
    if (outcome.kind === "honeypot") {
      return createSuccessResponse({ received: true }, RECEIVED);
    }

    // A person who mistyped a phone number is told so, and it does not spend
    // their allowance of messages.
    if (outcome.kind === "invalid") {
      return NextResponse.json(
        {
          success: false,
          error: "Please check the highlighted fields",
          code: "VALIDATION_ERROR",
          fields: outcome.errors,
        },
        { status: 400 },
      );
    }

    const sourceHash = hashSource(getClientIp(request));
    const rate = await checkInquiryRate(checkRateLimitByKey, sourceHash);
    if (!rate.allowed) {
      return createRateLimitResponse(
        "Too many messages. Please try again later.",
        Date.now() + rate.retryAfterSeconds * 1000,
      );
    }

    const result = await recordInquiry({
      listingId: id,
      data: outcome.data,
      sourceHash,
    });
    if (!result.ok) return createErrorResponse("Listing not found", 404);

    return createSuccessResponse({ received: true }, RECEIVED);
  } catch (error) {
    console.error("Listing inquiry failed:", error);
    return createErrorResponse("We could not send your message. Please try again.", 500);
  }
}
