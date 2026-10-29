/**
 * PropertyPro - Invoice Status Cron
 * Persists time-based invoice status transitions (SCHEDULED→ISSUED, →OVERDUE)
 * so reports and queries filtered by `status` stay accurate.
 *
 * Read paths overlay the effective status at request time; this cron keeps
 * the persisted field from drifting for batch filters and analytics.
 */

import { NextResponse } from "next/server";
import { rejectUnauthorizedCron, withCronLock } from "@/lib/cron/request";
import { db } from "@/lib/db/prisma";
import { InvoiceStatus } from "@/types";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { endOfBusinessDay, startOfBusinessDay } from "@/lib/dates/business-day";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  try {
    const now = new Date();

    // SCHEDULED → ISSUED for invoices whose issue day has arrived — the day
    // on Riyadh's calendar, which turns over at its midnight, not at the
    // server's 03:00 later.
    const lock = await withCronLock("invoice-status", () =>
      bypassOrgScope(async () => {
      const issuedRes = await db.invoice.updateMany({
        where: {
          status: InvoiceStatus.SCHEDULED,
          issueDate: { lte: endOfBusinessDay(now) },
          balanceRemaining: { gt: 0 },
        },
        data: { status: InvoiceStatus.ISSUED, updatedAt: now },
      });

      // Overdue only once the due DAY has fully passed (due dates are stored
      // at midnight; comparing against `now` flagged tenants overdue all day
      // on the day rent was due). The day ends at Riyadh's midnight.
      const startOfToday = startOfBusinessDay(now);
      const overdueRes = await db.invoice.updateMany({
        where: {
          status: { in: [InvoiceStatus.ISSUED, InvoiceStatus.PARTIAL] },
          dueDate: { lt: startOfToday },
          balanceRemaining: { gt: 0 },
        },
        data: { status: InvoiceStatus.OVERDUE, updatedAt: now },
      });
      return { issuedRes, overdueRes };
      })
    );

    if (lock.skipped || !lock.result) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous invoice-status sync still running",
      });
    }

    return NextResponse.json({
      success: true,
      message: "Invoice status sync completed",
      data: {
        issued: lock.result.issuedRes.count,
        overdue: lock.result.overdueRes.count,
      },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("Error in invoice-status cron:", error);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}
