/**
 * PropertyPro - Payment analytics
 *
 * GET /api/payments/reports/analytics?startDate=&endDate=&ownerId=&propertyId=&status=&paymentType=
 *
 * The analytics page used to add up whatever the payments list handed it —
 * the first twelve rows, since it sent no limit — filtered on the day each
 * row was written, and called the billed amounts "revenue". Every figure is
 * now worked out here, over every payment in the period the caller can see:
 *
 *   - money received, by the day it arrived, with refunds taken off — the
 *     payment report's own lines and breakdowns (payment-register.ts), so
 *     the two pages cannot disagree;
 *   - what fell due in the period and how much of it has come in;
 *   - what is owed now, and the part of it already late.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import type { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  withAccessAndDB,
} from "@/lib/api-utils";
import { invoiceScope } from "@/lib/db/scopes";
import { UserRole } from "@/types";
import { getCollectionsReport } from "@/lib/services/payment-reports.service";
import {
  collectionInvoicesWhere,
  isPaymentRegisterStatus,
  OPEN_INVOICE_STATUSES,
  type PaymentRegisterStatus,
} from "@/lib/reports/report-where";
import type { PaymentAnalytics } from "@/types/payment-report";
import {
  businessDayEnd,
  businessDayStart,
  businessDaysBetween,
  businessToday,
  parseBusinessDay,
  startOfBusinessDay,
  trailingDays,
} from "@/lib/dates/business-day";

/** Whoever can read the payments list can read its analytics, in their scope. */
const ANALYTICS_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "payment_view",
    "payment_processing",
    "financial_management",
    "financial_reports",
  ],
  match: "any" as const,
};

/** The period when none is asked for: the last 30 days, today included. */
const DEFAULT_DAYS = 30;

const CODE = /^[a-z][a-z0-9_]{0,39}$/;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export const GET = withAccessAndDB(ANALYTICS_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);

      // Days on the office's calendar (Riyadh), whatever zone the server
      // runs in: the period starts at Riyadh's midnight on its first day and
      // takes in the whole of its last.
      const endDay = parseBusinessDay(searchParams.get("endDate")) ?? businessToday();
      const startDay =
        parseBusinessDay(searchParams.get("startDate")) ??
        trailingDays(DEFAULT_DAYS, endDay).from;
      if (endDay < startDay) {
        return createErrorResponse("End date must be after the start date", 400);
      }
      const rangeStart = businessDayStart(startDay);
      const rangeEnd = businessDayEnd(endDay);

      const status = searchParams.get("status") || undefined;
      if (status && !isPaymentRegisterStatus(status)) {
        return createErrorResponse(`Unknown payment status "${status}"`, 400);
      }
      const paymentType = searchParams.get("paymentType") || undefined;
      if (paymentType && !CODE.test(paymentType)) {
        return createErrorResponse(`Unknown payment type "${paymentType}"`, 400);
      }
      // Building filters are the office's; a tenant's or owner's scope already
      // narrows them, and the scope is AND-ed on in every query below.
      const propertyId = (!user.isTenant && searchParams.get("propertyId")) || undefined;
      const ownerId = (!user.isTenant && searchParams.get("ownerId")) || undefined;

      // An installment's category is the payment type's counterpart; a
      // generic "invoice" payment has none.
      const category: Prisma.InvoiceWhereInput =
        paymentType && paymentType !== "invoice" ? { category: paymentType } : {};
      const scope = invoiceScope(user);
      const dueInPeriod = collectionInvoicesWhere(
        { propertyId, ownerId, dueFrom: rangeStart, dueTo: rangeEnd },
        scope,
      );
      const owingNow: Prisma.InvoiceWhereInput = {
        AND: [
          collectionInvoicesWhere({ propertyId, ownerId }, scope),
          { status: { in: OPEN_INVOICE_STATUSES }, balanceRemaining: { gt: 0 } },
          category,
        ],
      };

      const [register, due, owing, late] = await Promise.all([
        getCollectionsReport({
          startDate: rangeStart,
          endDate: rangeEnd,
          propertyId,
          ownerId,
          status: status as PaymentRegisterStatus | undefined,
          paymentType,
          summaryOnly: true,
          actor: user,
        }),
        db.invoice.aggregate({
          where: { AND: [dueInPeriod, category] },
          _sum: { totalAmount: true, amountPaid: true, balanceRemaining: true },
          _count: true,
        }),
        db.invoice.aggregate({
          where: owingNow,
          _sum: { balanceRemaining: true },
          _count: true,
        }),
        db.invoice.aggregate({
          // Late: due before today began, on the office's calendar.
          where: { AND: [owingNow, { dueDate: { lt: startOfBusinessDay() } }] },
          _sum: { balanceRemaining: true },
          _count: true,
        }),
      ]);

      const billed = round(Number(due._sum.totalAmount ?? 0));
      const collected = round(Number(due._sum.amountPaid ?? 0));
      const days = businessDaysBetween(startDay, endDay) + 1;

      const analytics: PaymentAnalytics = {
        period: { startDate: startDay, endDate: endDay, days },
        received: register.summary,
        due: {
          installmentCount: due._count,
          billed,
          collected,
          outstanding: round(Number(due._sum.balanceRemaining ?? 0)),
          // Of what fell due in the period, how much has come in.
          collectionRate: billed > 0 ? Math.round((collected / billed) * 1000) / 10 : 0,
        },
        outstanding: {
          amount: round(Number(owing._sum.balanceRemaining ?? 0)),
          count: owing._count,
        },
        overdue: {
          amount: round(Number(late._sum.balanceRemaining ?? 0)),
          count: late._count,
        },
      };

      return createSuccessResponse(analytics, "Analytics generated successfully");
    } catch (error) {
      return handleApiError(error, "Failed to generate the analytics");
    }
  },
);
