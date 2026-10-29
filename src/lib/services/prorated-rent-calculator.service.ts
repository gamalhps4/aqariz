/**
 * PropertyPro - Prorated Rent Calculator Service
 * Advanced prorated rent calculations for move-in dates and lease terms
 */

import { formatCurrency } from "@/lib/utils/formatting";

export interface ProrationMethod {
  type: "daily" | "calendar" | "banking";
  description: string;
}

export interface ProrationPeriod {
  startDate: Date;
  endDate: Date;
  totalDays: number;
  billingDays: number;
  isPartialMonth: boolean;
  monthName: string;
  year: number;
}

export interface ProrationBreakdown {
  period: ProrationPeriod;
  monthlyRent: number;
  daysInMonth: number;
  dailyRate: number;
  proratedAmount: number;
  savings: number;
  method: ProrationMethod;
}

export interface ProrationResult {
  totalProrated: number;
  totalSavings: number;
  breakdowns: ProrationBreakdown[];
  summary: {
    originalAmount: number;
    proratedAmount: number;
    totalDays: number;
    averageDailyRate: number;
  };
  recommendations: string[];
}

export interface LeaseProrationConfig {
  method: "daily" | "calendar" | "banking";
  roundingMethod: "round" | "floor" | "ceil";
  minimumCharge: number;
  graceDays: number;
  includeEndDate: boolean;
}

export class ProratedRentCalculatorService {
  private defaultConfig: LeaseProrationConfig = {
    method: "daily",
    roundingMethod: "round",
    minimumCharge: 0,
    graceDays: 0,
    includeEndDate: true,
  };

  private prorationMethods: Record<string, ProrationMethod> = {
    daily: {
      type: "daily",
      description: "Standard daily proration based on actual days in month",
    },
    calendar: {
      type: "calendar",
      description: "Calendar month proration (30-day standard)",
    },
    banking: {
      type: "banking",
      description: "Banking method (360-day year, 30-day months)",
    },
  };

  /**
   * Calculate days in month based on method
   */
  private getDaysInMonth(
    date: Date,
    method: "daily" | "calendar" | "banking"
  ): number {
    switch (method) {
      case "daily":
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      case "calendar":
        return 30;
      case "banking":
        return 30;
      default:
        return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
    }
  }

  /**
   * Calculate billing days between two dates
   */
  private calculateBillingDays(
    startDate: Date,
    endDate: Date,
    includeEndDate: boolean = true
  ): number {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const timeDiff = end.getTime() - start.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    return includeEndDate ? daysDiff + 1 : daysDiff;
  }

  /**
   * Apply rounding method to amount
   */
  private applyRounding(
    amount: number,
    method: "round" | "floor" | "ceil"
  ): number {
    const multiplier = 100; // For 2 decimal places

    switch (method) {
      case "round":
        return Math.round(amount * multiplier) / multiplier;
      case "floor":
        return Math.floor(amount * multiplier) / multiplier;
      case "ceil":
        return Math.ceil(amount * multiplier) / multiplier;
      default:
        return Math.round(amount * multiplier) / multiplier;
    }
  }

  /**
   * Calculate prorated rent for a single period
   */
  calculatePeriodProration(
    monthlyRent: number,
    startDate: Date,
    endDate: Date,
    config: Partial<LeaseProrationConfig> = {}
  ): ProrationBreakdown {
    const finalConfig = { ...this.defaultConfig, ...config };

    const start = new Date(startDate);
    const end = new Date(endDate);

    // Create period information
    const period: ProrationPeriod = {
      startDate: start,
      endDate: end,
      totalDays: this.calculateBillingDays(
        start,
        end,
        finalConfig.includeEndDate
      ),
      billingDays: this.calculateBillingDays(
        start,
        end,
        finalConfig.includeEndDate
      ),
      isPartialMonth: true,
      monthName: start.toLocaleString("default", { month: "long" }),
      year: start.getFullYear(),
    };

    // Calculate days in month based on method
    const daysInMonth = this.getDaysInMonth(start, finalConfig.method);

    // Calculate daily rate
    const dailyRate = monthlyRent / daysInMonth;

    // Calculate prorated amount
    let proratedAmount = dailyRate * period.billingDays;

    // Apply grace days if configured
    if (
      finalConfig.graceDays > 0 &&
      period.billingDays <= finalConfig.graceDays
    ) {
      proratedAmount = 0;
    }

    // Apply minimum charge
    if (proratedAmount > 0 && proratedAmount < finalConfig.minimumCharge) {
      proratedAmount = finalConfig.minimumCharge;
    }

    // Apply rounding
    proratedAmount = this.applyRounding(
      proratedAmount,
      finalConfig.roundingMethod
    );

    const savings = monthlyRent - proratedAmount;

    return {
      period,
      monthlyRent,
      daysInMonth,
      dailyRate: this.applyRounding(dailyRate, finalConfig.roundingMethod),
      proratedAmount,
      savings,
      method: this.prorationMethods[finalConfig.method],
    };
  }

  /**
   * Calculate prorated rent for lease term with multiple periods
   */
  calculateLeaseProration(
    monthlyRent: number,
    leaseStartDate: Date,
    leaseEndDate: Date,
    config: Partial<LeaseProrationConfig> = {}
  ): ProrationResult {
    const finalConfig = { ...this.defaultConfig, ...config };
    const breakdowns: ProrationBreakdown[] = [];
    const recommendations: string[] = [];

    let currentDate = new Date(leaseStartDate);
    const endDate = new Date(leaseEndDate);

    // Calculate proration for each month
    while (currentDate <= endDate) {
      const monthStart = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      );

      // Determine period boundaries
      const periodStart = currentDate < monthStart ? monthStart : currentDate;
      const periodEnd = endDate < monthEnd ? endDate : monthEnd;

      // Check if this is a partial month
      const isPartialMonth = periodStart > monthStart || periodEnd < monthEnd;

      if (isPartialMonth) {
        const breakdown = this.calculatePeriodProration(
          monthlyRent,
          periodStart,
          periodEnd,
          finalConfig
        );
        breakdowns.push(breakdown);

        // Add recommendations
        if (breakdown.savings > monthlyRent * 0.5) {
          recommendations.push(
            `Significant savings in ${
              breakdown.period.monthName
            }: ${formatCurrency(breakdown.savings)}`
          );
        }

        if (breakdown.period.billingDays <= 3) {
          recommendations.push(
            `Consider waiving charge for ${breakdown.period.monthName} (only ${breakdown.period.billingDays} days)`
          );
        }
      }

      // Move to next month
      currentDate = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        1
      );
    }

    // Calculate totals
    const totalProrated = breakdowns.reduce(
      (sum, b) => sum + b.proratedAmount,
      0
    );
    const totalSavings = breakdowns.reduce((sum, b) => sum + b.savings, 0);
    const totalDays = breakdowns.reduce(
      (sum, b) => sum + b.period.billingDays,
      0
    );
    const originalAmount = breakdowns.length * monthlyRent;
    const averageDailyRate = totalDays > 0 ? totalProrated / totalDays : 0;

    // Add general recommendations
    if (breakdowns.length === 0) {
      recommendations.push("No proration needed - full month periods");
    } else if (totalSavings > monthlyRent) {
      recommendations.push(
        "Substantial savings from proration - review lease terms"
      );
    }

    if (finalConfig.method === "banking" && breakdowns.length > 0) {
      recommendations.push(
        "Using banking method (30-day months) - consider daily method for accuracy"
      );
    }

    return {
      totalProrated: this.applyRounding(
        totalProrated,
        finalConfig.roundingMethod
      ),
      totalSavings: this.applyRounding(
        totalSavings,
        finalConfig.roundingMethod
      ),
      breakdowns,
      summary: {
        originalAmount: this.applyRounding(
          originalAmount,
          finalConfig.roundingMethod
        ),
        proratedAmount: this.applyRounding(
          totalProrated,
          finalConfig.roundingMethod
        ),
        totalDays,
        averageDailyRate: this.applyRounding(
          averageDailyRate,
          finalConfig.roundingMethod
        ),
      },
      recommendations,
    };
  }

  /**
   * Calculate move-in proration (first month)
   */
  calculateMoveInProration(
    monthlyRent: number,
    moveInDate: Date,
    config: Partial<LeaseProrationConfig> = {}
  ): ProrationBreakdown {
    const moveIn = new Date(moveInDate);
    const monthEnd = new Date(moveIn.getFullYear(), moveIn.getMonth() + 1, 0);

    return this.calculatePeriodProration(monthlyRent, moveIn, monthEnd, config);
  }

  /**
   * Calculate move-out proration (last month)
   */
  calculateMoveOutProration(
    monthlyRent: number,
    moveOutDate: Date,
    config: Partial<LeaseProrationConfig> = {}
  ): ProrationBreakdown {
    const moveOut = new Date(moveOutDate);
    const monthStart = new Date(moveOut.getFullYear(), moveOut.getMonth(), 1);

    return this.calculatePeriodProration(
      monthlyRent,
      monthStart,
      moveOut,
      config
    );
  }

  /**
   * Compare different proration methods
   */
  compareProrationMethods(
    monthlyRent: number,
    startDate: Date,
    endDate: Date
  ): Record<string, ProrationBreakdown> {
    const methods: Array<"daily" | "calendar" | "banking"> = [
      "daily",
      "calendar",
      "banking",
    ];
    const comparisons: Record<string, ProrationBreakdown> = {};

    methods.forEach((method) => {
      comparisons[method] = this.calculatePeriodProration(
        monthlyRent,
        startDate,
        endDate,
        { method }
      );
    });

    return comparisons;
  }

  /**
   * Get proration recommendations based on lease terms
   */
  getProrationRecommendations(
    monthlyRent: number,
    leaseStartDate: Date,
    leaseEndDate: Date
  ): {
    recommendedMethod: "daily" | "calendar" | "banking";
    reasoning: string[];
    estimatedSavings: number;
    riskFactors: string[];
  } {
    const reasoning: string[] = [];
    const riskFactors: string[] = [];

    // Calculate with different methods
    const dailyResult = this.calculateLeaseProration(
      monthlyRent,
      leaseStartDate,
      leaseEndDate,
      { method: "daily" }
    );
    const calendarResult = this.calculateLeaseProration(
      monthlyRent,
      leaseStartDate,
      leaseEndDate,
      { method: "calendar" }
    );

    let recommendedMethod: "daily" | "calendar" | "banking" = "daily";

    // Determine recommendation based on accuracy and tenant benefit
    if (
      Math.abs(dailyResult.totalProrated - calendarResult.totalProrated) < 10
    ) {
      recommendedMethod = "calendar";
      reasoning.push(
        "Minimal difference between methods - calendar method is simpler"
      );
    } else {
      recommendedMethod = "daily";
      reasoning.push(
        "Significant difference between methods - daily method is more accurate"
      );
    }

    // Check for risk factors
    if (dailyResult.totalSavings > monthlyRent * 2) {
      riskFactors.push("High savings amount may impact cash flow");
    }

    if (dailyResult.breakdowns.some((b) => b.period.billingDays <= 2)) {
      riskFactors.push("Very short billing periods - consider minimum charges");
    }

    return {
      recommendedMethod,
      reasoning,
      estimatedSavings: dailyResult.totalSavings,
      riskFactors,
    };
  }
}

export const proratedRentCalculatorService =
  new ProratedRentCalculatorService();
