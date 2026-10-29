/**
 * PropertyPro SaaS - Close the organization
 *
 * `Organization.deletedAt` existed but nothing ever set it, so an account
 * could be created and never closed — the customer's only option was to stop
 * paying and let it sit there.
 *
 * Deliberately a **soft close with a grace period**, not an erase:
 *   - Property, lease and payment records carry statutory retention
 *     obligations that outlive the subscription.
 *   - Accidental or malicious deletion of a whole portfolio must be
 *     recoverable; a platform operator can clear `deletedAt` within the
 *     window.
 * The retention window and what actually happens are stated back to the
 * caller, so nobody is surprised by which of the two they got.
 *
 * Sign-in is refused immediately (the organization is suspended in the same
 * transaction), so "closed" is closed from the customer's point of view.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withAccessAndDB,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { verifyUserPassword } from "@/lib/auth-credentials";
import { getBillingStripe } from "@/lib/billing/stripe";
import { emailService } from "@/lib/email-service";
import { recordPlatformAudit, SYSTEM_ACTOR } from "@/lib/platform/audit";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";

/** Days the closed organization stays recoverable before an operator may purge it. */
export const CLOSURE_RETENTION_DAYS = Number(
  process.env.ORG_CLOSURE_RETENTION_DAYS ?? 30,
);

const deleteSchema = z.object({
  password: z.string().min(1, "Confirm your password to close the account"),
  // Typing the organization name is the standard guard against a mis-click
  // on an irreversible-feeling action.
  confirmName: z.string().min(1, "Type the organization name to confirm"),
  reason: z.string().max(1000).optional(),
});

export const POST = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = deleteSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const organization = await db.organization.findFirst({
        where: { id: user.organizationId! },
        select: {
          id: true,
          name: true,
          ownerId: true,
          deletedAt: true,
          stripeSubscriptionId: true,
        },
      });
      if (!organization) {
        return createErrorResponse("Organization not found", 404);
      }
      if (organization.deletedAt) {
        return createErrorResponse("This account is already closed", 409);
      }
      // Closing the account ends everyone's access and stops the billing
      // relationship — that is the owner's decision, not an admin's.
      if (organization.ownerId !== user.id) {
        return createErrorResponse(
          "Only the organization owner can close the account",
          403,
        );
      }
      if (
        parsed.data.confirmName.trim().toLowerCase() !==
        organization.name.trim().toLowerCase()
      ) {
        return createErrorResponse(
          "The name you typed doesn't match the organization name",
          400,
        );
      }
      if (!(await verifyUserPassword(user.id, parsed.data.password))) {
        return createErrorResponse("Password is incorrect", 401);
      }

      // Stop the money first. If cancellation fails the closure still
      // proceeds — an operator can clean up a subscription, but a customer
      // blocked from closing would keep being billed.
      let subscriptionCanceled = false;
      if (organization.stripeSubscriptionId) {
        try {
          await getBillingStripe().subscriptions.cancel(
            organization.stripeSubscriptionId,
          );
          subscriptionCanceled = true;
        } catch (stripeError) {
          console.error(
            "Failed to cancel subscription during closure:",
            stripeError,
          );
        }
      }

      const closedAt = new Date();
      await bypassOrgScope(() =>
        db.organization.update({
          where: { id: organization.id },
          data: {
            deletedAt: closedAt,
            // Suspension is what actually blocks sign-in (see better-auth's
            // session-create gate); deletedAt alone would not.
            status: "suspended",
            cancelAtPeriodEnd: true,
            plan: "free",
          },
        }),
      );

      const purgeAfter = new Date(
        closedAt.getTime() + CLOSURE_RETENTION_DAYS * 24 * 60 * 60 * 1000,
      );

      await auditService.logEvent(
        {
          category: AuditCategory.COMPLIANCE,
          action: AuditAction.DELETE,
          severity: AuditSeverity.CRITICAL,
          description: `Organization closed by owner${
            parsed.data.reason ? `: ${parsed.data.reason}` : ""
          }`,
          resourceType: "organization",
          resourceId: organization.id,
          resourceName: organization.name,
          newValues: { deletedAt: closedAt, subscriptionCanceled },
          tags: ["organization", "closure"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      await recordPlatformAudit({
        actor: SYSTEM_ACTOR,
        action: "organization.closed",
        targetType: "organization",
        targetId: organization.id,
        targetName: organization.name,
        organizationId: organization.id,
        summary: `Closed by its owner (${user.email})`,
        metadata: {
          reason: parsed.data.reason,
          subscriptionCanceled,
          purgeAfter: purgeAfter.toISOString(),
        },
      });

      await emailService
        .sendNotification(
          user.email,
          [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
          `${organization.name} has been closed`,
          `Your PropertyPro account has been closed and billing has stopped. Your data is retained for ${CLOSURE_RETENTION_DAYS} days in case this was a mistake — contact support before ${purgeAfter.toDateString()} to have it restored.`,
        )
        .catch((mailError) => {
          console.error("Closure confirmation email failed:", mailError);
        });

      return createSuccessResponse(
        {
          closedAt,
          purgeAfter,
          retentionDays: CLOSURE_RETENTION_DAYS,
          subscriptionCanceled,
        },
        `${organization.name} is closed. Data is recoverable until ${purgeAfter.toDateString()}.`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to close the account");
    }
  },
);
