/**
 * PropertyPro - Invoice API Routes
 * RESTful API endpoints for invoice management
 *
 * GET lists a tenant's invoices — installments and charges — as it always
 * has; `?party=all` lists everything the office has issued: invoices to
 * owners and to customers who are not tenants, and credit notes, which the
 * accounting invoice screen shows. POST writes a custom invoice or a credit
 * note (lib/invoice/custom-invoice.service.ts).
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countInvoicesThisMonth } from "@/lib/billing/usage";
import {
  applyScope,
  invoiceScope,
  leaseScope,
  withScope,
} from "@/lib/db/scopes";
import { InvoiceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  isValidObjectId,
} from "@/lib/api-utils";
import { recordDomainAudit } from "@/lib/audit-domain";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { AuditAction } from "@/lib/audit-service";
import { computeEffectiveInvoiceStatus } from "@/lib/invoice/invoice-shared";
import { requireOrgId } from "@/lib/tenancy/context";
import {
  INVOICE_BULK_DELETE_PERMISSIONS,
  INVOICE_BULK_EDIT_PERMISSIONS,
  INVOICE_CREATE_PERMISSIONS,
  INVOICE_LIST_PERMISSIONS,
} from "@/lib/finance-permissions";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  EXPORT_ROW_LIMIT,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import {
  customInvoiceSchema,
  fromLegacyInvoiceBody,
} from "@/lib/invoice/custom-invoice-schema";
import { invoicePartyWhere } from "@/lib/invoice/party-filter";
import {
  createCreditNote,
  createCustomInvoice,
  CustomInvoiceError,
} from "@/lib/invoice/custom-invoice.service";
import { defaultVatTreatment } from "@/lib/invoice/vat";
import {
  accountingPhase0Available,
  invoicePhase0Omit,
} from "@/lib/invoice/phase0-columns";
import { businessDay, businessToday } from "@/lib/dates/business-day";

type PropertyAddressRow = {
  addressStreet: string;
  addressCity: string;
  addressState: string;
  addressZipCode: string;
  addressCountry: string;
};

function buildAddress(property: PropertyAddressRow) {
  return {
    street: property.addressStreet,
    city: property.addressCity,
    state: property.addressState,
    zipCode: property.addressZipCode,
    country: property.addressCountry,
  };
}

const invoiceTenantSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  avatar: true,
  deletedAt: true,
} as const;

const invoicePropertySelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
  deletedAt: true,
} as const;

const invoiceLeaseInclude = {
  select: {
    id: true,
    startDate: true,
    endDate: true,
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
} as const;

/** Who an invoice is to, by name: its tenant, or the customer it names. */
function billedName(invoice: {
  tenant?: { firstName?: string | null; lastName?: string | null } | null;
  customerName?: string | null;
}): string {
  const tenant = invoice.tenant
    ? `${invoice.tenant.firstName ?? ""} ${invoice.tenant.lastName ?? ""}`.trim()
    : "";
  return invoice.customerName?.trim() || tenant;
}

/** Rebuild the populated field shapes the Mongoose responses carried. */
function mapInvoiceListRow(invoice: any) {
  const { tenant, property, lease, ...rest } = invoice;
  return {
    ...rest,
    documentType: rest.documentType ?? "invoice",
    customerType: rest.customerType ?? (tenant ? "tenant" : null),
    customerName: billedName(invoice) || null,
    creditedAmount: Number(rest.creditedAmount ?? 0),
    tenantId: tenant
      ? {
          id: tenant.id,
          firstName: tenant.firstName,
          lastName: tenant.lastName,
          email: tenant.email,
          avatar: tenant.avatar,
          deletedAt: tenant.deletedAt,
        }
      : null,
    propertyId: property
      ? {
          id: property.id,
          name: property.name,
          address: buildAddress(property),
          deletedAt: property.deletedAt,
        }
      : null,
    leaseId: lease
      ? {
          id: lease.id,
          startDate: lease.startDate,
          endDate: lease.endDate,
          propertyId: lease.property
            ? {
                id: lease.property.id,
                name: lease.property.name,
                address: buildAddress(lease.property),
              }
            : null,
        }
      : (rest.leaseId ?? null),
  };
}

// ============================================================================
// GET /api/invoices - List invoices with filtering
// ============================================================================
export const GET = withPermissionAndDB([...INVOICE_LIST_PERMISSIONS])(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const requestedTenantId = searchParams.get("tenantId");
    const propertyId = searchParams.get("propertyId");
    const leaseId = searchParams.get("leaseId");
    const status = searchParams.get("status");
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const sortBy = searchParams.get("sortBy") || "dueDate";
    const sortOrder = searchParams.get("sortOrder") || "desc";
    const search = (searchParams.get("search") || "").trim();

    const phase0 = await accountingPhase0Available();
    const omit = await invoicePhase0Omit();

    // Build filter query
    const where: Prisma.InvoiceWhereInput = {};

    // Asking for someone else's invoices is answered honestly with a 403
    // rather than an empty list; the scope below is what actually enforces it.
    if (user.isTenant && requestedTenantId && requestedTenantId !== user.id) {
      return createErrorResponse("You can only view your own invoices", 403);
    }
    const party = invoicePartyWhere(searchParams, phase0);
    if ("error" in party) {
      return createErrorResponse(String(party.error), 400);
    }
    Object.assign(where, party);
    if (requestedTenantId) {
      where.tenantId = requestedTenantId;
    }
    // See lib/db/scopes.ts.
    applyScope(where, invoiceScope(user));

    if (propertyId) where.propertyId = propertyId;
    if (leaseId) where.leaseId = leaseId;
    if (status) {
      where.status = status;
    } else if (!searchParams.get("party")) {
      // Exclude fully paid invoices by default so only actionable items appear
      where.balanceRemaining = { gt: 0 };
    }

    if (search) {
      where.OR = [
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { notes: { contains: search, mode: "insensitive" } },
        { tenant: { firstName: { contains: search, mode: "insensitive" } } },
        { tenant: { lastName: { contains: search, mode: "insensitive" } } },
        { tenant: { email: { contains: search, mode: "insensitive" } } },
        { property: { name: { contains: search, mode: "insensitive" } } },
        ...(phase0
          ? [{ customerName: { contains: search, mode: "insensitive" as const } }]
          : []),
      ];
    }

    // `?format=` downloads the list as filtered — the same `where`, so the
    // file holds exactly what the screen does. Export is its own permission,
    // not a by-product of being able to read the list.
    const rawFormat = searchParams.get("format");
    if (rawFormat) {
      if (!canExport(user, "invoice_export", "financial_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (!isReportFormat(rawFormat)) {
        return createErrorResponse(
          `Unsupported export format "${rawFormat}"`,
          400
        );
      }
      const rows = await db.invoice.findMany({
        where,
        omit,
        include: {
          tenant: { select: invoiceTenantSelect },
          property: { select: invoicePropertySelect },
        },
        orderBy: { [sortBy]: sortOrder === "desc" ? "desc" : "asc" },
        take: EXPORT_ROW_LIMIT,
      });
      const now = new Date();
      const sheet: ReportSheet<(typeof rows)[number]> = {
        title: "Invoices",
        columns: [
          { header: "Invoice", value: (row) => row.invoiceNumber },
          {
            header: "Document",
            value: (row) =>
              (row as { documentType?: string }).documentType === "credit_note"
                ? "credit_note"
                : "invoice",
          },
          {
            header: "Customer",
            value: (row) =>
              billedName(row as Parameters<typeof billedName>[0]),
          },
          {
            header: "VAT number",
            value: (row) =>
              (row as { customerVatNumber?: string | null }).customerVatNumber ?? "",
          },
          { header: "Building", value: (row) => row.property?.name ?? "" },
          { header: "Category", value: (row) => row.category },
          { header: "Date", value: (row) => businessDay(row.issueDate) },
          { header: "Due date", value: (row) => businessDay(row.dueDate) },
          {
            header: "Net",
            value: (row) =>
              Math.round((Number(row.subtotal) - Number(row.discountAmount)) * 100) / 100,
          },
          { header: "VAT", value: (row) => Number(row.taxAmount) },
          { header: "Total", value: (row) => Number(row.totalAmount) },
          { header: "Paid", value: (row) => Number(row.amountPaid) },
          { header: "Balance", value: (row) => Number(row.balanceRemaining) },
          {
            header: "Status",
            value: (row) =>
              computeEffectiveInvoiceStatus(
                row as Parameters<typeof computeEffectiveInvoiceStatus>[0],
                now,
              ),
          },
        ],
        rows,
        summary: [
          ["Rows", rows.length],
          ...(rows.length === EXPORT_ROW_LIMIT
            ? ([["Note", `Truncated at ${EXPORT_ROW_LIMIT} rows — narrow the filters`]] as Array<[string, string]>)
            : []),
        ],
      };
      return buildReportResponse(sheet, {
        format: rawFormat as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang: reportLanguage(searchParams),
        fileName: "Invoices",
        dateStamp: businessToday(),
      });
    }

    // Calculate pagination
    const skip = (page - 1) * limit;

    const [docs, total] = await Promise.all([
      db.invoice.findMany({
        where,
        omit,
        include: {
          tenant: { select: invoiceTenantSelect },
          property: { select: invoicePropertySelect },
          lease: invoiceLeaseInclude,
        },
        orderBy: { [sortBy]: sortOrder === "desc" ? "desc" : "asc" },
        skip,
        take: limit,
      }),
      db.invoice.count({ where }),
    ]);

    const invoices = docs.map(mapInvoiceListRow);

    // Overlay an effective status on each row so stale "issued" rows that are
    // actually past due render as "overdue" until the daily cron persists it.
    const now = new Date();
    const invoicesWithStatus = invoices.map((inv) => ({
      ...inv,
      status: computeEffectiveInvoiceStatus(inv, now),
    }));

    return createSuccessResponse(
      {
        invoices: invoicesWithStatus,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
      "Invoices retrieved successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/invoices - Create a custom invoice or a credit note
//
// To a tenant (with or without a contract), an owner, or a customer who is
// neither; each line with its VAT category and rate, the discount before
// VAT, numbered INV-000123 (CN-000045 for a credit note). The older body —
// `lineItems` with amounts and a typed-in `taxAmount` — is still read: each
// line takes the contract's (or the charge's) default VAT treatment.
// ============================================================================
export const POST = withPermissionAndDB([...INVOICE_CREATE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const rawBody = (await request.json()) as Record<string, unknown>;

    // The older body named a contract or a tenant and building; its lines
    // take the contract's tax setting.
    let contract: { taxEnabled: boolean; taxRate: number } | null = null;
    if (!Array.isArray(rawBody.lines) && typeof rawBody.leaseId === "string") {
      const lease = await db.lease.findFirst({
        where: withScope({ id: rawBody.leaseId }, leaseScope(user)),
        select: { taxEnabled: true, taxRate: true },
      });
      contract = lease
        ? { taxEnabled: lease.taxEnabled, taxRate: Number(lease.taxRate) }
        : null;
    }
    const body = fromLegacyInvoiceBody(rawBody, (category) =>
      defaultVatTreatment(category, contract),
    );

    const validation = customInvoiceSchema.safeParse(body);
    if (!validation.success) {
      return createErrorResponse(
        validation.error.errors
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join(", "),
        400,
        undefined,
        "VALIDATION_ERROR"
      );
    }
    const input = validation.data;

    if (input.documentType === "credit_note") {
      const note = await createCreditNote(user, input);
      await recordDomainAudit({
        user,
        request,
        resource: "invoice",
        action: AuditAction.CREATE,
        resourceId: note.id,
        resourceName: note.invoiceNumber,
        description: `Issued credit note ${note.invoiceNumber} for ${Math.abs(note.totalAmount)} against ${note.originalInvoiceNumber}`,
        newValues: {
          documentType: "credit_note",
          totalAmount: note.totalAmount,
          originalInvoice: note.originalInvoiceNumber,
          refundDue: note.refundDue || undefined,
          reason: input.reason,
        },
      });
      return createSuccessResponse(note, "Credit note created successfully");
    }

    // Unlike every other limit here, this one is a monthly allowance rather
    // than a ceiling on live rows, so it frees up on the first of the month.
    await enforcePlanLimit(
      requireOrgId(),
      "invoicesPerMonth",
      await countInvoicesThisMonth(),
    );

    const invoice = await createCustomInvoice(user, input);

    await recordDomainAudit({
      user,
      request,
      resource: "invoice",
      action: AuditAction.CREATE,
      resourceId: invoice.id,
      resourceName: invoice.invoiceNumber,
      description: `Issued invoice ${invoice.invoiceNumber} for ${invoice.totalAmount}`,
      newValues: {
        totalAmount: invoice.totalAmount,
        customerType: input.customerType,
        tenantId: input.tenantId,
        ownerId: input.ownerId,
        customer: input.customer?.name,
        leaseId: input.leaseId,
        dueDate: input.dueDate,
      },
    });

    const created = await db.invoice.findFirst({
      where: { id: invoice.id },
      omit: await invoicePhase0Omit(),
      include: {
        tenant: { select: invoiceTenantSelect },
        property: { select: invoicePropertySelect },
        lease: invoiceLeaseInclude,
      },
    });

    return createSuccessResponse(
      created ? mapInvoiceListRow(created) : invoice,
      "Invoice created successfully",
    );
  } catch (error) {
    if (error instanceof CustomInvoiceError) {
      return createErrorResponse(error.message, error.status);
    }
    return handleApiError(error);
  }
});

// ============================================================================
// PATCH /api/invoices - Bulk update invoices
// ============================================================================

/** The columns a bulk update may write. */
const BULK_EDITABLE_INVOICE_FIELDS = new Set(["notes", "dueDate"]);
export const PATCH = withPermissionAndDB([...INVOICE_BULK_EDIT_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const body = await request.json();
    const { invoiceIds, updates } = body;

    if (!invoiceIds || !Array.isArray(invoiceIds) || invoiceIds.length === 0) {
      return createErrorResponse("Invoice IDs are required", 400);
    }

    if (!updates || typeof updates !== "object" || Array.isArray(updates)) {
      return createErrorResponse("Updates object is required", 400);
    }

    // Only what can be changed across many invoices without touching money.
    // This wrote whatever it was sent — amounts paid, balances, a status the
    // other routes refuse to set because it is derived — and asked for no
    // more than it does now that Edit invoices opens it.
    const refused = Object.keys(updates).filter(
      (field) => !BULK_EDITABLE_INVOICE_FIELDS.has(field)
    );
    if (refused.length > 0) {
      return createErrorResponse(
        `These fields cannot be changed in bulk: ${refused.join(", ")}`,
        400
      );
    }
    if (updates.dueDate !== undefined) {
      const due = new Date(updates.dueDate);
      if (Number.isNaN(due.getTime())) {
        return createErrorResponse("dueDate must be a date", 400);
      }
      updates.dueDate = due;
    }
    if (updates.notes !== undefined && updates.notes !== null && typeof updates.notes !== "string") {
      return createErrorResponse("notes must be text", 400);
    }

    // Validate invoice IDs
    const ids = invoiceIds.map((id: string) => {
      if (!isValidObjectId(id)) {
        throw new Error(`Invalid invoice ID: ${id}`);
      }
      return id;
    });

    // Perform bulk update
    const result = await db.invoice.updateMany({
      // Intersected, not assigned: the ids come from the request, so rows
      // outside this caller's buildings are simply not touched.
      where: { id: { in: ids }, ...invoiceScope(user) },
      data: updates,
    });

    await recordDomainAudit({
      user,
      request,
      resource: "invoice",
      action: AuditAction.BULK_UPDATE,
      resourceId: ids.join(","),
      resourceName: `${result.count} invoices`,
      description: `Bulk-updated ${result.count} invoices`,
      newValues: updates as Record<string, unknown>,
    });
    // A new due date moves the day an installment is posted on.
    if (updates.dueDate !== undefined) postAfterCommit("invoice", ids, { userId: user.id });

    return createSuccessResponse(
      {
        matchedCount: result.count,
        modifiedCount: result.count,
      },
      `Updated ${result.count} invoices`
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// DELETE /api/invoices - Bulk soft delete invoices
// ============================================================================
export const DELETE = withPermissionAndDB([...INVOICE_BULK_DELETE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const invoiceIds = searchParams.get("ids")?.split(",") || [];

    if (invoiceIds.length === 0) {
      return createErrorResponse("Invoice IDs are required", 400);
    }

    // Validate invoice IDs
    const ids = invoiceIds.map((id: string) => {
      if (!isValidObjectId(id)) {
        throw new Error(`Invalid invoice ID: ${id}`);
      }
      return id;
    });

    // Check if any invoices have payments
    const invoicesWithPayments = await db.invoice.count({
      where: {
        id: { in: ids },
        amountPaid: { gt: 0 },
      },
    });

    if (invoicesWithPayments > 0) {
      return createErrorResponse(
        "Cannot delete invoices that have received payments",
        400
      );
    }

    // A credit note, and an invoice one has corrected, stay: deleting either
    // would leave the other's figures pointing at nothing.
    if (await accountingPhase0Available()) {
      const credited = await db.invoice.count({
        where: {
          id: { in: ids },
          OR: [{ documentType: "credit_note" }, { creditedAmount: { gt: 0 } }],
        },
      });
      if (credited > 0) {
        return createErrorResponse(
          "Credit notes, and invoices a credit note has corrected, cannot be deleted",
          400
        );
      }
    }

    // Perform soft delete
    const result = await db.invoice.updateMany({
      // Intersected, not assigned: the ids come from the request, so rows
      // outside this caller's buildings are simply not touched.
      where: { id: { in: ids }, ...invoiceScope(user) },
      data: { deletedAt: new Date(), status: InvoiceStatus.CANCELLED },
    });

    await recordDomainAudit({
      user,
      request,
      resource: "invoice",
      action: AuditAction.DELETE,
      resourceId: ids.join(","),
      resourceName: `${result.count} invoices`,
      description: `Cancelled and soft-deleted ${result.count} unpaid invoices`,
    });
    postAfterCommit("invoice", ids, { userId: user.id });

    return createSuccessResponse(
      {
        deletedCount: result.count,
      },
      `Deleted ${result.count} invoices`
    );
  } catch (error) {
    return handleApiError(error);
  }
});
