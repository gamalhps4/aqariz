export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  type AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  parseRequestBody,
  withPlatformAdminAndDB,
} from "@/lib/api-utils";
import { getPlanByKey, planExists } from "@/lib/billing/plans";
import { unlimitedPlanLimits } from "@/lib/billing/plan-constants";
import { recordPlatformAudit } from "@/lib/platform/audit";
import { bypassOrgScope } from "@/lib/tenancy/context";

const ALLOWED_STATUS = ["active", "suspended", "trial"] as const;
const STRIPE_MANAGED_STATUSES = [
  "incomplete",
  "trialing",
  "active",
  "past_due",
  "unpaid",
  "paused",
];

async function resolveId(context: { params?: Promise<{ id: string }> }): Promise<string> {
  return (await context.params)?.id ?? "";
}

export const GET = withPlatformAdminAndDB()(
  async (
    _actor: AuthenticatedAccessUser,
    _request: NextRequest,
    context: { params?: Promise<{ id: string }> },
  ) => {
    try {
      const id = await resolveId(context);
      if (!isValidObjectId(id)) return createErrorResponse("Invalid organization id", 400);

      const organization = await db.organization.findFirst({ where: { id } });
      if (!organization) return createErrorResponse("Organization not found", 404);

      // Deliberately no invoice or payment counts.
      //
      // What an organization bills its own tenants, and how much of it they
      // collect, is their business — the platform's relationship with them is
      // the subscription and nothing else. The counts here exist to show plan
      // usage, and the plan limits are properties, members, units and storage.
      // Invoice and payment volume are not limits, so surfacing them was a
      // window into their finances that served no purpose.
      const [owner, users, properties, leases] = await Promise.all([
        bypassOrgScope(() =>
          db.user.findFirst({
            where: { id: organization.ownerId },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              isActive: true,
              lastLogin: true,
            },
          }),
        ),
        bypassOrgScope(() =>
          db.user.count({
            where: { organizationId: organization.id, deletedAt: null },
          }),
        ),
        bypassOrgScope(() =>
          db.property.count({
            where: { organizationId: organization.id, deletedAt: null },
          }),
        ),
        bypassOrgScope(() =>
          db.lease.count({
            where: { organizationId: organization.id, deletedAt: null },
          }),
        ),
      ]);
      const plan =
        (await getPlanByKey(organization.plan)) ?? (await getPlanByKey("free"));

      return createSuccessResponse({
        organization: {
          id: organization.id,
          name: organization.name,
          slug: organization.slug,
          status: organization.status,
          plan: organization.plan,
          createdAt: organization.createdAt,
          updatedAt: organization.updatedAt,
          owner: owner
            ? {
                id: owner.id,
                name: `${owner.firstName} ${owner.lastName}`.trim(),
                email: owner.email,
                isActive: owner.isActive,
                lastLogin: owner.lastLogin ?? null,
              }
            : null,
          usage: { users, properties, leases },
          billing: {
            subscriptionStatus: organization.subscriptionStatus ?? null,
            stripeCustomerId: organization.stripeCustomerId ?? null,
            stripeSubscriptionId: organization.stripeSubscriptionId ?? null,
            stripePriceId: organization.stripePriceId ?? null,
            trialEndsAt: organization.trialEndsAt ?? null,
            currentPeriodEnd: organization.currentPeriodEnd ?? null,
            cancelAtPeriodEnd: organization.cancelAtPeriodEnd,
          },
          limits: plan?.limits ?? unlimitedPlanLimits(),
          modules: plan?.modules ?? [],
        },
      });
    } catch (error) {
      return handleApiError(error, "Failed to load organization");
    }
  },
);

export const PATCH = withPlatformAdminAndDB()(
  async (
    actor: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params?: Promise<{ id: string }> },
  ) => {
    try {
      const id = await resolveId(context);
      if (!isValidObjectId(id)) return createErrorResponse("Invalid organization id", 400);

      const parsed = await parseRequestBody(request);
      if (!parsed.success) return createErrorResponse(parsed.error!, 400);
      const input = parsed.data as {
        status?: string;
        plan?: string;
        trialEndsAt?: string | null;
      };
      if (input.status === undefined && input.plan === undefined && input.trialEndsAt === undefined) {
        return createErrorResponse("No supported changes were provided", 400);
      }

      const organization = await db.organization.findFirst({ where: { id } });
      if (!organization) return createErrorResponse("Organization not found", 404);

      const changes: Array<{
        action: "organization.status_changed" | "organization.plan_changed" | "organization.trial_changed";
        summary: string;
        previous: unknown;
        current: unknown;
      }> = [];
      const data: Prisma.OrganizationUpdateInput = {};

      if (input.status !== undefined) {
        if (!ALLOWED_STATUS.includes(input.status as (typeof ALLOWED_STATUS)[number])) {
          return createErrorResponse(`status must be one of: ${ALLOWED_STATUS.join(", ")}`, 400);
        }
        if (organization.status !== input.status) {
          changes.push({
            action: "organization.status_changed",
            summary: `${organization.name} status changed from ${organization.status} to ${input.status}`,
            previous: organization.status,
            current: input.status,
          });
          data.status = input.status;
        }
      }

      if (input.plan !== undefined) {
        if (!(await planExists(input.plan))) return createErrorResponse("Invalid billing plan", 400);
        const stripeManaged =
          Boolean(organization.stripeSubscriptionId) &&
          STRIPE_MANAGED_STATUSES.includes(organization.subscriptionStatus || "");
        if (stripeManaged && organization.plan !== input.plan) {
          return createErrorResponse(
            "This plan is managed by Stripe. Use the customer billing portal to change it.",
            409,
          );
        }
        if (organization.plan !== input.plan) {
          changes.push({
            action: "organization.plan_changed",
            summary: `${organization.name} plan changed from ${organization.plan} to ${input.plan}`,
            previous: organization.plan,
            current: input.plan,
          });
          data.plan = input.plan;
        }
      }

      if (input.trialEndsAt !== undefined) {
        let trialEndsAt: Date | null = null;
        if (input.trialEndsAt) {
          trialEndsAt = new Date(input.trialEndsAt);
          if (Number.isNaN(trialEndsAt.getTime())) {
            return createErrorResponse("trialEndsAt must be a valid date", 400);
          }
        }
        const previous = organization.trialEndsAt?.toISOString() ?? null;
        const current = trialEndsAt?.toISOString() ?? null;
        if (previous !== current) {
          changes.push({
            action: "organization.trial_changed",
            summary: trialEndsAt
              ? `${organization.name} trial updated to ${trialEndsAt.toISOString()}`
              : `${organization.name} trial end date cleared`,
            previous,
            current,
          });
          data.trialEndsAt = trialEndsAt;
        }
      }

      if (changes.length === 0) {
        return createSuccessResponse({ id, unchanged: true }, "No changes required");
      }
      const updated = await db.organization.update({ where: { id }, data });

      await Promise.all(
        changes.map((change) =>
          recordPlatformAudit({
            actor,
            action: change.action,
            targetType: "organization",
            targetId: id,
            targetName: organization.name,
            organizationId: id,
            summary: change.summary,
            metadata: { previous: change.previous, current: change.current },
          }),
        ),
      );

      return createSuccessResponse(
        {
          id,
          status: updated.status,
          plan: updated.plan,
          trialEndsAt: updated.trialEndsAt,
        },
        "Organization updated",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update organization");
    }
  },
);
