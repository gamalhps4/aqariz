/**
 * PropertyPro - Individual Payment API Routes
 * CRUD operations for individual payments
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  InstallmentPaymentError,
  deleteRecordedPayment,
  recordInstallmentPayment,
} from "@/lib/services/payment-invoice-linking.service";
import { GatewayRefundError, refundPayment } from "@/lib/payments/gateway-refund";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
import {
  auditRecordChange,
  recordDomainAudit,
  moneySnapshot,
} from "@/lib/audit-domain";
import { AuditAction } from "@/lib/audit-service";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { paymentAllows } from "@/lib/db/scopes";
import { UserRole, PaymentStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { paymentSchema, validateSchema } from "@/lib/validations";
import {
  MANUAL_PAYMENT_METHOD_ERROR,
  isManualPaymentMethod,
} from "@/lib/payments/methods";
import { PAYMENT_RECORDER_SELECT } from "@/lib/payments/recorder";
import { movesToAnotherContract } from "@/lib/payments/charge-links";
import {
  formatPaymentNumber,
  receiptNumberFor,
} from "@/lib/payments/receipt-number";
import { paymentNumberOmit } from "@/lib/payments/payment-number";

const PAYMENT_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "payment_view",
    "payment_processing",
    "financial_management",
    "financial_reports",
  ],
  match: "any" as const,
};

const PAYMENT_WRITE_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: ["payment_edit", "payment_processing", "financial_management"],
  match: "any" as const,
};

function buildAddress(property: {
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
  addressCountry: string;
}) {
  return {
    street: property.addressStreet,
    city: property.addressCity,
    state: property.addressState,
    zipCode: property.addressZipCode,
    country: property.addressCountry,
  };
}

/** Rebuild the populated tenantId/propertyId/leaseId shapes the client reads. */
function mapPaymentRow(payment: any) {
  const { tenant, property, lease, ...rest } = payment;
  let propertyRef = rest.propertyId;
  if (property) {
    const {
      addressStreet: _s,
      addressCity: _c,
      addressState: _st,
      addressZipCode: _z,
      addressCountry: _co,
      ...keep
    } = property;
    propertyRef = { ...keep, address: buildAddress(property) };
  }
  return {
    ...rest,
    tenantId: tenant ?? rest.tenantId,
    propertyId: propertyRef,
    leaseId: lease ?? rest.leaseId,
  };
}

// ============================================================================
// GET /api/payments/[id] - Get a specific payment
// ============================================================================

export const GET = withAccessAndDB(PAYMENT_READ_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid payment ID", 400);
      }

      const payment = await db.payment.findFirst({
        where: { id },
        // With its number, once the database has numbers (payment-number.ts).
        omit: { ...(await paymentNumberOmit()), ...(await gatewayColumnsOmit()) },
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
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
              type: true,
              ownerId: true,
              managerId: true,
            },
          },
          lease: {
            select: {
              id: true,
              startDate: true,
              endDate: true,
              status: true,
              contractNumber: true,
              unit: { select: { unitNumber: true } },
            },
          },
          // The installment it belongs to, by its number.
          invoice: {
            select: { id: true, invoiceNumber: true, dueDate: true },
          },
          // The number on the receipt the tenant was sent, when one was issued.
          receipt: { select: { receiptNumber: true } },
          // Which employee recorded it — for the office, not its clients.
          ...(user.isCompanyStaff
            ? { recordedBy: { select: PAYMENT_RECORDER_SELECT } }
            : {}),
        },
      });

      if (!payment) {
        return createErrorResponse("Payment not found", 404);
      }

      // Ownership is the same rule the payments list filters by — see
      // lib/db/scopes.ts. paymentAllows is true for staff.
      if (!paymentAllows(user, payment)) {
        return createErrorResponse("You can only view your own payments", 403);
      }

      return createSuccessResponse(
        {
          ...mapPaymentRow(payment),
          // RCP-000123 — null for a charge nobody has paid.
          paymentNumber: formatPaymentNumber(payment.number),
          // The receipt's number — the payment number, as the receipt printed
          // from this payment and the owner statement's السند column write it.
          receiptNumber: receiptNumberFor(
            payment.id,
            payment.receipt?.receiptNumber,
            payment.number,
          ),
        },
        "Payment retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/payments/[id] - Update a specific payment
// ============================================================================

export const PUT = withPermissionAndDB([
  "payment_edit",
  "payment_processing",
  "financial_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid payment ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const payment = await db.payment.findFirst({ where: { id } });
      if (!payment) {
        return createErrorResponse("Payment not found", 404);
      }

      // GET and PATCH below already ask this; PUT and DELETE did not, so a
      // caller narrowed to some buildings could edit or remove a payment in
      // any of the others.
      if (!paymentAllows(user, payment)) {
        return createErrorResponse("Payment not found", 404);
      }

      if (payment.status === PaymentStatus.PAID) {
        return createErrorResponse("Cannot update completed payment", 400);
      }

      const updateSchema = paymentSchema.partial();
      const validation = validateSchema(updateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      // A payment stays on the contract and installment it belongs to. Edit
      // used to pass `leaseId` straight through, so a payment — money and
      // all — could be moved onto another tenant's contract while its
      // installment went on counting it. The correction is delete-and-add,
      // which takes the money back off the installment on the way out.
      const requested = body as { leaseId?: string | null; invoiceId?: string | null };
      if (
        movesToAnotherContract(payment.leaseId, requested.leaseId) ||
        movesToAnotherContract(payment.invoiceId, requested.invoiceId)
      ) {
        return createErrorResponse(
          "A payment stays on the contract and installment it was recorded against. To correct it, delete it and add it again on the right contract.",
          409,
        );
      }

      const updateData = validation.data;
      delete updateData.tenantId;
      delete updateData.propertyId;
      delete updateData.leaseId;
      delete (updateData as Record<string, unknown>).stripePaymentIntentId;

      // A changed method must be one of the six staff record with. An older
      // payment keeps the method it already carries: an edit that leaves it
      // alone must not fail because that method is no longer offered.
      if (
        updateData.paymentMethod !== undefined &&
        updateData.paymentMethod !== payment.paymentMethod &&
        !isManualPaymentMethod(updateData.paymentMethod)
      ) {
        return createErrorResponse(MANUAL_PAYMENT_METHOD_ERROR, 400);
      }

      // The rule PATCH's updateAmount already kept, now kept here too — this
      // is the route the edit screen actually calls, so a part-paid payment
      // could be re-priced underneath the money already taken. The review is
      // explicit: a recorded amount is not edited; the payment is deleted and
      // a correct one recorded.
      const hasMoney =
        payment.status === PaymentStatus.PARTIAL ||
        Number(payment.amountPaid ?? 0) > 0;
      if (
        hasMoney &&
        updateData.amount !== undefined &&
        Number(updateData.amount) !== Number(payment.amount)
      ) {
        return createErrorResponse(
          "This payment has money recorded against it, so its amount cannot be changed. Delete it and record a new one instead.",
          409,
        );
      }

      const updatedPayment = await db.payment.update({
        where: { id: payment.id },
        data: updateData,
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
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
              type: true,
            },
          },
          lease: {
            select: { id: true, startDate: true, endDate: true, status: true },
          },
        },
      });

      // Before and after, for the fields this edit touched — the activity
      // log is asked for exactly this on payment edits.
      const touched = Object.keys(updateData);
      await recordDomainAudit({
        user,
        request,
        resource: "payment",
        action: AuditAction.UPDATE,
        resourceId: payment.id,
        resourceName: payment.description ?? payment.id,
        description: "Edited a payment",
        oldValues: moneySnapshot(payment as never, touched),
        newValues: moneySnapshot(updatedPayment as never, touched),
      });
      postAfterCommit("payment", payment.id, { userId: user.id });

      return createSuccessResponse(
        mapPaymentRow(updatedPayment),
        "Payment updated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/payments/[id] - Delete a specific payment
// ============================================================================

export const DELETE = withPermissionAndDB([
  // Its own permission, not a by-product of being able to record payments:
  // the review asks for Delete to be granted separately from Add and Edit.
  "payment_delete",
  "financial_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid payment ID", 400);
      }

      const payment = await db.payment.findFirst({ where: { id } });
      if (!payment) {
        return createErrorResponse("Payment not found", 404);
      }

      if (!paymentAllows(user, payment)) {
        return createErrorResponse("Payment not found", 404);
      }

      // This is the review's correction path — a wrong payment is deleted and
      // the right one recorded — so a paid payment is exactly what has to be
      // deletable. Its money comes back off the installment in the same
      // transaction, and the payment goes to the archive, from where a
      // restore puts the money back.
      let reversed;
      try {
        ({ reversed } = await deleteRecordedPayment(payment.id, user.id));
      } catch (error) {
        if (error instanceof InstallmentPaymentError) {
          return createErrorResponse(error.message, error.status);
        }
        throw error;
      }

      await recordDomainAudit({
        user,
        request,
        resource: "payment",
        action: AuditAction.DELETE,
        resourceId: payment.id,
        resourceName: payment.description ?? payment.id,
        description: `Deleted a payment of ${Number(payment.amountPaid ?? 0) || Number(payment.amount)} and moved it to the archive`,
        oldValues: moneySnapshot(payment as never, [
          "amount",
          "amountPaid",
          "status",
          "paymentMethod",
          "paidDate",
          "invoiceId",
        ]),
        newValues: { reversed },
      });

      return createSuccessResponse(
        { id: payment.id, reversed },
        "Payment deleted and moved to the archive"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/payments/[id] - Partial update (status change, etc.)
// ============================================================================

/** A charge with no money on it yet: the only kind "mark as failed" applies to. */
const FAILABLE_STATUSES: readonly string[] = [
  PaymentStatus.PENDING,
  PaymentStatus.OVERDUE,
  PaymentStatus.FAILED,
];

export const PATCH = withAccessAndDB(PAYMENT_WRITE_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid payment ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const payment = await db.payment.findFirst({ where: { id } });
      if (!payment) {
        return createErrorResponse("Payment not found", 404);
      }

      if (!paymentAllows(user, payment)) {
        return createErrorResponse("You can only modify your own payments", 403);
      }

      const { action, ...data } = body;

      const updateData: Record<string, unknown> = {};

      switch (action) {
        case "markAsPaid": {
          if (user.isTenant) {
            return createErrorResponse("Tenants cannot mark payments as paid", 403);
          }
          // Asked for, never assumed: how the money arrived decides whether
          // the office or the owner received it. This used to fall back to
          // the method the unpaid row happened to carry, or to cash.
          const paymentMethod = data.paymentMethod;
          if (!isManualPaymentMethod(paymentMethod)) {
            return createErrorResponse(MANUAL_PAYMENT_METHOD_ERROR, 400);
          }
          const paidDate = data.paidDate ? new Date(data.paidDate) : new Date();
          if (payment.invoiceId) {
            // A status flip alone left the installment it belongs to unpaid.
            // Recorded through the same path as any other payment instead.
            try {
              await recordInstallmentPayment({
                invoiceId: payment.invoiceId,
                amount:
                  Number(payment.amount) - Number(payment.amountPaid ?? 0),
                paymentMethod,
                paidDate,
                convertPaymentId: payment.id,
                recordedBy: user.id,
              });
            } catch (error) {
              if (error instanceof InstallmentPaymentError) {
                return createErrorResponse(error.message, error.status);
              }
              throw error;
            }
            const recorded = await db.payment.findFirst({
              where: { id: payment.id },
            });
            return createSuccessResponse(
              recorded,
              "Payment markAsPaid completed successfully"
            );
          }
          updateData.status = PaymentStatus.PAID;
          updateData.amountPaid = payment.amount;
          updateData.paidDate = paidDate;
          updateData.paymentMethod = paymentMethod;
          updateData.recordedById = user.id;
          break;
        }

        case "markAsFailed":
          if (user.isTenant) {
            return createErrorResponse(
              "Tenants cannot mark payments as failed",
              403
            );
          }
          // Only a charge still waiting for its money can fail. A receipt
          // flipped to failed kept its money on the installment and in the
          // books; a bounced cheque or a mistake is undone by deleting the
          // payment (its money comes off the installment) or refunding it.
          if (
            !FAILABLE_STATUSES.includes(payment.status) ||
            Number(payment.amountPaid ?? 0) > 0
          ) {
            return createErrorResponse(
              "This payment has money recorded against it, so it cannot be marked as failed. Delete it (its money comes off the installment) or refund it instead.",
              409
            );
          }
          updateData.status = PaymentStatus.FAILED;
          break;

        // Retired. It put the payment back to PENDING whatever state it was in
        // — a paid or refunded one included — and stored whichever Stripe
        // payment-intent id the caller sent, and a tenant may call this
        // route. POST /api/payments/create-intent then found that intent
        // succeeded and marked the payment paid, so the receipt for one
        // payment settled another. Nothing called it: a card payment starts
        // at create-intent, which stores the id of the intent it raises.
        case "processPayment":
          return createErrorResponse(
            "This action is retired: it stored a payment-intent id sent by the caller. " +
              "Start a card payment with POST /api/v1/payments/create-intent.",
            410
          );

        case "refund": {
          if (user.isTenant) {
            return createErrorResponse("Tenants cannot refund payments", 403);
          }
          // The money goes back to the tenant, so it comes back off the
          // installment too — a status change alone left it reading as paid.
          // Taken online, it goes back through the same gateway first
          // (lib/payments/gateway-refund.ts).
          let reversed;
          let gatewayRefund;
          try {
            ({ reversed, gatewayRefund } = await refundPayment(payment.id, user.id));
          } catch (error) {
            if (
              error instanceof InstallmentPaymentError ||
              error instanceof GatewayRefundError
            ) {
              return createErrorResponse(error.message, error.status);
            }
            throw error;
          }
          await recordDomainAudit({
            user,
            request,
            resource: "payment",
            action: AuditAction.UPDATE,
            resourceId: payment.id,
            resourceName: payment.description ?? payment.id,
            description: gatewayRefund
              ? `Refunded a payment through ${gatewayRefund.gateway}`
              : "Refunded a payment",
            oldValues: { status: payment.status },
            newValues: { status: PaymentStatus.REFUNDED, reversed, gatewayRefund },
          });
          const refunded = await db.payment.findFirst({
            where: { id: payment.id },
          });
          return createSuccessResponse(
            refunded,
            "Payment refund completed successfully"
          );
        }

        case "updateAmount":
          if (user.isTenant) {
            return createErrorResponse(
              "Tenants cannot update payment amounts",
              403
            );
          }
          // Once any money has been received against this row the amount is
          // history, not a field. `PAID` alone was too narrow: a partially
          // paid row could still be re-priced underneath the money already
          // taken, which silently changes what the tenant owes. The
          // correction path is delete-and-re-record, which reverses the
          // invoice on the way out.
          if (
            payment.status === PaymentStatus.PAID ||
            payment.status === PaymentStatus.PARTIAL ||
            Number(payment.amountPaid ?? 0) > 0
          ) {
            return createErrorResponse(
              "This payment has money recorded against it, so its amount cannot be changed. Delete it and record a new one instead.",
              409
            );
          }
          if (!data.amount || data.amount <= 0) {
            return createErrorResponse("Valid amount is required", 400);
          }
          updateData.amount = data.amount;
          break;

        case "updateDueDate":
          if (user.isTenant) {
            return createErrorResponse("Tenants cannot update due dates", 403);
          }
          if (!data.dueDate) {
            return createErrorResponse("Due date is required", 400);
          }
          updateData.dueDate = new Date(data.dueDate);
          break;

        case "addNote": {
          // A note is added beside what the office has already written. This
          // used to overwrite the payment's description — "Payment for
          // RENT-000003" — and a tenant could do it to their own payments.
          if (user.isTenant) {
            return createErrorResponse("Tenants cannot add notes to payments", 403);
          }
          const note = String(data.note ?? data.description ?? "").trim();
          if (!note) {
            return createErrorResponse("A note is required", 400);
          }
          if (note.length > 1000) {
            return createErrorResponse("Notes too long", 400);
          }
          updateData.notes = payment.notes ? `${payment.notes}\n${note}` : note;
          break;
        }

        default:
          return createErrorResponse("Invalid action", 400);
      }

      const updatedPayment = await db.payment.update({
        where: { id: payment.id },
        data: updateData,
      });

      // Paying, failing, re-pricing, re-dating or annotating a payment: one
      // entry, with the fields that moved before and after.
      auditRecordChange({
        action:
          action === "markAsPaid"
            ? AuditAction.PAYMENT_PROCESSED
            : action === "markAsFailed"
              ? AuditAction.PAYMENT_FAILED
              : AuditAction.UPDATE,
        recordType: "payment",
        recordId: payment.id,
        recordName: payment.description ?? null,
        before: payment as unknown as Record<string, unknown>,
        after: updatedPayment as unknown as Record<string, unknown>,
        keys: Object.keys(updateData),
        messageParams:
          action === "markAsPaid" ? { amount: Number(payment.amount) } : undefined,
        details: { patch: action, leaseId: payment.leaseId ?? undefined },
      });
      // "Mark as paid" without an installment sets PAID here directly.
      postAfterCommit("payment", payment.id, { userId: user.id });

      return createSuccessResponse(
        updatedPayment,
        `Payment ${action} completed successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
