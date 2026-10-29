/**
 * PropertyPro - Maintenance Requests API Routes
 * CRUD operations for maintenance request management
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
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
  URGENT_PRIORITIES,
  URGENT_STATUSES,
  maintenanceDaysOverdue,
  sortMaintenance,
} from "@/lib/reports/maintenance-list";
import { assignmentText, translatorFor } from "@/lib/reports/list-labels";
import {
  maintenanceCategoryText,
  maintenancePriorityText,
  maintenanceStatusText,
} from "@/lib/maintenance-labels";
import {
  addBusinessDays,
  businessDay,
  businessDayStart,
  businessPresetRange,
  businessRange,
  businessToday,
  isDayPreset,
} from "@/lib/dates/business-day";
import {
  applyScope,
  maintenanceAllows,
  maintenanceScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { UserRole, MaintenancePriority, MaintenanceStatus } from "@/types";
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
  maintenanceRequestSchema,
  paginationSchema,
  validateSchema,
} from "@/lib/validations";
import { isMaintenanceAssignableRole } from "@/lib/model-access";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { pickSnapshot } from "@/lib/audit/diff";
import {
  maintenanceName,
  maintenanceSnapshot,
} from "@/lib/audit/records/maintenance";
import { compact } from "@/lib/audit/records/shared";

const MAINTENANCE_READ_ACCESS = {
  roles: [UserRole.OWNER, UserRole.TENANT],
  permissions: [
    "maintenance_view",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const MAINTENANCE_WRITE_ACCESS = {
  roles: [UserRole.TENANT],
  permissions: [
    "maintenance_create",
    "maintenance_management",
    "maintenance_assign",
    "work_orders",
  ],
  match: "any" as const,
};

const PROPERTY_LIST_SELECT = {
  id: true,
  name: true,
  type: true,
  isMultiUnit: true,
  addressStreet: true,
  addressCity: true,
  addressState: true,
  addressZipCode: true,
  addressCountry: true,
} as const;

const TENANT_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  tenantStatus: true,
} as const;

const ASSIGNEE_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
} as const;

function withAddress<T extends Record<string, unknown> | null | undefined>(
  property: T
) {
  if (!property) return property ?? null;
  const p = property as Record<string, unknown>;
  return {
    ...p,
    address: {
      street: p.addressStreet,
      city: p.addressCity,
      state: p.addressState,
      zipCode: p.addressZipCode,
      country: p.addressCountry,
    },
  };
}

// ============================================================================
// GET /api/maintenance - Get all maintenance requests with pagination and filtering
// ============================================================================

export const GET = withAccessAndDB(MAINTENANCE_READ_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      const filterParams = {
        ...paginationParams,
        status: searchParams.get("status") || undefined,
        priority: searchParams.get("priority") || undefined,
        category: searchParams.get("category") || undefined,
        propertyId: searchParams.get("propertyId") || undefined,
        unitId: searchParams.get("unitId") || undefined,
        tenantId: searchParams.get("tenantId") || undefined,
        assignedTo: searchParams.get("assignedTo") || undefined,
        emergency: searchParams.get("emergency") === "true",
        overdue: searchParams.get("overdue") === "true",
      };

      const validation = validateSchema(paginationSchema, paginationParams);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const filters = filterParams;
      const where: Prisma.MaintenanceRequestWhereInput = {};

      // See lib/db/scopes.ts.
      applyScope(where, maintenanceScope(user));

      if (filters.status) {
        where.status = filters.status;
      }
      if (filters.priority) {
        where.priority = filters.priority;
      }
      if (filters.category) {
        where.category = filters.category;
      }
      if (filters.propertyId) {
        where.propertyId = filters.propertyId;
      }
      if (filters.unitId) {
        where.unitId = filters.unitId;
      }
      if (filters.tenantId && !user.isTenant) {
        where.tenantId = filters.tenantId;
      }
      if (filters.assignedTo) {
        where.assignedToId = filters.assignedTo;
      }

      if (filters.emergency) {
        where.priority = MaintenancePriority.EMERGENCY;
      }

      if (filters.overdue) {
        // Overdue is a day count on the office's calendar — more days open
        // than the priority allows, as the list's own "overdue" column has
        // it — so the cut-off is the start of a Riyadh day, not "now minus
        // 24 hours" on whatever clock the server keeps.
        const today = businessToday();
        const startedBefore = (days: number) =>
          businessDayStart(addBusinessDays(today, -days));
        const emergencyDate = startedBefore(1);
        const highDate = startedBefore(3);
        const mediumDate = startedBefore(7);
        const lowDate = startedBefore(14);

        where.status = {
          notIn: [MaintenanceStatus.COMPLETED, MaintenanceStatus.CANCELLED],
        };
        where.OR = [
          {
            priority: MaintenancePriority.EMERGENCY,
            createdAt: { lt: emergencyDate },
          },
          { priority: MaintenancePriority.HIGH, createdAt: { lt: highDate } },
          {
            priority: MaintenancePriority.MEDIUM,
            createdAt: { lt: mediumDate },
          },
          { priority: MaintenancePriority.LOW, createdAt: { lt: lowDate } },
        ];
      }

      // The rest of the screen's filters. Each is AND-ed on, so none can
      // replace one written above — the `OR` of the overdue rule, the status
      // the caller named — or the reader's own scope.
      //
      // Search is the box above the table: the request, its description and
      // category, the building, the tenant's name.
      const searchTerm = (paginationParams.search ?? "").trim();
      if (searchTerm) {
        const contains = {
          contains: searchTerm,
          mode: Prisma.QueryMode.insensitive,
        };
        applyScope(where, {
          OR: [
            { title: contains },
            { description: contains },
            { category: contains },
            { property: { name: contains } },
            { tenant: { firstName: contains } },
            { tenant: { lastName: contains } },
          ],
        });
      }

      // The day it was raised: today, this week, this month — on the office's
      // calendar.
      const datePreset = searchParams.get("date");
      const dayWindow = isDayPreset(datePreset)
        ? businessPresetRange(datePreset)
        : null;
      if (dayWindow) {
        applyScope(where, {
          createdAt: businessRange(dayWindow.from, dayWindow.to),
        });
      }

      // Whether anyone is assigned — the screen's assignment filter.
      const assignment = searchParams.get("assigned");
      if (assignment === "assigned") {
        applyScope(where, { assignedToId: { not: null } });
      } else if (assignment === "unassigned") {
        applyScope(where, { assignedToId: null });
      }

      // Urgent: high or emergency, and still open.
      const urgent = searchParams.get("urgent") === "true";
      if (urgent) {
        applyScope(where, {
          priority: { in: [...URGENT_PRIORITIES] },
          status: { in: [...URGENT_STATUSES] },
        });
      }

      const { page = 1, limit = 12, sortBy, sortOrder } = paginationParams;
      const orderBy: Record<string, "asc" | "desc"> = sortBy
        ? { [sortBy]: sortOrder === "asc" ? "asc" : "desc" }
        : { createdAt: "desc" };

      // Same `where`, same order — the file carries what the screen filtered
      // to, not the one page of it that happened to be visible.
      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport.
      if (rawFormat && !canExport(user, "maintenance_export", "maintenance_management")) {
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
        const fetched = await db.maintenanceRequest.findMany({
          where,
          // The screen's sort is by columns a database cannot order by —
          // priority is a rank, cost is the estimate or else the actual — so
          // the order is applied below.
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          take: EXPORT_FETCH_LIMIT,
          include: {
            property: { select: { name: true } },
            tenant: { select: { firstName: true, lastName: true } },
            assignedTo: { select: { firstName: true, lastName: true } },
          },
        });
        const { rows: capped, truncated } = capExportRows(fetched);
        const all = sortMaintenance(capped, sortBy, sortOrder);

        // A request names its unit by id only; the number is read once for
        // the whole list.
        const unitIds = [
          ...new Set(
            all
              .map((row) => row.unitId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const units = unitIds.length
          ? await db.unit.findMany({
              where: { id: { in: unitIds } },
              select: { id: true, unitNumber: true },
            })
          : [];
        const unitNumber = new Map(units.map((unit) => [unit.id, unit.unitNumber]));

        const name = (
          person: { firstName?: string | null; lastName?: string | null } | null,
        ) =>
          person
            ? `${person.firstName ?? ""} ${person.lastName ?? ""}`.trim()
            : "";

        const words = (
          codes: readonly string[],
          text: (code: string) => string,
        ) => codes.map(text).join(", ");

        const sheet: ReportSheet<(typeof all)[number]> = {
          title: "Maintenance",
          columns: [
            { header: "Raised", value: (row) => businessDay(row.createdAt) },
            { header: "Request", value: (row) => row.title },
            {
              header: "Category",
              value: (row) => maintenanceCategoryText(row.category, tr),
            },
            {
              header: "Priority",
              value: (row) => maintenancePriorityText(row.priority, tr),
            },
            {
              header: "Status",
              value: (row) => maintenanceStatusText(row.status, tr),
            },
            { header: "Building", value: (row) => row.property?.name ?? "" },
            {
              header: "Unit",
              value: (row) => (row.unitId ? unitNumber.get(row.unitId) ?? "" : ""),
            },
            { header: "Tenant", value: (row) => name(row.tenant) },
            { header: "Assigned to", value: (row) => name(row.assignedTo) },
            {
              header: "Estimated",
              value: (row) => Number(row.estimatedCost ?? 0),
            },
            { header: "Actual", value: (row) => Number(row.actualCost ?? 0) },
            {
              header: "Days overdue",
              value: (row) => maintenanceDaysOverdue(row),
            },
          ],
          rows: all,
          summary: [
            [
              "Estimated total",
              all.reduce((sum, row) => sum + Number(row.estimatedCost ?? 0), 0),
            ],
            [
              "Actual total",
              all.reduce((sum, row) => sum + Number(row.actualCost ?? 0), 0),
            ],
          ],
          filtersSummary: {
            period: dayWindow ?? {},
            filters: [
              ["Search", searchTerm],
              [
                "Status",
                filters.status
                  ? maintenanceStatusText(filters.status, tr)
                  : urgent
                    ? words(URGENT_STATUSES, (code) => maintenanceStatusText(code, tr))
                    : undefined,
              ],
              [
                "Priority",
                filters.priority
                  ? maintenancePriorityText(filters.priority, tr)
                  : filters.emergency
                    ? maintenancePriorityText(MaintenancePriority.EMERGENCY, tr)
                    : urgent
                      ? words(URGENT_PRIORITIES, (code) =>
                          maintenancePriorityText(code, tr),
                        )
                      : undefined,
              ],
              [
                "Category",
                filters.category
                  ? maintenanceCategoryText(filters.category, tr)
                  : undefined,
              ],
              [
                "Assignment",
                assignment === "assigned" || assignment === "unassigned"
                  ? assignmentText(assignment === "assigned", tr)
                  : undefined,
              ],
              ["Overdue", filters.overdue],
              ...(await describeAppliedFilters(user, {
                propertyId: filters.propertyId,
                tenantId: filters.tenantId && !user.isTenant ? filters.tenantId : undefined,
              })),
              ["Assigned to", await staffName(filters.assignedTo)],
            ],
            limit: EXPORT_ROW_LIMIT,
            truncated,
          },
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang,
          fileName: "Maintenance requests",
          dateStamp: businessToday(),
        });
      }

      const [rows, total] = await Promise.all([
        db.maintenanceRequest.findMany({
          where,
          orderBy,
          skip: (page - 1) * limit,
          take: limit,
          include: {
            property: {
              select: { ...PROPERTY_LIST_SELECT, units: true },
            },
            tenant: { select: TENANT_SELECT },
            assignedTo: { select: ASSIGNEE_SELECT },
          },
        }),
        db.maintenanceRequest.count({ where }),
      ]);

      const pagination = createPaginationInfo(page, limit, total);

      const transformedData = rows.map((row) => {
        const property = withAddress(row.property as never) as
          | (Record<string, unknown> & { units?: Array<{ id: string }> })
          | null;

        let unit: unknown = null;
        if (row.unitId && property?.units) {
          unit =
            property.units.find(
              (embeddedUnit) => embeddedUnit.id === row.unitId
            ) ?? null;
        }

        return {
          ...row,
          propertyId: property ?? row.propertyId,
          tenantId: row.tenant ?? row.tenantId,
          assignedTo: row.assignedTo ?? null,
          property,
          unit,
          tenant: row.tenant ? { user: row.tenant } : null,
        };
      });

      return createSuccessResponse(
        transformedData,
        "Maintenance requests retrieved successfully",
        pagination
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/maintenance - Create a new maintenance request
// ============================================================================

export const POST = withAccessAndDB(MAINTENANCE_WRITE_ACCESS)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const validation = validateSchema(maintenanceRequestSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const maintenanceData = validation.data;
      // Scoped: the building comes from the body. For a tenant that is the
      // buildings they hold a live lease in, so a request cannot be filed on
      // any other — nor its name and address read back in the response —
      // as the emergency route already refuses.
      const property = await db.property.findFirst({
        where: withScope(
          { id: maintenanceData.propertyId },
          propertyScope(user),
        ),
        include: { units: true },
      });
      if (!property) {
        return createErrorResponse("Property not found", 404);
      }

      if (maintenanceData.unitId) {
        const unitExists = property.units.some(
          (unit) => unit.id === maintenanceData.unitId
        );
        if (!unitExists) {
          return createErrorResponse(
            "Unit not found in the specified property",
            404
          );
        }
      }

      const tenant = await db.user.findFirst({
        where: { id: maintenanceData.tenantId, role: UserRole.TENANT },
      });
      if (!tenant) {
        return createErrorResponse("Tenant not found", 404);
      }

      // A tenant may only file on their own behalf — see lib/db/scopes.ts.
      // The row carries its building as well: for an owner or a narrowed
      // employee the rule is keyed on it, and handed half a row it refused
      // every one of them.
      if (
        !maintenanceAllows(user, {
          tenantId: maintenanceData.tenantId,
          propertyId: maintenanceData.propertyId,
        })
      ) {
        return createErrorResponse(
          "You can only create maintenance requests for yourself",
          403
        );
      }

      if (maintenanceData.assignedTo) {
        const assignedUser = await db.user.findFirst({
          where: { id: maintenanceData.assignedTo },
        });
        if (!assignedUser) {
          return createErrorResponse("Assigned user not found", 404);
        }

        // Replaces the old pre-save hook check: assignees must hold a
        // maintenance-assignable role.
        if (!(await isMaintenanceAssignableRole(assignedUser.role))) {
          return createErrorResponse(
            "User cannot be assigned maintenance requests",
            400
          );
        }
      }

      const { assignedTo, ...requestData } = maintenanceData;

      const maintenanceRequest = await db.maintenanceRequest.create({
        data: {
          ...requestData,
          assignedToId: assignedTo ?? null,
          status: MaintenanceStatus.SUBMITTED,
          organizationId: user.organizationId!,
        },
        include: {
          property: { select: PROPERTY_LIST_SELECT },
          tenant: { select: TENANT_SELECT },
          assignedTo: { select: ASSIGNEE_SELECT },
        },
      });

      // An emergency reaches staff by SMS/WhatsApp at once, where the office
      // sends that (Settings → Messaging).
      if (maintenanceRequest.priority === MaintenancePriority.EMERGENCY) {
        void import("@/lib/messaging/events").then(
          ({ notifyMaintenanceEmergency }) =>
            notifyMaintenanceEmergency(maintenanceRequest.id),
        );
      }

      void recordActivity({
        action: AuditAction.CREATE,
        recordType: "maintenance",
        recordId: maintenanceRequest.id,
        recordName: maintenanceName(maintenanceRequest),
        after: compact(maintenanceSnapshot(maintenanceRequest)),
      });

      const property2 = withAddress(maintenanceRequest.property as never);

      return createSuccessResponse(
        {
          ...maintenanceRequest,
          propertyId: property2 ?? maintenanceRequest.propertyId,
          tenantId: maintenanceRequest.tenant ?? maintenanceRequest.tenantId,
          assignedTo: maintenanceRequest.assignedTo ?? null,
          property: property2,
          tenant: {
            user: maintenanceRequest.tenant || {},
          },
        },
        "Maintenance request created successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/maintenance - Bulk update maintenance requests
// ============================================================================

const BULK_UPDATABLE_FIELDS = [
  "title",
  "description",
  "priority",
  "status",
  "category",
  "contactPhone",
  "images",
  "estimatedCost",
  "actualCost",
  "scheduledDate",
  "completedDate",
  "notes",
  "unitId",
] as const;

/** What a bulk edit's entry leaves out: photo addresses and long texts. */
const BULK_AUDIT_SKIP = new Set(["images", "description", "notes"]);

export const PUT = withPermissionAndDB(
  ["maintenance_management", "bulk_operations"],
  { requireAllPermissions: true }
)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Forbidden", 403);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { requestIds, updates } = body;

      if (!Array.isArray(requestIds) || requestIds.length === 0) {
        return createErrorResponse("Request IDs array is required", 400);
      }

      if (!updates || typeof updates !== "object") {
        return createErrorResponse("Updates object is required", 400);
      }

      const allowedUpdates: Record<string, unknown> = {};
      for (const field of BULK_UPDATABLE_FIELDS) {
        if (updates[field] !== undefined) {
          allowedUpdates[field] = updates[field];
        }
      }
      if (updates.assignedTo !== undefined) {
        allowedUpdates.assignedToId = updates.assignedTo;
      }

      // What these requests held before the edit: one value set across many
      // rows that each held something different. The photos and the long
      // texts stay out of the entry.
      const editedKeys = Object.keys(allowedUpdates).filter(
        (key) => !BULK_AUDIT_SKIP.has(key),
      );
      const before = await db.maintenanceRequest.findMany({
        where: { id: { in: requestIds }, ...maintenanceScope(user) },
        select: {
          id: true,
          ...Object.fromEntries(
            editedKeys
              .filter((key) => key in Prisma.MaintenanceRequestScalarFieldEnum)
              .map((key) => [key, true]),
          ),
        },
      });

      const result = await db.maintenanceRequest.updateMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: { id: { in: requestIds }, ...maintenanceScope(user) },
        data: allowedUpdates,
      });

      void recordActivity({
        action: AuditAction.BULK_UPDATE,
        recordType: "maintenance",
        messageKey: "admin.audit.msg.maintenance_bulk_update",
        messageParams: { count: result.count },
        before: {
          rows: before
            .slice(0, 50)
            .map((row) => pickSnapshot(row, ["id", ...editedKeys])),
        },
        after: pickSnapshot(allowedUpdates, editedKeys),
        details: { count: result.count },
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
        `${result.count} maintenance requests updated successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/maintenance - Bulk delete maintenance requests
// ============================================================================

export const DELETE = withPermissionAndDB(
  ["maintenance_management", "bulk_operations"],
  { requireAllPermissions: true }
)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Forbidden", 403);
      }

      const { searchParams } = new URL(request.url);
      const requestIds = searchParams.get("ids")?.split(",") || [];

      if (requestIds.length === 0) {
        return createErrorResponse("Request IDs are required", 400);
      }

      const completedRequests = await db.maintenanceRequest.findMany({
        where: {
          id: { in: requestIds },
          status: MaintenanceStatus.COMPLETED,
          ...maintenanceScope(user),
        },
      });

      if (completedRequests.length > 0) {
        return createErrorResponse(
          "Cannot delete completed maintenance requests.",
          409
        );
      }

      const result = await db.maintenanceRequest.updateMany({
        // Intersected, not assigned: the ids come from the request, so
        // without this a caller narrowed to some buildings could act on
        // rows in any of the others. Rows outside the scope are simply
        // not touched, and `count` then reports what really happened.
        where: { id: { in: requestIds }, ...maintenanceScope(user) },
        data: { deletedAt: new Date() },
      });

      void recordActivity({
        action: AuditAction.BULK_DELETE,
        recordType: "maintenance",
        messageKey: "admin.audit.msg.maintenance_bulk_delete",
        messageParams: { count: result.count },
        details: { count: result.count },
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
        `${result.count} maintenance requests deleted successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
