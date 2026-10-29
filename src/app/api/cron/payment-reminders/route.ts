/**
 * PropertyPro SaaS - Rent reminder cron
 *
 * Reminds tenants about rent that is about to fall due and rent that is
 * already overdue — the one rent reminder path. (The in-process automation
 * engine used to remind a second time per payment row, and an overdue tenant
 * daily for ever; see lib/notification-automation.ts.)
 *
 * Schedule daily:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/payment-reminders
 *
 * Cadence: one reminder 3 days before the due date, then overdue nudges on
 * days 1, 7 and 14 — Riyadh calendar days. Each goes by email, in-app, and by
 * SMS and WhatsApp where the office has switched those on for the event
 * (Settings → Messaging), in the office's language. Each stage is appended to
 * the invoice's `remindersSent` log once it has been attempted, so re-running
 * the cron — or running it twice in a day — never sends the same stage twice.
 */

import { NextResponse } from "next/server";
import { db } from "@/lib/db/prisma";
import { InvoiceStatus } from "@/types";
import {
  rejectUnauthorizedCron,
  forEachOrganization,
  withCronLock,
} from "@/lib/cron/request";
import { organizationHasModule } from "@/lib/billing/entitlements";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import {
  addBusinessDays,
  businessDayStart,
  businessDaysUntil,
  businessToday,
} from "@/lib/dates/business-day";
import { officeName } from "@/lib/messaging/events";
import {
  REMINDER_INVOICE_SELECT,
  reminderLog,
  sendInvoiceReminder,
} from "@/lib/invoice/reminder";

export const dynamic = "force-dynamic";

/** Days before the due date that the upcoming-rent reminder goes out. */
const UPCOMING_REMINDER_DAYS = 3;
/** Days after the due date that overdue nudges go out. */
const OVERDUE_REMINDER_DAYS = [1, 7, 14];

export async function GET(request: Request) {
  const unauthorized = rejectUnauthorizedCron(request);
  if (unauthorized) return unauthorized;

  try {
    const now = new Date();
    const today = businessToday(now);
    // A day either side of the cadence: the exact stage is decided per
    // invoice below, on Riyadh days.
    const windowStart = businessDayStart(
      addBusinessDays(today, -(Math.max(...OVERDUE_REMINDER_DAYS) + 1)),
    );
    const windowEnd = businessDayStart(
      addBusinessDays(today, UPCOMING_REMINDER_DAYS + 2),
    );

    const lock = await withCronLock("payment-reminders", () =>
      forEachOrganization(async (organizationId) => {
      // Rent reminders are part of Collections: an office whose package
      // leaves the section out (or a platform switch turned it off) is not
      // emailing its tenants through us.
      if (!(await organizationHasModule(organizationId, "section.collections"))) {
        return { candidates: 0, sent: 0, skipped: 0 };
      }
      const invoices = await db.invoice.findMany({
        where: {
          deletedAt: null,
          balanceRemaining: { gt: 0 },
          status: {
            in: [
              InvoiceStatus.ISSUED,
              InvoiceStatus.PARTIAL,
              InvoiceStatus.OVERDUE,
            ],
          },
          dueDate: { gte: windowStart, lt: windowEnd },
        },
        select: REMINDER_INVOICE_SELECT,
      });

      let sent = 0;
      let skipped = 0;
      // The office this sweep is for decides the language of every reminder.
      const locale = invoices.length > 0 ? await recipientLocale() : null;
      const office = invoices.length > 0 ? await officeName() : "";

      for (const invoice of invoices) {
        const offset = businessDaysUntil(invoice.dueDate, now);
        const isUpcoming = offset === UPCOMING_REMINDER_DAYS;
        const daysOverdue = offset < 0 ? Math.abs(offset) : 0;
        const isOverdueNudge = OVERDUE_REMINDER_DAYS.includes(daysOverdue);

        if (!isUpcoming && !isOverdueNudge) {
          skipped += 1;
          continue;
        }

        // One entry per cadence stage ("upcoming" / "overdue-7"), so the log
        // itself is the idempotency key — no extra column, and a stage can
        // never repeat.
        const stage = isUpcoming ? "upcoming" : `overdue-${daysOverdue}`;
        if (reminderLog(invoice.remindersSent).some((entry) => entry.stage === stage)) {
          skipped += 1;
          continue;
        }
        if (
          !locale ||
          !(await sendInvoiceReminder(invoice, { locale, office, now, stage }))
        ) {
          skipped += 1;
          continue;
        }
        sent += 1;
      }

      return { candidates: invoices.length, sent, skipped };
      })
    );

    if (lock.skipped || !lock.result) {
      return NextResponse.json({
        success: true,
        skipped: true,
        message: "Previous reminder run still in progress",
      });
    }
    const sweep = lock.result;

    const totals = sweep.results.reduce(
      (acc, entry) => {
        if (!entry.result) return acc;
        acc.candidates += entry.result.candidates;
        acc.sent += entry.result.sent;
        acc.skipped += entry.result.skipped;
        return acc;
      },
      { candidates: 0, sent: 0, skipped: 0 },
    );

    return NextResponse.json({
      success: true,
      message: "Rent reminders processed",
      data: {
        organizations: sweep.organizations,
        failedOrganizations: sweep.failed,
        ...totals,
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error in payment-reminders cron:", error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
