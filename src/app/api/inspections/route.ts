/**
 * PropertyPro - Inspections API Routes
 * CRUD operations for property inspection management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  applyScope,
  inspectionScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import {
  buildReportResponse,
  capExportRows,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  EXPORT_FETCH_LIMIT,
  EXPORT_ROW_LIMIT,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { staffName } from "@/lib/reports/filter-names";
import {
  inspectionConditionText,
  inspectionStatusText,
  inspectionTypeText,
  translatorFor,
} from "@/lib/reports/list-labels";
import {
  businessDay,
  businessRange,
  businessToday,
  parseBusinessDay,
} from "@/lib/dates/business-day";
import { Prisma } from "@/generated/prisma/client";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parsePaginationParams,
  createPaginationInfo,
  parseRequestBody,
  withAccessAndDB,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  inspectionSchema,
  paginationSchema,
  validateSchema,
} from "@/lib/validations";

const INSPECTION_READ_PERMISSIONS = [
  "inspection_view",
  "property_view",
  "property_management",
  "maintenance_view",
  "maintenance_management",
] as const;

// Scheduling an inspection is its own right; the property and maintenance
// umbrellas still cover it, as they always did.
const INSPECTION_WRITE_PERMISSIONS = [
  "inspection_create",
  "property_management",
  "maintenance_management",
] as const;

const INSPECTOR_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  avatar: true,
} as const;

function propertyWithAddress(
  property: Record<string, unknown> | null | undefined
) {
  if (!property) return null;
  return {
    ...property,
    address: {
      street: property.addressStreet,
      city: property.addressCity,
      state: property.addressState,
      zipCode: property.addressZipCode,
      country: property.addressCountry,
    },
  };
}

async function loadInspectionTenants(tenantIds: Array<string | null>) {
  const ids = [...new Set(tenantIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const users = await db.user.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
    },
  });
  return new Map(users.map((row) => [row.id, row as Record<string, unknown>]));
}

async function loadInspectionLeases(leaseIds: Array<string | null>) {
  const ids = [...new Set(leaseIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map<string, Record<string, unknown>>();
  const leases = await db.lease.findMany({
    where: { id: { in: ids } },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  return new Map(leases.map((row) => [row.id, row as Record<string, unknown>]));
}

// ============================================================================
// GET /api/inspections - Get all inspections with pagination and filtering
// ============================================================================

export const GET = withPermissionAndDB([...INSPECTION_READ_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const paginationParams = parsePaginationParams(searchParams);

    const validation = validateSchema(paginationSchema, paginationParams);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    // Build query with filters
    const where: Prisma.InspectionWhereInput = {};

    const status = searchParams.get("status");
    if (status) where.status = status;

    const type = searchParams.get("type");
    if (type) where.type = type;

    const propertyId = searchParams.get("propertyId");
    if (propertyId) where.propertyId = propertyId;

    const inspectorId = searchParams.get("inspectorId");
    if (inspectorId) where.inspectorId = inspectorId;

    const tenantId = searchParams.get("tenantId");
    if (tenantId) where.tenantId = tenantId;

    const overallCondition = searchParams.get("overallCondition");
    if (overallCondition) where.overallCondition = overallCondition;

    // Date range filter: the days from and to, both whole, on the office's
    // calendar. `lte: new Date("2026-10-03")` was midnight at the START of the
    // last day, so a range ending on the 3rd left the 3rd out.
    const fromDay = parseBusinessDay(searchParams.get("fromDate"));
    const toDay = parseBusinessDay(searchParams.get("toDate"));
    const scheduledWithin = businessRange(fromDay, toDay);
    if (scheduledWithin) where.scheduledDate = scheduledWithin;

    // The search box: the building, who inspects, the tenant, the notes. The
    // tenant is a column of ids, not a relation, so the people whose names
    // match are found first.
    const searchTerm = (paginationParams.search ?? "").trim();
    if (searchTerm) {
      const contains = {
        contains: searchTerm,
        mode: Prisma.QueryMode.insensitive,
      };
      const tenants = await db.user.findMany({
        where: { OR: [{ firstName: contains }, { lastName: contains }] },
        select: { id: true },
        take: 1000,
      });
      applyScope(where, {
        OR: [
          { property: { name: contains } },
          { inspector: { firstName: contains } },
          { inspector: { lastName: contains } },
          { notes: contains },
          ...(tenants.length
            ? [{ tenantId: { in: tenants.map((tenant) => tenant.id) } }]
            : []),
        ],
      });
    }

    // AND-ed on last, after every caller-supplied filter. `propertyId` above
    // is assigned straight from the query string, so an intersecting clause is
    // what stops a narrowed employee widening themselves by naming someone
    // else's building.
    applyScope(where, inspectionScope(user));

    const { page = 1, limit = 12, sortBy, sortOrder } = paginationParams;
    const orderBy: Record<string, "asc" | "desc"> = sortBy
      ? { [sortBy]: sortOrder === "asc" ? "asc" : "desc" }
      : { createdAt: "desc" };

    // Same `where`, same order — the file carries what the screen filtered
    // to, not the one page of it that happened to be visible.
    const rawFormat = searchParams.get("format");
    // Export is its own permission, not a by-product of being able to
    // read the list — see canExport.
    if (
      rawFormat &&
      !canExport(user, "inspection_export", "maintenance_management") &&
      !canExport(user, "maintenance_export")
    ) {
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
      const fetched = await db.inspection.findMany({
        where,
        // The list is read newest-scheduled first, as the screen sorts it.
        orderBy: [{ scheduledDate: "desc" }, { id: "asc" }],
        take: EXPORT_FETCH_LIMIT,
        include: {
          property: { select: { name: true, addressCity: true } },
          inspector: { select: INSPECTOR_SELECT },
        },
      });
      const { rows: all, truncated } = capExportRows(fetched);
      const tenantMap = await loadInspectionTenants(all.map((row) => row.tenantId));

      const personName = (
        person: { firstName?: unknown; lastName?: unknown } | null | undefined,
      ) =>
        person
          ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim()
          : "";
      const items = (row: (typeof all)[number]) =>
        Array.isArray(row.items) ? (row.items as Array<{ requiresAttention?: boolean }>) : [];

      const sheet: ReportSheet<(typeof all)[number]> = {
        title: "Inspections",
        columns: [
          { header: "Scheduled", value: (row) => businessDay(row.scheduledDate) },
          { header: "Type", value: (row) => inspectionTypeText(row.type, tr) },
          { header: "Status", value: (row) => inspectionStatusText(row.status, tr) },
          {
            header: "Condition",
            value: (row) => inspectionConditionText(row.overallCondition, tr),
          },
          { header: "Building", value: (row) => row.property?.name ?? "" },
          { header: "City", value: (row) => row.property?.addressCity ?? "" },
          {
            header: "Tenant",
            value: (row) =>
              row.tenantId ? personName(tenantMap.get(row.tenantId)) : "",
          },
          { header: "Inspector", value: (row) => personName(row.inspector) },
          { header: "Items", value: (row) => items(row).length },
          {
            header: "Items needing attention",
            value: (row) => items(row).filter((item) => item.requiresAttention).length,
          },
          { header: "Completed", value: (row) => businessDay(row.completedDate) },
          { header: "Notes", value: (row) => row.notes ?? "" },
        ],
        rows: all,
        filtersSummary: {
          period: { from: fromDay, to: toDay },
          filters: [
            ["Search", searchTerm],
            ["Status", status ? inspectionStatusText(status, tr) : undefined],
            ["Type", type ? inspectionTypeText(type, tr) : undefined],
            [
              "Condition",
              overallCondition ? inspectionConditionText(overallCondition, tr) : undefined,
            ],
            ...(await describeAppliedFilters(user, { propertyId, tenantId })),
            ["Inspector", await staffName(inspectorId)],
          ],
          limit: EXPORT_ROW_LIMIT,
          truncated,
        },
      };

      return buildReportResponse(sheet, {
        format: rawFormat as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang,
        fileName: "Inspections",
        dateStamp: businessToday(),
      });
    }

    const [rows, total] = await Promise.all([
      db.inspection.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        include: {
          property: {
            select: {
              id: true,
              name: true,
              type: true,
              isMultiUnit: true,
              addressStreet: true,
              addressCity: true,
              addressState: true,
              addressZipCode: true,
              addressCountry: true,
              units: true,
            },
          },
          inspector: { select: INSPECTOR_SELECT },
        },
      }),
      db.inspection.count({ where }),
    ]);

    const [tenantMap, leaseMap] = await Promise.all([
      loadInspectionTenants(rows.map((row) => row.tenantId)),
      loadInspectionLeases(rows.map((row) => row.leaseId)),
    ]);

    const pagination = createPaginationInfo(page, limit, total);

    // Transform data
    const transformedData = rows.map((inspection) => {
      const property = propertyWithAddress(inspection.property as never);
      const tenant = inspection.tenantId
        ? tenantMap.get(inspection.tenantId) ?? null
        : null;
      const lease = inspection.leaseId
        ? leaseMap.get(inspection.leaseId) ?? null
        : null;

      return {
        ...inspection,
        propertyId: property ?? inspection.propertyId,
        tenantId: tenant,
        inspectorId: inspection.inspector ?? inspection.inspectorId,
        leaseId: lease,
        property,
        tenant: tenant ? { user: tenant } : null,
        inspector: inspection.inspector,
        lease: lease || null,
      };
    });

    return createSuccessResponse(
      transformedData,
      "Inspections retrieved successfully",
      pagination
    );
  } catch (error) {
    return handleApiError(error);
  }
  }
);

// ============================================================================
// POST /api/inspections - Create a new inspection
// ============================================================================

export const POST = withPermissionAndDB([...INSPECTION_WRITE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    const validation = validateSchema(inspectionSchema as any, body);
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const inspectionData = validation.data as any;

    // Verify property exists
    // Scoped: an inspection cannot be raised against a building this
    // caller was not given.
    const property = await db.property.findFirst({
      where: withScope({ id: inspectionData.propertyId }, propertyScope(user)),
    });
    if (!property) {
      return createErrorResponse("Property not found", 404);
    }

    // Create inspection
    const inspection = await db.inspection.create({
      data: {
        propertyId: inspectionData.propertyId,
        tenantId: inspectionData.tenantId ?? null,
        leaseId: inspectionData.leaseId ?? null,
        type: inspectionData.type,
        status: inspectionData.status,
        scheduledDate: inspectionData.scheduledDate,
        completedDate: inspectionData.completedDate ?? null,
        inspectorId: inspectionData.inspectorId,
        items: inspectionData.items ?? [],
        overallCondition: inspectionData.overallCondition ?? null,
        tenantSignature: inspectionData.tenantSignature ?? undefined,
        inspectorSignature: inspectionData.inspectorSignature ?? undefined,
        photos: inspectionData.photos ?? [],
        notes: inspectionData.notes ?? null,
        organizationId: user.organizationId!,
      },
      include: {
        property: {
          select: {
            id: true,
            name: true,
            type: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
            addressCountry: true,
          },
        },
        inspector: { select: INSPECTOR_SELECT },
      },
    });

    const [tenantMap, leaseMap] = await Promise.all([
      loadInspectionTenants([inspection.tenantId]),
      loadInspectionLeases([inspection.leaseId]),
    ]);

    const propertyObj = propertyWithAddress(inspection.property as never);
    const tenant = inspection.tenantId
      ? tenantMap.get(inspection.tenantId) ?? null
      : null;
    const lease = inspection.leaseId
      ? leaseMap.get(inspection.leaseId) ?? null
      : null;

    const transformedInspection = {
      ...inspection,
      propertyId: propertyObj ?? inspection.propertyId,
      tenantId: tenant,
      inspectorId: inspection.inspector ?? inspection.inspectorId,
      leaseId: lease,
      property: propertyObj,
      tenant: tenant ? { user: tenant } : null,
      inspector: inspection.inspector,
      lease: lease || null,
    };

    return createSuccessResponse(
      transformedInspection,
      "Inspection created successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
  }
);

// ============================================================================
// DELETE /api/inspections - Bulk delete inspections (admin only)
// ============================================================================

export const DELETE = withAccessAndDB({
  permissions: ["bulk_operations", "property_management"],
  requireAllPermissions: true,
})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (!user.isAdmin) {
      return createErrorResponse("Forbidden", 403);
    }

    const { searchParams } = new URL(request.url);
    const inspectionIds = searchParams.get("ids")?.split(",") || [];

    if (inspectionIds.length === 0) {
      return createErrorResponse("Inspection IDs are required", 400);
    }

    // Prevent deleting completed inspections
    const completedInspections = await db.inspection.findMany({
      where: withScope(
        { id: { in: inspectionIds }, status: "completed" },
        inspectionScope(user),
      ),
    });

    if (completedInspections.length > 0) {
      return createErrorResponse(
        "Cannot delete completed inspections.",
        409
      );
    }

    // Soft delete. Scoped like the read above, which on its own only ever
    // looked at this caller's inspections: the ids come from the query
    // string, and one in a building they were not given is left untouched.
    const result = await db.inspection.updateMany({
      where: withScope({ id: { in: inspectionIds } }, inspectionScope(user)),
      data: { deletedAt: new Date() },
    });

    return createSuccessResponse(
      {
        matchedCount: result.count,
        modifiedCount: result.count,
      },
      `${result.count} inspections deleted successfully`
    );
  } catch (error) {
    return handleApiError(error);
  }
  }
);
