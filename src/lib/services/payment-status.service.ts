/**
 * PropertyPro - Enhanced Payment Status Management Service
 * Handles payment status lifecycle with enhanced hierarchy and automated transitions
 *
 * Converted from Mongoose to Prisma/Postgres. Status writes use optimistic
 * concurrency (version-checked updateMany) — the replacement for the Mongoose
 * pre-save version guard.
 */

import { PaymentStatus } from "@/types";
import { db, runWithOrgTransaction, type OrgTransactionClient } from "@/lib/db/prisma";
import type { Payment as PaymentModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type PaymentRow = MoneyAsNumber<PaymentModel>;
import {
  paymentConcurrencyConflictError,
  isValidPaymentStatusTransition,
} from "./payment.service";

export interface PaymentStatusConfig {
  gracePeriodDays: number;
  severelyOverdueThresholdDays: number;
  dueSoonThresholdDays: number;
  upcomingThresholdDays: number;
}

export interface StatusTransitionResult {
  payment: PaymentRow;
  statusChanged: boolean;
  previousStatus: PaymentStatus;
  newStatus: PaymentStatus;
  daysOverdue: number;
  daysUntilDue: number;
}

export interface StatusTransitionRule {
  from: PaymentStatus[];
  to: PaymentStatus;
  condition?: (payment: any) => boolean;
  action?: (payment: any) => Promise<void>;
}

export interface PaymentStatusUpdate {
  paymentId: string;
  newStatus: PaymentStatus;
  reason?: string;
  metadata?: Record<string, any>;
}

type DbClient = OrgTransactionClient;

function clientOf(session?: DbClient): DbClient {
  return session ?? (db as unknown as DbClient);
}

class PaymentStatusService {
  private defaultConfig: PaymentStatusConfig = {
    gracePeriodDays: 5,
    severelyOverdueThresholdDays: 30,
    dueSoonThresholdDays: 7,
    upcomingThresholdDays: 7,
  };

  private statusTransitionRules: StatusTransitionRule[] = [
    // Enhanced status transitions with new hierarchy

    // Upcoming to Due Soon
    {
      from: [PaymentStatus.PENDING],
      to: PaymentStatus.PENDING,
      condition: (payment) =>
        this.getDaysUntilDue(payment.dueDate) <=
        this.defaultConfig.dueSoonThresholdDays,
    },

    // Due Soon to Due Today
    {
      from: [PaymentStatus.PENDING],
      to: PaymentStatus.PENDING,
      condition: (payment) => this.getDaysUntilDue(payment.dueDate) === 0,
    },

    // Due Today to Grace Period
    {
      from: [PaymentStatus.PENDING],
      to: PaymentStatus.OVERDUE,
      condition: (payment) =>
        this.getDaysOverdue(payment.dueDate) > 0 &&
        this.getDaysOverdue(payment.dueDate) <=
          this.defaultConfig.gracePeriodDays,
    },

    // Grace Period to Late
    {
      from: [PaymentStatus.OVERDUE],
      to: PaymentStatus.OVERDUE,
      condition: (payment) =>
        this.getDaysOverdue(payment.dueDate) >
        this.defaultConfig.gracePeriodDays,
    },

    // Late to Severely Overdue
    {
      from: [PaymentStatus.OVERDUE],
      to: PaymentStatus.OVERDUE,
      condition: (payment) =>
        this.getDaysOverdue(payment.dueDate) >=
        this.defaultConfig.severelyOverdueThresholdDays,
    },

    // Legacy transitions
    // Pending to Processing
    {
      from: [PaymentStatus.PENDING],
      to: PaymentStatus.PENDING,
      condition: (payment) => !!payment.stripePaymentIntentId,
    },

    // Processing to Completed/Paid
    {
      from: [PaymentStatus.PENDING],
      to: PaymentStatus.PAID,
      action: async (payment) => {
        payment.paidDate = new Date();
        payment.amountPaid = payment.amount;
      },
    },

    // Any unpaid status to Paid
    {
      from: [
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.PARTIAL,
      ],
      to: PaymentStatus.PAID,
      action: async (payment) => {
        payment.paidDate = new Date();
        payment.amountPaid = payment.amount;
      },
    },

    // Partial to Paid
    {
      from: [PaymentStatus.PARTIAL],
      to: PaymentStatus.PAID,
      condition: (payment) => (payment.amountPaid || 0) >= payment.amount,
      action: async (payment) => {
        payment.paidDate = new Date();
        payment.amountPaid = payment.amount;
      },
    },

    // Any status to Cancelled
    {
      from: [
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.PENDING,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.OVERDUE,
        PaymentStatus.PENDING,
        PaymentStatus.OVERDUE,
        PaymentStatus.PARTIAL,
      ],
      to: PaymentStatus.CANCELLED,
    },

    // Paid to Refunded
    {
      from: [PaymentStatus.PAID],
      to: PaymentStatus.REFUNDED,
      action: async (payment) => {
        payment.amountPaid = 0;
      },
    },

    // Failed back to appropriate status (for retry)
    {
      from: [PaymentStatus.FAILED],
      to: PaymentStatus.PENDING,
    },
  ];

  /**
   * Helper method to calculate days until due date
   */
  private getDaysUntilDue(
    dueDate: Date,
    currentDate: Date = new Date()
  ): number {
    const due = new Date(dueDate);
    const dueUtc = Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth(),
      due.getUTCDate()
    );
    const currUtc = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate()
    );
    const timeDiff = dueUtc - currUtc;
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    return daysDiff > 0 ? daysDiff : 0;
  }

  /**
   * Helper method to calculate days overdue
   */
  private getDaysOverdue(
    dueDate: Date,
    currentDate: Date = new Date()
  ): number {
    const due = new Date(dueDate);
    const dueUtc = Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth(),
      due.getUTCDate()
    );
    const currUtc = Date.UTC(
      currentDate.getUTCFullYear(),
      currentDate.getUTCMonth(),
      currentDate.getUTCDate()
    );
    const timeDiff = currUtc - dueUtc;
    const daysDiff = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
    return daysDiff > 0 ? daysDiff : 0;
  }

  /**
   * Calculate the appropriate payment status based on due date and current date
   */
  calculatePaymentStatus(
    dueDate: Date,
    currentDate: Date = new Date(),
    config: Partial<PaymentStatusConfig> = {}
  ): {
    status: PaymentStatus;
    daysOverdue: number;
    daysUntilDue: number;
  } {
    const finalConfig = { ...this.defaultConfig, ...config };
    const daysOverdue = this.getDaysOverdue(dueDate, currentDate);
    const daysUntilDue = this.getDaysUntilDue(dueDate, currentDate);

    let status: PaymentStatus;

    if (daysUntilDue > finalConfig.upcomingThresholdDays) {
      status = PaymentStatus.PENDING;
    } else if (
      daysUntilDue > 0 &&
      daysUntilDue <= finalConfig.dueSoonThresholdDays
    ) {
      status = PaymentStatus.PENDING;
    } else if (daysUntilDue === 0 && daysOverdue === 0) {
      status = PaymentStatus.PENDING;
    } else if (daysOverdue > 0 && daysOverdue <= finalConfig.gracePeriodDays) {
      status = PaymentStatus.OVERDUE;
    } else if (
      daysOverdue > finalConfig.gracePeriodDays &&
      daysOverdue < finalConfig.severelyOverdueThresholdDays
    ) {
      status = PaymentStatus.OVERDUE;
    } else if (daysOverdue >= finalConfig.severelyOverdueThresholdDays) {
      status = PaymentStatus.OVERDUE;
    } else {
      status = PaymentStatus.PENDING;
    }

    return { status, daysOverdue, daysUntilDue };
  }

  /**
   * Check if a status transition is valid. Delegates to the canonical
   * PAYMENT_STATUS_TRANSITIONS map in payment.service — this service used to
   * consult its own diverging rules table, which rejected transitions
   * (PENDING→PARTIAL, OVERDUE→PARTIAL, …) every other service allows.
   */
  isValidTransition(
    currentStatus: PaymentStatus,
    newStatus: PaymentStatus
  ): boolean {
    if (currentStatus === newStatus) return true;
    return isValidPaymentStatusTransition(currentStatus, newStatus);
  }

  /**
   * Update payment status with enhanced validation
   */
  async updatePaymentStatus(
    paymentId: string,
    newStatus?: PaymentStatus,
    config: Partial<PaymentStatusConfig> = {},
    session?: DbClient
  ): Promise<StatusTransitionResult> {
    const client = clientOf(session);
    const payment = await client.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) {
      throw new Error(`Payment not found: ${paymentId}`);
    }

    // Skip status update if payment is already completed/paid
    if (
      [
        PaymentStatus.PAID,
        PaymentStatus.PAID,
        PaymentStatus.CANCELLED,
        PaymentStatus.REFUNDED,
      ].includes(payment.status as PaymentStatus)
    ) {
      return {
        payment,
        statusChanged: false,
        previousStatus: payment.status as PaymentStatus,
        newStatus: payment.status as PaymentStatus,
        daysOverdue: this.getDaysOverdue(payment.dueDate),
        daysUntilDue: this.getDaysUntilDue(payment.dueDate),
      };
    }

    const previousStatus = payment.status as PaymentStatus;

    // Calculate appropriate status if not provided
    const calculatedStatus =
      newStatus ||
      this.calculatePaymentStatus(payment.dueDate, new Date(), config).status;

    const { daysOverdue, daysUntilDue } = this.calculatePaymentStatus(
      payment.dueDate,
      new Date(),
      config
    );

    // Validate transition if status is being changed
    if (
      calculatedStatus !== previousStatus &&
      !this.isValidTransition(previousStatus, calculatedStatus)
    ) {
      throw new Error(
        `Invalid status transition from ${previousStatus} to ${calculatedStatus}`
      );
    }

    // Mutable draft — the transition-rule actions mutate this the way they
    // used to mutate the Mongoose document; changed fields are persisted below.
    const draft: any = { ...payment };

    // Going overdue no longer bills a late fee: late fees were removed, and a
    // `lateFeeConfig` left on older payment rows is not read.
    const statusChanged = previousStatus !== calculatedStatus;
    if (statusChanged) {
      draft.status = calculatedStatus;
      draft.lastSyncedAt = new Date();
    }

    if (statusChanged) {
      // Optimistic concurrency: version-checked write replaces the Mongoose
      // pre-save version guard; count === 0 means a concurrent modification.
      const updated = await client.payment.updateMany({
        where: { id: paymentId, version: payment.version, deletedAt: null },
        data: {
          status: draft.status,
          paidDate: draft.paidDate ?? payment.paidDate,
          amountPaid: draft.amountPaid ?? payment.amountPaid,
          lastSyncedAt: new Date(),
          version: { increment: 1 },
        },
      });

      if (updated.count === 0) {
        throw paymentConcurrencyConflictError();
      }

      draft.version = payment.version + 1;

      // Log status change
      await this.logStatusChange(draft, previousStatus, calculatedStatus);
    }

    return {
      payment: draft as PaymentRow,
      statusChanged,
      previousStatus,
      newStatus: calculatedStatus,
      daysOverdue,
      daysUntilDue,
    };
  }

  /**
   * Process automated status transitions for all payments with enhanced status hierarchy
   */
  async processAutomatedTransitions(
    config: Partial<PaymentStatusConfig> = {}
  ): Promise<{
    totalProcessed: number;
    statusChanges: number;
    errors: string[];
  }> {
    const errors: string[] = [];
    let totalProcessed = 0;
    let statusChanges = 0;

    try {
      // Find payments that might need status updates (exclude final states)
      const paymentsToCheck = await db.payment.findMany({
        where: {
          status: {
            notIn: [
              PaymentStatus.PAID,
              PaymentStatus.CANCELLED,
              PaymentStatus.REFUNDED,
            ],
          },
          deletedAt: null,
        },
        select: { id: true },
      });

      // Process payments in batches using transactions
      const batchSize = 50;
      for (let i = 0; i < paymentsToCheck.length; i += batchSize) {
        const batch = paymentsToCheck.slice(i, i + batchSize);

        try {
          await runWithOrgTransaction(async (tx) => {
            for (const payment of batch) {
              try {
                const result = await this.updatePaymentStatus(
                  payment.id,
                  undefined,
                  config,
                  tx
                );

                totalProcessed++;
                if (result.statusChanged) statusChanges++;
              } catch (error) {
                errors.push(
                  `Payment ${payment.id}: ${
                    error instanceof Error ? error.message : "Unknown error"
                  }`
                );
              }
            }
          });
        } catch (error) {
          errors.push(
            `Batch failed: ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    } catch (error) {
      errors.push(
        `Failed to process automated transitions: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }

    return { totalProcessed, statusChanges, errors };
  }

  /**
   * Batch update payment statuses for multiple payments
   */
  async batchUpdatePaymentStatuses(
    paymentIds: string[],
    config: Partial<PaymentStatusConfig> = {}
  ): Promise<StatusTransitionResult[]> {
    const results: StatusTransitionResult[] = [];

    // Use transaction for batch updates
    await runWithOrgTransaction(async (tx) => {
      for (const paymentId of paymentIds) {
        const result = await this.updatePaymentStatus(
          paymentId,
          undefined,
          config,
          tx
        );
        results.push(result);
      }
    });

    return results;
  }

  /**
   * Get payments that need status updates based on enhanced hierarchy
   */
  async getPaymentsNeedingStatusUpdate(): Promise<any[]> {
    const payments = await db.payment.findMany({
      where: {
        status: {
          notIn: [
            PaymentStatus.PAID,
            PaymentStatus.CANCELLED,
            PaymentStatus.REFUNDED,
          ],
        },
        deletedAt: null,
      },
      include: {
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        property: { select: { id: true, name: true } },
        lease: {
          select: { id: true, startDate: true, endDate: true, status: true },
        },
      },
    });

    // Preserve the populated response shape
    return payments.map((payment) => ({
      ...payment,
      tenantId: payment.tenant ?? payment.tenantId,
      propertyId: payment.property ?? payment.propertyId,
      leaseId: payment.lease ?? payment.leaseId,
      tenant: undefined,
      property: undefined,
      lease: undefined,
    }));
  }

  /**
   * Get enhanced payment status statistics with new hierarchy
   */
  async getEnhancedStatusStatistics(filters?: {
    propertyId?: string;
    tenantId?: string;
    leaseId?: string;
  }) {
    const where: any = { deletedAt: null };

    if (filters?.propertyId) where.propertyId = filters.propertyId;
    if (filters?.tenantId) where.tenantId = filters.tenantId;
    if (filters?.leaseId) where.leaseId = filters.leaseId;

    const groups = await db.payment.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { amount: true, amountPaid: true, lateFeeApplied: true },
    });

    if (groups.length === 0) {
      return {
        statusBreakdown: [],
        totalPayments: 0,
        grandTotalAmount: 0,
        grandTotalPaid: 0,
        grandTotalLateFees: 0,
      };
    }

    const categoryFor = (status: string): string => {
      switch (status) {
        case PaymentStatus.PENDING:
          return "pending";
        case PaymentStatus.OVERDUE:
          return "overdue";
        case PaymentStatus.PAID:
          return "paid";
        case PaymentStatus.PARTIAL:
          return "partial";
        case PaymentStatus.FAILED:
          return "failed";
        default:
          return "other";
      }
    };

    const statusBreakdown = groups.map((group) => ({
      status: group.status,
      category: categoryFor(group.status),
      count: group._count._all,
      totalAmount: group._sum.amount ?? 0,
      totalPaid: group._sum.amountPaid ?? 0,
      totalLateFees: group._sum.lateFeeApplied ?? 0,
    }));

    return {
      statusBreakdown,
      totalPayments: statusBreakdown.reduce((sum, s) => sum + s.count, 0),
      grandTotalAmount: statusBreakdown.reduce(
        (sum, s) => sum + s.totalAmount,
        0
      ),
      grandTotalPaid: statusBreakdown.reduce((sum, s) => sum + s.totalPaid, 0),
      grandTotalLateFees: statusBreakdown.reduce(
        (sum, s) => sum + s.totalLateFees,
        0
      ),
    };
  }

  /**
   * Log status changes for audit trail (enhanced)
   */
  private async logStatusChange(
    payment: any,
    fromStatus: PaymentStatus,
    toStatus: PaymentStatus,
    metadata?: Record<string, any>
  ): Promise<void> {
    const logData = {
      paymentId: payment.id,
      fromStatus,
      toStatus,
      timestamp: new Date(),
      daysOverdue: this.getDaysOverdue(payment.dueDate),
      daysUntilDue: this.getDaysUntilDue(payment.dueDate),
      amount: payment.amount,
      lateFeeApplied: payment.lateFeeApplied || 0,
      metadata,
    };
    void logData;

    // TODO: Implement dedicated audit log system
  }

  /**
   * Get payment status statistics
   */
  async getStatusStatistics(filters?: {
    propertyId?: string;
    tenantId?: string;
    leaseId?: string;
  }) {
    const where: any = { deletedAt: null };

    if (filters?.propertyId) where.propertyId = filters.propertyId;
    if (filters?.tenantId) where.tenantId = filters.tenantId;
    if (filters?.leaseId) where.leaseId = filters.leaseId;

    const groups = await db.payment.groupBy({
      by: ["status"],
      where,
      _count: { _all: true },
      _sum: { amount: true, amountPaid: true },
    });

    if (groups.length === 0) {
      return {
        statusBreakdown: [],
        totalPayments: 0,
        grandTotalAmount: 0,
        grandTotalPaid: 0,
      };
    }

    const statusBreakdown = groups.map((group) => ({
      status: group.status,
      count: group._count._all,
      totalAmount: group._sum.amount ?? 0,
      totalPaid: group._sum.amountPaid ?? 0,
    }));

    return {
      statusBreakdown,
      totalPayments: statusBreakdown.reduce((sum, s) => sum + s.count, 0),
      grandTotalAmount: statusBreakdown.reduce(
        (sum, s) => sum + s.totalAmount,
        0
      ),
      grandTotalPaid: statusBreakdown.reduce((sum, s) => sum + s.totalPaid, 0),
    };
  }

  /**
   * Get payments requiring attention (overdue, failed, etc.)
   */
  async getPaymentsRequiringAttention() {
    const today = new Date();
    const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);

    const include = {
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
    } as const;

    const remap = (payments: any[]) =>
      payments.map((payment) => ({
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

    const [overdue, failed, partialPayments] = await Promise.all([
      db.payment.findMany({
        where: {
          status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
          dueDate: { lt: today },
          deletedAt: null,
        },
        include,
        orderBy: { dueDate: "asc" },
      }),
      db.payment.findMany({
        where: {
          status: PaymentStatus.FAILED,
          updatedAt: { gte: sevenDaysAgo },
          deletedAt: null,
        },
        include,
        orderBy: { updatedAt: "desc" },
      }),
      db.payment.findMany({
        where: { status: PaymentStatus.PARTIAL, deletedAt: null },
        include,
        orderBy: { dueDate: "asc" },
      }),
    ]);

    return {
      overdue: remap(overdue),
      failed: remap(failed),
      partialPayments: remap(partialPayments),
    };
  }
}

export const paymentStatusService = new PaymentStatusService();
