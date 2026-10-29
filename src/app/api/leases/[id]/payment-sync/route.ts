/**
 * PropertyPro - Lease Payment Synchronization API
 * Comprehensive API for managing synchronized payment processing, status updates, and invoice generation
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import {
  AuthenticatedAccessUser,
  withAccessAndDB,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { validateSchema } from "@/lib/validations";
import { UserRole } from "@/types";

const paymentSyncSetupSchema = z.object({
  autoGenerateInvoices: z.boolean().default(true),
  autoEmailInvoices: z.boolean().default(true),
  updateLeaseStatus: z.boolean().default(true),
  notifyTenant: z.boolean().default(true),
  createRecurringPayments: z.boolean().default(true),
  invoiceConfig: z.record(z.unknown()).default({}),
});

const paymentSyncInvoiceSchema = z.object({
  generateOnPaymentCreation: z.boolean().default(true),
  generateOnPaymentDue: z.boolean().default(false),
  generateOnPaymentOverdue: z.boolean().default(true),
  autoEmailToTenant: z.boolean().default(true),
  includePaymentInstructions: z.boolean().default(true),
  reminderSchedule: z
    .array(z.coerce.number().int().min(0))
    .default([7, 3, 1]),
});
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
} from "@/lib/api-utils";
import { leasePaymentSyncService } from "@/lib/services/lease-payment-sync.service";
import { db } from "@/lib/db/prisma";
import { leaseScope } from "@/lib/db/scopes";

const PAYMENT_SYNC_READ_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: ["lease_view", "lease_management", "payment_processing"],
  match: "any" as const,
};

// ============================================================================
// POST /api/leases/[id]/payment-sync - Setup comprehensive payment system
// ============================================================================
export const POST = withPermissionAndDB([
  "payment_processing",
  "lease_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: leaseId } = await params;

      if (!isValidObjectId(leaseId)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Verify lease exists and user has access
      // Scoped: a lease in a building this caller does not hold does not
      // resolve, and the 404 below answers — the same reply an id that never
      // existed gets.
      const lease = await db.lease.findFirst({
        where: { id: leaseId, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      const body = await request.json();

      const validation = validateSchema(paymentSyncSetupSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const {
        autoGenerateInvoices,
        autoEmailInvoices,
        updateLeaseStatus,
        notifyTenant,
        createRecurringPayments,
      } = validation.data;

      // Setup comprehensive payment system
      const syncResult = await leasePaymentSyncService.setupLeasePaymentSystem(
        leaseId,
        {
          autoGenerateInvoices,
          autoEmailInvoices,
          updateLeaseStatus,
          notifyTenant,
          createRecurringPayments,
        }
      );

      if (!syncResult.success) {
        return createErrorResponse(
          `Payment system setup failed: ${syncResult.errors.join(", ")}`,
          500
        );
      }

      return createSuccessResponse(
        {
          syncResult,
          message: "Payment system setup completed successfully",
          details: {
            paymentsCreated: syncResult.paymentsCreated,
            invoicesGenerated: syncResult.invoicesGenerated,
            emailsSent: syncResult.emailsSent,
            leaseStatusUpdated: syncResult.leaseStatusUpdated,
          },
        },
        "Payment system synchronized successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/leases/[id]/payment-sync - Retired
// ============================================================================
/**
 * Retired. It marked a payment paid with whatever amount the caller sent,
 * unchecked against what was owed, and never put the money on the
 * installment — the receipt read paid while the installment went on owing
 * all of it. Nothing called it. Money is recorded against an installment with
 * PATCH /api/invoices/<id> { operation: "add_payment" } (or "Mark as paid" on
 * the payment, PATCH /api/payments/<id>), which do both in one transaction.
 */
export const PUT = withPermissionAndDB([
  "payment_processing",
  "lease_management",
])(async () =>
  createErrorResponse(
    "This endpoint is retired. Record a payment with PATCH /api/invoices/<id> { operation: \"add_payment\" }.",
    410
  )
);

// ============================================================================
// GET /api/leases/[id]/payment-sync - Get payment synchronization status
// ============================================================================
export const GET = withAccessAndDB(PAYMENT_SYNC_READ_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: leaseId } = await params;

      if (!isValidObjectId(leaseId)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Verify lease exists and user has access. Scoped, so a lease outside
      // this caller's buildings answers 404 rather than a payment schedule.
      const lease = await db.lease.findFirst({
        where: { id: leaseId, ...leaseScope(user) },
        include: {
          tenant: true,
          property: {
            select: {
              id: true,
              name: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
            },
          },
        },
      });

      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Get all payments for this lease
      const payments = await db.payment.findMany({
        where: { leaseId },
        orderBy: { dueDate: "asc" },
      });

      // Calculate payment summary
      const now = new Date();
      const summary = payments.reduce(
        (acc, payment) => {
          acc.totalDue += payment.amount;
          acc.totalPaid += payment.amountPaid || 0;

          if (payment.status === "overdue") {
            acc.totalOverdue += payment.amount - (payment.amountPaid || 0);
          }

          if (payment.dueDate > now && payment.status === "pending") {
            acc.upcomingPayments += 1;
          }

          return acc;
        },
        { totalDue: 0, totalPaid: 0, totalOverdue: 0, upcomingPayments: 0 }
      );

      // Calculate invoice status
      const invoiceStatus = {
        generated: payments.filter((p: any) => p.invoices?.length > 0).length,
        sent: payments.filter((p: any) => p.invoiceEmailSent).length,
        pending: payments.filter((p) => p.status === "pending").length,
        overdue: payments.filter((p) => p.status === "overdue").length,
      };

      const terms = lease.terms as any;

      // Get automation status from lease configuration
      const automationStatus = {
        autoCreatePayments:
          terms?.paymentConfig?.autoCreatePayments ?? false,
        autoGenerateInvoices:
          terms?.paymentConfig?.autoGenerateInvoices ?? false,
        autoEmailInvoices:
          terms?.paymentConfig?.autoEmailInvoices ?? false,
        prorationEnabled: terms?.paymentConfig?.prorationEnabled ?? false,
      };

      const tenant = lease.tenant
        ? { ...(lease.tenant as any), ssn: undefined }
        : lease.tenantId;
      const property = lease.property
        ? {
            ...(lease.property as any),
            address: {
              street: lease.property.addressStreet,
              city: lease.property.addressCity,
              state: lease.property.addressState,
              zipCode: lease.property.addressZipCode,
              country: lease.property.addressCountry,
            },
          }
        : lease.propertyId;

      return createSuccessResponse({
        lease: {
          id: lease.id,
          status: lease.status,
          startDate: lease.startDate,
          endDate: lease.endDate,
          tenant,
          property,
        },
        payments,
        summary: {
          ...summary,
          paymentProgress:
            summary.totalDue > 0
              ? (summary.totalPaid / summary.totalDue) * 100
              : 0,
        },
        invoiceStatus,
        automationStatus,
        syncEnabled: true,
        lastSyncDate: new Date(),
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/leases/[id]/payment-sync - Generate and sync invoices
// ============================================================================
export const PATCH = withPermissionAndDB([
  "payment_processing",
  "lease_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id: leaseId } = await params;

      if (!isValidObjectId(leaseId)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      const body = await request.json();

      const validation = validateSchema(paymentSyncInvoiceSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const {
        generateOnPaymentCreation,
        generateOnPaymentDue,
        generateOnPaymentOverdue,
        autoEmailToTenant,
        includePaymentInstructions,
        reminderSchedule,
      } = validation.data;

      // The lease id arrives in the URL and went straight to the service,
      // which generates invoices and can email the tenant. Resolve it under
      // the caller's scope first: no row, no generation.
      const lease = await db.lease.findFirst({
        where: { id: leaseId, ...leaseScope(user) },
        select: { id: true },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // Generate and sync invoices
      const result = await leasePaymentSyncService.generateAndSyncInvoices(
        leaseId,
        {
          generateOnPaymentCreation,
          generateOnPaymentDue,
          generateOnPaymentOverdue,
          autoEmailToTenant,
          includePaymentInstructions,
          reminderSchedule,
        }
      );

      if (result.errors.length > 0) {
        return createErrorResponse(
          `Invoice generation completed with errors: ${result.errors.join(
            ", "
          )}`,
          207 // Multi-status
        );
      }

      return createSuccessResponse(
        {
          generated: result.generated,
          emailsSent: result.emailsSent,
          errors: result.errors,
          message: "Invoices generated and synchronized successfully",
        },
        "Invoices synchronized successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
