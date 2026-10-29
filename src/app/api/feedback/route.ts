/**
 * PropertyPro - Feedback API (organization side)
 *
 * What an organization can do with feedback: write it, and read what its own
 * people wrote. Nothing here sets status, priority or the reply — that is the
 * platform's to decide, and lives at /api/admin/feedback.
 *
 * The previous version of this file offered `update-status` and `bulk-update`
 * to any org admin, against an in-memory store shared by every organization in
 * the process. Both are gone.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withAccessAndDB,
} from "@/lib/api-utils";
import { feedbackScope } from "@/lib/db/scopes";
import {
  FEEDBACK_CATEGORIES,
  isFeedbackCategory,
  isFeedbackStatus,
  listFeedback,
  submitFeedback,
  summarizeFeedback,
} from "@/lib/services/feedback.service";

const submitSchema = z.object({
  category: z.enum(FEEDBACK_CATEGORIES),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().min(1, "A title is required").max(160),
  description: z.string().trim().min(1, "A description is required").max(4000),
  feature: z.string().trim().max(120).optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
});

// ============================================================================
// GET /api/feedback - this organization's feedback, plus its summary
// ============================================================================

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const category = searchParams.get("category");
      const status = searchParams.get("status");

      if (category && !isFeedbackCategory(category)) {
        return createErrorResponse("Unknown feedback category", 400);
      }
      if (status && !isFeedbackStatus(status)) {
        return createErrorResponse("Unknown feedback status", 400);
      }

      // Staff read the whole organization's feedback; a tenant or an owner
      // reads their own. RLS has already bounded this to one organization —
      // what lib/db/scopes.ts decides is who inside it may see whose words.
      const scope = feedbackScope(user);
      const options = {
        ...(category ? { category } : {}),
        ...(status ? { status } : {}),
        scope,
        limit: Number(searchParams.get("limit") ?? 50),
        offset: Number(searchParams.get("offset") ?? 0),
      };

      const [page, summary] = await Promise.all([
        listFeedback(options),
        summarizeFeedback(options),
      ]);

      return createSuccessResponse(
        { feedback: page.entries, total: page.total, summary },
        "Feedback retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve feedback");
    }
  },
);

// ============================================================================
// POST /api/feedback - submit
// ============================================================================

export const POST = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.organizationId) {
        // A platform admin has no organization to file against, and their
        // feedback would have nowhere to appear.
        return createErrorResponse(
          "Feedback is submitted from within an organization",
          400,
        );
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const parsed = submitSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const entry = await submitFeedback({
        organizationId: user.organizationId,
        userId: user.id,
        // The role as it is today. Stored, not joined, so a later promotion
        // does not rewrite who said what.
        userRole: user.originalRole,
        category: parsed.data.category,
        rating: parsed.data.rating,
        title: parsed.data.title,
        description: parsed.data.description,
        feature: parsed.data.feature ?? null,
        tags: parsed.data.tags ?? [],
      });

      return createSuccessResponse(entry, "Thank you — your feedback was sent");
    } catch (error) {
      return handleApiError(error, "Failed to submit feedback");
    }
  },
);
