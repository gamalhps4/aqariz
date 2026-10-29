/**
 * PropertyPro - Lease Payment Synchronizer Service
 * Centralized service for maintaining data consistency between Lease and Payment tables
 * Implements atomic operations, race condition protection, and comprehensive validation
 *
 * Converted from Mongoose to Prisma/Postgres. The lease→payment cascade that
 * used to live in LeaseSchema post-save (`handlePaymentCascades`) now lives
 * here — see `handlePaymentCascades` below: cancel non-paid payments when a
 * lease is terminated/expired, and update pending rent amounts when an active
 * lease's terms change.
 */

import { PaymentStatus, PaymentType, LeaseStatus } from "@/types";
import {
  db,
  runWithOrgTransaction,
  type OrgTransactionClient,
} from "@/lib/db/prisma";
import { paymentService } from "./payment.service";

export interface SyncOptions {
  session?: OrgTransactionClient;
  skipValidation?: boolean;
  forceSync?: boolean;
}

export interface SyncResult {
  success: boolean;
  leaseUpdated: boolean;
  paymentsUpdated: number;
  errors: string[];
  warnings: string[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  inconsistencies: Array<{
    type: string;
    description: string;
    severity: "error" | "warning";
  }>;
}

type DbClient = OrgTransactionClient;

function clientOf(session?: DbClient): DbClient {
  return session ?? (db as unknown as DbClient);
}

export class LeasePaymentSynchronizer {
  private static instance: LeasePaymentSynchronizer;
  private syncInProgress = new Set<string>();

  constructor() {
    if (LeasePaymentSynchronizer.instance) {
      return LeasePaymentSynchronizer.instance;
    }
    LeasePaymentSynchronizer.instance = this;
  }

  /**
   * Main synchronization method with atomic operations and race condition protection
   */
  async syncLeaseWithPayments(
    leaseId: string,
    options: SyncOptions = {}
  ): Promise<SyncResult> {
    const result: SyncResult = {
      success: false,
      leaseUpdated: false,
      paymentsUpdated: 0,
      errors: [],
      warnings: [],
    };

    // Prevent concurrent synchronization for the same lease
    if (this.syncInProgress.has(leaseId)) {
      result.warnings.push(
        "Synchronization already in progress for this lease"
      );
      return result;
    }

    this.syncInProgress.add(leaseId);

    try {
      const work = async (tx: DbClient) => {
        // Validate data consistency first
        if (!options.skipValidation) {
          const validation = await this.validateLeasePaymentConsistency(
            leaseId,
            { session: tx }
          );
          if (!validation.isValid && !options.forceSync) {
            result.errors.push(...validation.errors);
            throw new Error("Validation failed - use forceSync to override");
          }
          result.warnings.push(...validation.warnings);
        }

        // Get lease and payments within the transaction
        const lease = await tx.lease.findFirst({
          where: { id: leaseId, deletedAt: null },
        });
        if (!lease) {
          throw new Error("Lease not found");
        }

        const payments = await tx.payment.findMany({
          where: { leaseId, deletedAt: null },
        });

        // Calculate payment summary
        const paymentSummary = this.calculatePaymentSummary(payments);

        // Update lease status based on payment status
        const leaseUpdates = this.calculateLeaseUpdates(lease, paymentSummary);
        if (Object.keys(leaseUpdates).length > 0) {
          await tx.lease.update({
            where: { id: leaseId },
            data: leaseUpdates,
          });
          result.leaseUpdated = true;
        }

        // Update payment statuses based on lease status and dates
        const paymentUpdates = await this.calculatePaymentUpdates(
          lease,
          payments
        );
        if (paymentUpdates.length > 0) {
          for (const update of paymentUpdates) {
            await tx.payment.updateMany({
              where: { id: update.paymentId, deletedAt: null },
              data: update.updates,
            });
            result.paymentsUpdated++;
          }
        }

        // Mark all payments as synced
        await tx.payment.updateMany({
          where: { leaseId, deletedAt: null },
          data: { syncStatus: "synced", lastSyncedAt: new Date() },
        });
      };

      // Use provided transaction or open a new one for atomic operations
      if (options.session) {
        await work(options.session);
      } else {
        await runWithOrgTransaction(work);
      }

      result.success = true;
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
    } finally {
      this.syncInProgress.delete(leaseId);
    }

    return result;
  }

  /**
   * Lease→payment cascade — relocated from the Mongoose LeaseSchema post-save
   * hook (`handlePaymentCascades`):
   *   - terminated/expired lease → cancel every non-paid payment
   *   - active lease with changed terms → update pending rent payment amounts
   */
  async handlePaymentCascades(
    leaseId: string,
    options: { termsChanged?: boolean; session?: DbClient } = {}
  ): Promise<{ paymentsUpdated: number }> {
    try {
      const client = clientOf(options.session);
      const lease = await client.lease.findFirst({
        where: { id: leaseId, deletedAt: null },
      });
      if (!lease) return { paymentsUpdated: 0 };

      if (
        lease.status === LeaseStatus.TERMINATED ||
        lease.status === LeaseStatus.EXPIRED
      ) {
        // Cancel all non-paid payments for terminated/expired leases
        const cancelled = await client.payment.updateMany({
          where: {
            leaseId,
            status: {
              in: [
                PaymentStatus.PENDING,
                PaymentStatus.OVERDUE,
                PaymentStatus.PARTIAL,
                PaymentStatus.FAILED,
              ],
            },
            deletedAt: null,
          },
          data: {
            status: PaymentStatus.CANCELLED,
            notes: `Cancelled due to lease ${String(lease.status).toLowerCase()}`,
            lastSyncedAt: new Date(),
            syncStatus: "synced",
          },
        });
        return { paymentsUpdated: cancelled.count };
      }

      if (lease.status === LeaseStatus.ACTIVE && options.termsChanged) {
        // Update payment amounts if lease terms changed
        const rentAmount = ((lease.terms as any) ?? {}).rentAmount;
        if (typeof rentAmount === "number") {
          const updated = await client.payment.updateMany({
            where: {
              leaseId,
              status: PaymentStatus.PENDING,
              type: PaymentType.RENT,
              deletedAt: null,
            },
            data: {
              amount: rentAmount,
              lastSyncedAt: new Date(),
              syncStatus: "synced",
            },
          });
          return { paymentsUpdated: updated.count };
        }
      }

      return { paymentsUpdated: 0 };
    } catch {
      // Silently handle payment cascade errors to avoid breaking lease operations
      return { paymentsUpdated: 0 };
    }
  }

  /**
   * Comprehensive validation of lease-payment consistency
   */
  async validateLeasePaymentConsistency(
    leaseId: string,
    options: { session?: DbClient } = {}
  ): Promise<ValidationResult> {
    const result: ValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      inconsistencies: [],
    };

    try {
      const client = clientOf(options.session);

      const lease = await client.lease.findFirst({
        where: { id: leaseId, deletedAt: null },
      });

      if (!lease) {
        result.errors.push("Lease not found");
        result.isValid = false;
        return result;
      }

      const payments = await client.payment.findMany({
        where: { leaseId, deletedAt: null },
      });

      const leaseTerms = (lease.terms as any) ?? {};

      // Validate payment dates are within lease period
      for (const payment of payments) {
        if (
          payment.dueDate < lease.startDate ||
          payment.dueDate > lease.endDate
        ) {
          result.inconsistencies.push({
            type: "date_range",
            description: `Payment ${payment.id} due date ${payment.dueDate} is outside lease period`,
            severity: "error",
          });
          result.isValid = false;
        }
      }

      // Validate payment amounts match lease terms
      const rentPayments = payments.filter((p) => p.type === "rent");
      for (const payment of rentPayments) {
        if (payment.amount !== leaseTerms.rentAmount) {
          result.inconsistencies.push({
            type: "amount_mismatch",
            description: `Rent payment ${payment.id} amount ${payment.amount} doesn't match lease rent ${leaseTerms.rentAmount}`,
            severity: "warning",
          });
        }
      }

      // Validate no orphaned payments
      const orphanedPayments = payments.filter(
        (p) =>
          p.tenantId !== lease.tenantId || p.propertyId !== lease.propertyId
      );

      if (orphanedPayments.length > 0) {
        result.inconsistencies.push({
          type: "orphaned_payments",
          description: `Found ${orphanedPayments.length} payments with mismatched tenant/property references`,
          severity: "error",
        });
        result.isValid = false;
      }

      // Validate payment status consistency
      if (
        lease.status === LeaseStatus.TERMINATED ||
        lease.status === LeaseStatus.EXPIRED
      ) {
        const activePendingPayments = payments.filter(
          (p) => p.status === PaymentStatus.PENDING && p.dueDate > new Date()
        );

        if (activePendingPayments.length > 0) {
          result.inconsistencies.push({
            type: "status_inconsistency",
            description: `Found ${activePendingPayments.length} pending future payments for ${lease.status} lease`,
            severity: "warning",
          });
        }
      }

      // Collect all errors and warnings
      result.errors = result.inconsistencies
        .filter((i) => i.severity === "error")
        .map((i) => i.description);

      result.warnings = result.inconsistencies
        .filter((i) => i.severity === "warning")
        .map((i) => i.description);
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Validation failed"
      );
      result.isValid = false;
    }

    return result;
  }

  /**
   * Calculate payment summary for lease status updates
   */
  private calculatePaymentSummary(payments: any[]) {
    const now = new Date();

    return {
      totalDue: payments.reduce((sum, p) => sum + p.amount, 0),
      totalPaid: payments.reduce((sum, p) => sum + (p.amountPaid || 0), 0),
      totalOverdue: payments
        .filter((p) => p.status === PaymentStatus.OVERDUE)
        .reduce((sum, p) => sum + (p.amount - (p.amountPaid || 0)), 0),
      totalPending: payments
        .filter((p) => p.status === PaymentStatus.PENDING)
        .reduce((sum, p) => sum + (p.amount - (p.amountPaid || 0)), 0),
      overdueCount: payments.filter((p) => p.status === PaymentStatus.OVERDUE)
        .length,
      pendingCount: payments.filter((p) => p.status === PaymentStatus.PENDING)
        .length,
      completedCount: payments.filter((p) => p.status === PaymentStatus.PAID)
        .length,
      nextPaymentDate: payments
        .filter(
          (p) => p.status === PaymentStatus.PENDING && p.dueDate > now
        )
        .sort(
          (a, b) =>
            new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
        )[0]?.dueDate,
    };
  }

  /**
   * Calculate lease updates based on payment summary
   */
  private calculateLeaseUpdates(lease: any, paymentSummary: any) {
    const updates: any = {};

    // Update lease payment status based on overdue payments
    if (
      paymentSummary.overdueCount > 0 &&
      lease.status === LeaseStatus.ACTIVE
    ) {
      updates.paymentStatus = "overdue";
    } else if (
      paymentSummary.pendingCount === 0 &&
      paymentSummary.completedCount > 0
    ) {
      updates.paymentStatus = "current";
    } else if (paymentSummary.pendingCount > 0) {
      updates.paymentStatus = "pending";
    }

    // Only write when the value actually changes
    if (updates.paymentStatus && updates.paymentStatus === lease.paymentStatus) {
      delete updates.paymentStatus;
    }

    return updates;
  }

  /**
   * Calculate payment updates based on lease status and current date
   */
  private async calculatePaymentUpdates(lease: any, payments: any[]) {
    const updates: Array<{ paymentId: string; updates: any }> = [];
    const now = new Date();

    for (const payment of payments) {
      const paymentUpdates: any = {};

      // Update overdue status based on due date
      if (
        [PaymentStatus.PENDING, PaymentStatus.OVERDUE].includes(
          payment.status
        ) &&
        payment.dueDate < now &&
        payment.amount > (payment.amountPaid || 0)
      ) {
        paymentUpdates.status = PaymentStatus.OVERDUE;
      }

      // Cancel future payments for terminated/expired leases
      if (
        (lease.status === LeaseStatus.TERMINATED ||
          lease.status === LeaseStatus.EXPIRED) &&
        payment.status === PaymentStatus.PENDING &&
        payment.dueDate > now
      ) {
        paymentUpdates.status = PaymentStatus.CANCELLED;
        paymentUpdates.notes = `Cancelled due to lease ${String(
          lease.status
        ).toLowerCase()}`;
      }

      // Skip no-op status writes
      if (paymentUpdates.status === payment.status) {
        delete paymentUpdates.status;
        delete paymentUpdates.notes;
      }

      if (Object.keys(paymentUpdates).length > 0) {
        updates.push({
          paymentId: payment.id,
          updates: paymentUpdates,
        });
      }
    }

    return updates;
  }

  /**
   * Process payment with automatic lease synchronization
   */
  async processPaymentWithSync(
    paymentId: string,
    paymentData: any,
    options: SyncOptions = {}
  ) {
    const work = async (tx: DbClient) => {
      // Process the payment
      const payment = await paymentService.processPayment(
        paymentId,
        paymentData,
        { session: tx }
      );

      if (!payment.leaseId) {
        throw new Error("Payment is not linked to a lease");
      }

      // Sync the lease
      const syncResult = await this.syncLeaseWithPayments(payment.leaseId, {
        session: tx,
        skipValidation: false,
      });

      if (!syncResult.success) {
        throw new Error(
          `Payment processed but sync failed: ${syncResult.errors.join(", ")}`
        );
      }

      return { payment, syncResult };
    };

    if (options.session) {
      return work(options.session);
    }
    return runWithOrgTransaction(work);
  }

  /**
   * Monitor and detect synchronization failures
   */
  async detectSyncFailures(): Promise<
    Array<{ leaseId: string; issues: string[] }>
  > {
    const failures: Array<{ leaseId: string; issues: string[] }> = [];

    try {
      // Find payments with pending sync status
      const unsyncedPayments = await db.payment.findMany({
        where: { syncStatus: "pending", deletedAt: null },
        select: { leaseId: true },
        distinct: ["leaseId"],
      });

      const leaseIds = unsyncedPayments
        .map((p) => p.leaseId)
        .filter((id): id is string => Boolean(id));

      for (const leaseId of leaseIds) {
        const validation = await this.validateLeasePaymentConsistency(leaseId);
        if (!validation.isValid) {
          failures.push({
            leaseId,
            issues: validation.errors,
          });
        }
      }
    } catch {
      // Silently handle detection errors
    }

    return failures;
  }
}

// Export singleton instance
export const leasePaymentSynchronizer = new LeasePaymentSynchronizer();
