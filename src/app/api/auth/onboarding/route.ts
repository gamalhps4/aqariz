/**
 * PropertyPro SaaS - Onboarding (create org for the current user)
 *
 * For authenticated users who do not yet belong to an organization (e.g. fresh
 * OAuth sign-ups). Creates an organization owned by the current user, promotes
 * them to Admin, and seeds the per-organization system roles.
 *
 * Distinct from /api/auth/signup-organization, which creates a brand-new user.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db/prisma";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import { provisionOrganization } from "@/lib/tenancy/provision-organization";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { withRateLimit, ipBasedKeyGenerator } from "@/lib/rate-limit";
import { AuditAction, recordAccountEvent } from "@/lib/audit-domain";
import { UserRole } from "@/types";

// Creates an organization: throttle per IP even though the caller is
// authenticated (a fresh OAuth account is cheap to obtain).
export const POST = withRateLimit(
  { windowMs: 60 * 60 * 1000, maxRequests: 5, keyGenerator: ipBasedKeyGenerator },
  async (request: NextRequest) => {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return createErrorResponse("Authentication required", 401);
    }

    const user = await bypassOrgScope(async () =>
      db.user.findFirst({ where: { id: session.user.id } }),
    );
    if (!user) {
      return createErrorResponse("User not found", 404);
    }

    // Already onboarded — nothing to do.
    if (user.organizationId) {
      return createSuccessResponse(
        { organizationId: user.organizationId, alreadyOnboarded: true },
        "Already part of an organization",
      );
    }

    const { success, data, error } = await parseRequestBody(request);
    if (!success) return createErrorResponse(error!, 400);

    const organizationName = (
      data as { organizationName?: string }
    ).organizationName?.trim();
    if (!organizationName) {
      return createErrorResponse("Organization name is required", 400);
    }

    // The organization owner receives the billing and dunning mail, so this
    // path needs a reachable address even though a person's record may carry
    // none. A signed-in user reached here by logging in, so this is a guard
    // against the impossible rather than a case the UI can produce.
    if (!user.email) {
      return createErrorResponse(
        "Your account has no email address. Add one before creating an organization.",
        400,
      );
    }

    const result = await provisionOrganization({
      organizationName,
      status: "active",
      owner: {
        existingUserId: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
    });

    // A sign-up like any other: the organization's first activity entry.
    await recordAccountEvent({
      action: AuditAction.SIGNUP,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: UserRole.ADMIN,
        organizationId: result.organizationId,
      },
      request,
      recordType: "organization",
      recordId: result.organizationId,
      recordName: organizationName,
    });

    return createSuccessResponse(
      { organizationId: result.organizationId, slug: result.slug },
      "Organization created",
    );
  } catch (err) {
    return handleApiError(err);
  }
  },
);
