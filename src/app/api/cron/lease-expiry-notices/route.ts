/**
 * PropertyPro SaaS - Lease expiry notice cron
 *
 * Tells the tenant, the building's owner and its manager that a contract ends
 * in 90, 60, 30, 14 and 7 days — by email, in-app, and by SMS and WhatsApp
 * where the office has switched those on for the event (Settings →
 * Messaging). See `sendLeaseExpiryNotices` in lib/notification-automation.ts.
 *
 * This used to run on a timer inside the web process, started by the first
 * request to /api/notifications: every server instance ran its own copy, a
 * restart lost or repeated a day, and nothing ran until somebody opened the
 * notifications screen. A cron route runs once, wherever the scheduler is.
 *
 * Schedule daily (docs/scheduled-jobs.md):
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/lease-expiry-notices
 *
 * Idempotent: a person already notified for a lease's step is skipped, so a
 * second run on the same day sends nothing.
 */

import { NextResponse } from "next/server";
import {
  forEachOrganization,
  rejectUnauthorizedCron,
  withCronLock,
} from "@/lib/cron/request";
import { sendLeaseExpiryNotices } from "@/lib/notification-automation";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  try {
    const lock = await withCronLock("lease-expiry-notices", () =>
      forEachOrganization(() => sendLeaseExpiryNotices()),
    );

    if (lock.skipped || !lock.result) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous lease expiry run still in progress",
      });
    }
    const sweep = lock.result;
    const totals = sweep.results.reduce(
      (acc, entry) => {
        if (!entry.result) return acc;
        acc.leases += entry.result.leases;
        acc.notices += entry.result.notices;
        return acc;
      },
      { leases: 0, notices: 0 },
    );

    return NextResponse.json({
      success: true,
      message: "Lease expiry notices processed",
      data: {
        organizations: sweep.organizations,
        failedOrganizations: sweep.failed,
        ...totals,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in lease-expiry-notices cron:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
