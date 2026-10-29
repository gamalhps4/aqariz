/**
 * PropertyPro - Payments API Routes
 * CRUD operations for payment management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  EXPORT_FETCH_LIMIT,
  EXPORT_ROW_LIMIT,
  capExportRows,
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import {
  applyScope,
  invoiceScope,
  leaseScope,
  paymentScope,
  propertyScope,
  tenantRecordScope,
  withScope,
} from "@/lib/db/scopes";
import {
  UserRole,
  PaymentStatus,
  InvoiceStatus,
  InvoiceType,
} from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withAccessAndDB,
  withPermissionAndDB,
} from "@/lib/api-utils";
import { recordDomainAudit, moneySnapshot } from "@/lib/audit-domain";
import { AuditAction } from "@/lib/audit-service";
import { paymentCreateSchema, validateSchema } from "@/lib/validations";
import {
  PAYMENT_RECORDER_SELECT,
  recordedByText,
} from "@/lib/payments/recorder";
import {
  displayStatusWhere,
  isPaymentDisplayStatus,
  paymentDisplayStatus,
} from "@/lib/payments/display-status";
import { paymentReference } from "@/lib/payments/report-lines";
import { chosenPaymentOrder } from "@/lib/payments/list-order";
import {
  formatPaymentNumber,
  parsePaymentNumber,
} from "@/lib/payments/receipt-number";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { phoneSearchVariants } from "@/lib/payments/phone-search";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { chargeLinkProblem } from "@/lib/payments/charge-links";
import { uniqueViolationTarget } from "@/lib/db/unique-violation";
import {
  InstallmentPaymentError,
  deleteRecordedPayment,
} from "@/lib/services/payment-invoice-linking.service";

/** Money to the cent, so a subtraction of two sums cannot drift. */
function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
import { requireOrgId } from "@/lib/tenancy/context";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
import {
  businessDay,
  businessRange,
  businessToday,
  parseBusinessDay,
  startOfBusinessDay,
} from "@/lib/dates/business-day";

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

const paymentTenantSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

const paymentPropertySelect = {
  id: true,
  name: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

/**
 * The contract and installment a row belongs to, so the list can say which
 * of the tenant's contracts each payment is on and link to it. `leaseId` and
 * `invoiceId` stay plain ids beside these for the callers that read them.
 */
const paymentLeaseSelect = {
  id: true,
  contractNumber: true,
  startDate: true,
  endDate: true,
  status: true,
  unit: { select: { unitNumber: true } },
} as const;

const paymentInstallmentSelect = {
  id: true,
  invoiceNumber: true,
  dueDate: true,
} as const;

function mapPaymentRow(payment: any) {
  const { tenant, property, ...rest } = payment;
  return {
    ...rest,
    // RCP-000123 — the payment number, which is also its receipt number.
    // Null for a charge nobody has paid, and until the database has numbers.
    paymentNumber: formatPaymentNumber(rest.number),
    tenantId: tenant ?? rest.tenantId,
    propertyId: property
      ? {
          id: property.id,
          name: property.name,
          address: {
            street: property.addressStreet,
            city: property.addressCity,
            state: property.addressState,
            zipCode: property.addressZipCode,
            country: property.addressCountry,
          },
        }
      : rest.propertyId,
  };
}

/** The list's contract, tenant and building filters, as installments read them. */
interface InstallmentFilters {
  leaseId: string | null;
  tenantId: string | null;
  propertyId: string | null;
  unitId: string | null;
  compoundId: string | null;
  ownerId: string | null;
  /** The due-date range, when the date filter is about due dates. */
  dueRange: Record<string, Date> | null;
}

/**
 * The installments still owing money under the list's contract, tenant and
 * building filters — what the Outstanding and Overdue cards add up.
 *
 * The same installments the contract's schedule counts in its own
 * outstanding figure: billed, not cancelled, on a contract, rent or the late
 * fees billed with it. Status, type, method and search describe payment rows
 * and are not applied; an installment has none of those.
 */
function openInstallmentsWhere(
  user: AuthenticatedAccessUser,
  filters: InstallmentFilters,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const where: Record<string, unknown> = {
    leaseId: filters.leaseId ? filters.leaseId : { not: null },
    category: { in: [InvoiceType.RENT, InvoiceType.LATE_FEE] },
    status: { not: InvoiceStatus.CANCELLED },
    balanceRemaining: { gt: 0 },
  };
  // Staff-only, as on the list; a tenant's scope below decides for them.
  if (!user.isTenant) {
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.propertyId) where.propertyId = filters.propertyId;
    if (filters.unitId) where.lease = { unitId: filters.unitId };
    if (filters.compoundId || filters.ownerId) {
      where.property = {
        ...(filters.compoundId ? { compoundId: filters.compoundId } : {}),
        ...(filters.ownerId ? { ownerId: filters.ownerId } : {}),
      };
    }
  }
  const conditions = [
    ...(filters.dueRange ? [{ dueDate: filters.dueRange }] : []),
    ...(extra ? [extra] : []),
  ];
  if (conditions.length > 0) where.AND = conditions;
  applyScope(where, invoiceScope(user));
  return where;
}

// GET /api/payments - Get all payments with pagination and filtering
export const GET = withAccessAndDB(PAYMENT_READ_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const page = parseInt(searchParams.get("page") || "1");
      const limit = Math.min(parseInt(searchParams.get("limit") || "12"), 100);
      const status = searchParams.get("status");
      const type = searchParams.get("type");
      const propertyId = searchParams.get("propertyId");
      const tenantId = searchParams.get("tenantId");
      const startDate = searchParams.get("startDate");
      const endDate = searchParams.get("endDate");
      const search = (searchParams.get("search") || "").trim();
      const paymentMethod = searchParams.get("paymentMethod");
      // What the badge says — overdue, due, upcoming, partly paid… — which is
      // not the stored status. `status` keeps its stored meaning for the
      // callers that send one (the analytics page, the mobile app).
      const displayStatus = searchParams.get("displayStatus");
      const leaseId = searchParams.get("leaseId");
      const unitId = searchParams.get("unitId");
      const compoundId = searchParams.get("compoundId");
      const ownerId = searchParams.get("ownerId");
      // Which column the date range means. `createdAt` — when the row was
      // written — is the least interesting of the three to an office, but it
      // is what this endpoint has always filtered on, so it stays the default
      // and callers ask for something better explicitly.
      const dateField = (() => {
        const requested = searchParams.get("dateField");
        return requested === "dueDate" || requested === "paidDate"
          ? requested
          : "createdAt";
      })();

      const where: Record<string, unknown> = {};
      // Filters that can name the same column — the badge filter reads the
      // due date, and so can the date range — AND-ed rather than assigned,
      // so neither replaces the other.
      const conditions: Record<string, unknown>[] = [];

      if (status && status !== "all") {
        if (status === PaymentStatus.OVERDUE) {
          where.status = {
            in: [
              PaymentStatus.OVERDUE,
              PaymentStatus.PENDING,
              PaymentStatus.FAILED,
              PaymentStatus.PARTIAL,
            ],
          };
        } else {
          where.status = status;
        }
      }

      if (isPaymentDisplayStatus(displayStatus)) {
        conditions.push(displayStatusWhere(displayStatus));
      }

      if (type) {
        where.type = type;
      }
      if (propertyId && !user.isTenant) {
        where.propertyId = propertyId;
      }
      if (tenantId && !user.isTenant) {
        where.tenantId = tenantId;
      }
      if (paymentMethod && paymentMethod !== "all") {
        where.paymentMethod = paymentMethod;
      }

      // The contract filter the review asked for: with a lease chosen, this
      // page shows that contract's money and nothing else. Tenants included —
      // their own-payments scope still applies on top, so all this can do for
      // a tenant is narrow their payments to one of their contracts, which is
      // what their contract page asks for.
      if (leaseId) {
        where.leaseId = leaseId;
      }
      // A payment carries no unit of its own — the unit is on the contract —
      // so narrowing to one goes through the lease.
      if (unitId && !user.isTenant) {
        where.lease = { unitId };
      }

      // Compound and owner both live on the building, so they share one
      // relation filter rather than overwriting each other.
      if ((compoundId || ownerId) && !user.isTenant) {
        where.property = {
          ...(compoundId ? { compoundId } : {}),
          ...(ownerId ? { ownerId } : {}),
        };
      }

      // Inclusive on the office's calendar: an office asking for payments "to
      // the 31st" means the whole of the 31st in Riyadh, not everything
      // before midnight UTC that morning.
      const dateRange = businessRange(
        parseBusinessDay(startDate),
        parseBusinessDay(endDate),
      );
      if (dateRange) conditions.push({ [dateField]: dateRange });

      // Read once: whether the database has payment numbers yet. The list
      // reads them, searches them and exports them only once it does.
      const withNumber = await paymentNumbersAvailable();
      // A column header's order (lib/payments/list-order: listed columns
      // only), or null for the order each read below has always used.
      const chosenOrder = chosenPaymentOrder(
        searchParams.get("sortBy"),
        searchParams.get("sortOrder"),
        { withNumber },
      );

      if (search) {
        // A payment number however it is typed — "RCP-000123", "123".
        const searchedNumber = parsePaymentNumber(search);
        where.OR = [
          { description: { contains: search, mode: "insensitive" } },
          { notes: { contains: search, mode: "insensitive" } },
          { tenant: { firstName: { contains: search, mode: "insensitive" } } },
          { tenant: { lastName: { contains: search, mode: "insensitive" } } },
          { tenant: { email: { contains: search, mode: "insensitive" } } },
          // The mobile number as typed, without its spaces, and as it is
          // dialled at home: "050 123 4567" finds "+966501234567".
          { tenant: { phone: { contains: search, mode: "insensitive" } } },
          ...phoneSearchVariants(search).map((variant) => ({
            tenant: { phone: { contains: variant } },
          })),
          { property: { name: { contains: search, mode: "insensitive" } } },
          { lease: { contractNumber: { contains: search, mode: "insensitive" } } },
          {
            lease: {
              unit: { unitNumber: { contains: search, mode: "insensitive" } },
            },
          },
          ...(withNumber && searchedNumber ? [{ number: searchedNumber }] : []),
        ];
      }

      if (conditions.length > 0) {
        where.AND = conditions;
      }

      // See lib/db/scopes.ts. The `!user.isTenant` guards above keep the
      // query parameters staff-only; this AND clause is what enforces it.
      // Last, so no filter above can be written over it.
      applyScope(where, paymentScope(user));

      // Export takes the same `where` the list just built — including the
      // caller's scope and every filter they set — so "exactly the filtered
      // results shown on screen" is true by construction rather than by two
      // code paths agreeing to stay in step.
      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport.
      if (rawFormat && !canExport(user, "payment_export", "financial_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }
        const fetched = await db.payment.findMany({
          where,
          // The number and the gateway reference are left out of reads
          // unless asked for (prisma.ts): the reference says "Online".
          omit: { number: !withNumber, ...(await gatewayColumnsOmit()) },
          include: {
            tenant: { select: paymentTenantSelect },
            property: { select: paymentPropertySelect },
            lease: { select: paymentLeaseSelect },
            invoice: { select: paymentInstallmentSelect },
            recordedBy: { select: PAYMENT_RECORDER_SELECT },
          },
          // The file in the screen's order when a column was chosen there.
          orderBy: chosenOrder ?? [{ dueDate: "desc" }, { id: "desc" }],
          // One more than is written, so a cut list is known for certain.
          take: EXPORT_FETCH_LIMIT,
        });
        const { rows, truncated } = capExportRows(fetched);

        const sheet: ReportSheet<(typeof rows)[number]> = {
          title: "Payments",
          columns: [
            // The payment number, which is also its receipt number; empty for
            // a charge nobody has paid.
            {
              header: "Payment no.",
              value: (row) =>
                formatPaymentNumber((row as { number?: number | null }).number) ?? "",
            },
            { header: "Due date", value: (row) => businessDay(row.dueDate) },
            { header: "Paid date", value: (row) => row.paidDate ? businessDay(row.paidDate) : "" },
            {
              header: "Tenant",
              value: (row) =>
                `${row.tenant?.firstName ?? ""} ${row.tenant?.lastName ?? ""}`.trim(),
            },
            { header: "Mobile", value: (row) => row.tenant?.phone ?? "" },
            { header: "Building", value: (row) => row.property?.name ?? "" },
            { header: "Unit", value: (row) => row.lease?.unit?.unitNumber ?? "" },
            { header: "Contract no.", value: (row) => row.lease?.contractNumber ?? "" },
            { header: "Installment", value: (row) => row.invoice?.invoiceNumber ?? "" },
            { header: "Type", value: (row) => row.type },
            // What the badge on screen says — overdue, due, partly paid — not
            // the stored lifecycle value, which still says "pending" weeks
            // after the due date.
            { header: "Status", value: (row) => paymentDisplayStatus(row) },
            { header: "Method", value: (row) => row.paymentMethod ?? "" },
            {
              // "Online" is translated on the way out like any other value.
              header: "Recorded by",
              value: (row) => recordedByText(row, "Online") ?? "",
            },
            // No currency column — the client asked for it to be removed.
            { header: "Amount", value: (row) => Number(row.amount) },
            { header: "Paid", value: (row) => Number(row.amountPaid ?? 0) },
            {
              header: "Outstanding",
              value: (row) =>
                Math.max(0, Number(row.amount) - Number(row.amountPaid ?? 0)),
            },
            {
              // The transfer or cheque number the office typed when it
              // recorded the money, else the gateway's own — read the way the
              // reports read it (paymentReference), so the two never differ.
              header: "Reference",
              value: (row) => paymentReference(row) ?? "",
            },
            { header: "Notes", value: (row) => row.notes ?? "" },
          ],
          rows,
          // What the file holds: how many rows, the period, and every filter
          // the screen had on, by name — and a note if the limit cut it.
          filtersSummary: {
            period:
              startDate || endDate
                ? {
                    from: parseBusinessDay(startDate) ?? undefined,
                    to: parseBusinessDay(endDate) ?? undefined,
                  }
                : undefined,
            filters: [
              ["Search", search || undefined],
              ["Status", isPaymentDisplayStatus(displayStatus) ? displayStatus : undefined],
              ["Type", type || undefined],
              ["Method", paymentMethod && paymentMethod !== "all" ? paymentMethod : undefined],
              // Named through the reader's own scope; a tenant's list is
              // narrowed by its contract alone.
              ...(await describeAppliedFilters(
                user,
                user.isTenant
                  ? { leaseId }
                  : { ownerId, compoundId, propertyId, unitId, tenantId, leaseId },
              )),
            ],
            limit: EXPORT_ROW_LIMIT,
            truncated,
          },
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang: reportLanguage(searchParams),
          fileName: "Payments",
          dateStamp: businessToday(),
        });
      }

      const skip = (page - 1) * limit;

      // Overdue is derived, not stored: an installment whose due day has
      // passed is late whether or not a nightly sweep has relabelled it yet.
      const startOfToday = startOfBusinessDay();

      const installmentFilters: InstallmentFilters = {
        leaseId,
        tenantId,
        propertyId,
        unitId,
        compoundId,
        ownerId,
        dueRange: dateField === "dueDate" ? (dateRange ?? null) : null,
      };

      const [
        docs,
        total,
        totals,
        collected,
        byStatus,
        outstanding,
        overdue,
        methods,
      ] = await Promise.all([
        db.payment.findMany({
          where,
          // The number and the gateway reference are left out of reads
          // unless asked for (prisma.ts): the reference says "Online".
          omit: { number: !withNumber, ...(await gatewayColumnsOmit()) },
          include: {
            tenant: { select: paymentTenantSelect },
            property: { select: paymentPropertySelect },
            lease: { select: paymentLeaseSelect },
            invoice: { select: paymentInstallmentSelect },
            // Which employee recorded it — for the office, not its clients.
            ...(user.isCompanyStaff
              ? { recordedBy: { select: PAYMENT_RECORDER_SELECT } }
              : {}),
          },
          orderBy: chosenOrder ?? { createdAt: "desc" },
          skip,
          take: limit,
        }),
        db.payment.count({ where }),
        // Totals are computed over the WHOLE filtered set, not the page.
        // The screen used to add up whatever twelve rows it happened to be
        // showing and print that next to the full record count — so the
        // headline money and the headline count described different things,
        // and both moved when you turned the page.
        db.payment.aggregate({ where, _sum: { amount: true } }),
        // What actually arrived, which is not the same as what was asked for:
        // a partial payment must count for the money received, not the money
        // billed. Summing `amount` here overstated collections.
        db.payment.aggregate({
          where: {
            ...where,
            status: { in: [PaymentStatus.PAID, PaymentStatus.PARTIAL] },
          },
          _sum: { amountPaid: true },
          _count: true,
        }),
        db.payment.groupBy({
          by: ["status"],
          where,
          _sum: { amount: true },
          _count: true,
        }),
        // What is still owed, and what of it is late, read off the
        // installment schedule rather than off payment rows. Payment rows
        // only exist for money that was recorded or a charge someone wrote,
        // so an installment nobody had touched was missing from both cards —
        // the contract's own Payments tab counted it, this page did not.
        db.invoice.aggregate({
          where: openInstallmentsWhere(user, installmentFilters),
          _sum: { balanceRemaining: true },
          _count: true,
        }),
        db.invoice.aggregate({
          where: openInstallmentsWhere(user, installmentFilters, {
            dueDate: { lt: startOfToday },
          }),
          _sum: { balanceRemaining: true },
          _count: true,
        }),
        // Every method the caller's payments carry, filters aside — what the
        // method filter offers beyond the six the office records with, so a
        // card payment or an older cheque can be found too.
        db.payment.groupBy({
          by: ["paymentMethod"],
          where: withScope({ paymentMethod: { not: null } }, paymentScope(user)),
        }),
      ]);

      const payments = docs.map(mapPaymentRow);

      const statusTotals = Object.fromEntries(
        byStatus.map((row) => [
          row.status,
          { count: row._count, amount: Number(row._sum.amount ?? 0) },
        ]),
      );

      return createSuccessResponse(
        payments,
        "Payments retrieved successfully",
        {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
        {
          totalAmount: Number(totals._sum.amount ?? 0),
          collectedAmount: Number(collected._sum.amountPaid ?? 0),
          collectedCount: collected._count,
          // Installments, not payment rows — see openInstallmentsWhere.
          outstandingAmount: round2(
            Number(outstanding._sum.balanceRemaining ?? 0),
          ),
          outstandingCount: outstanding._count,
          overdueAmount: round2(Number(overdue._sum.balanceRemaining ?? 0)),
          overdueCount: overdue._count,
          byStatus: statusTotals,
          availableMethods: methods
            .map((row) => row.paymentMethod)
            .filter((method): method is string => Boolean(method))
            .sort(),
        },
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// POST /api/payments - Add a charge: something the tenant owes.
//
// Money is recorded against an installment (PATCH /api/invoices/[id],
// add_payment — the Record payment dialog), never here; a charge is created
// unpaid whatever the body says.
export const POST = withPermissionAndDB([
  "payment_create",
  "payment_processing",
  "financial_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: rawBody, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = validateSchema(paymentCreateSchema, rawBody);
      if (!validation.success) {
        return createErrorResponse(
          validation.errors.join(", "),
          400,
          undefined,
          "VALIDATION_ERROR"
        );
      }
      const body = validation.data;

      // A manager without finance rights records payments only on buildings
      // they own or manage.
      const ownOrManageOnly =
        user.isManager &&
        !user.isAdmin &&
        !user.permissions.includes("financial_management");

      // Scoped: the id arrives in the request body, so this is what stops
      // a narrowed caller attaching a record to a building they were
      // not given. It used to run only for the managers above — a narrowed
      // administrator, or a manager with finance rights, was never checked.
      const scope = propertyScope(user);
      if (ownOrManageOnly || Object.keys(scope).length > 0) {
        const property = await db.property.findFirst({
          where: withScope({ id: body.propertyId }, scope),
        });
        if (!property) {
          return createErrorResponse("Property not found", 404);
        }

        const isOwner = property.ownerId === user.id;
        const isManager = property.managerId === user.id;

        if (ownOrManageOnly && !isOwner && !isManager) {
          return createErrorResponse(
            "You can only create payments for properties you own or manage",
            403
          );
        }
      }

      // The contract and installment ids arrive in the body too, so they are
      // resolved under the caller's scope and checked against the tenant and
      // building before anything is written — see chargeLinkProblem. They
      // used to be stored as sent: a contract of another tenant, an
      // installment of another contract.
      const [lease, installment] = await Promise.all([
        body.leaseId
          ? db.lease.findFirst({
              where: withScope({ id: body.leaseId }, leaseScope(user)),
              select: { tenantId: true, propertyId: true, currency: true },
            })
          : null,
        body.invoiceId
          ? db.invoice.findFirst({
              where: withScope({ id: body.invoiceId }, invoiceScope(user)),
              select: {
                tenantId: true,
                propertyId: true,
                leaseId: true,
                status: true,
              },
            })
          : null,
      ]);
      const linkProblem = chargeLinkProblem(body, lease, installment);
      if (linkProblem) {
        return createErrorResponse(linkProblem.message, linkProblem.status);
      }

      // With no contract there is nothing above that vouches for the tenant,
      // so it has to be a tenant this caller can see.
      if (!body.leaseId) {
        const tenant = await db.user.findFirst({
          where: withScope(
            { id: body.tenantId, role: UserRole.TENANT },
            tenantRecordScope(user),
          ),
          select: { id: true },
        });
        if (!tenant) {
          return createErrorResponse("Tenant not found", 404);
        }
      }

      // Only schema-validated fields reach the model — a caller can no longer
      // inject arbitrary Payment columns (amountPaid, gateway ids, history).
      let payment;
      try {
        payment = await db.payment.create({
          data: {
            ...body,
            organizationId: requireOrgId(),
            status: PaymentStatus.PENDING,
            // The contract's currency, not the column default.
            ...(lease?.currency ? { currency: lease.currency } : {}),
          },
          include: {
            tenant: { select: paymentTenantSelect },
            property: { select: paymentPropertySelect },
          },
        });
      } catch (error) {
        // payments_rent_per_lease_due_unique: one rent charge per contract
        // per due date, so a replayed generator cannot bill it twice.
        if (uniqueViolationTarget(error).includes("rent_per_lease")) {
          return createErrorResponse(
            "This contract already has a rent charge due on that date.",
            409,
            undefined,
            "DUPLICATE",
          );
        }
        throw error;
      }

      await recordDomainAudit({
        user,
        request,
        resource: "payment",
        action: AuditAction.CREATE,
        resourceId: payment.id,
        resourceName: payment.id,
        description: `Added a charge of ${payment.amount}`,
        newValues: moneySnapshot(payment as never, [
          "amount",
          "status",
          "type",
          "dueDate",
          "leaseId",
          "invoiceId",
          "tenantId",
        ]),
      });

      return createSuccessResponse(
        mapPaymentRow(payment),
        "Charge added"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// PUT /api/payments - Bulk update payments
export const PUT = withPermissionAndDB([
  "payment_processing",
  "financial_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { paymentIds, updates } = body;

      if (!paymentIds || !Array.isArray(paymentIds) || paymentIds.length === 0) {
        return createErrorResponse("Payment IDs are required", 400);
      }

      if (!updates || typeof updates !== "object") {
        return createErrorResponse("Updates object is required", 400);
      }

      // Only fields that describe a payment, never ones that move money. The
      // body used to be spread straight into the update, so a bulk call could
      // re-price, re-assign or mark paid any payment in scope — around every
      // rule the single-payment routes keep, including the review's "a
      // recorded amount is not edited".
      const BULK_EDITABLE = new Set(["notes", "description"]);
      const refused = Object.keys(updates as Record<string, unknown>).filter(
        (key) => !BULK_EDITABLE.has(key),
      );
      if (refused.length > 0) {
        return createErrorResponse(
          `These fields cannot be changed in bulk: ${refused.join(", ")}`,
          400,
        );
      }

      const scopedWhere = { id: { in: paymentIds }, ...paymentScope(user) };

      // Read the fields this edit is about to overwrite, before it does.
      //
      // The trail recorded what a payment BECAME and never what it was, so
      // "who changed this and from what" — the question an audit log exists
      // to answer — could not be asked of it. The review asks for the value
      // before as well as after. One extra read, on a path that edits money.
      const editedKeys = Object.keys(updates as Record<string, unknown>);
      const before = await db.payment.findMany({
        where: scopedWhere,
        select: { id: true, ...Object.fromEntries(
          editedKeys
            .filter((key) => key in Prisma.PaymentScalarFieldEnum)
            .map((key) => [key, true]),
        ) },
      });

      const result = await db.payment.updateMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: scopedWhere,
        data: { ...updates, updatedAt: new Date() },
      });

      await recordDomainAudit({
        user,
        request,
        resource: "payment",
        action: AuditAction.BULK_UPDATE,
        resourceId: paymentIds.join(","),
        resourceName: `${result.count} payments`,
        description: `Bulk-updated ${result.count} payments`,
        // Keyed by row, because a bulk edit sets one value across many rows
        // that each held something different — a single "before" would be a
        // fiction.
        oldValues: { rows: before } as Record<string, unknown>,
        newValues: updates as Record<string, unknown>,
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
        `${result.count} payments updated successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// DELETE /api/payments?ids=a,b - Delete several payments
//
// The single delete's rules, one payment at a time: its own permission, the
// caller's scope, the money each carries taken back off the installments it
// paid, and then the archive (deleteRecordedPayment). This used to mark the
// rows cancelled and deleted in one updateMany — gated on processing rights
// rather than payment_delete, and leaving every installment they had paid
// still counting the money.
const BULK_DELETE_LIMIT = 100;

export const DELETE = withPermissionAndDB([
  "payment_delete",
  "financial_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      // Bulk actions stay with the administrator.
      if (!user.isAdmin) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const { searchParams } = new URL(request.url);
      const paymentIds = [
        ...new Set(
          (searchParams.get("ids") ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
        ),
      ];

      if (paymentIds.length === 0) {
        return createErrorResponse("Payment IDs are required", 400);
      }
      if (paymentIds.length > BULK_DELETE_LIMIT) {
        return createErrorResponse(
          `At most ${BULK_DELETE_LIMIT} payments can be deleted at once`,
          400,
        );
      }

      // Intersected with the scope: an id outside it is reported as not
      // found, never touched.
      const payments = await db.payment.findMany({
        where: withScope({ id: { in: paymentIds } }, paymentScope(user)),
      });
      const byId = new Map(payments.map((payment) => [payment.id, payment]));

      const deleted: Array<{ id: string; reversed: unknown }> = [];
      const failed: Array<{ id: string; error: string }> = [];

      for (const id of paymentIds) {
        const payment = byId.get(id);
        if (!payment) {
          failed.push({ id, error: "Payment not found" });
          continue;
        }
        try {
          const { reversed } = await deleteRecordedPayment(payment.id, user.id);
          deleted.push({ id, reversed });
          await recordDomainAudit({
            user,
            request,
            resource: "payment",
            action: AuditAction.DELETE,
            resourceId: payment.id,
            resourceName: payment.description ?? payment.id,
            description: `Deleted a payment of ${Number(payment.amountPaid ?? 0) || Number(payment.amount)} and moved it to the archive (bulk)`,
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
        } catch (error) {
          if (error instanceof InstallmentPaymentError) {
            failed.push({ id, error: error.message });
            continue;
          }
          throw error;
        }
      }

      return createSuccessResponse(
        {
          matchedCount: payments.length,
          modifiedCount: deleted.length,
          deleted,
          failed,
        },
        `${deleted.length} payments deleted and moved to the archive`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
