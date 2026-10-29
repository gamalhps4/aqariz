/**
 * PropertyPro - Payment Analytics & Reporting Service
 * Comprehensive reporting system with KPIs, cash flow projections, and tenant payment behavior tracking
 */

import { PaymentStatus, PaymentType } from "@/types";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";

export interface PaymentKPIs {
  collectionRate: number;
  averageDaysLate: number;
  lateFeeRevenue: number;
  vacancyImpact: number;
  onTimePaymentRate: number;
  totalRevenue: number;
  outstandingAmount: number;
  averagePaymentAmount: number;
}

export interface CashFlowProjection {
  period: string;
  expectedIncome: number;
  projectedIncome: number;
  actualIncome: number;
  variance: number;
  confidenceLevel: number;
  riskFactors: string[];
}

export interface TenantPaymentBehavior {
  tenantId: string;
  tenantName: string;
  totalPayments: number;
  onTimePayments: number;
  latePayments: number;
  averageDaysLate: number;
  totalLateFees: number;
  paymentReliabilityScore: number;
  riskLevel: "low" | "medium" | "high";
  trends: {
    improving: boolean;
    declining: boolean;
    stable: boolean;
  };
}

export interface PropertyPerformance {
  propertyId: string;
  propertyName: string;
  totalUnits: number;
  occupiedUnits: number;
  occupancyRate: number;
  collectionRate: number;
  averageRent: number;
  totalRevenue: number;
  outstandingAmount: number;
  lateFeeRevenue: number;
  performanceGrade: "A" | "B" | "C" | "D" | "F";
}

export interface PaymentTrends {
  monthly: Array<{
    month: string;
    year: number;
    totalPayments: number;
    totalAmount: number;
    collectionRate: number;
    averageDaysLate: number;
  }>;
  seasonal: Array<{
    quarter: string;
    collectionRate: number;
    averageAmount: number;
    trends: string[];
  }>;
  yearly: Array<{
    year: number;
    totalRevenue: number;
    collectionRate: number;
    growth: number;
  }>;
}

export interface AnalyticsReport {
  reportId: string;
  generatedAt: Date;
  period: {
    start: Date;
    end: Date;
  };
  kpis: PaymentKPIs;
  cashFlowProjections: CashFlowProjection[];
  tenantBehavior: TenantPaymentBehavior[];
  propertyPerformance: PropertyPerformance[];
  paymentTrends: PaymentTrends;
  insights: string[];
  recommendations: string[];
}

export class PaymentAnalyticsService {
  /**
   * Generate comprehensive analytics report
   */
  async generateAnalyticsReport(
    startDate: Date,
    endDate: Date,
    filters?: {
      propertyId?: string;
      managerId?: string;
      tenantId?: string;
    }
  ): Promise<AnalyticsReport> {
    const reportId = crypto.randomUUID();

    const [
      kpis,
      cashFlowProjections,
      tenantBehavior,
      propertyPerformance,
      paymentTrends,
    ] = await Promise.all([
      this.calculateKPIs(startDate, endDate, filters),
      this.generateCashFlowProjections(startDate, endDate, filters),
      this.analyzeTenantPaymentBehavior(startDate, endDate, filters),
      this.analyzePropertyPerformance(startDate, endDate, filters),
      this.analyzePaymentTrends(startDate, endDate, filters),
    ]);

    const insights = this.generateInsights(
      kpis,
      tenantBehavior,
      propertyPerformance,
      paymentTrends
    );
    const recommendations = this.generateRecommendations(
      kpis,
      tenantBehavior,
      propertyPerformance
    );

    return {
      reportId,
      generatedAt: new Date(),
      period: { start: startDate, end: endDate },
      kpis,
      cashFlowProjections,
      tenantBehavior,
      propertyPerformance,
      paymentTrends,
      insights,
      recommendations,
    };
  }

  /**
   * Calculate key performance indicators
   */
  async calculateKPIs(
    startDate: Date,
    endDate: Date,
    filters?: any
  ): Promise<PaymentKPIs> {
    const where = this.buildWhereSql(startDate, endDate, filters);

    const kpiData = await db.$queryRaw<
      Array<{
        totalPayments: number;
        totalAmount: number;
        paidAmount: number;
        outstandingAmount: number;
        lateFeeRevenue: number;
        onTimePayments: number;
        latePayments: number;
        totalDaysLate: number;
      }>
    >`
      SELECT
        count(*)::int AS "totalPayments",
        COALESCE(sum(amount), 0)::float AS "totalAmount",
        COALESCE(sum(amount) FILTER (WHERE status = ${PaymentStatus.PAID}), 0)::float AS "paidAmount",
        COALESCE(sum(amount) FILTER (WHERE status <> ${PaymentStatus.PAID}), 0)::float AS "outstandingAmount",
        COALESCE(sum(amount) FILTER (WHERE type = ${PaymentType.LATE_FEE}), 0)::float AS "lateFeeRevenue",
        (count(*) FILTER (
          WHERE status = ${PaymentStatus.PAID}
            AND ("paidDate" IS NULL OR "paidDate" <= "dueDate")
        ))::int AS "onTimePayments",
        (count(*) FILTER (
          WHERE status = ${PaymentStatus.PAID} AND "paidDate" > "dueDate"
        ))::int AS "latePayments",
        COALESCE(sum(EXTRACT(EPOCH FROM ("paidDate" - "dueDate")) / 86400.0) FILTER (
          WHERE status = ${PaymentStatus.PAID} AND "paidDate" > "dueDate"
        ), 0)::float AS "totalDaysLate"
      FROM payments
      WHERE ${where}
    `;

    const data = kpiData[0] || ({} as any);
    const paidPayments = (data.onTimePayments || 0) + (data.latePayments || 0);

    return {
      collectionRate:
        data.totalAmount > 0 ? (data.paidAmount / data.totalAmount) * 100 : 0,
      averageDaysLate:
        data.latePayments > 0 ? data.totalDaysLate / data.latePayments : 0,
      lateFeeRevenue: data.lateFeeRevenue || 0,
      vacancyImpact: await this.calculateVacancyImpact(
        startDate,
        endDate,
        filters
      ),
      onTimePaymentRate:
        paidPayments > 0 ? (data.onTimePayments / paidPayments) * 100 : 0,
      totalRevenue: data.paidAmount || 0,
      outstandingAmount: data.outstandingAmount || 0,
      averagePaymentAmount:
        data.totalPayments > 0 ? data.totalAmount / data.totalPayments : 0,
    };
  }

  /**
   * Generate cash flow projections
   */
  async generateCashFlowProjections(
    startDate: Date,
    endDate: Date,
    filters?: any
  ): Promise<CashFlowProjection[]> {
    const projections: CashFlowProjection[] = [];
    const now = new Date();

    // Generate projections for next 6 months
    for (let i = 0; i < 6; i++) {
      const projectionDate = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const monthEnd = new Date(
        projectionDate.getFullYear(),
        projectionDate.getMonth() + 1,
        0
      );

      const where = this.buildWhereSql(projectionDate, monthEnd, filters);

      const monthlyData = await db.$queryRaw<
        Array<{ expectedIncome: number; actualIncome: number }>
      >`
        SELECT
          COALESCE(sum(amount), 0)::float AS "expectedIncome",
          COALESCE(sum(amount) FILTER (WHERE status = ${PaymentStatus.PAID}), 0)::float AS "actualIncome"
        FROM payments
        WHERE ${where} AND type = ${PaymentType.RENT}
      `;

      const data = monthlyData[0] || { expectedIncome: 0, actualIncome: 0 };
      const historicalCollectionRate = await this.getHistoricalCollectionRate(
        filters
      );
      const projectedIncome =
        data.expectedIncome * (historicalCollectionRate / 100);

      projections.push({
        period: projectionDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        }),
        expectedIncome: data.expectedIncome,
        projectedIncome,
        actualIncome: projectionDate <= now ? data.actualIncome : 0,
        variance:
          projectionDate <= now ? data.actualIncome - projectedIncome : 0,
        confidenceLevel: this.calculateConfidenceLevel(
          historicalCollectionRate
        ),
        riskFactors: await this.identifyRiskFactors(projectionDate, filters),
      });
    }

    return projections;
  }

  /**
   * Analyze tenant payment behavior
   */
  async analyzeTenantPaymentBehavior(
    startDate: Date,
    endDate: Date,
    filters?: any
  ): Promise<TenantPaymentBehavior[]> {
    const where = this.buildWhereSql(startDate, endDate, filters, "p.");

    const tenantData = await db.$queryRaw<
      Array<{
        tenantId: string;
        totalPayments: number;
        onTimePayments: number;
        latePayments: number;
        totalDaysLate: number;
        totalLateFees: number;
        tenantName: string | null;
      }>
    >`
      SELECT
        p."tenantId" AS "tenantId",
        count(*)::int AS "totalPayments",
        (count(*) FILTER (
          WHERE p.status = ${PaymentStatus.PAID}
            AND (p."paidDate" IS NULL OR p."paidDate" <= p."dueDate")
        ))::int AS "onTimePayments",
        (count(*) FILTER (
          WHERE p.status = ${PaymentStatus.PAID} AND p."paidDate" > p."dueDate"
        ))::int AS "latePayments",
        COALESCE(sum(EXTRACT(EPOCH FROM (p."paidDate" - p."dueDate")) / 86400.0) FILTER (
          WHERE p.status = ${PaymentStatus.PAID} AND p."paidDate" > p."dueDate"
        ), 0)::float AS "totalDaysLate",
        COALESCE(sum(p.amount) FILTER (WHERE p.type = ${PaymentType.LATE_FEE}), 0)::float AS "totalLateFees",
        (u."firstName" || ' ' || u."lastName") AS "tenantName"
      FROM payments p
      LEFT JOIN users u ON u.id = p."tenantId"
      WHERE ${where}
      GROUP BY p."tenantId", u."firstName", u."lastName"
    `;

    return tenantData.map((data) => {
      const averageDaysLate =
        data.latePayments > 0 ? data.totalDaysLate / data.latePayments : 0;
      const onTimeRate =
        data.totalPayments > 0
          ? (data.onTimePayments / data.totalPayments) * 100
          : 0;
      const paymentReliabilityScore = this.calculateReliabilityScore(
        onTimeRate,
        averageDaysLate,
        data.totalLateFees
      );

      return {
        tenantId: data.tenantId,
        tenantName: data.tenantName || "Unknown",
        totalPayments: data.totalPayments,
        onTimePayments: data.onTimePayments,
        latePayments: data.latePayments,
        averageDaysLate: Math.round(averageDaysLate * 10) / 10,
        totalLateFees: data.totalLateFees,
        paymentReliabilityScore,
        riskLevel: this.determineRiskLevel(paymentReliabilityScore),
        trends: {
          improving: false, // TODO: Implement trend analysis
          declining: false,
          stable: true,
        },
      };
    });
  }

  /**
   * Analyze property performance
   */
  async analyzePropertyPerformance(
    startDate: Date,
    endDate: Date,
    filters?: any
  ): Promise<PropertyPerformance[]> {
    const where = this.buildWhereSql(startDate, endDate, filters, "p.");

    const propertyData = await db.$queryRaw<
      Array<{
        propertyId: string;
        totalPayments: number;
        totalAmount: number;
        paidAmount: number;
        outstandingAmount: number;
        lateFeeRevenue: number;
        propertyName: string | null;
        totalUnits: number | null;
      }>
    >`
      SELECT
        p."propertyId" AS "propertyId",
        count(*)::int AS "totalPayments",
        COALESCE(sum(p.amount), 0)::float AS "totalAmount",
        COALESCE(sum(p.amount) FILTER (WHERE p.status = ${PaymentStatus.PAID}), 0)::float AS "paidAmount",
        COALESCE(sum(p.amount) FILTER (WHERE p.status <> ${PaymentStatus.PAID}), 0)::float AS "outstandingAmount",
        COALESCE(sum(p.amount) FILTER (WHERE p.type = ${PaymentType.LATE_FEE}), 0)::float AS "lateFeeRevenue",
        pr.name AS "propertyName",
        pr."totalUnits"::int AS "totalUnits"
      FROM payments p
      LEFT JOIN properties pr ON pr.id = p."propertyId"
      WHERE ${where}
      GROUP BY p."propertyId", pr.name, pr."totalUnits"
    `;

    return propertyData.map((data) => {
      const collectionRate =
        data.totalAmount > 0 ? (data.paidAmount / data.totalAmount) * 100 : 0;
      const averageRent =
        data.totalPayments > 0 ? data.totalAmount / data.totalPayments : 0;
      const totalUnits = data.totalUnits || 0;
      // Occupied-unit tracking never made it onto the property record, so the
      // occupancy inputs stay 0 exactly as before.
      const occupiedUnits = 0;

      return {
        propertyId: data.propertyId,
        propertyName: data.propertyName || "Unknown Property",
        totalUnits,
        occupiedUnits,
        occupancyRate:
          totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0,
        collectionRate,
        averageRent,
        totalRevenue: data.paidAmount,
        outstandingAmount: data.outstandingAmount,
        lateFeeRevenue: data.lateFeeRevenue,
        performanceGrade: this.calculatePerformanceGrade(collectionRate, 0),
      };
    });
  }

  /**
   * Analyze payment trends
   */
  async analyzePaymentTrends(
    startDate: Date,
    endDate: Date,
    filters?: any
  ): Promise<PaymentTrends> {
    const where = this.buildWhereSql(startDate, endDate, filters);

    // Monthly trends
    const monthlyTrends = await db.$queryRaw<
      Array<{
        year: number;
        month: number;
        totalPayments: number;
        totalAmount: number;
        paidAmount: number;
        totalDaysLate: number;
        latePayments: number;
      }>
    >`
      SELECT
        EXTRACT(YEAR FROM "dueDate")::int AS "year",
        EXTRACT(MONTH FROM "dueDate")::int AS "month",
        count(*)::int AS "totalPayments",
        COALESCE(sum(amount), 0)::float AS "totalAmount",
        COALESCE(sum(amount) FILTER (WHERE status = ${PaymentStatus.PAID}), 0)::float AS "paidAmount",
        COALESCE(sum(EXTRACT(EPOCH FROM ("paidDate" - "dueDate")) / 86400.0) FILTER (
          WHERE status = ${PaymentStatus.PAID} AND "paidDate" > "dueDate"
        ), 0)::float AS "totalDaysLate",
        (count(*) FILTER (
          WHERE status = ${PaymentStatus.PAID} AND "paidDate" > "dueDate"
        ))::int AS "latePayments"
      FROM payments
      WHERE ${where}
      GROUP BY 1, 2
      ORDER BY 1, 2
    `;

    const monthly = monthlyTrends.map((trend) => ({
      month: new Date(trend.year, trend.month - 1).toLocaleDateString("en-US", {
        month: "long",
      }),
      year: trend.year,
      totalPayments: trend.totalPayments,
      totalAmount: trend.totalAmount,
      collectionRate:
        trend.totalAmount > 0
          ? (trend.paidAmount / trend.totalAmount) * 100
          : 0,
      averageDaysLate:
        trend.latePayments > 0 ? trend.totalDaysLate / trend.latePayments : 0,
    }));

    return {
      monthly,
      seasonal: [], // TODO: Implement seasonal analysis
      yearly: [], // TODO: Implement yearly analysis
    };
  }

  /**
   * Helper methods
   */
  private buildWhereSql(
    startDate: Date,
    endDate: Date,
    filters?: any,
    alias: string = ""
  ): Prisma.Sql {
    const col = (name: string) => Prisma.raw(`${alias}"${name}"`);
    const conditions: Prisma.Sql[] = [
      Prisma.sql`${col("deletedAt")} IS NULL`,
      Prisma.sql`${col("dueDate")} >= ${startDate}`,
      Prisma.sql`${col("dueDate")} <= ${endDate}`,
    ];

    if (filters?.propertyId) {
      conditions.push(Prisma.sql`${col("propertyId")} = ${filters.propertyId}`);
    }
    if (filters?.tenantId) {
      conditions.push(Prisma.sql`${col("tenantId")} = ${filters.tenantId}`);
    }

    return Prisma.join(conditions, " AND ");
  }

  private async calculateVacancyImpact(
    startDate: Date,
    endDate: Date,
    filters?: any
  ): Promise<number> {
    // TODO: Implement vacancy impact calculation
    return 0;
  }

  private async getHistoricalCollectionRate(filters?: any): Promise<number> {
    // TODO: Implement historical collection rate calculation
    return 85; // Default 85% collection rate
  }

  private calculateConfidenceLevel(collectionRate: number): number {
    if (collectionRate >= 95) return 0.95;
    if (collectionRate >= 90) return 0.9;
    if (collectionRate >= 85) return 0.85;
    if (collectionRate >= 80) return 0.8;
    return 0.75;
  }

  private async identifyRiskFactors(
    date: Date,
    filters?: any
  ): Promise<string[]> {
    // TODO: Implement risk factor identification
    return [];
  }

  private calculateReliabilityScore(
    onTimeRate: number,
    avgDaysLate: number,
    lateFees: number
  ): number {
    let score = onTimeRate;
    score -= avgDaysLate * 2; // Penalty for late payments
    score -= (lateFees / 100) * 5; // Penalty for late fees
    return Math.max(0, Math.min(100, score));
  }

  private determineRiskLevel(score: number): "low" | "medium" | "high" {
    if (score >= 80) return "low";
    if (score >= 60) return "medium";
    return "high";
  }

  private calculatePerformanceGrade(
    collectionRate: number,
    occupancyRate: number
  ): "A" | "B" | "C" | "D" | "F" {
    const combinedScore = (collectionRate + occupancyRate) / 2;
    if (combinedScore >= 90) return "A";
    if (combinedScore >= 80) return "B";
    if (combinedScore >= 70) return "C";
    if (combinedScore >= 60) return "D";
    return "F";
  }

  private generateInsights(
    kpis: PaymentKPIs,
    tenantBehavior: TenantPaymentBehavior[],
    propertyPerformance: PropertyPerformance[],
    trends: PaymentTrends
  ): string[] {
    const insights: string[] = [];

    if (kpis.collectionRate < 85) {
      insights.push(
        `Collection rate of ${kpis.collectionRate.toFixed(
          1
        )}% is below industry standard of 85%`
      );
    }

    const highRiskTenants = tenantBehavior.filter(
      (t) => t.riskLevel === "high"
    ).length;
    if (highRiskTenants > 0) {
      insights.push(
        `${highRiskTenants} tenants identified as high-risk for payment issues`
      );
    }

    if (kpis.lateFeeRevenue > kpis.totalRevenue * 0.05) {
      insights.push(
        "Late fee revenue exceeds 5% of total revenue, indicating payment timing issues"
      );
    }

    return insights;
  }

  private generateRecommendations(
    kpis: PaymentKPIs,
    tenantBehavior: TenantPaymentBehavior[],
    propertyPerformance: PropertyPerformance[]
  ): string[] {
    const recommendations: string[] = [];

    if (kpis.collectionRate < 90) {
      recommendations.push(
        "Implement automated payment reminders to improve collection rates"
      );
    }

    if (kpis.averageDaysLate > 7) {
      recommendations.push(
        "Consider reducing grace period or increasing late fee penalties"
      );
    }

    const poorPerformingProperties = propertyPerformance.filter(
      (p) => p.performanceGrade === "D" || p.performanceGrade === "F"
    );
    if (poorPerformingProperties.length > 0) {
      recommendations.push(
        `Focus on improving management of ${poorPerformingProperties.length} underperforming properties`
      );
    }

    return recommendations;
  }
}

export const paymentAnalyticsService = new PaymentAnalyticsService();
