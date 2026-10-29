/**
 * PropertyPro SaaS - Over-limit report (platform admin)
 *
 * `enforcePlanLimit` blocks creation, so an organization can only end up over
 * a limit when the limit itself moves — a downgrade, a cancelled subscription
 * dropping to Free, or an admin editing the plan. Nothing surfaced those, so
 * a Business customer downgrading to Free kept 200 properties silently.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { findOrganizationsOverLimit } from "@/lib/billing/usage";

export const GET = withPlatformAdminAndDB()(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const organizations = await findOrganizationsOverLimit();
      return createSuccessResponse({
        organizations,
        total: organizations.length,
      });
    } catch (error) {
      return handleApiError(error, "Failed to build the over-limit report");
    }
  },
);
