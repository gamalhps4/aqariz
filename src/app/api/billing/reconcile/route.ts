/**
 * PropertyPro SaaS - Checkout reconcile
 *
 * The success redirect returns with `?checkout=success&session_id=…` while the
 * webhook may still be in flight. Without this the customer pays and then
 * stares at their old plan with no feedback at all. Pulling the session
 * straight from Stripe closes that window; the webhook remains the source of
 * truth and simply finds the work already done.
 *
 * Idempotent: it only ever mirrors Stripe's current state onto the
 * organization, so calling it twice changes nothing.
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
  withPermissionAndDB,
} from "@/lib/api-utils";
import { getBillingStripe } from "@/lib/billing/stripe";
import {
  requireUserOrganization,
  syncOrganizationSubscription,
} from "@/lib/billing/service";
import { getEffectivePlan } from "@/lib/billing/entitlements";

const reconcileSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
});

export const POST = withPermissionAndDB("company_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = reconcileSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const organization = await requireUserOrganization(user);

      const session = await getBillingStripe().checkout.sessions.retrieve(
        parsed.data.sessionId,
      );

      // The session must belong to this organization. Without this check any
      // member could pass someone else's session id and have that
      // subscription mirrored onto their own organization.
      if (session.client_reference_id !== organization.id) {
        return createErrorResponse("Checkout session not found", 404);
      }
      if (session.metadata?.purpose !== "saas_subscription") {
        return createErrorResponse("Not a subscription checkout", 400);
      }

      if (session.payment_status === "unpaid") {
        return createSuccessResponse({
          reconciled: false,
          reason: "payment_pending",
          plan: await getEffectivePlan(organization.id),
        });
      }

      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;
      if (!subscriptionId) {
        return createSuccessResponse({
          reconciled: false,
          reason: "subscription_not_ready",
          plan: await getEffectivePlan(organization.id),
        });
      }

      const subscription =
        await getBillingStripe().subscriptions.retrieve(subscriptionId);
      await syncOrganizationSubscription(subscription);

      return createSuccessResponse(
        {
          reconciled: true,
          plan: await getEffectivePlan(organization.id),
          subscriptionStatus: subscription.status,
        },
        "Subscription updated",
      );
    } catch (error) {
      return handleApiError(error, "Failed to confirm the checkout");
    }
  },
);
