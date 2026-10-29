import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { requireUserOrganization } from "@/lib/billing/service";
import { getEffectivePlan } from "@/lib/billing/entitlements";
import { getPlanByKey } from "@/lib/billing/plans";
import { findOverLimits, getPlanUsage } from "@/lib/billing/usage";

export const GET = withPermissionAndDB("company_settings")(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const organization = await requireUserOrganization(user);
      const effectivePlan = await getEffectivePlan(user.organizationId!);
      const plan = await getPlanByKey(effectivePlan);
      const usage = await getPlanUsage();
      const overages = plan ? findOverLimits(usage, plan.limits) : [];

      return createSuccessResponse({
        organization: {
          id: organization.id,
          name: organization.name,
          plan: effectivePlan,
          status: organization.subscriptionStatus,
          trialEndsAt: organization.trialEndsAt,
          currentPeriodEnd: organization.currentPeriodEnd,
          cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
          hasCustomer: Boolean(organization.stripeCustomerId),
          hasSubscription: Boolean(organization.stripeSubscriptionId),
        },
        plan,
        usage,
        // Non-empty only after a downgrade — enforcement blocks creation, so
        // usage can exceed a limit only when the limit itself moves.
        overages,
      });
    } catch (error) {
      return handleApiError(error, "Failed to retrieve subscription");
    }
  },
);
