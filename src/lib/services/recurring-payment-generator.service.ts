/**
 * PropertyPro - Automated Recurring Payment Generation Service
 * Automatically generates monthly rent charges and payment schedules for leases
 *
 * Converted from Mongoose to Prisma/Postgres. Duplicate protection comes from
 * the DB partial unique index (one non-deleted rent payment per lease per due
 * date): a P2002 during generation means the charge already exists.
 */

import {
  PaymentType,
  PaymentFrequency,
  IPaymentSchedule,
} from "@/types";
import { db } from "@/lib/db/prisma";
import type { Payment as PaymentModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type PaymentRow = MoneyAsNumber<PaymentModel>;
import { paymentService, isUniqueConstraintError } from "./payment.service";
import { paymentStatusService } from "./payment-status.service";
import { leaseRentAmount, leaseSecurityDeposit } from "@/lib/lease-money";

export interface PaymentGenerationConfig {
  autoCreatePayments: boolean;
  autoGenerateInvoices: boolean;
  autoEmailInvoices: boolean;
  enableProration: boolean;
}

export interface ProrationCalculation {
  totalDays: number;
  daysInMonth: number;
  dailyRate: number;
  proratedAmount: number;
  fullMonthAmount: number;
  startDate: Date;
  endDate: Date;
}

export interface PaymentScheduleResult {
  payments: PaymentRow[];
  totalAmount: number;
  scheduleGenerated: boolean;
  prorationApplied: boolean;
  firstPaymentProrated: boolean;
  lastPaymentProrated: boolean;
  errors: string[];
}

export class RecurringPaymentGeneratorService {
  private defaultConfig: PaymentGenerationConfig = {
    autoCreatePayments: true,
    autoGenerateInvoices: true,
    autoEmailInvoices: false,
    enableProration: true,
  };

  /**
   * Calculate prorated rent for partial months
   */
  calculateProration(
    monthlyRent: number,
    startDate: Date,
    endDate: Date
  ): ProrationCalculation {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // Get the last day of the month for the start date
    const lastDayOfMonth = new Date(
      start.getFullYear(),
      start.getMonth() + 1,
      0
    ).getDate();
    const daysInMonth = lastDayOfMonth;

    // Calculate days in the period
    const timeDiff = end.getTime() - start.getTime();
    const totalDays = Math.ceil(timeDiff / (1000 * 60 * 60 * 24)) + 1; // +1 to include both start and end dates

    const dailyRate = monthlyRent / daysInMonth;
    const proratedAmount = Math.round(dailyRate * totalDays * 100) / 100;

    return {
      totalDays,
      daysInMonth,
      dailyRate: Math.round(dailyRate * 100) / 100,
      proratedAmount,
      fullMonthAmount: monthlyRent,
      startDate: start,
      endDate: end,
    };
  }

  /**
   * Generate payment schedule for entire lease term
   */
  async generatePaymentSchedule(
    leaseId: string,
    config: Partial<PaymentGenerationConfig> = {}
  ): Promise<PaymentScheduleResult> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const result: PaymentScheduleResult = {
      payments: [],
      totalAmount: 0,
      scheduleGenerated: false,
      prorationApplied: false,
      firstPaymentProrated: false,
      lastPaymentProrated: false,
      errors: [],
    };

    try {
      const lease = await db.lease.findFirst({ where: { id: leaseId } });

      if (!lease) {
        result.errors.push(`Lease not found: ${leaseId}`);
        return result;
      }

      const terms = (lease.terms as any) ?? {};
      const monthlyRent = leaseRentAmount(lease);
      if (monthlyRent <= 0) {
        result.errors.push("Invalid monthly rent amount");
        return result;
      }

      const leaseStart = new Date(lease.startDate);
      const leaseEnd = new Date(lease.endDate);
      const payments: PaymentRow[] = [];

      // Generate payments month by month
      let currentDate = new Date(leaseStart);
      let paymentNumber = 1;

      while (currentDate <= leaseEnd) {
        const isFirstMonth = paymentNumber === 1;
        const monthStart = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth(),
          leaseStart.getDate()
        );
        const monthEnd = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          leaseStart.getDate() - 1
        );

        // Adjust for lease boundaries
        const paymentStart = isFirstMonth ? leaseStart : monthStart;
        const paymentEnd = monthEnd > leaseEnd ? leaseEnd : monthEnd;

        let paymentAmount = monthlyRent;
        let isProrated = false;

        // Calculate proration if enabled
        if (finalConfig.enableProration) {
          const isPartialMonth =
            paymentStart.getDate() !== leaseStart.getDate() ||
            paymentEnd < monthEnd;

          if (isPartialMonth) {
            const proration = this.calculateProration(
              monthlyRent,
              paymentStart,
              paymentEnd
            );
            paymentAmount = proration.proratedAmount;
            isProrated = true;
            result.prorationApplied = true;

            if (isFirstMonth) {
              result.firstPaymentProrated = true;
            }
            if (paymentEnd >= leaseEnd) {
              result.lastPaymentProrated = true;
            }
          }
        }

        // Create payment schedule
        const schedule: IPaymentSchedule = {
          frequency: PaymentFrequency.MONTHLY,
          startDate: paymentStart,
          endDate: paymentEnd,
          dayOfMonth: leaseStart.getDate(),
          isActive: true,
          nextDueDate: monthStart,
        };

        // Create payment data
        const paymentData = {
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          leaseId: leaseId,
          amount: paymentAmount,
          type: PaymentType.RENT,
          dueDate: monthStart,
          description: `Monthly rent payment #${paymentNumber}${
            isProrated ? " (prorated)" : ""
          }`,
          notes: isProrated
            ? `Prorated for ${paymentStart.toDateString()} to ${paymentEnd.toDateString()}`
            : "",
          schedule,
        };

        if (finalConfig.autoCreatePayments) {
          try {
            const payment = await paymentService.createPayment(paymentData);
            payments.push(payment);
          } catch (error) {
            // Rent charge already exists for this lease + due date (P2002
            // from the partial unique index) — treat as already-generated.
            if (!isUniqueConstraintError(error)) {
              throw error;
            }
          }
        }

        result.totalAmount += paymentAmount;
        paymentNumber++;

        // Move to next month
        currentDate = new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() + 1,
          1
        );
      }

      result.payments = payments;
      result.scheduleGenerated = true;

      // Update payment statuses based on current date
      if (payments.length > 0) {
        const paymentIds = payments.map((p) => p.id);
        await paymentStatusService.batchUpdatePaymentStatuses(paymentIds);
      }
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error occurred"
      );
    }

    return result;
  }

  /**
   * Generate security deposit payment
   */
  async generateSecurityDepositPayment(
    leaseId: string,
    config: Partial<PaymentGenerationConfig> = {}
  ): Promise<PaymentRow | null> {
    try {
      const lease = await db.lease.findFirst({ where: { id: leaseId } });

      if (!lease) {
        throw new Error(`Lease not found: ${leaseId}`);
      }

      const terms = (lease.terms as any) ?? {};
      const securityDeposit = leaseSecurityDeposit(lease);
      if (securityDeposit <= 0) {
        return null; // No security deposit required
      }

      const paymentData = {
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        leaseId: leaseId,
        amount: securityDeposit,
        type: PaymentType.SECURITY_DEPOSIT,
        dueDate: new Date(lease.startDate),
        description: "Security deposit payment",
        notes: "Required before lease commencement",
      };

      const payment = await paymentService.createPayment(paymentData);

      // Update payment status
      await paymentStatusService.updatePaymentStatus(payment.id);

      return payment;
    } catch (error) {
      console.error("Error generating security deposit payment:", error);
      return null;
    }
  }

  /**
   * Generate additional payments (pet deposit, utilities, etc.)
   */
  async generateAdditionalPayments(
    leaseId: string,
    additionalCharges: Array<{
      type: PaymentType;
      amount: number;
      description: string;
      dueDate?: Date;
      recurring?: boolean;
    }>,
    config: Partial<PaymentGenerationConfig> = {}
  ): Promise<PaymentRow[]> {
    const payments: PaymentRow[] = [];

    try {
      const lease = await db.lease.findFirst({ where: { id: leaseId } });

      if (!lease) {
        throw new Error(`Lease not found: ${leaseId}`);
      }

      for (const charge of additionalCharges) {
        const paymentData = {
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          leaseId: leaseId,
          amount: charge.amount,
          type: charge.type,
          dueDate: charge.dueDate || new Date(lease.startDate),
          description: charge.description,
          notes: charge.recurring ? "Recurring charge" : "One-time charge",
        };

        try {
          const payment = await paymentService.createPayment(paymentData);
          payments.push(payment);
        } catch (error) {
          // Already-generated duplicate (P2002) — skip
          if (!isUniqueConstraintError(error)) {
            throw error;
          }
        }
      }

      // Update payment statuses
      if (payments.length > 0) {
        const paymentIds = payments.map((p) => p.id);
        await paymentStatusService.batchUpdatePaymentStatuses(paymentIds);
      }
    } catch (error) {
      console.error("Error generating additional payments:", error);
    }

    return payments;
  }

  /**
   * Setup complete payment system for a new lease
   */
  async setupLeasePaymentSystem(
    leaseId: string,
    config: Partial<PaymentGenerationConfig> = {}
  ): Promise<{
    rentPayments: PaymentRow[];
    securityDeposit: PaymentRow | null;
    additionalPayments: PaymentRow[];
    totalSetupAmount: number;
    success: boolean;
    errors: string[];
  }> {
    const result = {
      rentPayments: [] as PaymentRow[],
      securityDeposit: null as PaymentRow | null,
      additionalPayments: [] as PaymentRow[],
      totalSetupAmount: 0,
      success: false,
      errors: [] as string[],
    };

    try {
      // Generate rent payment schedule
      const scheduleResult = await this.generatePaymentSchedule(
        leaseId,
        config
      );
      result.rentPayments = scheduleResult.payments;
      result.errors.push(...scheduleResult.errors);

      // Generate security deposit payment
      result.securityDeposit = await this.generateSecurityDepositPayment(
        leaseId,
        config
      );

      // Calculate total setup amount (first month + security deposit)
      const firstMonthRent =
        result.rentPayments.length > 0 ? result.rentPayments[0].amount : 0;
      const securityAmount = result.securityDeposit?.amount || 0;
      result.totalSetupAmount = firstMonthRent + securityAmount;

      result.success = result.errors.length === 0;
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Transaction failed"
      );
    }

    return result;
  }
}

export const recurringPaymentGeneratorService =
  new RecurringPaymentGeneratorService();
