/**
 * PropertyPro - Feedback triage (platform side)
 *
 * Status, priority and the reply the author sees. Deliberately unreachable
 * from an organization: whether a request is next quarter's work is a roadmap
 * decision, and the customer who asked for it is not the one who makes it.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  isValidObjectId,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  FEEDBACK_PRIORITIES,
  FEEDBACK_STATUSES,
  updateTriage,
} from "@/lib/services/feedback.service";

const triageSchema = z
  .object({
    status: z.enum(FEEDBACK_STATUSES).optional(),
    priority: z.enum(FEEDBACK_PRIORITIES).optional(),
    adminResponse: z.string().trim().max(4000).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined ||
      value.priority !== undefined ||
      value.adminResponse !== undefined,
    { message: "Nothing to update" },
  );

export const PATCH = withPlatformAdminAndDB()(
  async (
    _user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid feedback ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const parsed = triageSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const updated = await updateTriage(id, parsed.data);
      if (!updated) {
        return createErrorResponse("Feedback not found", 404);
      }

      return createSuccessResponse(updated, "Feedback updated");
    } catch (error) {
      return handleApiError(error, "Failed to update feedback");
    }
  },
);
