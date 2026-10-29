/**
 * PropertyPro SaaS - Billing status (banner feed)
 *
 * A deliberately small, permission-free read: every member of the
 * organization needs to know the account is about to lose access, not just
 * the person who can pay. /api/billing/subscription stays behind
 * `company_settings` because it exposes plan pricing and usage.
 */

import { NextRequest } from "next/server";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { requireUserOrganization } from "@/lib/billing/service";
import {
  DUNNING_GRACE_DAYS,
  daysBetween,
  isWithinDunningGrace,
} from "@/lib/billing/lifecycle";

export type BillingNoticeKind =
  | "trial_ending"
  | "trial_expired"
  | "past_due_grace"
  | "past_due_expired"
  | "canceling"
  | "suspended";

export const GET = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const organization = await requireUserOrganization(user);
      const now = new Date();

      let notice: {
        kind: BillingNoticeKind;
        severity: "info" | "warning" | "critical";
        message: string;
        daysRemaining?: number;
        /** ISO date, for the "canceling" notice's end date. */
        endsAt?: string;
      } | null = null;

      const canManageBilling =
        user.isAdmin || organization.ownerId === user.id;

      if (organization.status === "suspended") {
        notice = {
          kind: "suspended",
          severity: "critical",
          message:
            "This account is suspended. Contact support or settle the outstanding balance to restore access.",
        };
      } else if (
        organization.subscriptionStatus === "past_due" ||
        organization.subscriptionStatus === "unpaid"
      ) {
        const inGrace =
          organization.subscriptionStatus === "past_due" &&
          isWithinDunningGrace(organization.pastDueSince, now);
        const daysRemaining = organization.pastDueSince
          ? Math.max(
              0,
              DUNNING_GRACE_DAYS - daysBetween(organization.pastDueSince, now),
            )
          : DUNNING_GRACE_DAYS;

        notice = inGrace
          ? {
              kind: "past_due_grace",
              severity: "warning",
              message: `We couldn't process your last payment. Update your payment method within ${daysRemaining} day${
                daysRemaining === 1 ? "" : "s"
              } to keep your paid features.`,
              daysRemaining,
            }
          : {
              kind: "past_due_expired",
              severity: "critical",
              message:
                "Your subscription is unpaid and paid features are paused. Update your payment method to restore them.",
            };
      } else if (organization.status === "trial" && organization.trialEndsAt) {
        const daysRemaining = daysBetween(now, organization.trialEndsAt);
        if (daysRemaining < 0) {
          notice = {
            kind: "trial_expired",
            severity: "warning",
            message:
              "Your trial has ended. Choose a plan to restore your previous limits and features.",
          };
        } else if (daysRemaining <= 7) {
          notice = {
            kind: "trial_ending",
            severity: daysRemaining <= 2 ? "warning" : "info",
            message: `Your trial ends in ${daysRemaining + 1} day${
              daysRemaining === 0 ? "" : "s"
            }. Choose a plan to keep your current limits.`,
            daysRemaining: daysRemaining + 1,
          };
        }
      } else if (organization.cancelAtPeriodEnd && organization.currentPeriodEnd) {
        notice = {
          kind: "canceling",
          severity: "info",
          message: `Your subscription ends on ${organization.currentPeriodEnd.toDateString()}. You can resume it any time before then.`,
          endsAt: organization.currentPeriodEnd.toISOString(),
        };
      }

      return createSuccessResponse({ notice, canManageBilling });
    } catch (error) {
      return handleApiError(error, "Failed to retrieve billing status");
    }
  },
);
