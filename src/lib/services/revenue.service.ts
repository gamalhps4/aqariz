/**
 * PropertyPro - Revenue Service
 * Read-only aggregation of income from Payments and Invoices
 */

import { db } from "@/lib/db/prisma";
import {
  applyScope,
  paymentScope,
  paymentScopeSql,
  withScope,
  type ScopeActor,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { PaymentStatus } from "@/types";
import { businessDayStart, businessMonthRange, businessToday } from "@/lib/dates/business-day";

export interface RevenueSummary {
  totalRevenue: number;
  totalCollected: number;
  totalOutstanding: number;
  monthToDate: number;
  yearToDate: number;
  collectionRate: number;
  count: number;
}

export interface RevenueByCategory {
  category: string;
  amount: number;
  count: number;
  percentage: number;
}

export interface RevenueByProperty {
  propertyId: string;
  propertyName: string;
  revenue: number;
  collected: number;
  outstanding: number;
  collectionRate: number;
}

export interface MonthlyRevenue {
  year: number;
  month: number;
  revenue: number;
  collected: number;
  count: number;
}

export class RevenueService {
  /**
   * Get revenue summary stats
   */
  async getRevenueSummary(
    /** Who is asking — revenue is money, and money is scoped. */
    actor: ScopeActor,
    propertyId?: string,
  ): Promise<RevenueSummary> {
    // `propertyId` narrows on request; the actor's own entitlement restricts.
    // Built from the parameter alone, this reported the whole organization's
    // takings to anyone who could open the page. The two are AND-ed: assigned
    // over a scope that is itself keyed on `propertyId`, the parameter
    // replaced it, and an owner could read any building's takings by id.
    const baseWhere: Prisma.PaymentWhereInput = withScope(
      propertyId ? { propertyId } : {},
      paymentScope(actor),
    );

    // This month and this year start at Riyadh's midnight, not the server's:
    // a payment taken at 01:30 on the 1st belongs to the new month.
    const today = businessToday();
    const startOfMonth = businessDayStart(businessMonthRange(today).from);
    const startOfYear = businessDayStart(`${today.slice(0, 4)}-01-01`);

    const completedStatuses = [PaymentStatus.PAID];
    const outstandingStatuses = [
      PaymentStatus.PENDING,
      PaymentStatus.OVERDUE,
      PaymentStatus.PARTIAL,
    ];

    const [collected, outstanding, mtd, ytd, totalCount] = await Promise.all([
      db.payment.aggregate({
        _sum: { amount: true },
        where: { ...baseWhere, status: { in: completedStatuses } },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: { ...baseWhere, status: { in: outstandingStatuses } },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: {
          ...baseWhere,
          status: { in: completedStatuses },
          paidDate: { gte: startOfMonth },
        },
      }),
      db.payment.aggregate({
        _sum: { amount: true },
        where: {
          ...baseWhere,
          status: { in: completedStatuses },
          paidDate: { gte: startOfYear },
        },
      }),
      db.payment.count({ where: baseWhere }),
    ]);

    const totalCollected = collected._sum.amount || 0;
    const totalOutstanding = outstanding._sum.amount || 0;
    const totalRevenue = totalCollected + totalOutstanding;
    const collectionRate =
      totalRevenue > 0 ? (totalCollected / totalRevenue) * 100 : 0;

    return {
      totalRevenue,
      totalCollected,
      totalOutstanding,
      monthToDate: mtd._sum.amount || 0,
      yearToDate: ytd._sum.amount || 0,
      collectionRate: Math.round(collectionRate * 100) / 100,
      count: totalCount,
    };
  }

  /**
   * Get revenue breakdown by category (rent, late fee, deposit, etc.)
   */
  async getRevenueByCategory(
    /** Who is asking — as on the summary above. */
    actor: ScopeActor,
    startDate?: Date,
    endDate?: Date,
    propertyId?: string
  ): Promise<RevenueByCategory[]> {
    const where: Prisma.PaymentWhereInput = {
      status: { in: [PaymentStatus.PAID] },
    };
    if (propertyId) where.propertyId = propertyId;
    if (startDate || endDate) {
      where.paidDate = {
        ...(startDate ? { gte: startDate } : {}),
        ...(endDate ? { lte: endDate } : {}),
      };
    }
    // This breakdown and the two after it took no actor at all, so the page
    // scoped its headline figures and listed the whole organization's
    // payments underneath them.
    applyScope(where, paymentScope(actor));

    const result = await db.payment.groupBy({
      by: ["type"],
      _sum: { amount: true },
      _count: { _all: true },
      where,
      orderBy: { _sum: { amount: "desc" } },
    });

    const totalAmount = result.reduce(
      (sum, r) => sum + (r._sum.amount || 0),
      0
    );

    return result.map((r) => ({
      category: r.type,
      amount: r._sum.amount || 0,
      count: r._count._all,
      percentage:
        totalAmount > 0
          ? Math.round(((r._sum.amount || 0) / totalAmount) * 10000) / 100
          : 0,
    }));
  }

  /**
   * Get revenue by property
   */
  async getRevenueByProperty(
    /** Who is asking — as on the summary above. */
    actor: ScopeActor,
    startDate?: Date,
    endDate?: Date
  ): Promise<RevenueByProperty[]> {
    const conditions: Prisma.Sql[] = [Prisma.sql`p."deletedAt" IS NULL`];
    if (startDate) conditions.push(Prisma.sql`p."createdAt" >= ${startDate}`);
    if (endDate) conditions.push(Prisma.sql`p."createdAt" <= ${endDate}`);
    const scope = paymentScopeSql(actor, {
      tenantId: Prisma.sql`p."tenantId"`,
      propertyId: Prisma.sql`p."propertyId"`,
    });
    if (scope) conditions.push(scope);
    const where = Prisma.join(conditions, " AND ");

    const result = await db.$queryRaw<
      Array<{
        propertyId: string;
        propertyName: string;
        revenue: number;
        collected: number;
        outstanding: number;
      }>
    >`
      SELECT
        p."propertyId" AS "propertyId",
        pr.name AS "propertyName",
        COALESCE(sum(p.amount), 0)::float AS "revenue",
        COALESCE(sum(p.amount) FILTER (
          WHERE p.status IN (${PaymentStatus.PAID})
        ), 0)::float AS "collected",
        COALESCE(sum(p.amount) FILTER (
          WHERE p.status IN (${PaymentStatus.PENDING}, ${PaymentStatus.OVERDUE})
        ), 0)::float AS "outstanding"
      FROM payments p
      JOIN properties pr ON pr.id = p."propertyId"
      WHERE ${where}
      GROUP BY p."propertyId", pr.name
      ORDER BY "revenue" DESC
    `;

    return result.map((r) => ({
      propertyId: r.propertyId,
      propertyName: r.propertyName,
      revenue: r.revenue,
      collected: r.collected,
      outstanding: r.outstanding,
      collectionRate:
        r.revenue > 0
          ? Math.round((r.collected / r.revenue) * 10000) / 100
          : 0,
    }));
  }

  /**
   * Get monthly revenue trends
   */
  async getMonthlyRevenue(
    /** Who is asking — as on the summary above. */
    actor: ScopeActor,
    months: number = 12,
    propertyId?: string
  ): Promise<MonthlyRevenue[]> {
    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    const conditions: Prisma.Sql[] = [
      Prisma.sql`"deletedAt" IS NULL`,
      Prisma.sql`"createdAt" >= ${startDate}`,
    ];
    if (propertyId) conditions.push(Prisma.sql`"propertyId" = ${propertyId}`);
    const scope = paymentScopeSql(actor, {
      tenantId: Prisma.sql`"tenantId"`,
      propertyId: Prisma.sql`"propertyId"`,
    });
    if (scope) conditions.push(scope);
    const where = Prisma.join(conditions, " AND ");

    return db.$queryRaw<MonthlyRevenue[]>`
      SELECT
        EXTRACT(YEAR FROM "createdAt")::int AS "year",
        EXTRACT(MONTH FROM "createdAt")::int AS "month",
        COALESCE(sum(amount), 0)::float AS "revenue",
        COALESCE(sum(amount) FILTER (WHERE status IN (${PaymentStatus.PAID})), 0)::float AS "collected",
        count(*)::int AS "count"
      FROM payments
      WHERE ${where}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;
  }
}

export const revenueService = new RevenueService();
