/**
 * PropertyPro - System Configuration Service
 * Fine-tuning and optimization of system parameters based on analytics and feedback
 */

export interface PaymentConfiguration {
  gracePeriods: {
    default: number; // days
    firstTimeRenters: number;
    longTermTenants: number; // 1+ years
    autoPayUsers: number;
  };
  lateFees: {
    enabled: boolean;
    gracePeriodDays: number;
    feeStructure: {
      type: "fixed" | "percentage" | "tiered" | "daily";
      fixedAmount?: number;
      percentage?: number;
      dailyAmount?: number;
      tieredRates?: {
        daysLate: number;
        amount: number;
      }[];
    };
    maximumFee?: number;
    autoApplication: boolean;
  };
  communicationTiming: {
    paymentReminders: {
      firstReminder: number; // days before due date
      secondReminder: number;
      finalReminder: number;
      overdueNotice: number; // days after due date
      escalationNotice: number;
    };
    channels: {
      email: boolean;
      sms: boolean;
      pushNotification: boolean;
    };
    businessHours: {
      enabled: boolean;
      start: string; // HH:MM format
      end: string;
      timezone: string;
      weekendsEnabled: boolean;
    };
  };
  autoPayIncentives: {
    enabled: boolean;
    discountType: "fixed" | "percentage";
    discountAmount: number;
    gracePeriodExtension: number; // additional days
  };
}

export interface OptimizationRecommendation {
  parameter: string;
  currentValue: any;
  recommendedValue: any;
  reason: string;
  expectedImpact: string;
  confidence: "high" | "medium" | "low";
  dataSource: "analytics" | "feedback" | "benchmark";
  priority: "high" | "medium" | "low";
}

export interface ConfigurationAnalysis {
  currentConfig: PaymentConfiguration;
  performanceMetrics: {
    collectionRate: number;
    averageDaysToPayment: number;
    lateFeeRevenue: number;
    autoPayAdoption: number;
    tenantSatisfaction: number;
  };
  recommendations: OptimizationRecommendation[];
  benchmarkComparison: {
    parameter: string;
    current: number;
    industry: number;
    status: "above" | "at" | "below";
  }[];
}

class SystemConfigurationService {
  private currentConfig: PaymentConfiguration;
  private configHistory: {
    timestamp: Date;
    config: PaymentConfiguration;
    reason: string;
  }[] = [];

  constructor() {
    this.currentConfig = this.getDefaultConfiguration();
  }

  /**
   * Get default system configuration
   */
  private getDefaultConfiguration(): PaymentConfiguration {
    return {
      gracePeriods: {
        default: 5,
        firstTimeRenters: 7,
        longTermTenants: 3,
        autoPayUsers: 2,
      },
      lateFees: {
        enabled: true,
        gracePeriodDays: 5,
        feeStructure: {
          type: "fixed",
          fixedAmount: 50,
        },
        maximumFee: 200,
        autoApplication: true,
      },
      communicationTiming: {
        paymentReminders: {
          firstReminder: 7,
          secondReminder: 3,
          finalReminder: 1,
          overdueNotice: 1,
          escalationNotice: 7,
        },
        channels: {
          email: true,
          sms: true,
          pushNotification: false,
        },
        businessHours: {
          enabled: true,
          start: "09:00",
          end: "17:00",
          timezone: "America/New_York",
          weekendsEnabled: false,
        },
      },
      autoPayIncentives: {
        enabled: true,
        discountType: "fixed",
        discountAmount: 10,
        gracePeriodExtension: 2,
      },
    };
  }

  /**
   * Get current configuration
   */
  getCurrentConfiguration(): PaymentConfiguration {
    return { ...this.currentConfig };
  }

  /**
   * Update configuration with validation
   */
  async updateConfiguration(
    updates: Partial<PaymentConfiguration>,
    reason: string = "Manual update"
  ): Promise<PaymentConfiguration> {
    // Validate updates
    const validationResult = this.validateConfiguration(updates);
    if (!validationResult.valid) {
      throw new Error(
        `Configuration validation failed: ${validationResult.errors.join(", ")}`
      );
    }

    // Store current config in history
    this.configHistory.push({
      timestamp: new Date(),
      config: { ...this.currentConfig },
      reason: `Before: ${reason}`,
    });

    // Apply updates
    this.currentConfig = {
      ...this.currentConfig,
      ...updates,
    };

    // Store updated config in history
    this.configHistory.push({
      timestamp: new Date(),
      config: { ...this.currentConfig },
      reason,
    });


    return this.getCurrentConfiguration();
  }

  /**
   * Validate configuration parameters
   */
  private validateConfiguration(config: Partial<PaymentConfiguration>): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    // Validate grace periods
    if (config.gracePeriods) {
      const gp = config.gracePeriods;
      if (gp.default && (gp.default < 0 || gp.default > 30)) {
        errors.push("Default grace period must be between 0 and 30 days");
      }
      if (
        gp.firstTimeRenters &&
        (gp.firstTimeRenters < 0 || gp.firstTimeRenters > 30)
      ) {
        errors.push(
          "First-time renter grace period must be between 0 and 30 days"
        );
      }
    }

    // Validate late fees
    if (config.lateFees) {
      const lf = config.lateFees;
      if (lf.feeStructure) {
        if (
          lf.feeStructure.type === "fixed" &&
          (!lf.feeStructure.fixedAmount || lf.feeStructure.fixedAmount < 0)
        ) {
          errors.push("Fixed late fee amount must be greater than 0");
        }
        if (
          lf.feeStructure.type === "percentage" &&
          (!lf.feeStructure.percentage ||
            lf.feeStructure.percentage < 0 ||
            lf.feeStructure.percentage > 50)
        ) {
          errors.push("Percentage late fee must be between 0 and 50%");
        }
      }
      if (lf.maximumFee && lf.maximumFee < 0) {
        errors.push("Maximum late fee must be greater than or equal to 0");
      }
    }

    // Validate communication timing
    if (config.communicationTiming?.paymentReminders) {
      const pr = config.communicationTiming.paymentReminders;
      if (pr.firstReminder && (pr.firstReminder < 1 || pr.firstReminder > 30)) {
        errors.push(
          "First reminder must be between 1 and 30 days before due date"
        );
      }
      if (
        pr.secondReminder &&
        pr.firstReminder &&
        pr.secondReminder >= pr.firstReminder
      ) {
        errors.push(
          "Second reminder must be closer to due date than first reminder"
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Analyze current configuration and generate optimization recommendations
   */
  async analyzeConfiguration(): Promise<ConfigurationAnalysis> {
    // Get performance metrics (would come from analytics service in real implementation)
    const performanceMetrics = await this.getPerformanceMetrics();

    // Generate recommendations based on analytics and feedback
    const recommendations = await this.generateOptimizationRecommendations(
      performanceMetrics
    );

    // Compare to industry benchmarks
    const benchmarkComparison = this.compareToBenchmarks();

    return {
      currentConfig: this.getCurrentConfiguration(),
      performanceMetrics,
      recommendations,
      benchmarkComparison,
    };
  }

  /**
   * Get current performance metrics
   */
  private async getPerformanceMetrics() {
    // In real implementation, this would fetch from analytics service
    return {
      collectionRate: 0.94,
      averageDaysToPayment: 2.3,
      lateFeeRevenue: 3250.0,
      autoPayAdoption: 0.68,
      tenantSatisfaction: 4.2,
    };
  }

  /**
   * Generate optimization recommendations
   */
  private async generateOptimizationRecommendations(
    metrics: any
  ): Promise<OptimizationRecommendation[]> {
    const recommendations: OptimizationRecommendation[] = [];

    // Collection rate optimization
    if (metrics.collectionRate < 0.95) {
      recommendations.push({
        parameter: "gracePeriods.default",
        currentValue: this.currentConfig.gracePeriods.default,
        recommendedValue: Math.max(
          3,
          this.currentConfig.gracePeriods.default - 1
        ),
        reason:
          "Collection rate below target - reducing grace period may improve timely payments",
        expectedImpact: "Increase collection rate by 2-3%",
        confidence: "medium",
        dataSource: "analytics",
        priority: "high",
      });
    }

    // Auto-pay adoption optimization
    if (metrics.autoPayAdoption < 0.7) {
      recommendations.push({
        parameter: "autoPayIncentives.discountAmount",
        currentValue: this.currentConfig.autoPayIncentives.discountAmount,
        recommendedValue:
          this.currentConfig.autoPayIncentives.discountAmount + 5,
        reason:
          "Low auto-pay adoption - increasing incentive may encourage enrollment",
        expectedImpact: "Increase auto-pay adoption by 10-15%",
        confidence: "high",
        dataSource: "analytics",
        priority: "medium",
      });
    }

    // Communication timing optimization
    if (metrics.averageDaysToPayment > 3) {
      recommendations.push({
        parameter: "communicationTiming.paymentReminders.firstReminder",
        currentValue:
          this.currentConfig.communicationTiming.paymentReminders.firstReminder,
        recommendedValue: Math.min(
          10,
          this.currentConfig.communicationTiming.paymentReminders
            .firstReminder + 2
        ),
        reason:
          "Average payment time is high - earlier reminders may improve payment timing",
        expectedImpact: "Reduce average payment time by 0.5-1 days",
        confidence: "medium",
        dataSource: "analytics",
        priority: "medium",
      });
    }

    // Late fee optimization
    if (metrics.lateFeeRevenue > 5000) {
      recommendations.push({
        parameter: "lateFees.gracePeriodDays",
        currentValue: this.currentConfig.lateFees.gracePeriodDays,
        recommendedValue: this.currentConfig.lateFees.gracePeriodDays + 1,
        reason:
          "High late fee revenue indicates potential tenant hardship - consider extending grace period",
        expectedImpact:
          "Improve tenant satisfaction while maintaining collection rates",
        confidence: "low",
        dataSource: "analytics",
        priority: "low",
      });
    }

    // Tenant satisfaction optimization
    if (metrics.tenantSatisfaction < 4.0) {
      recommendations.push({
        parameter: "communicationTiming.businessHours.weekendsEnabled",
        currentValue:
          this.currentConfig.communicationTiming.businessHours.weekendsEnabled,
        recommendedValue: false,
        reason:
          "Low tenant satisfaction - avoid weekend communications to improve experience",
        expectedImpact: "Improve tenant satisfaction scores",
        confidence: "medium",
        dataSource: "feedback",
        priority: "low",
      });
    }

    return recommendations;
  }

  /**
   * Compare configuration to industry benchmarks
   */
  private compareToBenchmarks() {
    const benchmarks = [
      {
        parameter: "Grace Period (days)",
        current: this.currentConfig.gracePeriods.default,
        industry: 5,
        status:
          this.currentConfig.gracePeriods.default === 5
            ? "at"
            : this.currentConfig.gracePeriods.default > 5
            ? "above"
            : ("below" as "above" | "at" | "below"),
      },
      {
        parameter: "Late Fee Amount ($)",
        current: this.currentConfig.lateFees.feeStructure.fixedAmount || 0,
        industry: 50,
        status:
          (this.currentConfig.lateFees.feeStructure.fixedAmount || 0) === 50
            ? "at"
            : (this.currentConfig.lateFees.feeStructure.fixedAmount || 0) > 50
            ? "above"
            : ("below" as "above" | "at" | "below"),
      },
      {
        parameter: "First Reminder (days before)",
        current:
          this.currentConfig.communicationTiming.paymentReminders.firstReminder,
        industry: 7,
        status:
          this.currentConfig.communicationTiming.paymentReminders
            .firstReminder === 7
            ? "at"
            : this.currentConfig.communicationTiming.paymentReminders
                .firstReminder > 7
            ? "above"
            : ("below" as "above" | "at" | "below"),
      },
      {
        parameter: "Auto-pay Discount ($)",
        current: this.currentConfig.autoPayIncentives.discountAmount,
        industry: 10,
        status:
          this.currentConfig.autoPayIncentives.discountAmount === 10
            ? "at"
            : this.currentConfig.autoPayIncentives.discountAmount > 10
            ? "above"
            : ("below" as "above" | "at" | "below"),
      },
    ];

    return benchmarks;
  }

  /**
   * Apply optimization recommendations
   */
  async applyRecommendations(
    recommendations: OptimizationRecommendation[],
    selectedIds?: string[]
  ): Promise<PaymentConfiguration> {
    const updates: Partial<PaymentConfiguration> = {};
    const appliedRecommendations: string[] = [];

    recommendations.forEach((rec, index) => {
      // Apply if no selection or if selected
      if (!selectedIds || selectedIds.includes(index.toString())) {
        // Apply the recommendation based on parameter path
        this.applyRecommendationToConfig(updates, rec);
        appliedRecommendations.push(rec.parameter);
      }
    });

    if (appliedRecommendations.length > 0) {
      await this.updateConfiguration(
        updates,
        `Applied optimization recommendations: ${appliedRecommendations.join(
          ", "
        )}`
      );
    }

    return this.getCurrentConfiguration();
  }

  /**
   * Apply a single recommendation to configuration updates
   */
  private applyRecommendationToConfig(
    updates: Partial<PaymentConfiguration>,
    recommendation: OptimizationRecommendation
  ) {
    const { parameter, recommendedValue } = recommendation;

    // Parse parameter path and apply value
    if (parameter === "gracePeriods.default") {
      if (!updates.gracePeriods)
        updates.gracePeriods = { ...this.currentConfig.gracePeriods };
      updates.gracePeriods.default = recommendedValue;
    } else if (parameter === "autoPayIncentives.discountAmount") {
      if (!updates.autoPayIncentives)
        updates.autoPayIncentives = { ...this.currentConfig.autoPayIncentives };
      updates.autoPayIncentives.discountAmount = recommendedValue;
    } else if (
      parameter === "communicationTiming.paymentReminders.firstReminder"
    ) {
      if (!updates.communicationTiming)
        updates.communicationTiming = {
          ...this.currentConfig.communicationTiming,
        };
      if (!updates.communicationTiming.paymentReminders) {
        updates.communicationTiming.paymentReminders = {
          ...this.currentConfig.communicationTiming.paymentReminders,
        };
      }
      updates.communicationTiming.paymentReminders.firstReminder =
        recommendedValue;
    } else if (parameter === "lateFees.gracePeriodDays") {
      if (!updates.lateFees)
        updates.lateFees = { ...this.currentConfig.lateFees };
      updates.lateFees.gracePeriodDays = recommendedValue;
    } else if (
      parameter === "communicationTiming.businessHours.weekendsEnabled"
    ) {
      if (!updates.communicationTiming)
        updates.communicationTiming = {
          ...this.currentConfig.communicationTiming,
        };
      if (!updates.communicationTiming.businessHours) {
        updates.communicationTiming.businessHours = {
          ...this.currentConfig.communicationTiming.businessHours,
        };
      }
      updates.communicationTiming.businessHours.weekendsEnabled =
        recommendedValue;
    }
  }

  /**
   * Get configuration history
   */
  getConfigurationHistory(limit: number = 10): typeof this.configHistory {
    return this.configHistory
      .slice(-limit)
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Rollback to previous configuration
   */
  async rollbackConfiguration(
    steps: number = 1
  ): Promise<PaymentConfiguration> {
    if (this.configHistory.length < steps * 2) {
      throw new Error("Not enough configuration history for rollback");
    }

    // Get the configuration from 'steps' changes ago
    const targetConfig =
      this.configHistory[this.configHistory.length - steps * 2].config;

    await this.updateConfiguration(targetConfig, `Rollback ${steps} step(s)`);

    return this.getCurrentConfiguration();
  }

  /**
   * Export configuration for backup
   */
  exportConfiguration(): {
    config: PaymentConfiguration;
    timestamp: Date;
    version: string;
  } {
    return {
      config: this.getCurrentConfiguration(),
      timestamp: new Date(),
      version: "1.0",
    };
  }

  /**
   * Import configuration from backup
   */
  async importConfiguration(
    configData: {
      config: PaymentConfiguration;
      timestamp: Date;
      version: string;
    },
    reason: string = "Configuration import"
  ): Promise<PaymentConfiguration> {
    // Validate imported configuration
    const validationResult = this.validateConfiguration(configData.config);
    if (!validationResult.valid) {
      throw new Error(
        `Imported configuration is invalid: ${validationResult.errors.join(
          ", "
        )}`
      );
    }

    await this.updateConfiguration(
      configData.config,
      `${reason} (from ${configData.timestamp.toISOString()})`
    );

    return this.getCurrentConfiguration();
  }
}

export const systemConfigurationService = new SystemConfigurationService();
