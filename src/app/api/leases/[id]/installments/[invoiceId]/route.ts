/**
 * PropertyPro - Edit or remove one lease installment
 *
 * Generated installments are editable: a schedule is a starting point, and
 * offices routinely adjust an amount or shift a due date after agreeing it
 * with the tenant. What is never editable is an installment that has already
 * taken money — reducing a paid installment below what was collected would
 * leave the ledger describing a payment that cannot exist.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseScope, type ScopeActor } from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { InvoiceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
  isValidObjectId,
} from "@/lib/api-utils";
import { validateSchema } from "@/lib/validations";
import { taxFor } from "@/lib/lease-installments";
import { computeInvoiceDerivedState } from "@/lib/services/payment-invoice-linking.service";
import { EDIT_INSTALLMENT_PERMISSIONS } from "@/lib/contract-rights";
import { AuditAction, auditRecordChange } from "@/lib/audit-domain";
import { postAfterCommit } from "@/lib/accounting/hooks";

const editInstallmentSchema = z
  .object({
    amount: z
      .number()
      .min(0, "Amount cannot be negative")
      .max(10_000_000, "Amount too large")
      .optional(),
    dueDate: z.coerce.date().optional(),
    description: z.string().min(1).max(200).optional(),
    /** Override the contract's tax setting for this installment. */
    applyTax: z.boolean().optional(),
    notes: z.string().max(1000).nullable().optional(),
  })
  .refine(
    (data) =>
      data.amount !== undefined ||
      data.dueDate !== undefined ||
      data.description !== undefined ||
      data.applyTax !== undefined ||
      data.notes !== undefined,
    { message: "Nothing to update" },
  );

type LoadedInstallment =
  | { ok: false; error: string }
  | {
      ok: true;
      lease: NonNullable<Awaited<ReturnType<typeof db.lease.findFirst>>>;
      invoice: NonNullable<Awaited<ReturnType<typeof db.invoice.findFirst>>>;
    };

async function loadInstallment(
  leaseId: string,
  invoiceId: string,
  actor: ScopeActor,
): Promise<LoadedInstallment> {
  // Scoped: a lease outside this caller's buildings does not resolve, and the
  // "Lease not found" below is the same reply a missing id gets.
  const lease = await db.lease.findFirst({
    where: { id: leaseId, ...leaseScope(actor) },
  });
  if (!lease) return { ok: false, error: "Lease not found" };

  // Scoped to the lease, so an installment id from another contract 404s
  // rather than being edited through this contract's endpoint.
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, leaseId },
  });
  if (!invoice) return { ok: false, error: "Installment not found" };

  return { ok: true, lease, invoice };
}

// ============================================================================
// PATCH /api/leases/[id]/installments/[invoiceId]
// ============================================================================

export const PATCH = withPermissionAndDB([...EDIT_INSTALLMENT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string; invoiceId: string }> },
  ) => {
    try {
      const { id, invoiceId } = await params;
      if (!isValidObjectId(id) || !isValidObjectId(invoiceId)) {
        return createErrorResponse("Invalid identifier", 400);
      }

      const loaded = await loadInstallment(id, invoiceId, user);
      if (!loaded.ok) {
        return createErrorResponse(loaded.error, 404);
      }
      const { lease, invoice } = loaded;

      if (invoice.status === InvoiceStatus.CANCELLED) {
        return createErrorResponse(
          "This installment is cancelled and can no longer be edited",
          409,
        );
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(editInstallmentSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const input = validation.data;
      const existingLine = (invoice.lineItems as any[])?.[0] ?? {};

      const subtotal =
        input.amount !== undefined ? input.amount : invoice.subtotal;
      const description = input.description ?? existingLine.description ?? "Rent";
      const dueDate = input.dueDate ?? invoice.dueDate;

      // Recompute tax from the amount rather than carrying the old figure —
      // an edited installment whose tax still reflected the previous rent
      // would bill a total that does not add up.
      const applyTax =
        input.applyTax ?? (invoice.taxAmount > 0 || Boolean(lease.taxEnabled));
      const taxAmount = taxFor(subtotal, applyTax, Number(lease.taxRate));

      const lineItems = [
        {
          ...existingLine,
          description,
          amount: subtotal,
          quantity: 1,
          unitPrice: subtotal,
          dueDate,
        },
      ];

      const derived = computeInvoiceDerivedState({
        lineItems,
        taxAmount,
        discountAmount: invoice.discountAmount,
        amountPaid: invoice.amountPaid,
        dueDate,
        issueDate: invoice.issueDate,
        status: invoice.status,
      });

      // Money already collected sets the floor: an installment cannot be
      // rewritten to be worth less than what the tenant has paid into it.
      if (derived.totalAmount < invoice.amountPaid) {
        return createErrorResponse(
          `This installment already has ${invoice.amountPaid} paid against it — the new total cannot be lower`,
          409,
        );
      }

      const updated = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          dueDate,
          subtotal: derived.subtotal,
          taxAmount,
          totalAmount: derived.totalAmount,
          balanceRemaining: derived.balanceRemaining,
          status: derived.status,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          lineItems: lineItems as unknown as Prisma.InputJsonValue,
          metadata: {
            ...((invoice.metadata as Record<string, unknown>) ?? {}),
            edited: true,
          } as unknown as Prisma.InputJsonValue,
        },
      });

      auditRecordChange({
        action: AuditAction.UPDATE,
        recordType: "invoice",
        recordId: invoiceId,
        recordName: invoice.invoiceNumber,
        before: invoice as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
        keys: ["dueDate", "subtotal", "taxAmount", "totalAmount", "balanceRemaining", "status", "notes"],
        details: { leaseId: lease.id, contractNumber: lease.contractNumber ?? undefined },
        messageParams: { contractNumber: lease.contractNumber ?? undefined },
      });

      postAfterCommit("invoice", invoiceId);

      return createSuccessResponse(
        { invoice: updated },
        "Installment updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update installment");
    }
  },
);

// ============================================================================
// DELETE /api/leases/[id]/installments/[invoiceId]
// ============================================================================

export const DELETE = withPermissionAndDB([...EDIT_INSTALLMENT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string; invoiceId: string }> },
  ) => {
    try {
      const { id, invoiceId } = await params;
      if (!isValidObjectId(id) || !isValidObjectId(invoiceId)) {
        return createErrorResponse("Invalid identifier", 400);
      }

      const loaded = await loadInstallment(id, invoiceId, user);
      if (!loaded.ok) {
        return createErrorResponse(loaded.error, 404);
      }
      const { invoice, lease } = loaded;

      // Anything already collected must stay visible in the ledger.
      if (invoice.amountPaid > 0) {
        return createErrorResponse(
          "This installment has payments against it and cannot be removed",
          409,
        );
      }

      // Cancelled, not deleted: the schedule keeps a record that this
      // installment existed and was withdrawn.
      const cancelled = await db.invoice.update({
        where: { id: invoiceId },
        data: {
          status: InvoiceStatus.CANCELLED,
          balanceRemaining: 0,
        },
      });

      // Withdrawn from the schedule: recorded as the deletion it is to the
      // office, with the figures it carried.
      auditRecordChange({
        action: AuditAction.DELETE,
        recordType: "invoice",
        recordId: invoiceId,
        recordName: invoice.invoiceNumber,
        before: invoice as unknown as Record<string, unknown>,
        after: cancelled as unknown as Record<string, unknown>,
        keys: ["status", "balanceRemaining", "totalAmount", "dueDate"],
        details: { leaseId: lease.id, contractNumber: lease.contractNumber ?? undefined },
        messageParams: { contractNumber: lease.contractNumber ?? undefined },
      });

      postAfterCommit("invoice", invoiceId);

      return createSuccessResponse(
        { invoice: cancelled },
        "Installment cancelled successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to remove installment");
    }
  },
);
