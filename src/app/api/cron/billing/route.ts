/**
 * PropertyPro SaaS - Billing lifecycle cron
 *
 * Drives the trial and dunning state machines that Stripe webhooks cannot:
 * webhooks only fire when Stripe has something to say, but a trial started at
 * signup has no Stripe object at all, and a past-due grace window expires on
 * a date rather than on an event.
 *
 * Schedule daily:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/billing
 */

import { NextResponse } from "next/server";
import { rejectUnauthorizedCron, withCronLock } from "@/lib/cron/request";
import { runBillingLifecycleSweep } from "@/lib/billing/lifecycle";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  try {
    // Advisory lock: overlapping fires (slow run + next tick) skip instead
    // of double-running the sweep.
    const lock = await withCronLock("billing", () => runBillingLifecycleSweep());
    if (lock.skipped) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous billing sweep still running",
      });
    }
    return NextResponse.json({
      success: true,
      message: "Billing lifecycle sweep completed",
      data: lock.result,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in billing cron:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
