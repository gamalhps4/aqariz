/**
 * PropertyPro - Lease Payment Synchronization Service
 * Comprehensive service for synchronizing payment status, processing, and invoice management
 *
 * Converted from Mongoose to Prisma/Postgres.
 */

import { PaymentStatus } from "@/types";
import { db } from "@/lib/db/prisma";
import { paymentService } from "./payment.service";
import { paymentStatusService } from "./payment-status.service";
import {
  generateLeaseInvoicePDF,
  emailInvoicePDF,
} from "@/lib/invoice-pdf-generator";
import { leasePaymentSynchronizer } from "./lease-payment-synchronizer.service";
import { formatCurrency } from "@/lib/utils/formatting";

export interface PaymentSyncOptions {
  autoGenerateInvoices?: boolean;
  autoEmailInvoices?: boolean;
  updateLeaseStatus?: boolean;
  notifyTenant?: boolean;
  createRecurringPayments?: boolean;
}

export interface PaymentSyncResult {
  success: boolean;
  paymentsCreated: number;
  invoicesGenerated: number;
  emailsSent: number;
  leaseStatusUpdated: boolean;
  errors: string[];
  warnings: string[];
}

export interface InvoiceGenerationConfig {
  generateOnPaymentCreation: boolean;
  generateOnPaymentDue: boolean;
  generateOnPaymentOverdue: boolean;
  autoEmailToTenant: boolean;
  includePaymentInstructions: boolean;
  reminderSchedule: number[]; // Days before due date to send reminders
}

class LeasePaymentSyncService {
  private defaultSyncOptions: PaymentSyncOptions = {
    autoGenerateInvoices: true,
    autoEmailInvoices: true,
    updateLeaseStatus: true,
    notifyTenant: true,
    createRecurringPayments: true,
  };

  private defaultInvoiceConfig: InvoiceGenerationConfig = {
    generateOnPaymentCreation: true,
    generateOnPaymentDue: false,
    generateOnPaymentOverdue: true,
    autoEmailToTenant: true,
    includePaymentInstructions: true,
    reminderSchedule: [7, 3, 1], // 7, 3, and 1 days before due date
  };

  /**
   * Comprehensive lease payment setup with full synchronization
   */
  async setupLeasePaymentSystem(
    leaseId: string,
    options: Partial<PaymentSyncOptions> = {}
  ): Promise<PaymentSyncResult> {
    const syncOptions = { ...this.defaultSyncOptions, ...options };
    const result: PaymentSyncResult = {
      success: false,
      paymentsCreated: 0,
      invoicesGenerated: 0,
      emailsSent: 0,
      leaseStatusUpdated: false,
      errors: [],
      warnings: [],
    };

    try {
      // 1. Fetch lease with all required data
      const lease = await this.getLeaseWithDetails(leaseId);
      if (!lease) {
        throw new Error("Lease not found");
      }

      // 2. Create payment schedule if enabled
      if (syncOptions.createRecurringPayments) {
        const payments = await this.createPaymentSchedule(lease);
        result.paymentsCreated = payments.length;
      }

      // 3. Generate initial invoices if enabled
      if (syncOptions.autoGenerateInvoices) {
        const invoiceResult = await this.generateInitialInvoices(lease);
        result.invoicesGenerated = invoiceResult.generated;
        result.emailsSent = invoiceResult.emailsSent;
      }

      // 4. Update lease status if needed
      if (syncOptions.updateLeaseStatus) {
        const statusUpdated = await this.updateLeaseStatusBasedOnPayments(
          lease
        );
        result.leaseStatusUpdated = statusUpdated;
      }

      // 5. Set up payment monitoring and automation
      await this.setupPaymentMonitoring(lease, syncOptions);

      result.success = true;
      return result;
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
      return result;
    }
  }

  /**
   * Handle payment status changes and trigger appropriate actions
   */
  async handlePaymentStatusChange(
    paymentId: string,
    oldStatus: PaymentStatus,
    newStatus: PaymentStatus,
    metadata?: Record<string, any>
  ): Promise<void> {
    const payment = await db.payment.findFirst({
      where: { id: paymentId },
    });

    if (!payment) {
      throw new Error("Payment not found");
    }

    // Update payment status using the payment status service
    await paymentStatusService.updatePaymentStatus(
      paymentId,
      newStatus,
      metadata
    );

    // Handle specific status transitions
    switch (newStatus) {
      case PaymentStatus.PAID:
        await this.handlePaymentCompleted(payment);
        break;
      case PaymentStatus.OVERDUE:
        await this.handlePaymentOverdue(payment);
        break;
      case PaymentStatus.FAILED:
        await this.handlePaymentFailed(payment);
        break;
      case PaymentStatus.REFUNDED:
        await this.handlePaymentRefunded(payment);
        break;
    }

    // Update lease status based on payment changes
    if (payment.leaseId) {
      await this.updateLeaseStatusBasedOnPayments(payment.leaseId);
    }
  }

  /**
   * Generate and sync invoices for a lease
   */
  async generateAndSyncInvoices(
    leaseId: string,
    config: Partial<InvoiceGenerationConfig> = {}
  ): Promise<{ generated: number; emailsSent: number; errors: string[] }> {
    const invoiceConfig = { ...this.defaultInvoiceConfig, ...config };
    const result = {
      generated: 0,
      emailsSent: 0,
      errors: [] as string[],
    };

    try {
      const lease = await this.getLeaseWithDetails(leaseId);
      if (!lease) {
        throw new Error("Lease not found");
      }

      // Get all payments for this lease
      const payments = await db.payment.findMany({
        where: { leaseId },
      });

      for (const payment of payments) {
        try {
          // Determine if invoice should be generated based on config and payment status
          const shouldGenerate = this.shouldGenerateInvoice(
            payment,
            invoiceConfig
          );

          if (shouldGenerate) {
            const invoiceNumber = `INV-${payment.id
              .slice(-8)
              .toUpperCase()}`;

            // Generate invoice
            const invoiceResult = await generateLeaseInvoicePDF({
              lease: lease as any,
              invoiceNumber,
              issueDate: new Date(),
              dueDate: payment.dueDate,
              includeTerms: true,
              includeNotes: true,
            });

            if (invoiceResult.success) {
              result.generated++;

              // Email invoice if configured
              if (invoiceConfig.autoEmailToTenant && lease.tenantId?.email) {
                const emailResult = await emailInvoicePDF({
                  to: lease.tenantId.email,
                  leaseId: leaseId,
                  invoiceNumber,
                  subject: `Invoice for ${
                    lease.propertyId?.name || "Property"
                  } - Payment Due`,
                  message: this.generateInvoiceEmailMessage(
                    lease,
                    payment,
                    invoiceConfig
                  ),
                });

                if (emailResult.success) {
                  result.emailsSent++;
                }
              }

              // Link invoice to payment
              await this.linkInvoiceToPayment(payment.id, invoiceResult);
            }
          }
        } catch (error) {
          result.errors.push(
            `Failed to process payment ${payment.id}: ${error}`
          );
        }
      }

      return result;
    } catch (error) {
      result.errors.push(
        error instanceof Error ? error.message : "Unknown error"
      );
      return result;
    }
  }

  /**
   * Real-time payment processing with immediate synchronization using transactions
   */
  async processPaymentWithSync(
    paymentId: string,
    paymentData: {
      amount: number;
      paymentMethod: string;
      transactionId?: string;
      notes?: string;
    }
  ): Promise<{
    payment: any;
    invoiceGenerated: boolean;
    leaseUpdated: boolean;
  }> {
    // Use the centralized synchronizer with atomic transactions
    const result = await leasePaymentSynchronizer.processPaymentWithSync(
      paymentId,
      paymentData
    );

    // Generate receipt/confirmation invoice
    const invoiceGenerated = await this.generatePaymentConfirmationInvoice(
      result.payment
    );

    // Trigger next payment in sequence if this was a recurring payment
    if (
      result.payment.isRecurring &&
      result.payment.status === PaymentStatus.PAID
    ) {
      await this.triggerNextRecurringPayment(result.payment);
    }

    return {
      payment: result.payment,
      invoiceGenerated,
      leaseUpdated: result.syncResult.leaseUpdated,
    };
  }

  // Private helper methods
  private async getLeaseWithDetails(leaseId: string): Promise<any> {
    const lease = await db.lease.findFirst({
      where: { id: leaseId },
      include: {
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        property: {
          select: {
            id: true,
            name: true,
            type: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
            addressCountry: true,
          },
        },
      },
    });

    if (!lease) return null;

    // Preserve the populated shape the old callers read
    return {
      ...lease,
      tenantId: lease.tenant ?? lease.tenantId,
      propertyId: lease.property
        ? {
            ...lease.property,
            address: {
              street: lease.property.addressStreet,
              city: lease.property.addressCity,
              state: lease.property.addressState,
              zipCode: lease.property.addressZipCode,
              country: lease.property.addressCountry,
            },
          }
        : lease.propertyId,
      tenant: undefined,
      property: undefined,
    };
  }

  private async createPaymentSchedule(lease: any): Promise<any[]> {
    // Use existing payment scheduler service
    const { paymentSchedulerService } = await import(
      "./payment-scheduler.service"
    );
    return await paymentSchedulerService.setupLeasePaymentSchedule(lease.id);
  }

  private async generateInitialInvoices(
    lease: any
  ): Promise<{ generated: number; emailsSent: number }> {
    // Generate invoices for immediate payments (security deposit, first month rent, etc.)
    return await this.generateAndSyncInvoices(lease.id);
  }

  private async updateLeaseStatusBasedOnPayments(lease: any): Promise<boolean> {
    try {
      const leaseId =
        typeof lease === "string" ? lease : lease.id ?? String(lease._id ?? "");
      const payments = await db.payment.findMany({
        where: { leaseId },
      });

      // Calculate payment status summary
      const totalDue = payments.reduce((sum, p) => sum + p.amount, 0);
      const totalPaid = payments.reduce(
        (sum, p) => sum + (p.amountPaid || 0),
        0
      );
      const overduePayments = payments.filter(
        (p) =>
          p.status === PaymentStatus.OVERDUE ||
          (p.dueDate < new Date() && p.status === PaymentStatus.PENDING)
      );

      // Determine the lease's aggregate payment status
      // (the old code targeted LeaseStatus.DELINQUENT / CURRENT which no
      // longer exist — the aggregate now lives on lease.paymentStatus)
      let newPaymentStatus: "current" | "pending" | "overdue" = "pending";
      if (overduePayments.length > 0) {
        newPaymentStatus = "overdue";
      } else if (totalDue > 0 && totalPaid >= totalDue) {
        newPaymentStatus = "current";
      }

      // Update lease if status changed
      const currentLease = await db.lease.findFirst({
        where: { id: leaseId },
      });
      if (currentLease && currentLease.paymentStatus !== newPaymentStatus) {
        await db.lease.update({
          where: { id: leaseId },
          data: { paymentStatus: newPaymentStatus },
        });
        return true;
      }

      return false;
    } catch {
      return false;
    }
  }

  private async setupPaymentMonitoring(
    lease: any,
    options: PaymentSyncOptions
  ): Promise<void> {
    // Set up automated monitoring for payment due dates, overdue payments, etc.
    // This would integrate with a job scheduler or cron system
  }

  private shouldGenerateInvoice(
    payment: any,
    config: InvoiceGenerationConfig
  ): boolean {
    const now = new Date();
    const dueDate = new Date(payment.dueDate);
    const daysToDue = Math.ceil(
      (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (
      config.generateOnPaymentCreation &&
      payment.status === PaymentStatus.PENDING
    ) {
      return true;
    }

    if (
      config.generateOnPaymentDue &&
      daysToDue <= 0 &&
      payment.status === PaymentStatus.PENDING
    ) {
      return true;
    }

    if (
      config.generateOnPaymentOverdue &&
      payment.status === PaymentStatus.OVERDUE
    ) {
      return true;
    }

    return false;
  }

  private generateInvoiceEmailMessage(
    lease: any,
    payment: any,
    config: InvoiceGenerationConfig
  ): string {
    let message = `Dear ${lease.tenantId?.firstName || "Tenant"},\n\n`;
    message += `Please find attached your invoice for ${
      lease.propertyId?.name || "your rental property"
    }.\n\n`;
    message += `Payment Details:\n`;
    message += `- Amount Due: ${formatCurrency(payment.amount)}\n`;
    message += `- Due Date: ${new Date(
      payment.dueDate
    ).toLocaleDateString()}\n`;
    message += `- Payment Type: ${payment.type}\n\n`;

    if (config.includePaymentInstructions) {
      message += `Payment Instructions:\n`;
      message += `You can make your payment online through our tenant portal or by the accepted payment methods listed in your lease agreement.\n\n`;
    }

    message += `Thank you for your prompt payment.\n\n`;
    message += `Best regards,\n`;
    message += `PropertyPro Management`;

    return message;
  }

  private async linkInvoiceToPayment(
    paymentId: string,
    invoiceResult: any
  ): Promise<void> {
    // The legacy Mongoose implementation pushed onto a non-schema `invoices`
    // field, which strict mode silently discarded — so nothing was ever
    // persisted. Kept as a no-op for parity; generated invoice files are
    // tracked by the invoice records themselves.
    void paymentId;
    void invoiceResult;
  }

  private async handlePaymentCompleted(payment: any): Promise<void> {
    // Generate payment confirmation
    await this.generatePaymentConfirmationInvoice(payment);

    // Update lease status
    if (payment.leaseId) {
      await this.updateLeaseStatusBasedOnPayments(payment.leaseId);
    }
  }

  private async handlePaymentOverdue(payment: any): Promise<void> {
    // Generate overdue notice
    // Send notification to tenant
  }

  private async handlePaymentFailed(payment: any): Promise<void> {
    // Send failure notification
    // Revert any status changes
  }

  private async handlePaymentRefunded(payment: any): Promise<void> {
    // Generate refund confirmation
    // Update accounting records
  }

  private async generatePaymentConfirmationInvoice(
    payment: any
  ): Promise<boolean> {
    try {
      // Generate a payment confirmation/receipt
      return true;
    } catch {
      return false;
    }
  }

  private async triggerNextRecurringPayment(payment: any): Promise<void> {
    // Create the next payment in the recurring series
    const schedule = payment.schedule as any;
    if (schedule?.frequency && schedule?.nextDueDate) {
      await paymentService.generateNextRecurringPayment(payment.id);
    }
  }
}

export const leasePaymentSyncService = new LeasePaymentSyncService();
