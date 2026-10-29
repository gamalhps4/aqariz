import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  createSubscriptionCheckout,
  assertCanManageBilling,
  requireUserOrganization,
} from "@/lib/billing/service";
import { resolveApplicationOrigin } from "@/lib/billing/origin";

export const POST = withPermissionAndDB("company_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = (await request.json()) as {
        plan?: string;
        interval?: string;
      };
      if (!body.plan) return createErrorResponse("Plan is required", 400);

      const interval = body.interval === "year" ? "year" : "month";

      const organization = await requireUserOrganization(user);
      assertCanManageBilling(organization, user);
      const session = await createSubscriptionCheckout(
        organization,
        user,
        body.plan,
        resolveApplicationOrigin(request),
        interval,
      );
      if (!session.url) {
        return createErrorResponse("Stripe Checkout URL is unavailable", 502);
      }
      return createSuccessResponse({ url: session.url, sessionId: session.id });
    } catch (error) {
      return handleApiError(error, "Failed to create subscription checkout");
    }
  },
);
