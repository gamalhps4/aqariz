/**
 * PropertyPro SaaS - Organization signup
 *
 * Public endpoint that provisions a brand-new SaaS account: an Organization,
 * its owner Admin user, and the per-organization system roles. After this the
 * owner can sign in normally and lands in their isolated workspace.
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
import { provisionOrganization } from "@/lib/tenancy/provision-organization";
import { bypassOrgScope, runWithOrgContext } from "@/lib/tenancy/context";
import {
  createEmailVerificationToken,
  sendEmailVerificationLink,
} from "@/lib/invitation-utils";
import { isValidPhoneNumber, normalizePhoneNumber } from "@/lib/utils";
import { getPlatformSettings } from "@/lib/platform/settings";
import { withRateLimit, ipBasedKeyGenerator } from "@/lib/rate-limit";
import { PASSWORD_MIN_LENGTH } from "@/lib/password-policy";
import { AuditAction, recordAccountEvent } from "@/lib/audit-domain";
import { UserRole } from "@/types";

const EMAIL_REGEX = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;

// Public endpoint that creates a user + organization: throttle hard per IP.
export const POST = withRateLimit(
  { windowMs: 60 * 60 * 1000, maxRequests: 5, keyGenerator: ipBasedKeyGenerator },
  async (request: NextRequest) => {
  try {
    // Platform-level gate: the super-admin can close public sign-ups.
    const { registration, general } = await getPlatformSettings();
    if (!registration.allowSignups) {
      return createErrorResponse(
        "New sign-ups are currently disabled. Please contact support.",
        403,
      );
    }

    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    const { organizationName, firstName, lastName, email, password, phone } =
      body as Record<string, string>;

    // Required fields
    if (
      !organizationName ||
      !firstName ||
      !lastName ||
      !email ||
      !password
    ) {
      return createErrorResponse(
        "Organization name, first name, last name, email and password are required",
        400,
      );
    }

    if (!EMAIL_REGEX.test(email)) {
      return createErrorResponse("Invalid email format", 400);
    }

    // provisionOrganization ultimately calls setUserPassword, which enforces
    // PASSWORD_MIN_LENGTH — check it here too so the caller gets a clean 400
    // instead of a compensating-delete round trip.
    if (password.length < PASSWORD_MIN_LENGTH) {
      return createErrorResponse(
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`,
        400,
      );
    }

    if (phone && !isValidPhoneNumber(phone)) {
      return createErrorResponse("Invalid phone number format", 400);
    }

    // Email is globally unique (one person → one organization in Phase 1).
    // Soft-deleted users still hold their email under the unique index, so
    // the check deliberately includes them (deletedAt: undefined opts out of
    // the soft-delete auto-filter).
    const existing = await bypassOrgScope(async () =>
      db.user.findFirst({
        where: { email: email.toLowerCase().trim(), deletedAt: undefined },
        select: { id: true },
      }),
    );
    if (existing) {
      return createErrorResponse(
        "An account with this email already exists",
        409,
      );
    }

    const result = await provisionOrganization({
      organizationName,
      owner: {
        firstName,
        lastName,
        email,
        password,
        phone: phone ? normalizePhoneNumber(phone) : undefined,
      },
      trialDays: registration.defaultTrialDays,
      defaults: {
        currency: general.defaultCurrency,
        timezone: general.defaultTimezone,
        language: general.defaultLanguage,
      },
    });

    // The organization's first activity entry: who registered it, from where.
    // The owner is provisioned as the organization's administrator.
    await recordAccountEvent({
      action: AuditAction.SIGNUP,
      user: {
        id: result.ownerId,
        email: email.toLowerCase().trim(),
        firstName,
        lastName,
        role: UserRole.ADMIN,
        organizationId: result.organizationId,
      },
      request,
      recordType: "organization",
      recordId: result.organizationId,
      recordName: organizationName,
    });

    // Verification email. Sent for every signup so the address is confirmed
    // even when the platform toggle is off (the toggle decides whether an
    // unverified owner is *blocked*, not whether we ask). Invitation tokens
    // are org-scoped rows, so this runs inside the new organization's context.
    const verificationSent = await runWithOrgContext(
      { organizationId: result.organizationId, isPlatformAdmin: false },
      async () => {
        const token = await createEmailVerificationToken(
          result.ownerId,
          email.toLowerCase().trim(),
        );
        if (!token.success || !token.token) return false;
        const sent = await sendEmailVerificationLink(
          token.token,
          `${firstName} ${lastName}`.trim(),
        );
        return sent.success;
      },
    ).catch((error) => {
      // A mail failure must not undo a provisioned account — the owner can
      // resend from the app.
      console.error("Signup verification email failed:", error);
      return false;
    });

    return createSuccessResponse(
      {
        organizationId: result.organizationId,
        slug: result.slug,
        verificationEmailSent: verificationSent,
        message: verificationSent
          ? "Organization created. Check your email to confirm your address, then sign in."
          : "Organization created. You can now sign in.",
      },
      "Organization created successfully",
    );
  } catch (err: unknown) {
    // P2002 = Postgres unique-constraint violation (was Mongo error 11000).
    const e = err as { code?: string | number; message?: string };
    if (e?.code === "P2002" || e?.message?.includes("already exists")) {
      return createErrorResponse(
        "An account with this email already exists",
        409,
      );
    }
    return handleApiError(err);
  }
  },
);
