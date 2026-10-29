/**
 * PropertyPro SaaS - Start impersonation (platform admin)
 *
 * Grants the operator a signed, one-hour, read-only view of the app as the
 * target user. See lib/platform/impersonation for why this is a cookie
 * overlay rather than a real session for the target.
 */

export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_HINT_COOKIE,
  createImpersonationToken,
  impersonationCookieOptions,
  impersonationHintCookieOptions,
} from "@/lib/platform/impersonation";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { AuditAction, recordActivity } from "@/lib/audit-service";
import { fullName } from "@/lib/audit/scope";

export const POST = withPlatformAdminAndDB()(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;

      const target = await db.user.findFirst({
        where: { id, deletedAt: null },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
          organizationId: true,
        },
      });

      if (!target) return createErrorResponse("User not found", 404);
      if (!target.isActive) {
        return createErrorResponse(
          "This account is deactivated and cannot be viewed",
          409,
        );
      }
      // Another platform admin is a peer, not a customer — and an org-less
      // account has no tenant workspace to view in the first place.
      if (target.role === UserRole.SUPER_ADMIN || !target.organizationId) {
        return createErrorResponse(
          "Platform administrators cannot be impersonated",
          403,
        );
      }

      const organization = await db.organization.findFirst({
        where: { id: target.organizationId },
        select: { name: true, status: true },
      });
      if (organization?.status === "suspended") {
        return createErrorResponse(
          "Reactivate the organization before viewing it",
          409,
        );
      }

      const token = createImpersonationToken(target.id, user.id);

      // Falls through to the id: an email address is optional on a person's
      // record, and this entry has to name who was impersonated.
      const impersonatedName =
        [target.firstName, target.lastName].filter(Boolean).join(" ") ||
        target.email ||
        target.id;

      await recordPlatformAudit({
        actor: user,
        action: "user.impersonation_started",
        targetType: "user",
        targetId: target.id,
        targetName: impersonatedName,
        organizationId: target.organizationId,
        summary: `Started viewing the app as ${impersonatedName}`,
        metadata: { organizationName: organization?.name, readOnly: true },
      });

      // The customer sees it too: an entry in their own organization's log,
      // naming the account being viewed and the operator viewing it.
      await recordActivity({
        action: AuditAction.IMPERSONATION_STARTED,
        recordType: "user",
        recordId: target.id,
        recordName: impersonatedName,
        organizationId: target.organizationId,
        actor: {
          id: target.id,
          name: fullName(target.firstName, target.lastName),
          email: target.email,
          role: target.role,
          isPlatformAdmin: false,
        },
        impersonator: { id: user.id, email: user.email },
        details: { readOnly: true, expiresInSeconds: token.maxAge },
      });

      const response = NextResponse.json({
        success: true,
        data: {
          targetUserId: target.id,
          targetEmail: target.email,
          organizationName: organization?.name ?? null,
          readOnly: true,
          expiresInSeconds: token.maxAge,
        },
        message: `Now viewing as ${target.email}. This session is read-only.`,
      });
      response.cookies.set(IMPERSONATION_COOKIE, token.value, {
        ...impersonationCookieOptions,
        maxAge: token.maxAge,
      });
      // Lets the browser's session hook know to resolve as the customer too;
      // without it the dashboard read the operator, bounced to /admin, and the
      // console bounced back.
      response.cookies.set(IMPERSONATION_HINT_COOKIE, "1", {
        ...impersonationHintCookieOptions,
        maxAge: token.maxAge,
      });
      return response;
    } catch (error) {
      return handleApiError(error, "Failed to start impersonation");
    }
  },
);
