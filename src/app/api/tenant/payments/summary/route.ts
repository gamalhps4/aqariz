/**
 * PropertyPro - Tenant Payment Summary API
 * API endpoint for tenant payment summary and statistics
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  addBusinessMonths,
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessDaysBetween,
  businessDaysUntil,
  businessMonth,
  businessMonthRange,
  businessToday,
  startOfBusinessDay,
} from "@/lib/dates/business-day";

// ============================================================================
// GET /api/tenant/payments/summary - Get tenant payment summary
// ============================================================================

export const GET = withPermissionAndDB("payment_portal")(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context?: { tenantProfile?: any }
  ) => {
    try {
      const tenant = context?.tenantProfile;
      if (!tenant) {
        return createErrorResponse("Tenant profile unavailable", 500);
      }

      // Get current year date range — on the office's calendar (Riyadh), the
      // whole of the first day to the whole of the last.
      const now = new Date();
      const today = businessToday(now);
      const currentYear = Number(today.slice(0, 4));
      const yearStart = businessDayStart(`${currentYear}-01-01`);
      const yearEnd = businessDayEnd(`${currentYear}-12-31`);

      const paidStatusValues = [PaymentStatus.PAID];

      const overdueStatusValues = [
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
      ];

      const pendingStatusValues = [
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        ...overdueStatusValues,
      ];

      const isPaid = (status: string | undefined | null) =>
        status ? paidStatusValues.includes(status as PaymentStatus) : false;

      const isPending = (status: string | undefined | null) =>
        status ? pendingStatusValues.includes(status as PaymentStatus) : false;

      const isOverdue = (status: string | undefined | null) =>
        status ? overdueStatusValues.includes(status as PaymentStatus) : false;

      // Get all payments for this tenant
      const allPayments = await db.payment.findMany({
        where: { tenantId: user.id },
      });

      // Get payments for current year
      const yearPayments = allPayments.filter(
        (payment) =>
          payment.createdAt >= yearStart && payment.createdAt <= yearEnd
      );

      // Calculate total paid this year
      const totalPaid = yearPayments
        .filter((payment) => isPaid(payment.status))
        .reduce((sum, payment) => sum + payment.amount, 0);

      // Calculate total outstanding
      const totalOutstanding = yearPayments
        .filter((payment) => isPending(payment.status))
        .reduce((sum, payment) => sum + payment.amount, 0);

      // Find next payment due
      const nextPayment = await db.payment.findFirst({
        where: {
          tenantId: user.id,
          status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
          // Due today is still to come: the day is over at Riyadh's midnight.
          dueDate: { gte: startOfBusinessDay(now) },
        },
        orderBy: { dueDate: "asc" },
      });

      let nextPaymentDue = null;
      if (nextPayment) {
        const daysUntilDue = businessDaysUntil(nextPayment.dueDate, now);

        nextPaymentDue = {
          amount: nextPayment.amount,
          dueDate: nextPayment.dueDate,
          daysUntilDue,
        };
      }

      // Calculate on-time payment rate
      const paidPayments = allPayments.filter((payment) =>
        isPaid(payment.status)
      );
      const onTimePayments = paidPayments.filter((payment) => {
        if (!payment.paidDate) return false;
        // On time is on or before the due day, however late in it.
        return businessDay(payment.paidDate) <= businessDay(payment.dueDate);
      });

      const onTimePaymentRate =
        paidPayments.length > 0
          ? (onTimePayments.length / paidPayments.length) * 100
          : 0;

      // Calculate monthly statistics
      const monthStart = businessDayStart(businessMonthRange(today).from);

      const monthlyPayments = yearPayments.filter(
        (payment) => new Date(payment.createdAt) >= monthStart
      );

      const paymentsThisMonth = monthlyPayments.filter((payment) =>
        isPaid(payment.status)
      ).length;

      // Calculate average payment amount
      const averagePaymentAmount =
        allPayments.length > 0
          ? allPayments.reduce((sum, payment) => sum + payment.amount, 0) /
            allPayments.length
          : 0;

      // Get payment trends for last 6 months
      const sixMonthsAgo = businessDayStart(addBusinessMonths(today, -6));

      const recentPayments = allPayments.filter(
        (payment) =>
          isPaid(payment.status) &&
          payment.paidDate &&
          new Date(payment.paidDate) >= sixMonthsAgo
      );

      // Group by month
      const monthlyTotals = new Map();
      recentPayments.forEach((payment) => {
        const monthKey = businessMonth(payment.paidDate);

        if (!monthlyTotals.has(monthKey)) {
          monthlyTotals.set(monthKey, { month: monthKey, total: 0, count: 0 });
        }

        const monthData = monthlyTotals.get(monthKey);
        monthData.total += payment.amount;
        monthData.count += 1;
      });

      const paymentTrends = Array.from(monthlyTotals.values()).sort((a, b) =>
        a.month.localeCompare(b.month)
      );

      const monthlyAverage =
        paymentTrends.length > 0
          ? paymentTrends.reduce((sum, month) => sum + month.total, 0) /
            paymentTrends.length
          : 0;

      // Calculate average payment time (days after due date)
      const paymentTimes = paidPayments
        .filter((payment) => payment.paidDate)
        .map((payment) => {
          // Calendar days after the due day: 0 when paid on it.
          return businessDaysBetween(
            businessDay(payment.dueDate),
            businessDay(payment.paidDate),
          );
        });

      const averagePaymentTime =
        paymentTimes.length > 0
          ? paymentTimes.reduce((sum, days) => sum + days, 0) /
            paymentTimes.length
          : 0;

      // Get payment trends (last 12 months)
      const monthlyTrends = [];
      for (let i = 11; i >= 0; i--) {
        const month = businessMonthRange(addBusinessMonths(today, -i));
        const monthStart = businessDayStart(month.from);
        const monthEnd = businessDayEnd(month.to);

        const monthPayments = allPayments.filter(
          (payment) =>
            isPaid(payment.status) &&
            payment.paidDate &&
            payment.paidDate >= monthStart &&
            payment.paidDate <= monthEnd
        );

        const monthTotal = monthPayments.reduce(
          (sum, payment) => sum + payment.amount,
          0
        );

        monthlyTrends.push({
          month: month.from.slice(0, 7), // YYYY-MM format
          amount: monthTotal,
          count: monthPayments.length,
        });
      }

      // Get payment type breakdown
      const paymentTypeGroups = await db.payment.groupBy({
        by: ["type"],
        where: {
          tenantId: user.id,
          status: { in: paidStatusValues },
        },
        _sum: { amount: true },
        _count: { _all: true },
      });

      const paymentTypes = paymentTypeGroups.map((group) => ({
        _id: group.type,
        total: group._sum.amount ?? 0,
        count: group._count._all,
      }));

      const summary = {
        totalPaid,
        totalPending: yearPayments
          .filter((payment) => payment.status === PaymentStatus.PENDING)
          .reduce((sum, payment) => sum + payment.amount, 0),
        totalOverdue: yearPayments
          .filter((payment) => payment.status === PaymentStatus.OVERDUE)
          .reduce((sum, payment) => sum + payment.amount, 0),
        totalOutstanding,
        paymentsThisMonth,
        paymentsThisYear: yearPayments.filter((payment) =>
          isPaid(payment.status)
        ).length,
        averagePaymentAmount,
        onTimePaymentRate,
        nextPaymentDue,
        averagePaymentTime,
        paymentTrends: {
          last6Months: paymentTrends,
          monthlyAverage,
        },
        monthlyTrends, // Keep for backward compatibility
        paymentTypes,
        statistics: {
          totalPayments: allPayments.length,
          paidPayments: paidPayments.length,
          pendingPayments: allPayments.filter((p) => isPending(p.status))
            .length,
          overduePayments: allPayments.filter((p) => isOverdue(p.status))
            .length,
        },
      };

      return createSuccessResponse(summary);
    } catch (error) {
      return handleApiError(error, "Failed to fetch payment summary");
    }
  }
);
