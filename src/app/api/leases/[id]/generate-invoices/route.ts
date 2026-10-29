/**
 * PropertyPro - Lease Invoice Generation API
 * API endpoint to generate invoices for a specific lease
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { leaseScope } from "@/lib/db/scopes";
import { billLeaseInstallments } from "@/lib/services/lease-lifecycle.service";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import {
  INSTALLMENT_GENERATION_PERMISSIONS,
  awaitsActivation,
} from "@/lib/lease-lifecycle";
import { validateSchema } from "@/lib/validations";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
  type AuthenticatedAccessUser,
} from "@/lib/api-utils";

// The defaults are what coming into force bills on its own: the rent
// installments, issued, with nothing emailed and no deposit. This route is
// the schedule's "Generate installments" action — the way to finish a
// contract whose automatic billing failed or predates it — so an empty body
// must do exactly what activation would have done.
const generateInvoicesSchema = z.object({
  generateOnLeaseCreation: z.boolean().default(true),
  generateMonthlyRent: z.boolean().default(true),
  generateSecurityDeposit: z.boolean().default(false),
  advanceMonths: z.coerce.number().int().min(0).max(24).default(0),
  gracePeriodDays: z.coerce.number().int().min(0).max(90).default(5),
  autoIssue: z.boolean().default(true),
  autoEmail: z.boolean().default(false),
});

// ============================================================================
// POST /api/leases/[id]/generate-invoices - Generate invoices for lease
// ============================================================================
async function generateLeaseInvoices(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leaseId } = await params;

    if (!isValidObjectId(leaseId)) {
      return createErrorResponse("Invalid lease ID", 400);
    }

    // Verify lease exists
    // Scoped: a lease outside this caller's buildings does not resolve, so
    // the 404 below answers — the same reply an id that never existed gets.
    const lease = await db.lease.findFirst({
      where: { id: leaseId, ...leaseScope(user) },
    });
    if (!lease) {
      return createErrorResponse("Lease not found", 404);
    }

    // No body is a valid request: it asks for the defaults above.
    const body = await request.json().catch(() => ({}));

    const validation = validateSchema(generateInvoicesSchema, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    // The same rule, and the same generator, as automatic billing: each
    // period is invoiced once, so pressing this twice bills nothing twice.
    const result = await billLeaseInstallments(lease, validation.data);

    // Not billable. A draft owes nothing until it comes into force — and is
    // billed the moment it does; a cancelled contract's unbilled periods were
    // cancelled with it.
    if (!result) {
      return createErrorResponse(
        awaitsActivation(lease.status)
          ? "This contract is not active yet. Its installments are billed when it becomes active."
          : "Installments cannot be generated for a cancelled contract.",
        409
      );
    }

    // Nothing billed and something wrong is a failure. A partial result is
    // returned as it stands, errors included, so the caller can show both
    // what was billed and what was not.
    if (result.invoicesGenerated === 0 && result.errors.length > 0) {
      return createErrorResponse(
        `Invoice generation failed: ${result.errors.join(", ")}`,
        400
      );
    }

    const terms = lease.terms as any;

    void recordActivity({
      action: AuditAction.GENERATE,
      recordType: "lease",
      recordId: lease.id,
      recordName: lease.contractNumber,
      messageParams: { count: result.invoicesGenerated },
      details: {
        installmentsGenerated: result.invoicesGenerated,
        ...(result.errors.length ? { errors: result.errors.slice(0, 5) } : {}),
      },
    });

    return createSuccessResponse(
      {
        invoicesGenerated: result.invoicesGenerated,
        invoiceIds: result.invoiceIds,
        errors: result.errors,
        lease: {
          id: lease.id,
          startDate: lease.startDate,
          endDate: lease.endDate,
          rentAmount: terms?.rentAmount,
        },
      },
      `Successfully generated ${result.invoicesGenerated} invoices`
    );
  } catch (error) {
    return handleApiError(error, "Failed to generate invoices");
  }
}

// ============================================================================
// GET /api/leases/[id]/generate-invoices - Preview invoice generation
// ============================================================================
async function previewLeaseInvoices(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leaseId } = await params;

    if (!isValidObjectId(leaseId)) {
      return createErrorResponse("Invalid lease ID", 400);
    }

    // Verify lease exists
    // Scoped: a lease outside this caller's buildings does not resolve, so
    // the 404 below answers — the same reply an id that never existed gets.
    const lease = await db.lease.findFirst({
      where: { id: leaseId, ...leaseScope(user) },
      include: {
        tenant: { select: { id: true, firstName: true, lastName: true } },
        property: { select: { id: true, name: true } },
      },
    });
    if (!lease) {
      return createErrorResponse("Lease not found", 404);
    }

    const { searchParams } = new URL(request.url);
    const generateSecurityDeposit =
      searchParams.get("generateSecurityDeposit") === "true";
    const advanceMonths = parseInt(searchParams.get("advanceMonths") || "0");
    const gracePeriodDays = parseInt(
      searchParams.get("gracePeriodDays") || "5"
    );

    const terms = lease.terms as any;

    // Calculate what invoices would be generated
    const preview = calculateInvoicePreview(
      { ...lease, terms },
      {
        generateSecurityDeposit,
        advanceMonths,
        gracePeriodDays,
      }
    );

    return createSuccessResponse(
      {
        lease: {
          id: lease.id,
          tenantName: `${lease.tenant?.firstName ?? ""} ${
            lease.tenant?.lastName ?? ""
          }`.trim(),
          propertyName: lease.property?.name,
          startDate: lease.startDate,
          endDate: lease.endDate,
          rentAmount: terms?.rentAmount,
          securityDeposit: terms?.securityDeposit,
        },
        preview,
      },
      "Invoice generation preview calculated"
    );
  } catch (error) {
    return handleApiError(error, "Failed to calculate invoice preview");
  }
}

export const POST = withPermissionAndDB([
  ...INSTALLMENT_GENERATION_PERMISSIONS,
])(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    generateLeaseInvoices(user, request, context),
);
export const GET = withPermissionAndDB([
  "lease_management",
  "financial_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest, context: any) =>
    previewLeaseInvoices(user, request, context),
);

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

interface InvoicePreviewItem {
  type: string;
  description: string;
  amount: number;
  dueDate: Date;
  issueDate: Date;
}

function calculateInvoicePreview(
  lease: any,
  config: {
    generateSecurityDeposit: boolean;
    advanceMonths: number;
    gracePeriodDays: number;
  }
): {
  totalInvoices: number;
  totalAmount: number;
  invoices: InvoicePreviewItem[];
} {
  const invoices: InvoicePreviewItem[] = [];
  let totalAmount = 0;

  // Security deposit invoice
  if (config.generateSecurityDeposit && lease.terms.securityDeposit > 0) {
    const dueDate = new Date(lease.startDate);
    dueDate.setDate(dueDate.getDate() - 7);

    const issueDate = new Date();

    invoices.push({
      type: "security_deposit",
      description: "Security Deposit",
      amount: lease.terms.securityDeposit,
      dueDate,
      issueDate,
    });

    totalAmount += lease.terms.securityDeposit;
  }

  // Advance payment invoices
  if (config.advanceMonths > 0) {
    const dueDate = new Date(lease.startDate);
    dueDate.setDate(dueDate.getDate() - 7);

    for (let i = 0; i < config.advanceMonths; i++) {
      invoices.push({
        type: "advance_rent",
        description: `Advance Rent Payment - Month ${i + 1}`,
        amount: lease.terms.rentAmount,
        dueDate,
        issueDate: new Date(),
      });

      totalAmount += lease.terms.rentAmount;
    }
  }

  // Monthly rent invoices
  const startDate = new Date(lease.startDate);
  const endDate = new Date(lease.endDate);
  const rentDueDay = lease.terms.paymentConfig?.rentDueDay || 1;

  const currentDate = new Date(startDate);
  currentDate.setDate(rentDueDay);

  if (currentDate < startDate) {
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  while (currentDate <= endDate) {
    const issueDate = new Date(currentDate);
    issueDate.setDate(issueDate.getDate() - 7);

    // Check if this is the first month and needs proration
    const isFirstMonth =
      currentDate.getMonth() === startDate.getMonth() &&
      currentDate.getFullYear() === startDate.getFullYear();

    let rentAmount = lease.terms.rentAmount;
    let description = "Monthly Rent";

    if (isFirstMonth && lease.terms.paymentConfig?.prorationEnabled) {
      const moveInDate = new Date(lease.startDate);
      const monthStart = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth(),
        1
      );
      const monthEnd = new Date(
        currentDate.getFullYear(),
        currentDate.getMonth() + 1,
        0
      );

      const daysInMonth = monthEnd.getDate();
      const daysOccupied = daysInMonth - moveInDate.getDate() + 1;

      const dailyRate = lease.terms.rentAmount / daysInMonth;
      rentAmount = Math.round(dailyRate * daysOccupied * 100) / 100;
      description = "Monthly Rent (Prorated)";
    }

    invoices.push({
      type: "monthly_rent",
      description,
      amount: rentAmount,
      dueDate: new Date(currentDate),
      issueDate,
    });

    totalAmount += rentAmount;
    currentDate.setMonth(currentDate.getMonth() + 1);
  }

  return {
    totalInvoices: invoices.length,
    totalAmount,
    invoices: invoices.sort(
      (a, b) => a.dueDate.getTime() - b.dueDate.getTime()
    ),
  };
}
