import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  createCustomerPortalSession,
  assertCanManageBilling,
  requireUserOrganization,
} from "@/lib/billing/service";
import { resolveApplicationOrigin } from "@/lib/billing/origin";

export const POST = withPermissionAndDB("company_settings")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const organization = await requireUserOrganization(user);
      assertCanManageBilling(organization, user);
      const session = await createCustomerPortalSession(
        organization,
        user,
        resolveApplicationOrigin(request),
      );
      return createSuccessResponse({ url: session.url });
    } catch (error) {
      return handleApiError(error, "Failed to create billing portal session");
    }
  },
);
