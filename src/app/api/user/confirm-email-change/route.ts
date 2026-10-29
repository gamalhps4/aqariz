/**
 * PropertyPro - Confirm Email Change API
 * Public endpoint reached from the verification link sent to the new address.
 * The secure token authorizes the change, so no session is required.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  validateInvitationToken,
  markTokenAsUsed,
} from "@/lib/invitation-utils";
import { runWithOrgContext } from "@/lib/tenancy/context";
import { z } from "zod";
import { auditOwnAccount } from "@/lib/audit/account-events";

const confirmSchema = z.object({
  token: z.string().min(1, "Token is required"),
});

// ============================================================================
// GET /api/user/confirm-email-change - Validate token
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return createErrorResponse("Token is required", 400);
    }

    const result = await validateInvitationToken(token, "email_change");
    if (!result.success || !result.invitation) {
      return createErrorResponse("Invalid or expired token", 400);
    }

    return createSuccessResponse(
      {
        valid: true,
        newEmail: result.invitation.newEmail,
        expiresAt: result.invitation.expiresAt,
      },
      "Token is valid"
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// ============================================================================
// POST /api/user/confirm-email-change - Apply the email change
// ============================================================================
export async function POST(request: NextRequest) {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    const validation = confirmSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        validation.error.errors.map((e) => e.message).join(", "),
        400
      );
    }

    const { token } = validation.data;

    const result = await validateInvitationToken(token, "email_change");
    if (!result.success || !result.invitation) {
      return createErrorResponse("Invalid or expired token", 400);
    }

    const { userId, newEmail, organizationId } = result.invitation;

    // The token names the organization; run the user lookup/update under it.
    return runWithOrgContext(
      { organizationId, isPlatformAdmin: false },
      async () => {
        const user = userId
          ? await db.user.findFirst({ where: { id: userId } })
          : null;
        if (!user) {
          return createErrorResponse("User not found", 404);
        }
        if (!user.isActive) {
          return createErrorResponse("Account is deactivated", 403);
        }

        // Re-check uniqueness in case the address was taken after the request.
        const existing = await db.user.findFirst({
          where: {
            email: newEmail!.toLowerCase(),
            id: { not: user.id },
          },
          select: { id: true },
        });
        if (existing) {
          return createErrorResponse("Email already in use", 409);
        }

        const updatedUser = await db.user.update({
          where: { id: user.id },
          data: {
            email: newEmail!.toLowerCase(),
            emailVerified: new Date(),
            emailVerifiedFlag: true,
          },
        });

        await markTokenAsUsed(token);

        // The link carries no session: the person is named explicitly.
        auditOwnAccount({
          person: updatedUser,
          request,
          before: { email: user.email },
          after: { email: updatedUser.email },
          messageKey: "admin.audit.msg.email_change_confirmed",
        });

        return createSuccessResponse(
          { message: "Email updated successfully", email: updatedUser.email },
          "Your email address has been updated"
        );
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
