/**
 * PropertyPro - Individual Invoice API Routes
 * RESTful API endpoints for individual invoice management
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { invoiceScope } from "@/lib/db/scopes";
import { InvoiceStatus, InvoiceType } from "@/types";
import { dbIdSchema, manualPaymentMethodSchema, validateSchema } from "@/lib/validations";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";
import {
  INVOICE_DELETE_PERMISSIONS,
  INVOICE_EDIT_PERMISSIONS,
  INVOICE_PAYMENT_PERMISSIONS,
  INVOICE_READ_PERMISSIONS,
} from "@/lib/finance-permissions";
import {
  InstallmentPaymentError,
  recordInstallmentPayment,
} from "@/lib/services/payment-invoice-linking.service";
import {
  auditRecordChange,
  pickSnapshot,
  recordActivity,
  recordDomainAudit,
} from "@/lib/audit-domain";
import { AuditAction } from "@/lib/audit-service";
import { postAfterCommit } from "@/lib/accounting/hooks";
import {
  accountingPhase0Available,
  invoicePhase0Omit,
} from "@/lib/invoice/phase0-columns";
import {
  CustomInvoiceError,
  readInvoiceLines,
  recordCustomerSettlement,
  recordInvoiceRefund,
} from "@/lib/invoice/custom-invoice.service";
import { OWNER_BALANCE_METHOD } from "@/lib/accounting/posting/invoice";
import { creditableLines } from "@/lib/invoice/credit-note";
import { sendManualInvoiceReminder } from "@/lib/invoice/reminder";

// PUT body: fields the update handler applies. Amounts are recomputed from
// quantity * unitPrice, so the line items validate those inputs.
const invoiceUpdateBodySchema = z.object({
  invoiceNumber: z.string().min(1).max(100).optional(),
  issueDate: z.coerce.date().optional(),
  dueDate: z.coerce.date().optional(),
  lineItems: z
    .array(
      z.object({
        description: z
          .string()
          .min(1, "Line item description is required")
          .max(200),
        type: z.nativeEnum(InvoiceType, {
          errorMap: () => ({ message: "Valid line item type is required" }),
        }),
        quantity: z.coerce.number().finite().min(0).optional(),
        unitPrice: z.coerce.number().finite().min(0).optional(),
        dueDate: z.coerce.date().optional(),
      })
    )
    .optional(),
  notes: z.string().max(2000).optional(),
  status: z.nativeEnum(InvoiceStatus).optional(),
  taxAmount: z.coerce.number().finite().min(0, "Tax cannot be negative").optional(),
});

// PATCH operation payloads
const addPaymentDataSchema = z.object({
  /** An open, unpaid payment row to turn into this receipt. */
  paymentId: dbIdSchema.optional(),
  amount: z.coerce
    .number({ invalid_type_error: "Valid payment amount is required" })
    .finite()
    .positive("Valid payment amount is required"),
  paymentMethod: manualPaymentMethodSchema,
  paidDate: z.coerce.date().default(() => new Date()),
  // The collection dialog has always sent these two; the schema did not list
  // them, so validation stripped them and every reference number typed at
  // the desk was thrown away.
  transactionId: z.string().trim().max(200).optional(),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const sendReminderDataSchema = z.object({
  type: z.string().max(100).default("reminder"),
  method: z.string().max(100).default("email"),
});

/**
 * A refund paid back on an invoice a credit note left overpaid. An owner's
 * may also go back on their balance (`owner_balance`).
 */
const recordRefundDataSchema = z.object({
  amount: z.coerce
    .number({ invalid_type_error: "Valid refund amount is required" })
    .finite()
    .positive("Valid refund amount is required"),
  paymentMethod: z.union([z.literal(OWNER_BALANCE_METHOD), manualPaymentMethodSchema]),
  paidDate: z.coerce.date().default(() => new Date()),
  reference: z.string().trim().max(200).optional(),
  notes: z.string().trim().max(2000).optional(),
});

const invoicePatchDataSchemas: Partial<Record<string, z.ZodTypeAny>> = {
  add_payment: addPaymentDataSchema,
  record_refund: recordRefundDataSchema,
  send_reminder: sendReminderDataSchema,
};
import { computeEffectiveInvoiceStatus } from "@/lib/invoice/invoice-shared";
import type { InvoiceReadModel as InvoiceModel } from "@/lib/invoice/phase0-columns";
import type { MoneyAsNumber } from "@/lib/db/prisma";
import { businessDay } from "@/lib/dates/business-day";
// Money fields arrive as numbers via the money result extension.
type InvoiceRow = MoneyAsNumber<InvoiceModel>;

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

const propertyNameAddressSelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

// ============================================================================
// GET /api/invoices/[id] - Get single invoice
// ============================================================================
async function getInvoice(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid invoice ID", 400);
    }

    // Scoped: an invoice for a building this caller does not hold simply
    // does not resolve, and the existing 404 answers. Narrowing the lookup
    // rather than checking afterwards keeps "not yours" and "not there"
    // indistinguishable from outside.
    const phase0 = await accountingPhase0Available();
    const invoice = await db.invoice.findFirst({
      where: { id, ...invoiceScope(user) },
      omit: await invoicePhase0Omit(),
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
        property: { select: propertyNameAddressSelect },
        lease: {
          select: {
            id: true,
            startDate: true,
            endDate: true,
            terms: true,
            taxEnabled: true,
            taxRate: true,
          },
        },
      },
    });

    if (!invoice) {
      return createErrorResponse("Invoice not found", 404);
    }

    // What accounting phase 0 added: the invoice's own lines, the customer
    // it is to, the credit notes against it or the invoice it credits.
    const document = invoice as typeof invoice & {
      documentType?: string;
      originalInvoiceId?: string | null;
      creditedAmount?: unknown;
      customerUserId?: string | null;
      customerName?: string | null;
    };
    const [lineMap, creditNotes, originalInvoice, customerUser] = await Promise.all([
      readInvoiceLines([invoice.id]),
      phase0 && document.documentType !== "credit_note"
        ? db.invoice.findMany({
            where: { originalInvoiceId: invoice.id },
            select: {
              id: true,
              invoiceNumber: true,
              issueDate: true,
              totalAmount: true,
              taxAmount: true,
            },
            orderBy: { issueDate: "asc" },
          })
        : Promise.resolve([]),
      document.originalInvoiceId
        ? db.invoice.findFirst({
            where: { id: document.originalInvoiceId, deletedAt: undefined },
            select: { id: true, invoiceNumber: true, issueDate: true },
          })
        : Promise.resolve(null),
      document.customerUserId
        ? db.user.findFirst({
            where: { id: document.customerUserId, deletedAt: undefined },
            select: { id: true, firstName: true, lastName: true, email: true, phone: true },
          })
        : Promise.resolve(null),
    ]);
    const lines = lineMap.get(invoice.id) ?? [];

    // The Mongoose route populated paymentIds with the payment documents.
    const paymentRows = invoice.paymentIds?.length
      ? await db.payment.findMany({
          where: { id: { in: invoice.paymentIds } },
          select: {
            id: true,
            amount: true,
            paidDate: true,
            paymentMethod: true,
            status: true,
            dueDate: true,
            type: true,
          },
        })
      : [];
    const paymentsById = new Map(paymentRows.map((p) => [p.id, p]));
    const populatedPayments = (invoice.paymentIds ?? [])
      .map((paymentId) => paymentsById.get(paymentId))
      .filter(Boolean);

    const { tenant, property, lease, ...rest } = invoice;

    // Surface an accurate, time-sensitive status without mutating the DB on read.
    // A daily cron persists transitions; this keeps reads correct between runs.
    const payload: Record<string, unknown> = {
      ...rest,
      documentType: document.documentType ?? "invoice",
      creditedAmount: Number(document.creditedAmount ?? 0),
      customerName:
        document.customerName ??
        (tenant ? `${tenant.firstName ?? ""} ${tenant.lastName ?? ""}`.trim() : null),
      tenantId: tenant ?? rest.tenantId,
      propertyId: property
        ? { id: property.id, name: property.name, address: buildAddress(property) }
        : rest.propertyId,
      leaseId: lease
        ? { ...lease, taxRate: Number(lease.taxRate) }
        : rest.leaseId,
      paymentIds: populatedPayments,
      status: computeEffectiveInvoiceStatus(invoice),
      lines,
      creditNotes: creditNotes.map((note) => ({
        ...note,
        totalAmount: Number(note.totalAmount),
        taxAmount: Number(note.taxAmount),
      })),
      originalInvoice,
      customerUser,
      // What a credit note against this invoice starts from.
      creditableLines:
        document.documentType === "credit_note"
          ? []
          : creditableLines({
              category: invoice.category,
              subtotal: Number(invoice.subtotal),
              discountAmount: Number(invoice.discountAmount),
              taxAmount: Number(invoice.taxAmount),
              lineItems: invoice.lineItems,
              lines,
            }),
      settlements: Array.isArray((invoice.metadata as { settlements?: unknown })?.settlements)
        ? (invoice.metadata as { settlements: unknown[] }).settlements
        : [],
    };

    return createSuccessResponse(payload, "Invoice retrieved successfully");
  } catch (error) {
    return handleApiError(error, "Failed to retrieve invoice");
  }
}

// ============================================================================
// PUT /api/invoices/[id] - Update invoice
// ============================================================================
async function updateInvoice(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid invoice ID", 400);
    }

    // Find existing invoice
    const existingInvoice = await db.invoice.findFirst({
      where: { id, ...invoiceScope(user) },
      omit: await invoicePhase0Omit(),
    });
    if (!existingInvoice) {
      return createErrorResponse("Invoice not found", 404);
    }

    // Prevent updates to paid invoices
    if (existingInvoice.status === InvoiceStatus.PAID) {
      return createErrorResponse("Cannot update paid invoices", 400);
    }

    // Extract updatable fields
    const validation = validateSchema(invoiceUpdateBodySchema, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }
    const {
      invoiceNumber,
      dueDate,
      issueDate,
      lineItems,
      notes,
      status,
      taxAmount,
    } = validation.data;

    // A tax invoice written line by line, and a credit note, are issued
    // documents: their number, date and lines stay as issued, and a mistake
    // is corrected with a credit note. Its due date and notes still change.
    const existing = existingInvoice as typeof existingInvoice & {
      documentType?: string;
      creditedAmount?: unknown;
    };
    const issuedDocument =
      existing.documentType === "credit_note" ||
      Number(existing.creditedAmount ?? 0) > 0 ||
      (await readInvoiceLines([id])).has(id);
    if (issuedDocument) {
      const changesFigures =
        (invoiceNumber && invoiceNumber !== existingInvoice.invoiceNumber) ||
        (issueDate &&
          businessDay(issueDate) !== businessDay(existingInvoice.issueDate)) ||
        lineItems !== undefined ||
        taxAmount !== undefined;
      if (changesFigures) {
        return createErrorResponse(
          "An issued tax invoice keeps its number, date and lines. Issue a credit note to correct it.",
          409,
        );
      }
      if (
        status === InvoiceStatus.CANCELLED &&
        (existing.documentType === "credit_note" ||
          Number(existing.creditedAmount ?? 0) > 0)
      ) {
        return createErrorResponse(
          existing.documentType === "credit_note"
            ? "A credit note cannot be cancelled"
            : "This invoice has a credit note against it, so it cannot be cancelled",
          409,
        );
      }
    }

    const updates: any = {};

    // Update invoice number (if provided and different). A number from a
    // sequence (INV-000123, RENT-000123, CN-000045) is kept: changing it
    // would leave a gap and could collide with the next one issued.
    if (invoiceNumber && invoiceNumber !== existingInvoice.invoiceNumber) {
      if (/^(INV|RENT|CN)-\d+$/.test(existingInvoice.invoiceNumber)) {
        return createErrorResponse(
          "An invoice numbered in sequence keeps its number",
          409,
        );
      }
      updates.invoiceNumber = invoiceNumber;
    }

    // Update issue date
    if (issueDate) {
      updates.issueDate = new Date(issueDate);
    }

    // Update due date
    if (dueDate) {
      updates.dueDate = new Date(dueDate);
      // Update grace period end if due date changes
      updates.gracePeriodEnd = new Date(
        new Date(dueDate).getTime() + 5 * 24 * 60 * 60 * 1000, // 5 days grace period
      );
    }

    // Update tax amount
    if (taxAmount !== undefined) {
      updates.taxAmount = Math.max(0, Number(taxAmount));
    }

    // Update line items and recalculate totals
    if (lineItems && Array.isArray(lineItems)) {
      // Process line items to ensure proper calculation
      const processedLineItems = lineItems.map((item: any) => ({
        description: item.description,
        amount: Number(item.unitPrice || 0) * Number(item.quantity || 1),
        type: item.type,
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unitPrice || 0),
        ...(item.dueDate ? { dueDate: new Date(item.dueDate) } : {}),
      }));

      updates.lineItems = processedLineItems;

      // Recalculate totals
      const subtotal = processedLineItems.reduce(
        (sum: number, item: any) => sum + item.amount,
        0,
      );
      const finalTaxAmount =
        updates.taxAmount !== undefined
          ? updates.taxAmount
          : existingInvoice.taxAmount || 0;

      // An invoice cannot be edited down below what has been paid on it —
      // that left a negative balance nothing could settle.
      if (subtotal + finalTaxAmount < existingInvoice.amountPaid - 0.005) {
        return createErrorResponse(
          "The new total is less than what has already been paid on this invoice.",
          409,
        );
      }

      updates.subtotal = subtotal;
      updates.totalAmount = subtotal + finalTaxAmount;
      updates.balanceRemaining =
        subtotal + finalTaxAmount - existingInvoice.amountPaid;
    }

    // Update notes
    if (notes !== undefined) {
      updates.notes = notes;
    }

    // Update status — only when it actually changes, and only to a status
    // an office decides. Paid and partly paid are what the recorded payments
    // add up to, and overdue is the due date passing; setting "paid" here
    // used to mark an invoice settled with no payment behind it.
    if (status && status !== existingInvoice.status) {
      const settable: InvoiceStatus[] = [
        InvoiceStatus.SCHEDULED,
        InvoiceStatus.ISSUED,
        InvoiceStatus.CANCELLED,
      ];
      if (!settable.includes(status)) {
        return createErrorResponse(
          "Paid, partly paid and overdue follow from payments and due dates, so they cannot be set by hand. Record a payment instead.",
          400,
        );
      }
      if (existingInvoice.amountPaid > 0) {
        return createErrorResponse(
          "This invoice has payments recorded against it. Delete them first, then change its status.",
          409,
        );
      }
      updates.status = status;
    }

    // Add audit trail
    updates.updatedAt = new Date();

    // Update the invoice
    const updatedInvoice = await db.invoice.update({
      where: { id },
      data: updates,
      include: {
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        property: { select: propertyNameAddressSelect },
        lease: { select: { id: true, startDate: true, endDate: true } },
      },
    });

    auditRecordChange({
      action: updates.status ? AuditAction.STATUS_CHANGED : AuditAction.UPDATE,
      recordType: "invoice",
      recordId: id,
      recordName: updatedInvoice.invoiceNumber,
      before: existingInvoice as unknown as Record<string, unknown>,
      after: updatedInvoice as unknown as Record<string, unknown>,
      keys: Object.keys(updates),
      messageParams: updates.status
        ? { from: existingInvoice.status, to: updates.status }
        : undefined,
      details: { leaseId: existingInvoice.leaseId ?? undefined },
    });

    postAfterCommit("invoice", existingInvoice.id, { userId: user.id });

    const { tenant, property, lease, ...rest } = updatedInvoice;
    const responseInvoice = {
      ...rest,
      tenantId: tenant ?? rest.tenantId,
      propertyId: property
        ? { id: property.id, name: property.name, address: buildAddress(property) }
        : rest.propertyId,
      leaseId: lease ?? rest.leaseId,
    };

    return createSuccessResponse(
      responseInvoice,
      "Invoice updated successfully",
    );
  } catch (error) {
    return handleApiError(error, "Failed to update invoice");
  }
}

// ============================================================================
// DELETE /api/invoices/[id] - Soft delete invoice
// ============================================================================
async function deleteInvoice(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid invoice ID", 400);
    }

    // Find the invoice
    const invoice = await db.invoice.findFirst({
      where: { id, ...invoiceScope(user) },
      omit: await invoicePhase0Omit(),
    });
    if (!invoice) {
      return createErrorResponse("Invoice not found", 404);
    }

    // Check if invoice has payments
    if (invoice.amountPaid > 0) {
      return createErrorResponse(
        "Cannot delete invoice that has received payments",
        400,
      );
    }

    // A credit note, and an invoice one has corrected, stay: deleting either
    // would leave the other's figures pointing at nothing.
    const credited = invoice as typeof invoice & {
      documentType?: string;
      creditedAmount?: unknown;
    };
    if (
      credited.documentType === "credit_note" ||
      Number(credited.creditedAmount ?? 0) > 0
    ) {
      return createErrorResponse(
        "Credit notes, and invoices a credit note has corrected, cannot be deleted",
        400,
      );
    }

    // Soft delete the invoice
    await db.invoice.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        status: InvoiceStatus.CANCELLED,
      },
    });

    void recordActivity({
      action: AuditAction.DELETE,
      recordType: "invoice",
      recordId: id,
      recordName: invoice.invoiceNumber,
      before: pickSnapshot(invoice as unknown as Record<string, unknown>, [
        "status",
        "totalAmount",
        "balanceRemaining",
        "dueDate",
      ]),
      details: { leaseId: invoice.leaseId ?? undefined },
    });
    postAfterCommit("invoice", id, { userId: user.id });

    return createSuccessResponse({ id }, "Invoice deleted successfully");
  } catch (error) {
    return handleApiError(error, "Failed to delete invoice");
  }
}

// ============================================================================
// PATCH /api/invoices/[id] - Partial update invoice
// ============================================================================
async function patchInvoice(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();

    if (!isValidObjectId(id)) {
      return createErrorResponse("Invalid invoice ID", 400);
    }

    // Find existing invoice
    const existingInvoice = await db.invoice.findFirst({
      where: { id, ...invoiceScope(user) },
    });
    if (!existingInvoice) {
      return createErrorResponse("Invoice not found", 404);
    }

    // Handle specific operations
    const { operation, ...rawData } = body;

    const allowed =
      operation === "add_payment" || operation === "record_refund"
        ? invoicePaymentPermissions
        : invoiceWritePermissions;
    if (!user.permissions.some((permission) => allowed.includes(permission))) {
      return createErrorResponse("Insufficient permissions", 403);
    }

    // Validate the operation-specific payload
    let data: any = rawData;
    const dataSchema =
      typeof operation === "string"
        ? invoicePatchDataSchemas[operation]
        : undefined;
    if (dataSchema) {
      const dataValidation = validateSchema(dataSchema, rawData);
      if (!dataValidation.success) {
        return createErrorResponse(dataValidation.errors.join(", "), 400);
      }
      data = dataValidation.data;
    }

    let result;

    switch (operation) {
      case "add_payment": {
        // An owner or a customer has no tenant record for a payment row to
        // hang on: what they paid is kept on the invoice itself.
        if (!existingInvoice.tenantId) {
          try {
            result = await recordCustomerSettlement(user, existingInvoice.id, {
              amount: data.amount,
              paidDate: data.paidDate,
              paymentMethod: data.paymentMethod,
              reference: data.transactionId ?? data.reference,
              notes: data.notes,
            });
          } catch (error) {
            if (error instanceof CustomInvoiceError) {
              return createErrorResponse(error.message, error.status);
            }
            throw error;
          }
          await recordDomainAudit({
            user,
            request,
            resource: "invoice",
            action: AuditAction.UPDATE,
            resourceId: existingInvoice.id,
            resourceName: existingInvoice.invoiceNumber,
            description: `Recorded ${data.amount} received against ${existingInvoice.invoiceNumber}`,
            newValues: {
              amount: data.amount,
              paymentMethod: data.paymentMethod,
              paidDate: data.paidDate,
              reference: data.transactionId ?? data.reference ?? null,
            },
          });
          break;
        }
        let recorded;
        try {
          recorded = await handleAddPayment(existingInvoice, data, user);
        } catch (error) {
          // The service's refusals are written for the person at the desk
          // ("more than what is left on this installment"); passed on as
          // they are rather than flattened into a generic failure.
          if (error instanceof InstallmentPaymentError) {
            return createErrorResponse(error.message, error.status);
          }
          throw error;
        }
        await recordDomainAudit({
          user,
          request,
          resource: "payment",
          action: AuditAction.CREATE,
          resourceId: recorded.paymentId,
          resourceName: existingInvoice.invoiceNumber,
          description: `Recorded payment of ${data.amount} against ${existingInvoice.invoiceNumber}`,
          newValues: {
            amount: data.amount,
            paymentMethod: data.paymentMethod,
            paidDate: data.paidDate,
            reference: data.transactionId ?? data.reference ?? null,
            installment: existingInvoice.invoiceNumber,
          },
        });
        result = recorded.invoice;
        break;
      }

      case "record_refund": {
        let refund;
        try {
          refund = await recordInvoiceRefund(user, existingInvoice.id, {
            amount: data.amount,
            paidDate: data.paidDate,
            paymentMethod: data.paymentMethod,
            reference: data.reference,
            notes: data.notes,
          });
        } catch (error) {
          if (error instanceof CustomInvoiceError) {
            return createErrorResponse(error.message, error.status);
          }
          throw error;
        }
        await recordDomainAudit({
          user,
          request,
          resource: "invoice",
          action: AuditAction.UPDATE,
          resourceId: existingInvoice.id,
          resourceName: existingInvoice.invoiceNumber,
          description: `Recorded a refund of ${refund.amount} paid back on ${existingInvoice.invoiceNumber}`,
          newValues: {
            refund: refund.amount,
            paymentMethod: data.paymentMethod,
            paidDate: data.paidDate,
            reference: data.reference ?? null,
            refundDue: refund.refundDue,
          },
        });
        result = await db.invoice.findFirst({ where: { id: existingInvoice.id } });
        break;
      }

      case "send_reminder": {
        const sent = await sendManualInvoiceReminder(existingInvoice.id);
        if (!sent.ok) return createErrorResponse(sent.error, sent.status);
        result = await db.invoice.findFirst({ where: { id: existingInvoice.id } });
        break;
      }

      case "mark_sent":
        result = await handleMarkSent(existingInvoice, data);
        break;

      default:
        return createErrorResponse("Invalid operation", 400);
    }

    return createSuccessResponse(result, "Invoice updated successfully");
  } catch (error) {
    return handleApiError(error, "Failed to update invoice");
  }
}

const invoiceReadPermissions: string[] = [...INVOICE_READ_PERMISSIONS];
const invoiceWritePermissions: string[] = [...INVOICE_EDIT_PERMISSIONS];
const invoiceDeletePermissions: string[] = [...INVOICE_DELETE_PERMISSIONS];
/**
 * Recording a payment against an installment is the "Add" of payments, so a
 * role given `payment_create` alone can do it — and only it: the invoice's
 * other operations (reminders, marking it sent) stay with the invoice rights.
 * Edit invoices does not record payments: that is money, and its own right.
 */
const invoicePaymentPermissions: string[] = [...INVOICE_PAYMENT_PERMISSIONS];
const invoicePatchPermissions = [
  ...new Set([...invoiceWritePermissions, ...invoicePaymentPermissions]),
];

export const GET = withPermissionAndDB(invoiceReadPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    getInvoice(user, request, context),
);
export const PUT = withPermissionAndDB(invoiceWritePermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    updateInvoice(user, request, context),
);
export const DELETE = withPermissionAndDB(invoiceDeletePermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    deleteInvoice(user, request, context),
);
export const PATCH = withPermissionAndDB(invoicePatchPermissions)(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    patchInvoice(user, request, context),
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function handleAddPayment(
  invoice: InvoiceRow,
  data: z.infer<typeof addPaymentDataSchema>,
  user: AuthenticatedAccessUser,
) {
  // addPaymentDataSchema admits only the methods staff record with. Anything
  // else used to be recorded as cash — wrong money on the owner statement,
  // since cash to the owner settles the other way.
  //
  // One transaction: the payment, what it paid and the installment's new
  // balance. The date is the one the office entered — it used to be pushed
  // forward to the moment of saving, which put a transfer that arrived last
  // week into this week's collections.
  return recordInstallmentPayment({
    invoiceId: invoice.id,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    paidDate: data.paidDate,
    reference: data.transactionId ?? data.reference,
    notes: data.notes,
    convertPaymentId: data.paymentId,
    recordedBy: user.id,
  });
}

async function handleMarkSent(invoice: InvoiceRow, _data: any) {
  // Mark invoice as sent (status moves scheduled → issued)
  return db.invoice.update({
    where: { id: invoice.id },
    data: {
      emailSent: true,
      emailSentDate: new Date(),
      ...(invoice.status === InvoiceStatus.SCHEDULED
        ? { status: InvoiceStatus.ISSUED }
        : {}),
    },
  });
}
