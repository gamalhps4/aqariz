/**
 * PropertyPro - Enhanced Payment Dashboard Service
 * Real-world metrics including collection rates, aging reports, and payment behavior analytics
 */

import { PaymentStatus } from "@/types";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { formatCurrency } from "@/lib/utils/formatting";
import {
  addBusinessDays,
  addBusinessMonths,
  businessDayEnd,
  businessDayStart,
  businessMonthRange,
  businessToday,
  endOfBusinessDay,
} from "@/lib/dates/business-day";

export interface CollectionMetrics {
  currentMonth: {
    collected: number;
    expected: number;
    collectionRate: number;
    outstanding: number;
  };
  previousMonth: {
    collected: number;
    expected: number;
    collectionRate: number;
  };
  yearToDate: {
    collected: number;
    expected: number;
    collectionRate: number;
  };
  averageDaysToPayment: number;
  totalPortfolioCollected: number;
}

export interface AgingReport {
  current: { count: number; amount: number }; // 0-30 days
  early: { count: number; amount: number }; // 31-60 days
  serious: { count: number; amount: number }; // 61-90 days
  critical: { count: number; amount: number }; // 90+ days
  totalOverdue: { count: number; amount: number };
}

export interface PaymentBehaviorAnalytics {
  onTimePayments: number;
  latePayments: number;
  averageLateDays: number;
  repeatOffenders: Array<{
    tenantId: string;
    tenantName: string;
    latePaymentCount: number;
    averageLateDays: number;
  }>;
  paymentMethodPreferences: Record<string, number>;
  seasonalTrends: Array<{
    month: string;
    collectionRate: number;
    averageDays: number;
  }>;
}

export interface CashFlowProjection {
  nextMonth: {
    expected: number;
    projected: number;
    confidence: number;
  };
  next3Months: {
    expected: number;
    projected: number;
    confidence: number;
  };
  riskFactors: string[];
  opportunities: string[];
}

export interface DashboardMetrics {
  collectionMetrics: CollectionMetrics;
  agingReport: AgingReport;
  paymentBehavior: PaymentBehaviorAnalytics;
  cashFlowProjection: CashFlowProjection;
  kpis: {
    collectionRate: number;
    averageDaysLate: number;
    lateFeeRevenue: number;
    vacancyImpact: number;
  };
  alerts: Array<{
    type: "warning" | "error" | "info";
    message: string;
    priority: number;
  }>;
}

export class PaymentDashboardService {
  /**
   * Get comprehensive dashboard metrics
   */
  async getDashboardMetrics(filters?: {
    propertyId?: string;
    managerId?: string;
    dateRange?: { start: Date; end: Date };
  }): Promise<DashboardMetrics> {
    const [
      collectionMetrics,
      agingReport,
      paymentBehavior,
      cashFlowProjection,
    ] = await Promise.all([
      this.getCollectionMetrics(filters),
      this.getAgingReport(filters),
      this.getPaymentBehaviorAnalytics(filters),
      this.getCashFlowProjection(filters),
    ]);

    const kpis = {
      collectionRate: collectionMetrics.currentMonth.collectionRate,
      averageDaysLate: paymentBehavior.averageLateDays,
      lateFeeRevenue: await this.getLateFeeRevenue(filters),
      vacancyImpact: await this.getVacancyImpact(filters),
    };

    const alerts = await this.generateAlerts(
      collectionMetrics,
      agingReport,
      paymentBehavior
    );

    return {
      collectionMetrics,
      agingReport,
      paymentBehavior,
      cashFlowProjection,
      kpis,
      alerts,
    };
  }

  /**
   * Calculate collection metrics
   */
  async getCollectionMetrics(filters?: any): Promise<CollectionMetrics> {
    // The months and the year are Riyadh's, and "up to now" takes in the whole
    // of today: rent due today is due, whatever hour the server is asked.
    const today = businessToday();
    const lastMonth = businessMonthRange(addBusinessMonths(today, -1));
    const now = new Date();
    const todayEnd = endOfBusinessDay(now);
    const currentMonthStart = businessDayStart(businessMonthRange(today).from);
    const previousMonthStart = businessDayStart(lastMonth.from);
    const previousMonthEnd = businessDayEnd(lastMonth.to);
    const yearStart = businessDayStart(`${today.slice(0, 4)}-01-01`);

    // Each query below pins its own due-date window, which (as before)
    // supersedes any dateRange filter.
    const base = this.buildFilterSql(filters, { includeDateRange: false });

    type ExpectedCollectedRow = {
      totalExpected: number;
      totalCollected: number;
      totalOutstanding: number;
    };

    // Current month metrics
    const currentMonthData = await db.$queryRaw<ExpectedCollectedRow[]>`
      SELECT
        COALESCE(sum(amount), 0)::float AS "totalExpected",
        COALESCE(sum(amount) FILTER (WHERE status = ${PaymentStatus.PAID}), 0)::float AS "totalCollected",
        COALESCE(sum(amount) FILTER (WHERE status <> ${PaymentStatus.PAID}), 0)::float AS "totalOutstanding"
      FROM payments
      WHERE ${base}
        AND "dueDate" >= ${currentMonthStart} AND "dueDate" <= ${todayEnd}
        AND type = 'rent'
    `;

    // Previous month metrics
    const previousMonthData = await db.$queryRaw<ExpectedCollectedRow[]>`
      SELECT
        COALESCE(sum(amount), 0)::float AS "totalExpected",
        COALESCE(sum(amount) FILTER (WHERE status = ${PaymentStatus.PAID}), 0)::float AS "totalCollected",
        COALESCE(sum(amount) FILTER (WHERE status <> ${PaymentStatus.PAID}), 0)::float AS "totalOutstanding"
      FROM payments
      WHERE ${base}
        AND "dueDate" >= ${previousMonthStart} AND "dueDate" <= ${previousMonthEnd}
        AND type = 'rent'
    `;

    // Year to date metrics
    const ytdData = await db.$queryRaw<ExpectedCollectedRow[]>`
      SELECT
        COALESCE(sum(amount), 0)::float AS "totalExpected",
        COALESCE(sum(amount) FILTER (WHERE status = ${PaymentStatus.PAID}), 0)::float AS "totalCollected",
        COALESCE(sum(amount) FILTER (WHERE status <> ${PaymentStatus.PAID}), 0)::float AS "totalOutstanding"
      FROM payments
      WHERE ${base}
        AND "dueDate" >= ${yearStart} AND "dueDate" <= ${todayEnd}
        AND type = 'rent'
    `;

    // Average days to payment (paid within the last 90 days of due dates)
    const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    const avgDaysData = await db.$queryRaw<Array<{ averageDays: number }>>`
      SELECT
        COALESCE(avg(EXTRACT(EPOCH FROM ("paidDate" - "dueDate")) / 86400.0), 0)::float AS "averageDays"
      FROM payments
      WHERE ${base}
        AND status = ${PaymentStatus.PAID}
        AND "paidDate" IS NOT NULL
        AND "dueDate" >= ${ninetyDaysAgo}
    `;

    const current = currentMonthData[0] || {
      totalExpected: 0,
      totalCollected: 0,
      totalOutstanding: 0,
    };
    const previous = previousMonthData[0] || {
      totalExpected: 0,
      totalCollected: 0,
    };
    const ytd = ytdData[0] || { totalExpected: 0, totalCollected: 0 };
    const avgDays = avgDaysData[0]?.averageDays || 0;

    return {
      currentMonth: {
        collected: current.totalCollected,
        expected: current.totalExpected,
        collectionRate:
          current.totalExpected > 0
            ? (current.totalCollected / current.totalExpected) * 100
            : 0,
        outstanding: current.totalOutstanding,
      },
      previousMonth: {
        collected: previous.totalCollected,
        expected: previous.totalExpected,
        collectionRate:
          previous.totalExpected > 0
            ? (previous.totalCollected / previous.totalExpected) * 100
            : 0,
      },
      yearToDate: {
        collected: ytd.totalCollected,
        expected: ytd.totalExpected,
        collectionRate:
          ytd.totalExpected > 0
            ? (ytd.totalCollected / ytd.totalExpected) * 100
            : 0,
      },
      averageDaysToPayment: Math.round(avgDays * 10) / 10,
      totalPortfolioCollected: ytd.totalCollected,
    };
  }

  /**
   * Generate aging report
   */
  async getAgingReport(filters?: any): Promise<AgingReport> {
    const now = new Date();
    const base = this.buildFilterSql(filters, { includeDateRange: false });

    const agingData = await db.$queryRaw<
      Array<{ category: string; count: number; amount: number }>
    >`
      SELECT
        category,
        count(*)::int AS "count",
        COALESCE(sum(amount), 0)::float AS "amount"
      FROM (
        SELECT
          amount,
          CASE
            WHEN EXTRACT(EPOCH FROM (${now}::timestamp - "dueDate")) / 86400.0 <= 30 THEN 'current'
            WHEN EXTRACT(EPOCH FROM (${now}::timestamp - "dueDate")) / 86400.0 <= 60 THEN 'early'
            WHEN EXTRACT(EPOCH FROM (${now}::timestamp - "dueDate")) / 86400.0 <= 90 THEN 'serious'
            ELSE 'critical'
          END AS category
        FROM payments
        WHERE ${base}
          AND status NOT IN (${PaymentStatus.PAID}, ${PaymentStatus.CANCELLED})
          AND "dueDate" < ${now}
      ) overdue
      GROUP BY category
    `;

    const aging = {
      current: { count: 0, amount: 0 },
      early: { count: 0, amount: 0 },
      serious: { count: 0, amount: 0 },
      critical: { count: 0, amount: 0 },
      totalOverdue: { count: 0, amount: 0 },
    };

    agingData.forEach((item) => {
      aging[item.category as keyof typeof aging] = {
        count: item.count,
        amount: item.amount,
      };
      aging.totalOverdue.count += item.count;
      aging.totalOverdue.amount += item.amount;
    });

    return aging;
  }

  /**
   * Analyze payment behavior patterns
   */
  async getPaymentBehaviorAnalytics(
    filters?: any
  ): Promise<PaymentBehaviorAnalytics> {
    const last90Days = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
    const base = this.buildFilterSql(filters, { includeDateRange: false });
    const baseAliased = this.buildFilterSql(filters, {
      includeDateRange: false,
      alias: "p.",
    });

    // On-time vs late payments (days late clamped at 0, as before)
    const paymentTimingData = await db.$queryRaw<
      Array<{
        onTimePayments: number;
        latePayments: number;
        averageLateDays: number;
      }>
    >`
      SELECT
        (count(*) FILTER (
          WHERE GREATEST(0, EXTRACT(EPOCH FROM ("paidDate" - "dueDate")) / 86400.0) <= 0
        ))::int AS "onTimePayments",
        (count(*) FILTER (
          WHERE GREATEST(0, EXTRACT(EPOCH FROM ("paidDate" - "dueDate")) / 86400.0) > 0
        ))::int AS "latePayments",
        COALESCE(avg(GREATEST(0, EXTRACT(EPOCH FROM ("paidDate" - "dueDate")) / 86400.0)), 0)::float AS "averageLateDays"
      FROM payments
      WHERE ${base}
        AND status = ${PaymentStatus.PAID}
        AND "paidDate" IS NOT NULL
        AND "dueDate" >= ${last90Days}
    `;

    // Repeat offenders analysis (2+ payments more than 5 days late)
    const repeatOffendersData = await db.$queryRaw<
      Array<{
        tenantId: string;
        latePaymentCount: number;
        averageLateDays: number;
        tenantName: string | null;
      }>
    >`
      SELECT
        p."tenantId" AS "tenantId",
        count(*)::int AS "latePaymentCount",
        COALESCE(avg(GREATEST(0, EXTRACT(EPOCH FROM (p."paidDate" - p."dueDate")) / 86400.0)), 0)::float AS "averageLateDays",
        (u."firstName" || ' ' || u."lastName") AS "tenantName"
      FROM payments p
      LEFT JOIN users u ON u.id = p."tenantId"
      WHERE ${baseAliased}
        AND p.status = ${PaymentStatus.PAID}
        AND p."paidDate" IS NOT NULL
        AND p."dueDate" >= ${last90Days}
        AND EXTRACT(EPOCH FROM (p."paidDate" - p."dueDate")) / 86400.0 > 5
      GROUP BY p."tenantId", u."firstName", u."lastName"
      HAVING count(*) >= 2
      ORDER BY count(*) DESC
      LIMIT 10
    `;

    const timing = paymentTimingData[0] || {
      onTimePayments: 0,
      latePayments: 0,
      averageLateDays: 0,
    };

    return {
      onTimePayments: timing.onTimePayments,
      latePayments: timing.latePayments,
      averageLateDays: Math.round(timing.averageLateDays * 10) / 10,
      repeatOffenders: repeatOffendersData.map((item) => ({
        tenantId: item.tenantId,
        tenantName: item.tenantName || "Unknown",
        latePaymentCount: item.latePaymentCount,
        averageLateDays: Math.round(item.averageLateDays * 10) / 10,
      })),
      paymentMethodPreferences: await this.getPaymentMethodPreferences(filters),
      seasonalTrends: await this.getSeasonalTrends(filters),
    };
  }

  /**
   * Generate cash flow projections
   */
  async getCashFlowProjection(filters?: any): Promise<CashFlowProjection> {
    // This is a simplified projection - in reality, you'd use more sophisticated algorithms
    const collectionMetrics = await this.getCollectionMetrics(filters);
    const avgCollectionRate = collectionMetrics.currentMonth.collectionRate;

    // Get upcoming payments
    // Upcoming starts tomorrow and runs to the start of the month three on,
    // on Riyadh's calendar.
    const today = businessToday();
    const thisMonthFirst = businessMonthRange(today).from;
    const tomorrow = businessDayStart(addBusinessDays(today, 1));
    const nextMonthNumber = Number(addBusinessMonths(thisMonthFirst, 1).slice(5, 7));
    const next3Months = businessDayStart(addBusinessMonths(thisMonthFirst, 3));

    const base = this.buildFilterSql(filters, { includeDateRange: false });
    const upcomingPayments = await db.$queryRaw<
      Array<{ month: number; year: number; totalExpected: number }>
    >`
      SELECT
        EXTRACT(MONTH FROM "dueDate")::int AS "month",
        EXTRACT(YEAR FROM "dueDate")::int AS "year",
        COALESCE(sum(amount), 0)::float AS "totalExpected"
      FROM payments
      WHERE ${base}
        AND "dueDate" >= ${tomorrow} AND "dueDate" < ${next3Months}
        AND type = 'rent'
      GROUP BY 1, 2
    `;

    const nextMonthExpected = upcomingPayments
      .filter((p) => p.month === nextMonthNumber)
      .reduce((sum, p) => sum + p.totalExpected, 0);

    const next3MonthsExpected = upcomingPayments.reduce(
      (sum, p) => sum + p.totalExpected,
      0
    );

    return {
      nextMonth: {
        expected: nextMonthExpected,
        projected: nextMonthExpected * (avgCollectionRate / 100),
        confidence:
          avgCollectionRate > 90 ? 0.95 : avgCollectionRate > 80 ? 0.85 : 0.75,
      },
      next3Months: {
        expected: next3MonthsExpected,
        projected: next3MonthsExpected * (avgCollectionRate / 100),
        confidence:
          avgCollectionRate > 90 ? 0.9 : avgCollectionRate > 80 ? 0.8 : 0.7,
      },
      riskFactors: await this.identifyRiskFactors(filters),
      opportunities: await this.identifyOpportunities(filters),
    };
  }

  /**
   * Helper methods
   */

  /** Raw-SQL filter fragment: soft-delete + optional property/date-range filters. */
  private buildFilterSql(
    filters?: any,
    opts: { includeDateRange?: boolean; alias?: string } = {}
  ): Prisma.Sql {
    const alias = opts.alias ?? "";
    const col = (name: string) => Prisma.raw(`${alias}"${name}"`);
    const conditions: Prisma.Sql[] = [Prisma.sql`${col("deletedAt")} IS NULL`];

    if (filters?.propertyId) {
      conditions.push(Prisma.sql`${col("propertyId")} = ${filters.propertyId}`);
    }

    if (opts.includeDateRange !== false && filters?.dateRange) {
      conditions.push(
        Prisma.sql`${col("dueDate")} >= ${filters.dateRange.start}`
      );
      conditions.push(Prisma.sql`${col("dueDate")} <= ${filters.dateRange.end}`);
    }

    return Prisma.join(conditions, " AND ");
  }

  /** Prisma where clause for the same filters (used with groupBy/aggregate). */
  private buildPrismaWhere(filters?: any): Record<string, any> {
    const where: Record<string, any> = {};
    if (filters?.propertyId) {
      where.propertyId = filters.propertyId;
    }
    if (filters?.dateRange) {
      where.dueDate = {
        gte: filters.dateRange.start,
        lte: filters.dateRange.end,
      };
    }
    return where;
  }

  private async getLateFeeRevenue(filters?: any): Promise<number> {
    const result = await db.payment.aggregate({
      _sum: { amount: true },
      where: {
        ...this.buildPrismaWhere(filters),
        type: "late_fee",
        status: { in: [PaymentStatus.PAID] },
      },
    });

    return result._sum.amount || 0;
  }

  private async getVacancyImpact(filters?: any): Promise<number> {
    // Calculate lost rent due to vacancies
    // This is a simplified calculation
    return 0; // TODO: Implement vacancy impact calculation
  }

  private async getPaymentMethodPreferences(
    filters?: any
  ): Promise<Record<string, number>> {
    const result = await db.payment.groupBy({
      by: ["paymentMethod"],
      _count: { _all: true },
      where: {
        ...this.buildPrismaWhere(filters),
        status: { in: [PaymentStatus.PAID] },
        paymentMethod: { not: null },
      },
    });

    const preferences: Record<string, number> = {};
    result.forEach((item) => {
      if (item.paymentMethod) {
        preferences[item.paymentMethod] = item._count._all;
      }
    });

    return preferences;
  }

  private async getSeasonalTrends(
    filters?: any
  ): Promise<
    Array<{ month: string; collectionRate: number; averageDays: number }>
  > {
    // TODO: Implement seasonal trends analysis
    return [];
  }

  private async generateAlerts(
    collectionMetrics: CollectionMetrics,
    agingReport: AgingReport,
    paymentBehavior: PaymentBehaviorAnalytics
  ): Promise<
    Array<{
      type: "warning" | "error" | "info";
      message: string;
      priority: number;
    }>
  > {
    const alerts: Array<{
      type: "warning" | "error" | "info";
      message: string;
      priority: number;
    }> = [];

    // Collection rate alerts
    if (collectionMetrics.currentMonth.collectionRate < 80) {
      alerts.push({
        type: "error",
        message: `Collection rate is critically low at ${collectionMetrics.currentMonth.collectionRate.toFixed(
          1
        )}%`,
        priority: 1,
      });
    } else if (collectionMetrics.currentMonth.collectionRate < 90) {
      alerts.push({
        type: "warning",
        message: `Collection rate is below target at ${collectionMetrics.currentMonth.collectionRate.toFixed(
          1
        )}%`,
        priority: 2,
      });
    }

    // Aging alerts
    if (agingReport.critical.amount > 0) {
      alerts.push({
        type: "error",
        message: `${formatCurrency(
          agingReport.critical.amount
        )} in critical overdue payments (90+ days)`,
        priority: 1,
      });
    }

    // Repeat offender alerts
    if (paymentBehavior.repeatOffenders.length > 0) {
      alerts.push({
        type: "warning",
        message: `${paymentBehavior.repeatOffenders.length} tenants with multiple late payments`,
        priority: 3,
      });
    }

    return alerts.sort((a, b) => a.priority - b.priority);
  }

  private async identifyRiskFactors(filters?: any): Promise<string[]> {
    // TODO: Implement risk factor identification
    return [];
  }

  private async identifyOpportunities(filters?: any): Promise<string[]> {
    // TODO: Implement opportunity identification
    return [];
  }
}

export const paymentDashboardService = new PaymentDashboardService();
