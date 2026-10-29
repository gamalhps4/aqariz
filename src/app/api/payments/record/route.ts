/**
 * PropertyPro - Payment allocation API
 *
 * GET previews how an amount would spread over a tenant's open invoices;
 * PATCH applies an existing payment to them; DELETE reverses that. POST,
 * which recorded new money here, is retired — see below.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { paymentAllows } from "@/lib/db/scopes";
import { z } from "zod";
import { paymentInvoiceLinkingService } from "@/lib/services/payment-invoice-linking.service";
import { dbIdSchema, validateSchema } from "@/lib/validations";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";

const applyPaymentSchema = z.object({
  paymentId: dbIdSchema,
  tenantId: dbIdSchema,
  amount: z.coerce
    .number({ invalid_type_error: "Valid payment amount is required" })
    .finite()
    .positive("Valid payment amount is required"),
  leaseId: dbIdSchema.optional(),
  specificInvoiceId: dbIdSchema.optional(),
});

// ============================================================================
// GET /api/payments/record - Get payment allocation preview
// ============================================================================
async function previewPaymentAllocation(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenantId = searchParams.get("tenantId");
    const leaseId = searchParams.get("leaseId");
    const amount = searchParams.get("amount");

    if (!tenantId) {
      return createErrorResponse("Tenant ID is required", 400);
    }

    if (!isValidObjectId(tenantId)) {
      return createErrorResponse("Invalid tenant ID format", 400);
    }

    // Get current payment allocation
    const allocation = await paymentInvoiceLinkingService.getPaymentAllocation(
      tenantId,
      leaseId || undefined
    );

    // If amount is provided, calculate how it would be applied
    let paymentPreview = null;
    if (amount && parseFloat(amount) > 0) {
      const paymentAmount = parseFloat(amount);
      let remainingAmount = paymentAmount;
      const applications = [];

      for (const invoice of allocation.invoices) {
        if (remainingAmount <= 0) break;

        const amountToApply = Math.min(
          remainingAmount,
          invoice.balanceRemaining
        );
        applications.push({
          invoiceId: invoice.invoiceId,
          invoiceNumber: invoice.invoiceNumber,
          dueDate: invoice.dueDate,
          currentBalance: invoice.balanceRemaining,
          amountToApply,
          newBalance: invoice.balanceRemaining - amountToApply,
          willBePaid: invoice.balanceRemaining - amountToApply === 0,
        });

        remainingAmount -= amountToApply;
      }

      paymentPreview = {
        paymentAmount,
        totalApplied: paymentAmount - remainingAmount,
        remainingAmount,
        applications,
      };
    }

    return createSuccessResponse(
      {
        tenantId,
        leaseId,
        currentAllocation: allocation,
        paymentPreview,
      },
      "Payment allocation retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to get payment allocation");
  }
}

/**
 * Resolve a payment the caller is actually entitled to act on.
 *
 * These endpoints take a payment id from the request and move money against
 * invoices with it. Permission alone was the only gate, so any holder of
 * `payment_processing` could apply or reverse *any* payment in the
 * organization by id — including, once employees can be narrowed to
 * particular buildings, payments in buildings they cannot see.
 *
 * Returns null when there is nothing this caller may touch; every call site
 * answers 404, so "not yours" and "not there" read the same from outside.
 */
async function findPaymentForActor(
  actor: AuthenticatedAccessUser,
  paymentId: string,
) {
  const payment = await db.payment.findFirst({ where: { id: paymentId } });
  if (!payment) return null;
  return paymentAllows(actor, payment) ? payment : null;
}

// ============================================================================
// PATCH /api/payments/record - Apply existing payment to invoices
// ============================================================================
async function applyPayment(
  user: AuthenticatedAccessUser,
  request: NextRequest,
) {
  try {
    const body = await request.json();

    const validation = validateSchema(applyPaymentSchema, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const { paymentId, tenantId, amount, leaseId } = validation.data;

    if (!(await findPaymentForActor(user, paymentId))) {
      return createErrorResponse("Payment not found", 404);
    }

    // Apply payment to invoices
    const result = await paymentInvoiceLinkingService.applyPaymentToInvoices(
      paymentId,
      tenantId,
      amount,
      leaseId
    );

    if (!result.success) {
      return createErrorResponse(
        `Payment application failed: ${result.errors.join(", ")}`,
        400
      );
    }

    return createSuccessResponse(
      {
        paymentId: result.paymentId,
        totalAmountApplied: result.totalAmountApplied,
        remainingAmount: result.remainingPaymentAmount,
        invoiceApplications: result.applicationsApplied,
        warnings: result.errors.length > 0 ? result.errors : undefined,
      },
      "Payment applied to invoices successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to apply payment to invoices");
  }
}

// ============================================================================
// DELETE /api/payments/record - Reverse payment application
// ============================================================================
async function reversePayment(
  user: AuthenticatedAccessUser,
  request: NextRequest,
) {
  try {
    const { searchParams } = new URL(request.url);
    const paymentId = searchParams.get("paymentId");

    if (!paymentId) {
      return createErrorResponse("Payment ID is required", 400);
    }

    if (!isValidObjectId(paymentId)) {
      return createErrorResponse("Invalid payment ID format", 400);
    }

    if (!(await findPaymentForActor(user, paymentId))) {
      return createErrorResponse("Payment not found", 404);
    }

    // Reverse the payment application
    const result = await paymentInvoiceLinkingService.reversePaymentApplication(
      paymentId
    );

    if (!result.success) {
      return createErrorResponse(
        `Payment reversal failed: ${result.errors.join(", ")}`,
        400
      );
    }

    return createSuccessResponse(
      {
        paymentId,
        reversedAmount: result.reversedAmount,
        affectedInvoices: result.affectedInvoices,
        warnings: result.errors.length > 0 ? result.errors : undefined,
      },
      "Payment application reversed successfully"
    );
  } catch (error) {
    return handleApiError(error, "Failed to reverse payment application");
  }
}

const paymentRecordPermissions = [
  "financial_management",
  "payment_processing",
];

/**
 * Retired. It recorded money for a tenant and spread it over their oldest
 * open invoices, across every contract they held, with no reference number —
 * and its only screen failed on every attempt. Money is recorded against one
 * installment of one contract: PATCH /api/invoices/[id] with
 * `operation: "add_payment"`, which is what the Record payment dialog calls.
 * Answered plainly rather than left to fail some other way.
 */
export const POST = withPermissionAndDB(paymentRecordPermissions)(async () =>
  createErrorResponse(
    "This endpoint is retired. Record a payment against its installment: " +
      'PATCH /api/invoices/<installment id> with operation "add_payment".',
    410,
  ),
);
export const GET = withPermissionAndDB(paymentRecordPermissions)(
  async (_user: unknown, request: NextRequest) =>
    previewPaymentAllocation(request),
);
export const PATCH = withPermissionAndDB(paymentRecordPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest) =>
    applyPayment(user, request),
);
export const DELETE = withPermissionAndDB(paymentRecordPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest) =>
    reversePayment(user, request),
);
