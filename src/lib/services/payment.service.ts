/**
 * PropertyPro - Enhanced Payment Service
 * Comprehensive payment management with scheduling, status tracking, and lease integration
 *
 * Converted from Mongoose to Prisma/Postgres. The business rules that used to
 * live in the Mongoose Payment model hooks now live here:
 *   - reference validation on create (tenant/property/lease consistency,
 *     due-date-within-lease, active-lease guard)
 *   - the payment status transition map (was PaymentSchema.methods.getValidStatusTransitions)
 *   - optimistic concurrency on status changes (version-checked updateMany)
 */

import {
  PaymentType,
  PaymentStatus,
  PaymentMethod,
  PaymentFrequency,
  IPaymentSchedule,
  ILateFeeConfig,
  ILeasePaymentConfig,
} from "@/types";
import {
  db,
  runWithOrgTransaction,
  type OrgTransactionClient,
} from "@/lib/db/prisma";
import { leaseRentAmount, leaseSecurityDeposit } from "@/lib/lease-money";
import { Prisma } from "@/generated/prisma/client";
import type { Payment as PaymentModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type PaymentRow = MoneyAsNumber<PaymentModel>;

export interface PaymentCreateData {
  tenantId: string;
  propertyId: string;
  leaseId?: string;
  amount: number;
  type: PaymentType;
  paymentMethod?: PaymentMethod;
  dueDate: Date;
  description?: string;
  notes?: string;
  schedule?: Partial<IPaymentSchedule>;
  lateFeeConfig?: Partial<ILateFeeConfig>;
  // Links derived charges (late fees, recurring children) to their source
  // payment; the late-fee partial unique index dedupes on it.
  parentPaymentId?: string;
}

export interface PaymentScheduleData {
  frequency: PaymentFrequency;
  startDate: Date;
  endDate?: Date;
  dayOfMonth?: number;
  dayOfWeek?: number;
  customInterval?: number;
}

export interface PaymentUpdateData {
  amount?: number;
  amountPaid?: number;
  status?: PaymentStatus;
  paymentMethod?: PaymentMethod;
  paidDate?: Date;
  notes?: string;
}

export interface PaymentQueryParams {
  page?: number;
  limit?: number;
  tenantId?: string;
  propertyId?: string;
  leaseId?: string;
  status?: PaymentStatus;
  type?: PaymentType;
  startDate?: Date;
  endDate?: Date;
  overdue?: boolean;
  recurring?: boolean;
}

// ============================================================================
// Relocated Mongoose-hook domain rules (shared with the other payment services)
// ============================================================================

/**
 * Valid payment status transitions.
 * Was `PaymentSchema.methods.getValidStatusTransitions` + the pre-save guard.
 */
export const PAYMENT_STATUS_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [
    PaymentStatus.PAID,
    PaymentStatus.PARTIAL,
    PaymentStatus.OVERDUE,
    PaymentStatus.CANCELLED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.PARTIAL]: [
    PaymentStatus.PAID,
    PaymentStatus.OVERDUE,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.OVERDUE]: [
    PaymentStatus.PAID,
    PaymentStatus.PARTIAL,
    PaymentStatus.CANCELLED,
  ],
  [PaymentStatus.PAID]: [PaymentStatus.REFUNDED],
  [PaymentStatus.FAILED]: [PaymentStatus.PENDING, PaymentStatus.CANCELLED],
  [PaymentStatus.CANCELLED]: [PaymentStatus.PENDING],
  [PaymentStatus.REFUNDED]: [],
};

export function getValidPaymentStatusTransitions(
  fromStatus: PaymentStatus
): PaymentStatus[] {
  return PAYMENT_STATUS_TRANSITIONS[fromStatus] ?? [];
}

export function isValidPaymentStatusTransition(
  fromStatus: PaymentStatus,
  toStatus: PaymentStatus
): boolean {
  return getValidPaymentStatusTransitions(fromStatus).includes(toStatus);
}

/**
 * 409 conflict error for optimistic-concurrency failures on payments.
 * `handleApiError` maps `statusCode` straight onto the HTTP response.
 */
export function paymentConcurrencyConflictError(): Error {
  const error = new Error(
    "Payment was modified by another process"
  ) as Error & { statusCode: number };
  error.statusCode = 409;
  return error;
}

/** True when the error is the Postgres unique-violation (P2002). Used by the
 * payment generators: the partial unique index (one non-deleted rent payment
 * per lease per due date) now lives in the database, so a duplicate insert
 * throws P2002 and is treated as "already generated". */
export function isUniqueConstraintError(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

type DbClient = OrgTransactionClient;

function clientOf(session?: unknown): DbClient {
  return (session as DbClient | undefined) ?? (db as unknown as DbClient);
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

class PaymentService {
  /**
   * Create a new payment with transaction support
   */
  async createPayment(
    data: PaymentCreateData,
    options: { session?: any } = {}
  ): Promise<PaymentRow> {
    const client = clientOf(options.session);

    // Validate tenant, property, and lease (these guards used to live in the
    // Mongoose pre-save hook and validatePaymentReferences)
    const { organizationId } = await this.validatePaymentReferences(
      data.tenantId,
      data.propertyId,
      data.leaseId,
      options.session,
      { type: data.type, dueDate: data.dueDate }
    );

    return client.payment.create({
      data: {
        organizationId,
        tenantId: data.tenantId,
        propertyId: data.propertyId,
        leaseId: data.leaseId ?? null,
        amount: data.amount,
        type: data.type,
        paymentMethod: data.paymentMethod ?? null,
        dueDate: data.dueDate,
        description: data.description ?? null,
        notes: data.notes ?? null,
        parentPaymentId: data.parentPaymentId ?? null,
        schedule: data.schedule
          ? (data.schedule as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        lateFeeConfig: data.lateFeeConfig
          ? (data.lateFeeConfig as unknown as Prisma.InputJsonValue)
          : Prisma.JsonNull,
        isRecurring: !!data.schedule,
        paymentHistory: [],
        remindersSent: [],
        statusHistory: [],
        syncStatus: "synced",
        lastSyncedAt: new Date(),
        version: 0,
      },
    });
  }

  /**
   * Create recurring payments for a lease
   */
  async createLeasePayments(leaseId: string): Promise<PaymentRow[]> {
    const lease = await db.lease.findFirst({ where: { id: leaseId } });
    if (!lease) {
      throw new Error("Lease not found");
    }

    const payments: PaymentRow[] = [];
    const terms = (lease.terms as any) ?? {};
    const paymentConfig = terms.paymentConfig as ILeasePaymentConfig | undefined;

    if (!paymentConfig?.autoCreatePayments) {
      return payments;
    }

    // Create security deposit payment
    if (leaseSecurityDeposit(lease) > 0) {
      const securityDepositPayment = await this.createPayment({
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        leaseId: leaseId,
        amount: leaseSecurityDeposit(lease),
        type: PaymentType.SECURITY_DEPOSIT,
        dueDate: new Date(lease.startDate),
        description: "Security deposit for lease",
      });
      payments.push(securityDepositPayment);
    }

    // Create pet deposit payment if applicable
    if (terms.petDeposit && terms.petDeposit > 0) {
      const petDepositPayment = await this.createPayment({
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        leaseId: leaseId,
        amount: terms.petDeposit,
        type: PaymentType.PET_DEPOSIT,
        dueDate: new Date(lease.startDate),
        description: "Pet deposit for lease",
      });
      payments.push(petDepositPayment);
    }

    // Create recurring rent payments
    const rentPayments = await this.createRecurringRentPayments(
      lease,
      paymentConfig
    );
    payments.push(...rentPayments);

    return payments;
  }

  /**
   * Create recurring rent payments for a lease
   */
  private async createRecurringRentPayments(
    lease: any,
    config: ILeasePaymentConfig
  ): Promise<PaymentRow[]> {
    const payments: PaymentRow[] = [];
    const terms = (lease.terms as any) ?? {};
    const startDate = new Date(lease.startDate);
    const endDate = new Date(lease.endDate);

    // Calculate first rent due date
    const firstRentDate = new Date(startDate);
    firstRentDate.setDate(config.rentDueDay);

    // If the rent due day has passed in the start month, move to next month
    if (firstRentDate < startDate) {
      firstRentDate.setMonth(firstRentDate.getMonth() + 1);
    }

    // Create monthly rent payments
    let currentDate = new Date(firstRentDate);
    let paymentNumber = 1;

    while (currentDate <= endDate) {
      let rentAmount = leaseRentAmount(lease);

      // Handle proration for first and last month
      if (config.prorationEnabled) {
        if (
          paymentNumber === 1 &&
          currentDate.getMonth() === startDate.getMonth()
        ) {
          // Prorate first month
          const daysInMonth = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
            0
          ).getDate();
          const daysFromStart = daysInMonth - startDate.getDate() + 1;
          rentAmount = (leaseRentAmount(lease) / daysInMonth) * daysFromStart;
        }

        // Check if this is the last payment and needs proration
        const nextMonth = new Date(currentDate);
        nextMonth.setMonth(nextMonth.getMonth() + 1);
        if (
          nextMonth > endDate &&
          currentDate.getMonth() === endDate.getMonth()
        ) {
          const daysInMonth = new Date(
            currentDate.getFullYear(),
            currentDate.getMonth() + 1,
            0
          ).getDate();
          const daysUntilEnd = endDate.getDate();
          rentAmount = (leaseRentAmount(lease) / daysInMonth) * daysUntilEnd;
        }
      }

      try {
        const rentPayment = await this.createPayment({
          tenantId: lease.tenantId,
          propertyId: lease.propertyId,
          leaseId: lease.id,
          amount: Math.round(rentAmount * 100) / 100, // Round to 2 decimal places
          type: PaymentType.RENT,
          dueDate: new Date(currentDate),
          description: `Monthly rent - ${currentDate.toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}`,
          schedule: {
            frequency: PaymentFrequency.MONTHLY,
            startDate: firstRentDate,
            endDate: endDate,
            dayOfMonth: config.rentDueDay,
            isActive: true,
          },
          lateFeeConfig: config.lateFeeConfig,
        });

        payments.push(rentPayment);
      } catch (error) {
        // The DB-level partial unique index (one rent payment per lease per
        // due date among non-deleted rows) throws P2002 when this rent charge
        // already exists — treat as already-generated and continue.
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
      }
      paymentNumber++;

      // Move to next month
      currentDate.setMonth(currentDate.getMonth() + 1);
    }

    return payments;
  }

  /**
   * Update payment status and handle partial payments
   */
  async updatePaymentStatus(
    paymentId: string,
    status: PaymentStatus,
    updateData?: PaymentUpdateData
  ): Promise<PaymentRow> {
    const payment = await db.payment.findFirst({ where: { id: paymentId } });
    if (!payment) {
      throw new Error("Payment not found");
    }

    const oldStatus = payment.status as PaymentStatus;
    let newStatus = status;

    const patch: Record<string, any> = {};
    if (updateData) {
      if (updateData.amount !== undefined) patch.amount = updateData.amount;
      if (updateData.amountPaid !== undefined)
        patch.amountPaid = updateData.amountPaid;
      if (updateData.paymentMethod !== undefined)
        patch.paymentMethod = updateData.paymentMethod;
      if (updateData.paidDate !== undefined) patch.paidDate = updateData.paidDate;
      if (updateData.notes !== undefined) patch.notes = updateData.notes;
    }

    const effectiveAmount = patch.amount ?? payment.amount;

    // Handle status-specific logic
    switch (status) {
      case PaymentStatus.PAID:
        if (!payment.paidDate && patch.paidDate === undefined) {
          patch.paidDate = new Date();
        }
        if (!(patch.amountPaid ?? payment.amountPaid)) {
          patch.amountPaid = effectiveAmount;
        }
        break;

      case PaymentStatus.PARTIAL:
        if (updateData?.amountPaid && updateData.amountPaid >= effectiveAmount) {
          newStatus = PaymentStatus.PAID;
          patch.amountPaid = effectiveAmount;
        }
        break;
    }

    // Amount-consistency guard (was in the Mongoose pre-save hook)
    const finalAmountPaid = patch.amountPaid ?? payment.amountPaid ?? 0;
    if (finalAmountPaid > effectiveAmount) {
      throw new Error("Amount paid cannot exceed total amount");
    }

    // Status transition guard (was in the Mongoose pre-save hook)
    if (
      newStatus !== oldStatus &&
      !isValidPaymentStatusTransition(oldStatus, newStatus)
    ) {
      throw new Error(
        `Invalid status transition from ${oldStatus} to ${newStatus}`
      );
    }

    // Add to payment history if payment was made (append immutably — Json column)
    let paymentHistory = (payment.paymentHistory as any[]) ?? [];
    if (newStatus === PaymentStatus.PAID || newStatus === PaymentStatus.PARTIAL) {
      const paymentAmount = updateData?.amountPaid || payment.amount;
      paymentHistory = [
        ...paymentHistory,
        {
          amount: paymentAmount,
          paymentMethod:
            updateData?.paymentMethod || PaymentMethod.BANK_TRANSFER,
          paidDate: updateData?.paidDate || new Date(),
          transactionId: updateData?.notes || "",
          notes: updateData?.notes || "",
        },
      ];
    }

    // Optimistic concurrency: replaces the Mongoose version check in pre-save.
    const updated = await db.payment.updateMany({
      where: { id: paymentId, version: payment.version, deletedAt: null },
      data: {
        ...patch,
        status: newStatus,
        paymentHistory: paymentHistory as unknown as Prisma.InputJsonValue,
        syncStatus: "pending",
        lastSyncedAt: new Date(),
        version: { increment: 1 },
      },
    });

    if (updated.count === 0) {
      throw paymentConcurrencyConflictError();
    }

    const fresh = await db.payment.findFirst({ where: { id: paymentId } });
    if (!fresh) {
      throw new Error("Payment not found");
    }
    return fresh;
  }

  /**
   * Process payment notifications
   */
  async processPaymentNotifications(): Promise<void> {
    // Cursor-paginated: this was an unbounded findMany over every overdue
    // payment, growing with history forever.
    const batchSize = 200;
    let cursor: string | undefined;

    for (;;) {
      const overduePayments = await db.payment.findMany({
        where: {
          status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
          dueDate: { lt: new Date() },
          deletedAt: null,
        },
        orderBy: { id: "asc" },
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        take: batchSize,
      });
      if (overduePayments.length === 0) break;

      for (const payment of overduePayments) {
        await this.sendPaymentNotifications(payment);
      }

      if (overduePayments.length < batchSize) break;
      cursor = overduePayments[overduePayments.length - 1].id;
    }
  }

  /**
   * Send payment notifications based on configuration
   */
  private async sendPaymentNotifications(payment: PaymentRow): Promise<void> {
    const lateFeeConfig = payment.lateFeeConfig as unknown as ILateFeeConfig | null;
    if (!lateFeeConfig?.enabled) return;

    const daysOverdue = Math.floor(
      (Date.now() - new Date(payment.dueDate).getTime()) / (1000 * 60 * 60 * 24)
    );

    const notificationDays = lateFeeConfig.notificationDays || [3, 7, 14];
    const remindersSent = ((payment.remindersSent as any[]) ?? []).map(
      (reminder) => ({
        ...reminder,
        sentDate: new Date(reminder.sentDate),
      })
    );

    for (const day of notificationDays) {
      if (daysOverdue === day) {
        const reminderType =
          daysOverdue <= 7
            ? "reminder"
            : daysOverdue <= 14
              ? "overdue"
              : "final_notice";

        // Already stamped for this specific day? (Entries also carry `day`
        // now, so the dedupe survives beyond the old 24-hour window; the
        // date-window check keeps legacy entries without `day` deduped too.)
        const alreadySent = remindersSent.some(
          (reminder) =>
            (reminder.day === day && reminder.type === reminderType) ||
            (reminder.day === undefined &&
              reminder.type === reminderType &&
              Math.floor(
                (Date.now() - reminder.sentDate.getTime()) /
                  (1000 * 60 * 60 * 24)
              ) < 1)
        );

        if (!alreadySent) {
          // Send notification (integrate with notification service)
          const nextReminders = [
            ...((payment.remindersSent as any[]) ?? []),
            {
              type: reminderType,
              day,
              sentDate: new Date(),
              method: "email", // This should be configurable
            },
          ];

          // Version-checked: two overlapping runs both computed
          // alreadySent=false on stale rows and both appended — duplicate
          // emails and one append silently lost. The loser now skips.
          await db.payment.updateMany({
            where: { id: payment.id, version: payment.version },
            data: {
              remindersSent: nextReminders as unknown as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
          });
        }
      }
    }
  }

  /**
   * Validate payment references with transaction support.
   * Returns the organizationId to stamp on the create.
   */
  private async validatePaymentReferences(
    tenantId: string,
    propertyId: string,
    leaseId?: string,
    session?: any,
    paymentInfo?: { type?: PaymentType; dueDate?: Date }
  ): Promise<{ organizationId: string }> {
    const client = clientOf(session);

    // Payment references User (with tenant role) directly
    const tenant = await client.user.findFirst({
      where: { id: tenantId, role: "tenant", deletedAt: null },
      select: { id: true },
    });

    if (!tenant) {
      throw new Error("Tenant not found or user does not have tenant role");
    }

    // Validate property
    const property = await client.property.findFirst({
      where: { id: propertyId, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!property) {
      throw new Error("Property not found");
    }

    // Validate lease if provided
    if (leaseId) {
      const lease = await client.lease.findFirst({
        where: { id: leaseId, deletedAt: null },
      });
      if (!lease) {
        throw new Error("Lease not found");
      }

      if (lease.tenantId !== tenantId) {
        throw new Error("Lease does not belong to the specified tenant");
      }

      if (lease.propertyId !== propertyId) {
        throw new Error("Lease does not belong to the specified property");
      }

      // Due-date-within-lease + active-lease guards (were in the Mongoose
      // pre-save hook). Security deposits may fall due before lease start.
      const isSecurityDeposit =
        paymentInfo?.type === PaymentType.SECURITY_DEPOSIT;
      if (!isSecurityDeposit && paymentInfo?.dueDate) {
        const leaseStartDate = new Date(lease.startDate);
        const leaseEndDate = new Date(lease.endDate);
        if (
          paymentInfo.dueDate < leaseStartDate ||
          paymentInfo.dueDate > leaseEndDate
        ) {
          throw new Error("Payment due date must be within lease period");
        }
      }

      if (!["active", "pending"].includes(String(lease.status))) {
        throw new Error("Cannot create payments for inactive leases");
      }
    }

    return { organizationId: property.organizationId };
  }

  /**
   * Get payment analytics for a property or tenant
   */
  async getPaymentAnalytics(filters: {
    propertyId?: string;
    tenantId?: string;
    leaseId?: string;
  }): Promise<any> {
    const where: any = { deletedAt: null };

    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.leaseId) where.leaseId = filters.leaseId;

    const [totals, pendingCount, overdueCount, completedCount] =
      await Promise.all([
        db.payment.aggregate({
          where,
          _count: { _all: true },
          _sum: { amount: true, amountPaid: true, lateFeeApplied: true },
        }),
        db.payment.count({ where: { ...where, status: PaymentStatus.PENDING } }),
        db.payment.count({ where: { ...where, status: PaymentStatus.OVERDUE } }),
        db.payment.count({ where: { ...where, status: PaymentStatus.PAID } }),
      ]);

    return {
      totalPayments: totals._count._all,
      totalAmount: totals._sum.amount ?? 0,
      totalPaid: totals._sum.amountPaid ?? 0,
      pendingCount,
      overdueCount,
      completedCount,
      totalLateFees: totals._sum.lateFeeApplied ?? 0,
    };
  }

  /**
   * Get payments with advanced filtering and pagination
   */
  async getPayments(params: PaymentQueryParams = {}): Promise<any> {
    const {
      page = 1,
      limit = 10,
      tenantId,
      propertyId,
      leaseId,
      status,
      type,
      startDate,
      endDate,
      overdue,
      recurring,
    } = params;

    const where: any = { deletedAt: null };

    // Apply filters
    if (tenantId) where.tenantId = tenantId;
    if (propertyId) where.propertyId = propertyId;
    if (leaseId) where.leaseId = leaseId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (recurring !== undefined) where.isRecurring = recurring;

    // Date range filter
    if (startDate || endDate) {
      where.dueDate = {};
      if (startDate) where.dueDate.gte = startDate;
      if (endDate) where.dueDate.lte = endDate;
    }

    // Overdue filter
    if (overdue) {
      where.status = { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] };
      where.dueDate = { lt: new Date() };
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      db.payment.findMany({
        where,
        include: {
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
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
        orderBy: { dueDate: "desc" },
        skip,
        take: limit,
      }),
      db.payment.count({ where }),
    ]);

    // Preserve the populated response shape the callers expect
    const data = payments.map((payment) => ({
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

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
        hasNext: page < Math.ceil(total / limit),
        hasPrev: page > 1,
      },
    };
  }

  /**
   * Process a payment (record payment made) with transaction support
   */
  async processPayment(
    paymentId: string,
    paymentData: {
      amount: number;
      paymentMethod: PaymentMethod;
      transactionId?: string;
      notes?: string;
    },
    options: { session?: any } = {}
  ): Promise<PaymentRow> {
    const client = clientOf(options.session);

    const payment = await client.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!payment) {
      throw new Error("Payment not found");
    }

    // Optimistic locking check
    const currentVersion = payment.version || 0;

    const totalPaid = (payment.amountPaid || 0) + paymentData.amount;

    // Validate payment amount
    if (totalPaid > payment.amount) {
      throw new Error("Payment amount exceeds total due");
    }

    let newStatus: PaymentStatus;
    if (totalPaid >= payment.amount) {
      newStatus = PaymentStatus.PAID;
    } else {
      newStatus = PaymentStatus.PARTIAL;
    }

    const paymentHistory = [
      ...((payment.paymentHistory as any[]) ?? []),
      {
        amount: paymentData.amount,
        paymentMethod: paymentData.paymentMethod,
        paidDate: new Date(),
        transactionId: paymentData.transactionId || "",
        notes: paymentData.notes || "",
      },
    ];

    // Update with optimistic locking (version-checked updateMany)
    const updated = await client.payment.updateMany({
      where: { id: paymentId, version: currentVersion, deletedAt: null },
      data: {
        status: newStatus,
        amountPaid: totalPaid,
        paymentMethod: paymentData.paymentMethod,
        paidDate: new Date(),
        notes: paymentData.notes
          ? payment.notes
            ? `${payment.notes}\n${paymentData.notes}`
            : paymentData.notes
          : payment.notes,
        syncStatus: "pending",
        lastSyncedAt: new Date(),
        version: { increment: 1 },
        paymentHistory: paymentHistory as unknown as Prisma.InputJsonValue,
      },
    });

    if (updated.count === 0) {
      throw paymentConcurrencyConflictError();
    }

    const updatedPayment = await client.payment.findFirst({
      where: { id: paymentId, deletedAt: null },
    });
    if (!updatedPayment) {
      throw new Error(
        "Payment update failed - possible concurrent modification"
      );
    }

    return updatedPayment;
  }

  /**
   * Generate next payment in a recurring series
   */
  async generateNextRecurringPayment(
    parentPaymentId: string
  ): Promise<PaymentRow | null> {
    const parentPayment = await db.payment.findFirst({
      where: { id: parentPaymentId },
    });
    const schedule = parseSchedule(parentPayment?.schedule);
    if (!parentPayment || !schedule || !schedule.isActive) {
      return null;
    }

    const nextDueDate = this.calculateNextDueDate(schedule);

    if (!nextDueDate || (schedule.endDate && nextDueDate > schedule.endDate)) {
      return null; // No more payments to generate
    }

    const updatedSchedule = {
      ...schedule,
      lastGeneratedDate: new Date(),
      nextDueDate: this.calculateNextDueDate(schedule, nextDueDate) ?? undefined,
    };

    // Claim the parent (version-checked) BEFORE creating the child, both in
    // one transaction. Previously child-create and schedule-advance were two
    // separate writes: a crash between them re-generated the child on retry
    // (only rent is covered by the partial unique index — utility/custom
    // recurring types had no duplicate protection at all), and two
    // overlapping cron ticks both saw the stale schedule.
    return runWithOrgTransaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: {
          id: parentPayment.id,
          version: parentPayment.version,
          deletedAt: null,
        },
        data: {
          schedule: updatedSchedule as unknown as Prisma.InputJsonValue,
          version: { increment: 1 },
        },
      });
      if (claimed.count === 0) {
        // Another run already advanced this schedule.
        return null;
      }

      try {
        return await this.createPayment(
          {
            tenantId: parentPayment.tenantId,
            propertyId: parentPayment.propertyId,
            leaseId: parentPayment.leaseId ?? undefined,
            amount: parentPayment.amount,
            type: parentPayment.type as PaymentType,
            dueDate: nextDueDate,
            description: parentPayment.description ?? undefined,
            parentPaymentId: parentPayment.id,
            schedule: updatedSchedule,
            lateFeeConfig:
              (parentPayment.lateFeeConfig as unknown as ILateFeeConfig) ??
              undefined,
          },
          { session: tx }
        );
      } catch (error) {
        // Duplicate (already generated) — P2002 from the partial unique
        // index. The schedule advance above still commits.
        if (!isUniqueConstraintError(error)) {
          throw error;
        }
        return null;
      }
    });
  }

  /**
   * Calculate next due date based on payment schedule
   */
  private calculateNextDueDate(
    schedule: IPaymentSchedule,
    fromDate?: Date
  ): Date | null {
    const baseDate =
      fromDate || schedule.lastGeneratedDate || schedule.startDate;
    const nextDate = new Date(baseDate);

    switch (schedule.frequency) {
      case PaymentFrequency.WEEKLY:
        nextDate.setDate(nextDate.getDate() + 7);
        break;

      case PaymentFrequency.MONTHLY:
        nextDate.setMonth(nextDate.getMonth() + 1);
        if (schedule.dayOfMonth) {
          nextDate.setDate(schedule.dayOfMonth);
        }
        break;

      case PaymentFrequency.QUARTERLY:
        nextDate.setMonth(nextDate.getMonth() + 3);
        break;

      case PaymentFrequency.ANNUALLY:
        nextDate.setFullYear(nextDate.getFullYear() + 1);
        break;

      case PaymentFrequency.CUSTOM:
        if (schedule.customInterval) {
          nextDate.setMonth(nextDate.getMonth() + schedule.customInterval);
        }
        break;

      default:
        return null; // One-time payment
    }

    return nextDate;
  }

  /**
   * Bulk update payment statuses (for admin operations)
   */
  async bulkUpdatePayments(
    paymentIds: string[],
    updates: Partial<PaymentUpdateData>
  ): Promise<{ updated: number; errors: string[] }> {
    const errors: string[] = [];
    let updated = 0;

    for (const paymentId of paymentIds) {
      try {
        await this.updatePaymentStatus(
          paymentId,
          updates.status || PaymentStatus.PENDING,
          updates
        );
        updated++;
      } catch (error) {
        errors.push(
          `Payment ${paymentId}: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }

    return { updated, errors };
  }

  /**
   * Get payment summary for dashboard
   */
  async getPaymentSummary(filters: {
    propertyId?: string;
    tenantId?: string;
  }): Promise<any> {
    const where: any = { deletedAt: null };

    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.tenantId) where.tenantId = filters.tenantId;

    const today = new Date();
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);

    const [thisMonthGroups, overdueAgg, upcomingAgg] = await Promise.all([
      db.payment.groupBy({
        by: ["status"],
        where: { ...where, dueDate: { gte: thisMonth, lt: nextMonth } },
        _count: { _all: true },
        _sum: { amount: true, amountPaid: true },
      }),
      db.payment.aggregate({
        where: {
          ...where,
          dueDate: { lt: today },
          status: { in: [PaymentStatus.PENDING, PaymentStatus.OVERDUE] },
        },
        _count: { _all: true },
        _sum: { amount: true, lateFeeApplied: true },
      }),
      db.payment.aggregate({
        where: {
          ...where,
          dueDate: {
            gte: today,
            lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          status: PaymentStatus.PENDING,
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
    ]);

    // Preserve the old $facet response shape
    return {
      thisMonth: thisMonthGroups.map((group) => ({
        _id: group.status,
        count: group._count._all,
        amount: group._sum.amount ?? 0,
        paid: group._sum.amountPaid ?? 0,
      })),
      overdue:
        overdueAgg._count._all > 0
          ? [
              {
                _id: null,
                count: overdueAgg._count._all,
                amount: overdueAgg._sum.amount ?? 0,
                lateFees: overdueAgg._sum.lateFeeApplied ?? 0,
              },
            ]
          : [],
      upcoming:
        upcomingAgg._count._all > 0
          ? [
              {
                _id: null,
                count: upcomingAgg._count._all,
                amount: upcomingAgg._sum.amount ?? 0,
              },
            ]
          : [],
    };
  }
}

export const paymentService = new PaymentService();
