export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { getBillingStripe } from "@/lib/billing/stripe";
import { resolveApplicationOrigin } from "@/lib/billing/origin";
import { recordPlatformAudit } from "@/lib/platform/audit";

export const POST = withPlatformAdminAndDB()(
  async (
    actor: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params?: Promise<{ id: string }> },
  ) => {
    try {
      const id = (await context.params)?.id ?? "";
      if (!isValidObjectId(id)) return createErrorResponse("Invalid organization id", 400);
      const organization = await db.organization.findFirst({ where: { id } });
      if (!organization) return createErrorResponse("Organization not found", 404);
      if (!organization.stripeCustomerId) {
        return createErrorResponse("This organization does not have a Stripe customer", 409);
      }

      const session = await getBillingStripe().billingPortal.sessions.create({
        customer: organization.stripeCustomerId,
        return_url: `${resolveApplicationOrigin(request)}/admin/organizations/${id}`,
      });
      await recordPlatformAudit({
        actor,
        action: "billing.portal_opened",
        targetType: "billing",
        targetId: id,
        targetName: organization.name,
        organizationId: id,
        summary: `Billing portal opened for ${organization.name}`,
      });

      return createSuccessResponse({ url: session.url });
    } catch (error) {
      return handleApiError(error, "Failed to open billing portal");
    }
  },
);
