import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  withAccessAndDB,
} from "@/lib/api-utils";
import { BILLING_CURRENCY, getPublicPlans } from "@/lib/billing/plans";

export const GET = withAccessAndDB({})(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) =>
    createSuccessResponse(
      // Stripe price ids are stripped: the client only needs to know whether a
      // term is purchasable, not which price backs it.
      (await getPublicPlans()).map(
        ({ stripePriceId, stripePriceIdYearly, ...plan }) => ({
          ...plan,
          // What Stripe bills the plan in — the page drew a "$" whatever it was.
          currency: BILLING_CURRENCY,
          available:
            plan.key === "free" || plan.isCustom || Boolean(stripePriceId),
          // The switch is authoritative, not just the presence of a price id.
          // A plan left with a stale yearly price from an earlier pricing
          // scheme must not become purchasable because the id happens to be
          // populated.
          annualAvailable:
            plan.annualEnabled &&
            plan.yearlyPrice !== null &&
            Boolean(stripePriceIdYearly),
        }),
      ),
      "Billing plans retrieved",
    ),
);
