/**
 * PropertyPro - Payment Scheduling Service
 * Handles recurring payments, scheduling, and automated payment generation
 *
 * Converted from Mongoose to Prisma/Postgres. Duplicate rent charges are now
 * prevented by the DB partial unique index (one non-deleted rent payment per
 * lease per due date) — a P2002 during generation means "already generated".
 */

import {
  PaymentFrequency,
  IPaymentSchedule,
  PaymentType,
  ILeasePaymentConfig,
} from "@/types";
import { db } from "@/lib/db/prisma";
import { leaseRentAmount, leaseSecurityDeposit } from "@/lib/lease-money";
import { Prisma } from "@/generated/prisma/client";
import type { Payment as PaymentModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type PaymentRow = MoneyAsNumber<PaymentModel>;
import { paymentService, isUniqueConstraintError } from "./payment.service";

export interface ScheduleConfig {
  frequency: PaymentFrequency;
  startDate: Date;
  endDate?: Date;
  dayOfMonth?: number;
  dayOfWeek?: number;
  customInterval?: number;
  amount: number;
  type: PaymentType;
  description?: string;
}

export interface RecurringPaymentSetup {
  leaseId: string;
  tenantId: string;
  propertyId: string;
  schedules: ScheduleConfig[];
}

/** Parse a schedule Json column back into Date-typed fields. */
function parseSchedule(raw: unknown): (IPaymentSchedule & Record<string, any>) | null {
  if (!raw || typeof raw !== "object") return null;
  const schedule = { ...(raw as Record<string, any>) };
  for (const key of [
    "startDate",
    "endDate",
    "nextDueDate",
    "lastGeneratedDate",
  ]) {
    if (schedule[key]) schedule[key] = new Date(schedule[key]);
  }
  return schedule as IPaymentSchedule & Record<string, any>;
}

class PaymentSchedulerService {
  /**
   * Create a recurring payment schedule
   */
  async createRecurringSchedule(
    setup: RecurringPaymentSetup
  ): Promise<PaymentRow[]> {
    const createdPayments: PaymentRow[] = [];

    for (const scheduleConfig of setup.schedules) {
      const payments = await this.generatePaymentsFromSchedule(
        setup,
        scheduleConfig
      );
      createdPayments.push(...payments);
    }

    return createdPayments;
  }

  /**
   * Generate payments from a schedule configuration
   */
  private async generatePaymentsFromSchedule(
    setup: RecurringPaymentSetup,
    config: ScheduleConfig
  ): Promise<PaymentRow[]> {
    const payments: PaymentRow[] = [];
    const dueDates = this.calculateDueDates(config);

    for (const dueDate of dueDates) {
      try {
        const payment = await paymentService.createPayment({
          tenantId: setup.tenantId,
          propertyId: setup.propertyId,
          leaseId: setup.leaseId,
          amount: config.amount,
          type: config.type,
          dueDate,
          description:
            config.description ||
            this.generatePaymentDescription(config, dueDate),
          schedule: {
            frequency: config.frequency,
            startDate: config.startDate,
            endDate: config.endDate,
            dayOfMonth: config.dayOfMonth,
            dayOfWeek: config.dayOfWeek,
            customInterval: config.customInterval,
            isActive: true,
          },
        });

        payments.push(payment);
      } catch (error) {
        // P2002 = this charge already exists (partial unique index on
        // lease/type/dueDate) — treat as already-generated and continue.
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
      }
    }

    return payments;
  }

  /**
   * Calculate all due dates for a schedule
   */
  private calculateDueDates(config: ScheduleConfig): Date[] {
    const dueDates: Date[] = [];
    let currentDate = new Date(config.startDate);
    const endDate = config.endDate || this.getDefaultEndDate(config.startDate);

    while (currentDate <= endDate) {
      dueDates.push(new Date(currentDate));
      currentDate = this.getNextDueDate(currentDate, config);

      // Prevent infinite loops
      if (dueDates.length > 1000) {
        break;
      }
    }

    return dueDates;
  }

  /**
   * Get the next due date based on frequency
   */
  private getNextDueDate(currentDate: Date, config: ScheduleConfig): Date {
    const nextDate = new Date(currentDate);

    switch (config.frequency) {
      case PaymentFrequency.WEEKLY:
        nextDate.setDate(nextDate.getDate() + 7);
        if (config.dayOfWeek !== undefined) {
          // Adjust to specific day of week
          const dayDiff = config.dayOfWeek - nextDate.getDay();
          nextDate.setDate(nextDate.getDate() + dayDiff);
        }
        break;

      case PaymentFrequency.MONTHLY:
        nextDate.setMonth(nextDate.getMonth() + 1);
        if (config.dayOfMonth) {
          nextDate.setDate(config.dayOfMonth);
          // Handle months with fewer days
          if (nextDate.getDate() !== config.dayOfMonth) {
            nextDate.setDate(0); // Last day of previous month
          }
        }
        break;

      case PaymentFrequency.QUARTERLY:
        nextDate.setMonth(nextDate.getMonth() + 3);
        if (config.dayOfMonth) {
          nextDate.setDate(config.dayOfMonth);
        }
        break;

      case PaymentFrequency.ANNUALLY:
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        if (config.dayOfMonth) {
          nextDate.setDate(config.dayOfMonth);
        }
        break;

      case PaymentFrequency.CUSTOM:
        if (config.customInterval) {
          nextDate.setMonth(nextDate.getMonth() + config.customInterval);
        } else {
          nextDate.setDate(nextDate.getDate() + 30); // Default to 30 days
        }
        break;

      default:
        // One-time payment, return far future date to stop iteration
        nextDate.setFullYear(nextDate.getFullYear() + 100);
        break;
    }

    return nextDate;
  }

  /**
   * Get default end date (1 year from start for most schedules)
   */
  private getDefaultEndDate(startDate: Date): Date {
    const endDate = new Date(startDate);
    endDate.setFullYear(endDate.getFullYear() + 1);
    return endDate;
  }

  /**
   * Generate payment description based on schedule
   */
  private generatePaymentDescription(
    config: ScheduleConfig,
    dueDate: Date
  ): string {
    const monthYear = dueDate.toLocaleDateString("en-US", {
      month: "long",
      year: "numeric",
    });

    switch (config.type) {
      case PaymentType.RENT:
        return `Monthly rent - ${monthYear}`;
      case PaymentType.UTILITY:
        return `Utility payment - ${monthYear}`;
      case PaymentType.MAINTENANCE:
        return `Maintenance fee - ${monthYear}`;
      default:
        return `${config.type} payment - ${monthYear}`;
    }
  }

  /**
   * Setup standard lease payment schedule
   */
  async setupLeasePaymentSchedule(leaseId: string): Promise<PaymentRow[]> {
    const lease = await db.lease.findFirst({ where: { id: leaseId } });
    if (!lease) {
      throw new Error("Lease not found");
    }

    const terms = (lease.terms as any) ?? {};
    const paymentConfig = terms.paymentConfig as ILeasePaymentConfig | undefined;
    if (!paymentConfig?.autoCreatePayments) {
      return [];
    }

    const schedules: ScheduleConfig[] = [];

    // Security deposit (one-time)
    if (leaseSecurityDeposit(lease) > 0) {
      schedules.push({
        frequency: PaymentFrequency.ONE_TIME,
        startDate: new Date(lease.startDate),
        amount: leaseSecurityDeposit(lease),
        type: PaymentType.SECURITY_DEPOSIT,
        description: "Security deposit",
      });
    }

    // Pet deposit (one-time)
    if (terms.petDeposit && terms.petDeposit > 0) {
      schedules.push({
        frequency: PaymentFrequency.ONE_TIME,
        startDate: new Date(lease.startDate),
        amount: terms.petDeposit,
        type: PaymentType.PET_DEPOSIT,
        description: "Pet deposit",
      });
    }

    // Monthly rent
    const rentStartDate = new Date(lease.startDate);
    rentStartDate.setDate(paymentConfig.rentDueDay);

    // If rent due day has passed in start month, move to next month
    if (rentStartDate < new Date(lease.startDate)) {
      rentStartDate.setMonth(rentStartDate.getMonth() + 1);
    }

    schedules.push({
      frequency: PaymentFrequency.MONTHLY,
      startDate: rentStartDate,
      endDate: new Date(lease.endDate),
      dayOfMonth: paymentConfig.rentDueDay,
      amount: leaseRentAmount(lease),
      type: PaymentType.RENT,
      description: "Monthly rent",
    });

    // Advance payments if configured
    if (
      paymentConfig.advancePaymentMonths &&
      paymentConfig.advancePaymentMonths > 0
    ) {
      const advanceAmount =
        leaseRentAmount(lease) * paymentConfig.advancePaymentMonths;
      schedules.push({
        frequency: PaymentFrequency.ONE_TIME,
        startDate: new Date(lease.startDate),
        amount: advanceAmount,
        type: PaymentType.RENT,
        description: `Advance rent payment (${paymentConfig.advancePaymentMonths} months)`,
      });
    }

    return this.createRecurringSchedule({
      leaseId: lease.id,
      tenantId: lease.tenantId,
      propertyId: lease.propertyId,
      schedules,
    });
  }

  /**
   * Process scheduled payments (run daily via cron job)
   */
  async processScheduledPayments(): Promise<{
    generated: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let generated = 0;

    try {
      // Find active recurring payments that need next payment generated
      // (schedule is a Json column — filter its fields in memory)
      const now = new Date();
      const candidates = await db.payment.findMany({
        where: { isRecurring: true, deletedAt: null },
      });

      const recurringPayments = candidates.filter((payment) => {
        const schedule = parseSchedule(payment.schedule);
        return (
          schedule?.isActive &&
          schedule.nextDueDate &&
          schedule.nextDueDate <= now
        );
      });

      for (const payment of recurringPayments) {
        try {
          const nextPayment = await this.generateNextPayment(payment);
          if (nextPayment) {
            generated++;
          }
        } catch (error) {
          errors.push(
            `Payment ${payment.id}: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    } catch (error) {
      errors.push(
        `Failed to process scheduled payments: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    return { generated, errors };
  }

  /**
   * Generate the next payment in a recurring series
   */
  private async generateNextPayment(
    parentPayment: PaymentRow
  ): Promise<PaymentRow | null> {
    const schedule = parseSchedule(parentPayment.schedule);
    if (!schedule || !schedule.isActive) {
      return null;
    }

    const nextDueDate = schedule.nextDueDate;

    if (!nextDueDate || (schedule.endDate && nextDueDate > schedule.endDate)) {
      // Mark schedule as inactive
      await db.payment.update({
        where: { id: parentPayment.id },
        data: {
          schedule: {
            ...schedule,
            isActive: false,
          } as unknown as Prisma.InputJsonValue,
        },
      });
      return null;
    }

    const scheduleConfig: ScheduleConfig = {
      frequency: schedule.frequency,
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      dayOfMonth: schedule.dayOfMonth,
      dayOfWeek: schedule.dayOfWeek,
      customInterval: schedule.customInterval,
      amount: parentPayment.amount,
      type: parentPayment.type as PaymentType,
    };

    // Create next payment
    let nextPayment: PaymentRow | null = null;
    try {
      nextPayment = await paymentService.createPayment({
        tenantId: parentPayment.tenantId,
        propertyId: parentPayment.propertyId,
        leaseId: parentPayment.leaseId ?? undefined,
        amount: parentPayment.amount,
        type: parentPayment.type as PaymentType,
        dueDate: nextDueDate,
        description: parentPayment.description ?? undefined,
        schedule: {
          ...schedule,
          lastGeneratedDate: new Date(),
          nextDueDate: this.getNextDueDate(nextDueDate, scheduleConfig),
        },
        lateFeeConfig: (parentPayment.lateFeeConfig as any) ?? undefined,
      });
    } catch (error) {
      // Already generated (P2002 from the partial unique index) — advance the
      // parent schedule anyway so the scheduler does not retry forever.
      if (!isUniqueConstraintError(error)) {
        throw error;
      }
    }

    // Update parent payment's schedule
    await db.payment.update({
      where: { id: parentPayment.id },
      data: {
        schedule: {
          ...schedule,
          lastGeneratedDate: new Date(),
          nextDueDate: this.getNextDueDate(nextDueDate, scheduleConfig),
        } as unknown as Prisma.InputJsonValue,
      },
    });

    return nextPayment;
  }

  /**
   * Update payment schedule
   */
  async updatePaymentSchedule(
    paymentId: string,
    scheduleUpdate: Partial<IPaymentSchedule>
  ): Promise<PaymentRow> {
    const payment = await db.payment.findFirst({ where: { id: paymentId } });
    if (!payment) {
      throw new Error("Payment not found");
    }

    const schedule = parseSchedule(payment.schedule);
    if (!schedule) {
      throw new Error("Payment does not have a schedule");
    }

    // Update schedule (append immutably — Json column)
    const nextSchedule: any = { ...schedule, ...scheduleUpdate };

    // Recalculate next due date if frequency or timing changed
    if (
      scheduleUpdate.frequency ||
      scheduleUpdate.dayOfMonth ||
      scheduleUpdate.dayOfWeek
    ) {
      const lastDate = nextSchedule.lastGeneratedDate || nextSchedule.startDate;
      nextSchedule.nextDueDate = this.getNextDueDate(new Date(lastDate), {
        frequency: nextSchedule.frequency,
        startDate: nextSchedule.startDate,
        endDate: nextSchedule.endDate,
        dayOfMonth: nextSchedule.dayOfMonth,
        dayOfWeek: nextSchedule.dayOfWeek,
        customInterval: nextSchedule.customInterval,
        amount: payment.amount,
        type: payment.type as PaymentType,
      });
    }

    return db.payment.update({
      where: { id: paymentId },
      data: { schedule: nextSchedule as unknown as Prisma.InputJsonValue },
    });
  }

  /**
   * Cancel recurring payment schedule
   */
  async cancelPaymentSchedule(paymentId: string): Promise<PaymentRow> {
    const payment = await db.payment.findFirst({ where: { id: paymentId } });
    if (!payment) {
      throw new Error("Payment not found");
    }

    const schedule = parseSchedule(payment.schedule);
    if (schedule) {
      return db.payment.update({
        where: { id: paymentId },
        data: {
          schedule: {
            ...schedule,
            isActive: false,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return payment;
  }

  /**
   * Get upcoming scheduled payments
   */
  async getUpcomingPayments(days: number = 30) {
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const payments = await db.payment.findMany({
      where: {
        dueDate: { gte: new Date(), lte: endDate },
        status: "pending",
        deletedAt: null,
      },
      include: {
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        property: {
          select: {
            id: true,
            name: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
          },
        },
        lease: {
          select: { id: true, startDate: true, endDate: true, status: true },
        },
      },
      orderBy: { dueDate: "asc" },
    });

    // Preserve the populated response shape
    return payments.map((payment) => ({
      ...payment,
      tenantId: payment.tenant ?? payment.tenantId,
      propertyId: payment.property
        ? {
            ...payment.property,
            address: {
              street: payment.property.addressStreet,
              city: payment.property.addressCity,
              state: payment.property.addressState,
              zipCode: payment.property.addressZipCode,
            },
          }
        : payment.propertyId,
      leaseId: payment.lease ?? payment.leaseId,
      tenant: undefined,
      property: undefined,
      lease: undefined,
    }));
  }
}

export const paymentSchedulerService = new PaymentSchedulerService();
