/**
 * PropertyPro - Lease installment schedule API
 *
 * GET  — every installment on the contract with due date, paid and overdue
 *        state, including the ones the contract calls for but has not billed,
 *        and apart from them the charges added by hand; with what the caller
 *        may do about them.
 * POST — add an extra installment by hand (a one-off charge outside the
 *        generated schedule).
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseScope } from "@/lib/db/scopes";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { Prisma } from "@/generated/prisma/client";
import { InvoiceStatus, InvoiceType } from "@/types";
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
import { validateSchema } from "@/lib/validations";
import { AuditAction, pickSnapshot, recordActivity } from "@/lib/audit-domain";
import { postAfterCommit } from "@/lib/accounting/hooks";
import {
  LEASE_READ_ACCESS,
  canManageLeases,
  isLeaseTenantUser,
} from "@/lib/lease-access";
import { getInstallmentSchedule } from "@/lib/services/lease-installments.service";
import {
  EDIT_INSTALLMENT_PERMISSIONS,
  contractRights,
} from "@/lib/contract-rights";
import type { InstallmentRow, ScheduleViewerRights } from "@/types/installment";
import { taxFor } from "@/lib/lease-installments";
import { computeInvoiceDerivedState } from "@/lib/services/payment-invoice-linking.service";
import { createWithInvoiceNumber } from "@/lib/services/invoice-number.service";
import { businessDay, businessToday } from "@/lib/dates/business-day";
import { describeCharge } from "@/lib/i18n/charge-description";

const extraInstallmentSchema = z.object({
  description: z.string().min(1, "Description is required").max(200),
  amount: z
    .number()
    .min(0.01, "Amount must be greater than zero")
    .max(10_000_000, "Amount too large"),
  dueDate: z.coerce.date({
    required_error: "Due date is required",
    invalid_type_error: "Invalid due date",
  }),
  /** Defaults to the contract's own tax setting. */
  applyTax: z.boolean().optional(),
  notes: z.string().max(1000).optional(),
});

/**
 * A row's status as the export writes it: the states the screen shows, with
 * a row not billed yet told apart by whether its due date has passed.
 */
function exportStatus(row: InstallmentRow): string {
  if (row.state !== "planned") return row.state;
  return row.dueDatePassed ? "not_billed_past_due" : "not_billed";
}

// ============================================================================
// GET /api/leases/[id]/installments
// ============================================================================

export const GET = withAccessAndDB(LEASE_READ_ACCESS)(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Scoped: a lease in a building this caller does not hold does not
      // resolve, and the 404 below answers — the same reply an id that never
      // existed gets.
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
        select: { id: true, tenantId: true },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      // A tenant may read their own contract's schedule; nobody else's.
      if (!canManageLeases(user) && !isLeaseTenantUser(user, lease)) {
        return createErrorResponse("Access denied", 403);
      }

      const schedule = await getInstallmentSchedule(id);
      if (!schedule) {
        return createErrorResponse("Lease not found", 404);
      }

      // The schedule the screen shows, as a file. One contract's
      // installments and nothing else — which is the separation the review
      // asked for, enforced by the lookup above rather than by a filter the
      // export could forget.
      const rawFormat = new URL(request.url).searchParams.get("format");
      if (rawFormat) {
        // Export is its own permission, not a by-product of being able to
        // read the schedule — see canExport.
        if (!canExport(user, "lease_export", "lease_management")) {
          return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
        }
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }
        const searchParams = new URL(request.url).searchParams;
        const exportLanguage = reportLanguage(searchParams);
        const sheet: ReportSheet<InstallmentRow> = {
          title: "Installments",
          columns: [
            // Numbered the way the review asked: installment 1, 2, 3 — not
            // an invoice id nobody reads out loud. Charges added by hand are
            // not installments of the schedule and carry no number.
            {
              header: "#",
              value: (row) =>
                row.source === "manual" || row.source === "orphaned"
                  ? ""
                  : row.index,
            },
            { header: "Due date", value: (row) => businessDay(row.dueDate) },
            { header: "Invoice", value: (row) => row.invoiceNumber ?? "" },
            // The generators stored English ("Monthly Rent"); the file says
            // it in the reader's language, with the billing period the
            // file has no column of its own for. Typed text stays as typed.
            {
              header: "Description",
              value: (row) =>
                describeCharge(
                  {
                    description: row.description,
                    periodStart: row.periodStart,
                    periodEnd: row.periodEnd,
                    frequency: schedule.summary.frequency,
                  },
                  exportLanguage,
                ),
            },
            { header: "Amount", value: (row) => row.totalAmount },
            { header: "Tax", value: (row) => row.taxAmount },
            { header: "Paid", value: (row) => row.amountPaid },
            { header: "Remaining", value: (row) => row.balanceRemaining },
            { header: "Status", value: exportStatus },
          ],
          rows: [...schedule.installments, ...schedule.charges],
          summary: [
            ["Installments", schedule.summary.totalInstallments],
            ["Contract value", schedule.summary.contractValue],
            ["Other charges", schedule.summary.chargesTotal],
            ["Billed", schedule.summary.billedTotal],
            ["Collected", schedule.summary.collectedTotal],
            ["Outstanding", schedule.summary.outstandingTotal],
            ["Overdue", schedule.summary.overdueTotal],
            ["Currency", schedule.summary.currency],
          ],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang: exportLanguage,
          fileName: "Installments",
          dateStamp: businessToday(),
        });
      }

      // What this caller may do on the schedule, from their resolved
      // permissions — per-person grants and denials included, which the
      // browser's copy of the role's permissions leaves out. The screen draws
      // its buttons from this rather than guessing.
      const viewer: ScheduleViewerRights = {
        ...contractRights(user),
        exportSchedule:
          !user.isTenant && canExport(user, "lease_export", "lease_management"),
      };

      return createSuccessResponse(
        { ...schedule, viewer },
        "Installment schedule retrieved successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to retrieve installment schedule");
    }
  },
);

// ============================================================================
// POST /api/leases/[id]/installments - add an extra installment manually
// ============================================================================

export const POST = withPermissionAndDB([...EDIT_INSTALLMENT_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid lease ID", 400);
      }

      // Scoped: a lease in a building this caller does not hold does not
      // resolve, and the 404 below answers — the same reply an id that never
      // existed gets.
      const lease = await db.lease.findFirst({
        where: { id, ...leaseScope(user) },
      });
      if (!lease) {
        return createErrorResponse("Lease not found", 404);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(extraInstallmentSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const input = validation.data;
      const applyTax = input.applyTax ?? Boolean(lease.taxEnabled);
      const taxAmount = taxFor(input.amount, applyTax, Number(lease.taxRate));

      const lineItems = [
        {
          description: input.description,
          amount: input.amount,
          type: InvoiceType.RENT,
          quantity: 1,
          unitPrice: input.amount,
          dueDate: input.dueDate,
        },
      ];

      const derived = computeInvoiceDerivedState({
        lineItems,
        taxAmount,
        discountAmount: 0,
        amountPaid: 0,
        dueDate: input.dueDate,
        issueDate: new Date(),
        status: InvoiceStatus.ISSUED,
      });

      // periodStart is deliberately left null. It is the key behind the
      // (leaseId, category, periodStart) partial unique that makes generation
      // idempotent; a manual charge belongs to no billing period and must not
      // collide with — or be mistaken for — a generated installment.
      const invoice = await createManualInstallment(lease, {
        dueDate: input.dueDate,
        status: derived.status,
        subtotal: derived.subtotal,
        taxAmount,
        totalAmount: derived.totalAmount,
        balanceRemaining: derived.balanceRemaining,
        lineItems,
        notes: input.notes,
      });

      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "invoice",
        recordId: invoice.id,
        recordName: invoice.invoiceNumber,
        after: pickSnapshot(invoice as unknown as Record<string, unknown>, [
          "invoiceNumber",
          "dueDate",
          "totalAmount",
          "taxAmount",
          "status",
          "notes",
        ]),
        details: { leaseId: lease.id, contractNumber: lease.contractNumber ?? undefined },
        messageParams: { contractNumber: lease.contractNumber ?? undefined },
      });
      postAfterCommit("invoice", invoice.id);

      return createSuccessResponse(
        { invoice },
        "Installment added successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to add installment");
    }
  },
);

/**
 * Insert the manual installment under the next RENT number — the same
 * allocator the schedule's own billing uses, so the two share one sequence
 * and neither is thrown by the gaps a permanent delete leaves.
 */
async function createManualInstallment(
  lease: { id: string; organizationId: string; tenantId: string; propertyId: string; unitId: string; currency: string },
  data: {
    dueDate: Date;
    status: string;
    subtotal: number;
    taxAmount: number;
    totalAmount: number;
    balanceRemaining: number;
    lineItems: unknown[];
    notes?: string;
  },
) {
  return createWithInvoiceNumber(lease.organizationId, "RENT", (invoiceNumber) =>
    db.invoice.create({
      data: {
        organizationId: lease.organizationId,
        invoiceNumber,
        tenantId: lease.tenantId,
        propertyId: lease.propertyId,
        leaseId: lease.id,
        unitId: lease.unitId,
        category: InvoiceType.RENT,
        periodStart: null,
        issueDate: new Date(),
        dueDate: data.dueDate,
        status: data.status,
        currency: lease.currency,
        subtotal: data.subtotal,
        taxAmount: data.taxAmount,
        totalAmount: data.totalAmount,
        amountPaid: 0,
        balanceRemaining: data.balanceRemaining,
        notes: data.notes,
        lineItems: data.lineItems as unknown as Prisma.InputJsonValue,
        metadata: {
          source: "manual",
        } as unknown as Prisma.InputJsonValue,
      },
    }),
  );
}
