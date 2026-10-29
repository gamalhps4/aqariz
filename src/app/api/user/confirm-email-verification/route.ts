/**
 * PropertyPro - Confirm Email Verification API
 * Public endpoint reached from the verification link.
 * The secure token authorizes the verification, so no session is required.
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
// GET /api/user/confirm-email-verification - Validate token
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return createErrorResponse("Token is required", 400);
    }

    const result = await validateInvitationToken(token, "email_verification");
    if (!result.success || !result.invitation) {
      return createErrorResponse("Invalid or expired token", 400);
    }

    return createSuccessResponse(
      {
        valid: true,
        email: result.invitation.email,
        expiresAt: result.invitation.expiresAt,
      },
      "Token is valid"
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// ============================================================================
// POST /api/user/confirm-email-verification - Mark the email as verified
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

    const result = await validateInvitationToken(token, "email_verification");
    if (!result.success || !result.invitation) {
      return createErrorResponse("Invalid or expired token", 400);
    }

    const { userId, email, organizationId } = result.invitation;

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

        // Only verify if the email still matches the one the link was issued for.
        // (Guards against the user changing their email after requesting the link.)
        if (String(user.email).toLowerCase() !== String(email).toLowerCase()) {
          return createErrorResponse(
            "This verification link is no longer valid for your current email",
            400
          );
        }

        const updatedUser = await db.user.update({
          where: { id: user.id },
          data: {
            emailVerified: new Date(),
            emailVerifiedFlag: true,
          },
        });

        await markTokenAsUsed(token);

        // The link carries no session: the person is named explicitly.
        auditOwnAccount({
          person: updatedUser,
          request,
          before: { emailVerified: false },
          after: { emailVerified: true },
          messageKey: "admin.audit.msg.email_verified",
        });

        return createSuccessResponse(
          { message: "Email verified successfully", email: updatedUser.email },
          "Your email address has been verified"
        );
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
