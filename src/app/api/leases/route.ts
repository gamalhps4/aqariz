/**
 * PropertyPro - Leases API Routes
 * CRUD operations for lease management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, leaseScope } from "@/lib/db/scopes";
import {
  EXPORT_FETCH_LIMIT,
  EXPORT_ROW_LIMIT,
  buildReportResponse,
  capExportRows,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import {
  expiryUrgency,
  expiryUrgencyText,
  leaseStatusText,
  translatorFor,
} from "@/lib/reports/list-labels";
import {
  addBusinessDays,
  businessDay,
  businessDayEnd,
  businessDayStart,
  businessDaysUntil,
  businessToday,
} from "@/lib/dates/business-day";

import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parsePaginationParams,
  createPaginationInfo,
  parseRequestBody,
} from "@/lib/api-utils";
import { recordDomainAudit, moneySnapshot } from "@/lib/audit-domain";
import { AuditAction } from "@/lib/audit-service";
import {
  leaseSchema,
  paginationSchema,
  validateSchema,
} from "@/lib/validations";
import { LEASE_READ_ACCESS } from "@/lib/lease-access";
import { unhookWithdrawnRenewals } from "@/lib/services/lease-lifecycle.service";
import {
  LeaseCreationError,
  createLease,
} from "@/lib/services/lease-creation.service";
import { isLiveRenewal } from "@/lib/lease-lifecycle";

const LEASE_TENANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatar: true,
  dateOfBirth: true,
  emergencyContacts: true,
  backgroundCheckStatus: true,
  // employmentInfo/creditScore live on the Tenant profile now (PII single
  // home); flattened back onto the tenant in the response mapping.
  tenantProfile: { select: { employmentInfo: true, creditScore: true } },
  moveInDate: true,
  moveOutDate: true,
  applicationDate: true,
  deletedAt: true,
} as const;

function buildPropertyAddress(property: any) {
  return {
    street: property?.addressStreet,
    city: property?.addressCity,
    state: property?.addressState,
    zipCode: property?.addressZipCode,
    country: property?.addressCountry,
  };
}

/** Restore the old populated response shape (propertyId/tenantId objects, unit info). */
function mapLeaseForResponse(lease: any) {
  const { property, tenant, unit, ...rest } = lease;

  const mappedProperty = property
    ? {
        ...property,
        address: buildPropertyAddress(property),
        ...(property.owner !== undefined
          ? { ownerId: property.owner ?? undefined, owner: undefined }
          : {}),
      }
    : undefined;

  const mappedTenant = tenant
    ? {
        ...tenant,
        employmentInfo: tenant.tenantProfile?.employmentInfo ?? null,
        creditScore: tenant.tenantProfile?.creditScore ?? null,
        tenantProfile: undefined,
        deletedAt: undefined,
      }
    : undefined;

  return {
    ...rest,
    propertyId: mappedProperty ?? rest.propertyId,
    tenantId: mappedTenant ?? rest.tenantId,
    unitId: unit ?? rest.unitId,
    unit: unit ?? undefined,
  };
}

// ============================================================================
// GET /api/leases - Get all leases with pagination and filtering
// ============================================================================


/**
 * The order the screen lists contracts in, as a query's. Its sort options are
 * written as the table's own columns — "terms.rentAmount" is the rent — so a
 * file comes out in the order the table was in, not in the database's.
 */
function leaseOrder(
  sortBy: string | undefined,
  sortOrder: string | undefined,
): Prisma.LeaseOrderByWithRelationInput {
  const direction: Prisma.SortOrder = sortOrder === "asc" ? "asc" : "desc";
  switch (sortBy) {
    case "terms.rentAmount":
    case "rentAmount":
      return { rentAmount: direction };
    case "startDate":
    case "endDate":
    case "createdAt":
      return { [sortBy]: direction };
    default:
      return { createdAt: "desc" };
  }
}

export const GET = withAccessAndDB(LEASE_READ_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      // Parse lease-specific filter parameters
      const status = searchParams.get("status") || undefined;
      const propertyId = searchParams.get("propertyId") || undefined;
      const tenantId = searchParams.get("tenantId") || undefined;
      const expiring = searchParams.get("expiring") || undefined;
      const archived = searchParams.get("archived") === "true";

      // Validate pagination parameters
      const validation = validateSchema(paginationSchema, paginationParams);

      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const filters = validation.data;

      // Build query based on user role and filters
      const where: Prisma.LeaseWhereInput = {
        // Never include soft-deleted leases
        deletedAt: null,
        // Archived leases are hidden from the default list and only shown when
        // explicitly requested (so finance reports keep the records, but the
        // working list stays clean).
        archivedAt: archived ? { not: null } : null,
      };

      // Which of the organization's own rows this caller may see — one rule,
      // in lib/db/scopes.ts. Company staff see everything; a tenant is pinned
      // to their own leases by an AND clause no later filter can unset.
      applyScope(where, leaseScope(user));

      // Apply lease-specific filters
      // "Pending" is two states on the screen — waiting to be sent, and
      // waiting for the tenant's signature — and the list and its file both
      // mean both.
      if (status) {
        where.status =
          status === LeaseStatus.PENDING
            ? { in: [LeaseStatus.PENDING, LeaseStatus.PENDING_SIGNATURE] }
            : status;
      }
      if (propertyId) where.propertyId = propertyId;
      if (tenantId) where.tenantId = tenantId;

      // Contracts still running whose last day is within `expiring` days —
      // today's included, on the office's calendar. A contract that has
      // already ended is expired, not expiring.
      const expiringDays = expiring
        ? Math.max(1, parseInt(expiring) || 30)
        : 0;
      if (expiringDays) {
        const today = businessToday();
        where.status = LeaseStatus.ACTIVE;
        where.endDate = {
          gte: businessDayStart(today),
          lte: businessDayEnd(addBusinessDays(today, expiringDays)),
        };
      }

      // A lease whose tenant has been soft-deleted is an orphan and must not
      // reach the list. Filtering it HERE rather than after the query is what
      // keeps `count` and the returned page describing the same set — the
      // nested include is not covered by the client's soft-delete extension
      // (see lib/db/prisma.ts), only the top-level where is.
      applyScope(where, { tenant: { deletedAt: null } });

      // Search runs in the DATABASE. It used to be a regex applied to the
      // page after it came back, so a lease matching on page 3 was invisible
      // from page 1 and the reported total counted only the current page.
      const searchTerm =
        typeof filters.search === "string" ? filters.search.trim() : "";

      if (searchTerm) {
        const contains = {
          contains: searchTerm,
          mode: Prisma.QueryMode.insensitive,
        };

        const searchOr: Prisma.LeaseWhereInput[] = [
          // The office's own reference for the signed paper: the scope
          // requires a lease to be findable by it.
          { contractNumber: contains },
          { id: contains },
          { notes: contains },
          { tenant: { firstName: contains } },
          { tenant: { lastName: contains } },
          { tenant: { email: contains } },
          { tenant: { phone: contains } },
          { property: { name: contains } },
          { property: { addressStreet: contains } },
          { property: { addressCity: contains } },
          { property: { addressState: contains } },
          { property: { addressZipCode: contains } },
        ];

        // Given and family names are separate columns, so a full name typed
        // as one phrase matches neither half on its own.
        const [firstToken, ...restTokens] = searchTerm.split(/\s+/);
        if (firstToken && restTokens.length > 0) {
          searchOr.push({
            tenant: {
              firstName: {
                contains: firstToken,
                mode: Prisma.QueryMode.insensitive,
              },
              lastName: {
                contains: restTokens.join(" "),
                mode: Prisma.QueryMode.insensitive,
              },
            },
          });
        }

        applyScope(where, { OR: searchOr });
      }

      // How many of the contracts this query matches already have a renewal:
      // the old contract names its successor, and the successor still stands
      // (a draft or one awaiting signature; not cancelled, not deleted). The
      // expiring page's "renewal started" card — a count, where the card used
      // to show 70% of the 30-day figure.
      if (searchParams.get("countWithRenewal") === "true") {
        const named = await db.lease.findMany({
          where: { AND: [where, { renewedLeaseId: { not: null } }] },
          select: { renewedLeaseId: true },
        });
        const successorIds = named
          .map((row) => row.renewedLeaseId)
          .filter((id): id is string => Boolean(id));
        const successors = successorIds.length
          ? await db.lease.findMany({
              where: { id: { in: successorIds } },
              select: { status: true, deletedAt: true },
            })
          : [];
        return createSuccessResponse(
          { count: successors.filter(isLiveRenewal).length },
          "Renewals counted",
        );
      }

      const page = filters.page ?? 1;
      const limit = filters.limit ?? 10;
      // The export runs the same `where` the list just built, so it carries
      // exactly what is on screen — scope, filters and all.
      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport.
      if (rawFormat && !canExport(user, "lease_export", "lease_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }
        const lang = reportLanguage(searchParams);
        const tr = translatorFor(lang);
        const fetched = await db.lease.findMany({
          where,
          include: {
            tenant: { select: { firstName: true, lastName: true, email: true, phone: true } },
            property: { select: { name: true, addressCity: true, addressDistrict: true } },
            unit: { select: { unitNumber: true } },
          },
          orderBy: [leaseOrder(filters.sortBy, filters.sortOrder), { id: "asc" }],
          take: EXPORT_FETCH_LIMIT,
        });
        const { rows, truncated } = capExportRows(fetched);

        const today = businessToday();
        const daysLeft = (row: (typeof rows)[number]) =>
          businessDaysUntil(row.endDate);
        const title = expiringDays ? "Expiring contracts" : "Lease contracts";

        const sheet: ReportSheet<(typeof rows)[number]> = {
          title,
          columns: [
            { header: "Contract", value: (row) => row.contractNumber ?? row.id },
            {
              header: "Tenant",
              value: (row) => `${row.tenant?.firstName ?? ""} ${row.tenant?.lastName ?? ""}`.trim(),
            },
            { header: "Phone", value: (row) => row.tenant?.phone ?? "" },
            { header: "Building", value: (row) => row.property?.name ?? "" },
            { header: "District", value: (row) => row.property?.addressDistrict ?? "" },
            { header: "City", value: (row) => row.property?.addressCity ?? "" },
            { header: "Unit", value: (row) => row.unit?.unitNumber ?? "" },
            { header: "Start", value: (row) => businessDay(row.startDate) },
            { header: "End", value: (row) => businessDay(row.endDate) },
            // As the screen has it: how long is left, or how long ago it ended.
            { header: "Days remaining", value: (row) => daysLeft(row) },
            ...(expiringDays
              ? [
                  {
                    header: "Urgency",
                    value: (row: (typeof rows)[number]) =>
                      expiryUrgencyText(expiryUrgency(daysLeft(row)), tr),
                  },
                ]
              : []),
            { header: "Status", value: (row) => leaseStatusText(row.status, tr) },
            { header: "Currency", value: (row) => row.currency },
            { header: "Rent", value: (row) => Number(row.rentAmount) },
            { header: "Deposit", value: (row) => Number(row.securityDepositAmount) },
          ],
          rows,
          // What the file says it holds: how many, for which days, and every
          // filter the screen had on — by name.
          filtersSummary: {
            period: expiringDays
              ? { from: today, to: addBusinessDays(today, expiringDays) }
              : {},
            filters: [
              ["Search", searchTerm],
              ["Status", status ? leaseStatusText(status, tr) : undefined],
              ["Archived", archived],
              ...(await describeAppliedFilters(user, { propertyId, tenantId })),
              ["Expiring within (days)", expiringDays || undefined],
            ],
            limit: EXPORT_ROW_LIMIT,
            truncated,
          },
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: title,
          dateStamp: today,
        });
      }

      const sortField =
        filters.sortBy && filters.sortBy in Prisma.LeaseScalarFieldEnum
          ? filters.sortBy
          : "createdAt";
      const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";
      // The table's rent sort is a column of the contract, not a field the
      // enum above knows by that name.
      const listOrder: Prisma.LeaseOrderByWithRelationInput =
        filters.sortBy === "terms.rentAmount"
          ? { rentAmount: sortOrder }
          : { [sortField]: sortOrder };

      const [leases, total] = await Promise.all([
        db.lease.findMany({
          where,
          orderBy: listOrder,
          skip: (page - 1) * limit,
          take: limit,
          include: {
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
                isMultiUnit: true,
                totalUnits: true,
                units: true,
                owner: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    email: true,
                  },
                },
              },
            },
            tenant: { select: LEASE_TENANT_SELECT },
            unit: true,
          },
        }),
        db.lease.count({ where }),
      ]);

      // Both the orphan rule and the search now live in the query above, so
      // the page and `total` describe the same set and no row is dropped
      // after the fact.
      const mappedLeases = leases.map((lease) => mapLeaseForResponse(lease));

      return createSuccessResponse(
        mappedLeases,
        "Leases retrieved successfully",
        createPaginationInfo(page, limit, total)
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/leases - Create a new lease
// ============================================================================

export const POST = withPermissionAndDB([
  "lease_create",
  "lease_management",
])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Validate request body
      const validation = validateSchema(leaseSchema as any, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const leaseData = validation.data as any;

      // Everything between a valid body and the response — scope, unit,
      // tenant, overlap and contract-number checks, the plan limit, the
      // write, occupancy and billing — is the lease-creation service, which
      // the spreadsheet import calls too.
      let outcome;
      try {
        outcome = await createLease(user, leaseData);
      } catch (error) {
        if (error instanceof LeaseCreationError) {
          return createErrorResponse(error.message, error.statusCode);
        }
        throw error;
      }
      const created = outcome.lease;
      const invoiceGenerationResult = outcome.invoiceGeneration;

      // Fetch with property/tenant/unit information for the response
      const populated = await db.lease.findFirst({
        where: { id: created.id },
        include: {
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
              isMultiUnit: true,
              totalUnits: true,
              units: true,
            },
          },
          tenant: { select: LEASE_TENANT_SELECT },
          unit: true,
        },
      });

      const responseLease = mapLeaseForResponse(populated ?? created);

      await recordDomainAudit({
        user,
        request,
        resource: "lease",
        action: AuditAction.CREATE,
        resourceId: responseLease.id,
        resourceName: responseLease.id,
        description: "Created lease",
        newValues: moneySnapshot(responseLease as never, [
          "startDate",
          "endDate",
          "status",
          "tenantId",
          "propertyId",
          "unitId",
        ]),
      });

      return createSuccessResponse(
        {
          lease: responseLease,
          invoiceGeneration: invoiceGenerationResult,
        },
        "Lease created successfully",
        undefined
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/leases - Bulk update leases (admin only)
// ============================================================================

// Fields that can be bulk-updated (everything else is dropped, matching the
// old behavior of stripping _id/propertyId/tenantId/createdAt/updatedAt).
// The status and the record of a cancellation are not among them — see
// LIFECYCLE_ONLY_LEASE_FIELDS and the refusal in the handler.
const BULK_UPDATABLE_LEASE_FIELDS = new Set([
  "unitId",
  "startDate",
  "endDate",
  "paymentStatus",
  "terms",
  "documents",
  "signedDate",
  "renewalOptions",
  "signedById",
  "signatureData",
  "signatureIpAddress",
  "terminationNotice",
  "renewedLeaseId",
  "parentLeaseId",
  "notes",
  "archivedAt",
]);

/**
 * What only a contract's own lifecycle may write: its status, and the record
 * of its cancellation — when, by whom and why. A bulk update naming any of
 * these is refused, not quietly trimmed.
 */
const LIFECYCLE_ONLY_LEASE_FIELDS = [
  "status",
  "terminatedDate",
  "terminatedById",
  "terminationReason",
] as const;

export const PUT = withAccessAndDB({
  permissions: ["bulk_operations", "lease_management"],
  requireAllPermissions: true,
})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { leaseIds, updates } = body;

      if (!Array.isArray(leaseIds) || leaseIds.length === 0) {
        return createErrorResponse("Lease IDs array is required", 400);
      }

      if (!updates || typeof updates !== "object") {
        return createErrorResponse("Updates object is required", 400);
      }

      // A status change is not a column edit. Activating a contract occupies
      // its unit and bills its installments; cancelling one frees the unit,
      // closes its payments and records when, by whom and why. One blind
      // write across many rows can do none of that, so it is refused rather
      // than silently dropped — the caller must be told it did not happen.
      // The cancellation record is refused with it: written here, it could
      // date a contract that was never cancelled, or overwrite the day and
      // the name a real cancellation recorded.
      const lifecycleOnly = LIFECYCLE_ONLY_LEASE_FIELDS.filter(
        (field) => field in updates
      );
      if (lifecycleOnly.length > 0) {
        return createErrorResponse(
          `${lifecycleOnly.join(", ")} cannot be bulk-updated. Change each contract's status through PATCH /api/leases/{id} or its terminate route, which record the cancellation themselves.`,
          400
        );
      }

      // Remove fields that shouldn't be bulk updated
      const allowedUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (BULK_UPDATABLE_LEASE_FIELDS.has(key)) {
          allowedUpdates[key] = value;
        }
      }

      const scopedWhere = { id: { in: leaseIds }, ...leaseScope(user) };

      // What these contracts held before the edit — see the same read on the
      // payments route for why. A trail that records only the new value
      // cannot answer "changed from what".
      const editedKeys = Object.keys(allowedUpdates as Record<string, unknown>);
      const before = await db.lease.findMany({
        where: scopedWhere,
        select: {
          id: true,
          ...Object.fromEntries(
            editedKeys
              .filter((key) => key in Prisma.LeaseScalarFieldEnum)
              .map((key) => [key, true]),
          ),
        },
      });

      // Perform bulk update
      const result = await db.lease.updateMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: scopedWhere,
        data: allowedUpdates,
      });

      await recordDomainAudit({
        user,
        request,
        resource: "lease",
        action: AuditAction.BULK_UPDATE,
        resourceId: leaseIds.join(","),
        resourceName: `${result.count} leases`,
        description: `Bulk-updated ${result.count} leases`,
        // Keyed by row: one value set across many rows that each held
        // something different.
        oldValues: { rows: before } as Record<string, unknown>,
        newValues: allowedUpdates as Record<string, unknown>,
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
        `${result.count} leases updated successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/leases - Bulk delete leases (admin only)
// ============================================================================

export const DELETE = withAccessAndDB({
  permissions: ["bulk_operations", "lease_management"],
  requireAllPermissions: true,
})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse(
          "Only admin-level roles can delete leases",
          403
        );
      }

      const { searchParams } = new URL(request.url);
      const leaseIds = searchParams.get("ids")?.split(",") || [];

      if (leaseIds.length === 0) {
        return createErrorResponse("Lease IDs are required", 400);
      }

      // Only draft leases can be deleted. Any lease beyond draft may carry
      // financial records, so block the whole batch if non-draft leases are
      // included (they should be terminated and/or archived instead).
      const nonDraftLeases = await db.lease.findMany({
        where: {
          id: { in: leaseIds },
          status: { not: LeaseStatus.DRAFT },
          ...leaseScope(user),
        },
      });

      if (nonDraftLeases.length > 0) {
        return createErrorResponse(
          "Only draft leases can be deleted. Terminate active leases and archive ended ones instead.",
          409
        );
      }

      // The drafts about to go, read under the same scope as the delete.
      const deleting = await db.lease.findMany({
        where: { id: { in: leaseIds }, status: LeaseStatus.DRAFT, ...leaseScope(user) },
        select: { id: true },
      });

      // Perform soft delete (draft leases only)
      const result = await db.lease.updateMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: {
          id: { in: deleting.map((lease) => lease.id) },
          status: LeaseStatus.DRAFT,
          ...leaseScope(user),
        },
        data: { deletedAt: new Date() },
      });

      // A draft renewal deleted before it came into force renews nothing:
      // the contract it was for stops pointing at it.
      await unhookWithdrawnRenewals(deleting.map((lease) => lease.id));

      await recordDomainAudit({
        user,
        request,
        resource: "lease",
        action: AuditAction.DELETE,
        resourceId: leaseIds.join(","),
        resourceName: `${result.count} leases`,
        description: `Soft-deleted ${result.count} draft leases`,
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
        `${result.count} leases deleted successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
