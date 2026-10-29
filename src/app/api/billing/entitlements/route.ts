/**
 * PropertyPro SaaS - Entitlements feed
 *
 * What the current package includes, for the UI to gate on: the sidebar, the
 * ⌘K palette, the page guard and the dashboards all read `modules` from here.
 * Permission-free by design: a manager who cannot open the billing screen
 * still needs to know whether "Export" is available before clicking it, and
 * none of this is sensitive — it is the same catalogue the public pricing page
 * shows, plus this organization's own usage.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { getOrganizationModules } from "@/lib/billing/entitlements";
import { unlimitedPlanLimits } from "@/lib/billing/plan-constants";
import { satisfiedLegacyKeys } from "@/lib/billing/modules";
import { getPlanUsage } from "@/lib/billing/usage";
import { requireUserOrganization } from "@/lib/billing/service";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // `?usage=0` is for the menus and the page guard, which ask on every
      // page load and only need the module list — not a count of every
      // property, unit, lease and invoice in the organization.
      const includeUsage = request.nextUrl.searchParams.get("usage") !== "0";
      const [{ planKey, plan, state }, usage, organization] =
        await Promise.all([
          getOrganizationModules(user.organizationId!),
          includeUsage ? getPlanUsage() : null,
          // Only the full feed reports who may manage billing from the
          // stored owner; the short one goes by the session's flag and is
          // spared the read.
          includeUsage ? requireUserOrganization(user) : null,
        ]);
      const modules = [...state.enabled];

      return createSuccessResponse({
        plan: planKey,
        planName: plan?.name ?? planKey,
        // Module keys, plus the old flat keys still satisfied — screens that
        // gate with `useHasFeature("data_export")` keep working unchanged.
        features: [...modules, ...satisfiedLegacyKeys(state)],
        modules,
        // So the page guard can say "switched off" rather than "upgrade".
        platformDisabled: [...state.platformOff],
        limits: plan?.limits ?? unlimitedPlanLimits(),
        ...(usage ? { usage } : {}),
        canManageBilling:
          user.isAdmin ||
          (organization
            ? organization.ownerId === user.id
            : user.isOrganizationOwner === true),
      });
    } catch (error) {
      return handleApiError(error, "Failed to read entitlements");
    }
  },
);
