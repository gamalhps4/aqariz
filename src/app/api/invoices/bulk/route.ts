/**
 * PropertyPro - Invoice Bulk Operations API
 * Handle bulk operations on multiple invoices
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { invoiceScope } from "@/lib/db/scopes";
import { InvoiceStatus } from "@/types";
import { dbIdSchema, manualPaymentMethodSchema, validateSchema } from "@/lib/validations";
import {
  InstallmentPaymentError,
  recordInstallmentPayment,
} from "@/lib/services/payment-invoice-linking.service";
import { renderAndStoreInvoicePdf } from "@/lib/services/invoice-pdf.service";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { sendManualInvoiceReminder } from "@/lib/invoice/reminder";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { officeName } from "@/lib/messaging/events";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";

const bulkOperationSchema = z.object({
  operation: z.enum([
    "mark_paid",
    "send_reminders",
    "update_status",
    "generate_pdfs",
    "delete",
  ]),
  invoiceIds: z
    .array(dbIdSchema)
    .min(1, "Invoice IDs are required"),
  data: z.record(z.unknown()).default({}),
});

// Per-operation payload validation for the money/state-touching operations.
const bulkDataSchemas: Partial<Record<string, z.ZodTypeAny>> = {
  mark_paid: z.object({
    paymentMethod: manualPaymentMethodSchema,
    paidDate: z.coerce.date().default(() => new Date()),
  }),
  send_reminders: z.object({
    type: z.string().max(100).default("reminder"),
    method: z.string().max(100).default("email"),
  }),
  update_status: z.object({
    // Only the statuses an office decides. Paid and partly paid are what the
    // recorded payments add up to, and overdue is the due date passing; this
    // used to accept "paid" and write the invoice's whole total as collected
    // with no payment behind it — money that showed in every statement and
    // could never be reversed.
    status: z.enum(
      [InvoiceStatus.SCHEDULED, InvoiceStatus.ISSUED, InvoiceStatus.CANCELLED],
      {
        errorMap: () => ({
          message:
            "Paid, partly paid and overdue follow from payments and due dates, so they cannot be set by hand. Record a payment instead.",
        }),
      },
    ),
  }),
  delete: z.object({}),
};

interface BulkResults {
  successful: Array<Record<string, unknown>>;
  failed: Array<{ invoiceId: string; error: string }>;
  totalProcessed: number;
}

function newBulkResults(): BulkResults {
  return {
    successful: [],
    failed: [],
    totalProcessed: 0,
  };
}

// ============================================================================
// POST /api/invoices/bulk - Perform bulk operations on invoices
// ============================================================================
async function performBulkInvoiceOperation(
  user: AuthenticatedAccessUser,
  request: NextRequest,
) {
  try {
    const body = await request.json();

    const envelope = validateSchema(bulkOperationSchema, body);
    if (!envelope.success) {
      return createErrorResponse(envelope.errors.join(", "), 400);
    }
    const { operation, invoiceIds: ids } = envelope.data;
    let data: any = envelope.data.data;

    // Validate the operation-specific payload
    const dataSchema = bulkDataSchemas[operation];
    if (dataSchema) {
      const dataValidation = validateSchema(dataSchema, data);
      if (!dataValidation.success) {
        return createErrorResponse(dataValidation.errors.join(", "), 400);
      }
      data = dataValidation.data;
    }

    // Narrowed once, here, rather than inside each of the six helpers below.
    // Resolving which of the requested invoices this caller may actually
    // touch — and passing only those on — means every operation inherits the
    // rule, and a helper added later cannot forget it.
    //
    // Ids the caller may not reach are dropped rather than rejected: a bulk
    // action over a screenful of invoices should do what it can, and telling
    // the caller *which* ids were refused would report the existence of rows
    // they cannot see.
    const reachable = await db.invoice.findMany({
      where: { id: { in: ids }, ...invoiceScope(user) },
      select: { id: true },
    });
    const scopedIds = reachable.map((invoice) => invoice.id);

    if (scopedIds.length === 0) {
      return createErrorResponse("No matching invoices found", 404);
    }

    let result;

    switch (operation) {
      case "mark_paid":
        result = await bulkMarkAsPaid(scopedIds, data, user);
        break;

      case "send_reminders":
        result = await bulkSendReminders(scopedIds, data);
        break;

      case "update_status":
        result = await bulkUpdateStatus(scopedIds, data);
        // Cancelling an installment takes it off the books.
        postAfterCommit("invoice", scopedIds, { userId: user.id });
        break;

      case "generate_pdfs":
        result = await bulkGeneratePDFs(scopedIds, data);
        break;

      case "delete":
        result = await bulkDelete(scopedIds, data);
        postAfterCommit("invoice", scopedIds, { userId: user.id });
        break;

      default:
        return createErrorResponse("Invalid operation", 400);
    }

    return createSuccessResponse(
      result,
      `Bulk ${operation} completed successfully`
    );
  } catch (error) {
    return handleApiError(error, "Failed to perform bulk operation");
  }
}

export const POST = withPermissionAndDB([
  "financial_management",
  "payment_processing",
  "bulk_operations",
], { requireAllPermissions: true })(
  async (user: AuthenticatedAccessUser, request: NextRequest) =>
    performBulkInvoiceOperation(user, request),
);

// ============================================================================
// BULK OPERATION FUNCTIONS
// ============================================================================

async function bulkMarkAsPaid(
  invoiceIds: string[],
  data: any,
  user: AuthenticatedAccessUser,
) {
  const { paymentMethod = "cash", paidDate = new Date() } = data;

  const results = newBulkResults();

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await db.invoice.findFirst({
        where: { id: invoiceId, deletedAt: null },
        select: { invoiceNumber: true, balanceRemaining: true },
      });
      if (!invoice) {
        results.failed.push({ invoiceId, error: "Invoice not found" });
        results.totalProcessed++;
        continue;
      }

      // The same path a single payment takes (recordInstallmentPayment): one
      // transaction, the version-claimed apply, the allocation that lets the
      // payment be deleted again, and the history entry. This used to write
      // its own payment without an allocation or history, so a bulk payment
      // looked different from every other one and could not be undone the
      // same way. The balance is re-checked inside the transaction, so a
      // payment that lands in between fails this invoice rather than
      // overpaying it.
      const amount = Number(invoice.balanceRemaining);
      await recordInstallmentPayment({
        invoiceId,
        amount,
        paymentMethod,
        paidDate: new Date(paidDate),
        notes: "Recorded in bulk",
        recordedBy: user.id,
      });

      results.successful.push({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        amountPaid: amount,
      });
    } catch (error) {
      results.failed.push({
        invoiceId,
        error:
          error instanceof InstallmentPaymentError || error instanceof Error
            ? error.message
            : "Unknown error",
      });
    }
    results.totalProcessed++;
  }

  return results;
}

async function bulkSendReminders(invoiceIds: string[], data: any) {
  const { type = "reminder" } = data;

  const results = newBulkResults();
  // One office per request: its language and name are the same for every row.
  const context = { locale: await recipientLocale(), office: await officeName() };
  const now = new Date();

  for (const invoiceId of invoiceIds) {
    try {
      const sent = await sendManualInvoiceReminder(invoiceId, {
        now,
        kind: type,
        context,
      });
      if (!sent.ok) {
        results.failed.push({ invoiceId, error: sent.error });
      } else {
        results.successful.push({
          invoiceId,
          invoiceNumber: sent.invoiceNumber,
          reminderType: type,
        });
      }
    } catch (error) {
      results.failed.push({
        invoiceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    results.totalProcessed++;
  }

  return results;
}

async function bulkUpdateStatus(invoiceIds: string[], data: any) {
  const { status } = data;

  if (!status || !Object.values(InvoiceStatus).includes(status)) {
    throw new Error("Valid status is required");
  }

  const results = newBulkResults();

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await db.invoice.findFirst({ where: { id: invoiceId } });
      if (!invoice) {
        results.failed.push({ invoiceId, error: "Invoice not found" });
        continue;
      }

      const oldStatus = invoice.status;
      // An invoice with money recorded against it keeps the status that
      // money gives it: cancelling it would strand the payment, and moving
      // it back to scheduled or issued would contradict it. Delete the
      // payment first (which reverses it), then change the status.
      if (Number(invoice.amountPaid ?? 0) > 0) {
        results.failed.push({
          invoiceId,
          error:
            "This invoice has payments recorded against it. Delete them first, then change its status.",
        });
        results.totalProcessed++;
        continue;
      }
      await db.invoice.update({
        where: { id: invoice.id },
        data: { status },
      });

      results.successful.push({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        oldStatus,
        newStatus: status,
      });
    } catch (error) {
      results.failed.push({
        invoiceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    results.totalProcessed++;
  }

  return results;
}

async function bulkGeneratePDFs(invoiceIds: string[], _data: any) {
  const results = newBulkResults();

  for (const invoiceId of invoiceIds) {
    try {
      // Actually render each invoice and store the PDF in R2; the invoice row
      // only gets pdfGenerated/pdfPath after a successful upload (a fabricated
      // "/invoices/{id}.pdf" used to be written here without generating
      // anything, so every download 404'd).
      const stored = await renderAndStoreInvoicePdf(invoiceId);

      if (!stored.success || !stored.pdfPath) {
        results.failed.push({
          invoiceId,
          error: stored.error ?? "Failed to generate PDF",
        });
      } else {
        results.successful.push({
          invoiceId,
          invoiceNumber: stored.invoiceNumber,
          pdfPath: stored.pdfPath,
        });
      }
    } catch (error) {
      results.failed.push({
        invoiceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    results.totalProcessed++;
  }

  return results;
}

async function bulkDelete(invoiceIds: string[], _data: any) {
  const results = newBulkResults();

  for (const invoiceId of invoiceIds) {
    try {
      const invoice = await db.invoice.findFirst({ where: { id: invoiceId } });
      if (!invoice) {
        results.failed.push({ invoiceId, error: "Invoice not found" });
        continue;
      }

      // No override: deleting an invoice with money against it strands the
      // payment — it stays counted as collected, pointing at nothing. The
      // payment is deleted first (which reverses it), then the invoice.
      if (invoice.amountPaid > 0) {
        results.failed.push({
          invoiceId,
          error:
            "This invoice has payments recorded against it. Delete them first, then the invoice.",
        });
        continue;
      }

      // Soft delete
      const deletedAt = new Date();
      await db.invoice.update({
        where: { id: invoice.id },
        data: { deletedAt },
      });

      results.successful.push({
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        deletedAt,
      });
    } catch (error) {
      results.failed.push({
        invoiceId,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
    results.totalProcessed++;
  }

  return results;
}
