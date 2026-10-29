/**
 * PropertyPro - Emergency Maintenance Requests API Routes
 * Specialized API endpoints for emergency maintenance request management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  applyScope,
  maintenanceScope,
  propertyScope,
  withScope,
} from "@/lib/db/scopes";
import { Prisma } from "@/generated/prisma/client";
import { MaintenancePriority, MaintenanceStatus } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  maintenanceRequestSchema,
  validateSchema,
} from "@/lib/validations";
import { hasAnyPermission } from "@/lib/role-utils";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { z } from "zod";
import {
  buildReportResponse,
  canExport,
  capExportRows,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  EXPORT_DENIED_MESSAGE,
  EXPORT_ROW_LIMIT,
  type ReportFormat,
  type ReportSheet,
} from "@/lib/reports/export";
import { describeAppliedFilters } from "@/lib/report-filters/describe";
import { staffName } from "@/lib/reports/filter-names";
import {
  assignmentText,
  responseTimeText,
  translatorFor,
} from "@/lib/reports/list-labels";
import {
  maintenancePriorityText,
  maintenanceStatusText,
} from "@/lib/maintenance-labels";
import {
  businessDay,
  businessDayStart,
  businessToday,
} from "@/lib/dates/business-day";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import {
  maintenanceName,
  maintenanceSnapshot,
} from "@/lib/audit/records/maintenance";
import { compact } from "@/lib/audit/records/shared";

const EMERGENCY_STAFF_PERMISSIONS = [
  "maintenance_management",
  "maintenance_assign",
  "work_orders",
];

function canHandleEmergencyMaintenance(profile: {
  isCompanyStaff: boolean;
  permissions: string[];
}) {
  return (
    profile.isCompanyStaff &&
    hasAnyPermission(profile.permissions, EMERGENCY_STAFF_PERMISSIONS)
  );
}

const ACTIVE_STATUSES = [
  MaintenanceStatus.SUBMITTED,
  MaintenanceStatus.ASSIGNED,
  MaintenanceStatus.IN_PROGRESS,
] as string[];

const CLOSED_STATUSES = [
  MaintenanceStatus.COMPLETED,
  MaintenanceStatus.CANCELLED,
] as string[];

function hoursSince(date: Date, now: Date): number {
  return (now.getTime() - date.getTime()) / (1000 * 60 * 60);
}

function computeUrgencyLevel(status: string, hours: number): string {
  if (CLOSED_STATUSES.includes(status)) return "completed";
  if (hours > 4) return "critical";
  if (hours > 2) return "overdue";
  return "normal";
}

// ============================================================================
// GET /api/maintenance/emergency - Get emergency maintenance requests
// ============================================================================

export const GET = withPermissionAndDB("maintenance_management")(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { searchParams } = new URL(request.url);
    const paginationParams = parsePaginationParams(searchParams);

    // Emergency-specific filters
    const search = (searchParams.get("search") || "").trim();
    const status = searchParams.get("status") || "all";
    const responseTime = searchParams.get("responseTime") || "all"; // overdue, urgent, normal
    const propertyId = searchParams.get("propertyId");
    const assignedTo = searchParams.get("assignedTo");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = searchParams.get("sortOrder") || "desc";

    // Build base query for emergency requests
    const where: Prisma.MaintenanceRequestWhereInput = {
      priority: MaintenancePriority.EMERGENCY,
      deletedAt: null,
    };

    // Apply status filter - by default, exclude completed/cancelled to show only active emergencies
    if (status !== "all") {
      if (status === "active") {
        where.status = { in: ACTIVE_STATUSES };
      } else {
        where.status = status;
      }
    } else {
      // Default: exclude completed and cancelled items
      where.status = { notIn: CLOSED_STATUSES };
    }

    // Apply property filter
    if (propertyId) {
      where.propertyId = propertyId;
    }

    // Apply assigned user filter. "assigned" is the screen's own option —
    // anyone — not a user's id, which matched nothing at all.
    if (assignedTo) {
      if (assignedTo === "unassigned") {
        where.assignedToId = null;
      } else if (assignedTo === "assigned") {
        where.assignedToId = { not: null };
      } else {
        where.assignedToId = assignedTo;
      }
    }

    // Role-based access control
    // Single company architecture - Managers can view all emergency maintenance requests

    // A narrowed employee sees emergencies in their own buildings only.
    // AND-ed on, because `propertyId` above comes from the query string.
    applyScope(where, maintenanceScope(user));

    const now = new Date();
    const rows = await db.maintenanceRequest.findMany({
      where,
      include: {
        property: {
          select: {
            id: true,
            name: true,
            addressStreet: true,
            addressCity: true,
            addressState: true,
            addressZipCode: true,
          },
        },
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            avatar: true,
          },
        },
        assignedTo: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        },
      },
    });

    // Project rows the way the old aggregation pipeline did
    let projected = rows.map((row) => {
      const hours = hoursSince(row.createdAt, now);
      const isOverdue = !CLOSED_STATUSES.includes(row.status) && hours > 2;
      const urgencyLevel = computeUrgencyLevel(row.status, hours);

      const property = row.property
        ? {
            id: row.property.id,
            name: row.property.name,
            address: `${row.property.addressStreet}, ${row.property.addressCity}, ${row.property.addressState} ${row.property.addressZipCode}`,
          }
        : {};

      return {
        id: row.id,
        title: row.title,
        description: row.description,
        priority: row.priority,
        status: row.status,
        category: row.category,
        images: row.images,
        estimatedCost: row.estimatedCost,
        actualCost: row.actualCost,
        scheduledDate: row.scheduledDate,
        completedDate: row.completedDate,
        notes: row.notes,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        hoursSinceCreation: hours,
        isOverdue,
        urgencyLevel,
        property,
        tenant: row.tenant ?? {},
        assignedUser: row.assignedTo ?? {},
      };
    });

    // Apply response time filter
    if (responseTime !== "all") {
      projected = projected.filter((item) =>
        responseTime === "overdue"
          ? ["overdue", "critical"].includes(item.urgencyLevel)
          : item.urgencyLevel === responseTime
      );
    }

    // Apply search across request, property, tenant and assignee fields
    if (search) {
      const needle = search.toLowerCase();
      const matches = (value: unknown) =>
        typeof value === "string" && value.toLowerCase().includes(needle);

      projected = projected.filter((item) => {
        const property = item.property as Record<string, unknown>;
        const tenant = item.tenant as Record<string, unknown>;
        const assignedUser = item.assignedUser as Record<string, unknown>;
        return (
          matches(item.title) ||
          matches(item.description) ||
          matches(item.category) ||
          matches(property?.name) ||
          matches(property?.address) ||
          matches(tenant?.firstName) ||
          matches(tenant?.lastName) ||
          matches(tenant?.email) ||
          matches(assignedUser?.firstName) ||
          matches(assignedUser?.lastName) ||
          matches(assignedUser?.email)
        );
      });
    }

    // Sort. "property.name" is a path into the row, as the screen's own sort
    // option writes it.
    const direction = sortOrder === "desc" ? -1 : 1;
    const sortValue = (item: unknown): unknown =>
      sortBy
        .split(".")
        .reduce<unknown>(
          (value, key) =>
            value && typeof value === "object"
              ? (value as Record<string, unknown>)[key]
              : undefined,
          item,
        );
    projected.sort((a, b) => {
      const av = sortValue(a);
      const bv = sortValue(b);
      if (av === bv) return 0;
      if (av === null || av === undefined) return -direction;
      if (bv === null || bv === undefined) return direction;
      if (av instanceof Date && bv instanceof Date) {
        return (av.getTime() - bv.getTime()) * direction;
      }
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * direction;
      }
      return String(av).localeCompare(String(bv)) * direction;
    });

    // The list as a file: every emergency the filters match — not the one
    // page of them on screen — in the order the screen has them in.
    const rawFormat = searchParams.get("format");
    if (rawFormat) {
      if (!canExport(user, "maintenance_export", "maintenance_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (!isReportFormat(rawFormat)) {
        return createErrorResponse(
          `Unsupported export format "${rawFormat}"`,
          400,
        );
      }

      const lang = reportLanguage(searchParams);
      const tr = translatorFor(lang);
      const { rows: listed, truncated } = capExportRows(projected);
      const fullName = (person: unknown) => {
        const named = person as { firstName?: string; lastName?: string } | null;
        return named
          ? `${named.firstName ?? ""} ${named.lastName ?? ""}`.trim()
          : "";
      };

      const sheet: ReportSheet<(typeof listed)[number]> = {
        title: "Emergency requests",
        columns: [
          { header: "Raised", value: (row) => businessDay(row.createdAt) },
          { header: "Request", value: (row) => row.title },
          {
            header: "Status",
            value: (row) => maintenanceStatusText(row.status, tr),
          },
          {
            header: "Urgency",
            value: (row) => responseTimeText(row.urgencyLevel, tr),
          },
          {
            header: "Hours open",
            value: (row) => Math.round(row.hoursSinceCreation),
          },
          { header: "Category", value: (row) => row.category },
          {
            header: "Building",
            value: (row) => (row.property as { name?: string }).name ?? "",
          },
          { header: "Tenant", value: (row) => fullName(row.tenant) },
          {
            header: "Phone",
            value: (row) => (row.tenant as { phone?: string }).phone ?? "",
          },
          {
            header: "Assigned to",
            value: (row) =>
              fullName(row.assignedUser) ||
              assignmentText(false, tr),
          },
        ],
        rows: listed,
        filtersSummary: {
          period: {},
          filters: [
            ["Search", search],
            [
              "Priority",
              maintenancePriorityText(MaintenancePriority.EMERGENCY, tr),
            ],
            [
              "Status",
              // Without a status the list holds what is still open.
              status === "all" || status === "active"
                ? tr("maintenance.emergency.list.filters.activeStatus", "Active")
                : maintenanceStatusText(status, tr),
            ],
            [
              "Response time",
              responseTime !== "all" ? responseTimeText(responseTime, tr) : undefined,
            ],
            ...(await describeAppliedFilters(user, { propertyId })),
            [
              "Assignment",
              assignedTo === "assigned" || assignedTo === "unassigned"
                ? assignmentText(assignedTo === "assigned", tr)
                : undefined,
            ],
            [
              "Assigned to",
              assignedTo && assignedTo !== "assigned" && assignedTo !== "unassigned"
                ? await staffName(assignedTo)
                : undefined,
            ],
          ],
          limit: EXPORT_ROW_LIMIT,
          truncated,
        },
      };

      return buildReportResponse(sheet, {
        format: rawFormat as ReportFormat,
        rtl: isRtlReportRequest(searchParams),
        lang,
        fileName: "Emergency requests",
        dateStamp: businessToday(),
        // "Print" opens the PDF's own print dialog.
        autoPrint:
          rawFormat === "pdf" && searchParams.get("print") === "1",
      });
    }

    // Paginate in memory (mirrors the old $skip/$limit stages)
    const { page = 1, limit = 12 } = paginationParams;
    const skip = ((page || 1) - 1) * (limit || 12);
    const total = projected.length;
    const pages = Math.ceil(total / (limit || 12));
    const data = projected.slice(skip, skip + (limit || 12));

    const result = {
      data,
      pagination: {
        page,
        limit,
        total,
        pages,
      },
    };

    // Get emergency statistics - only count active emergencies (exclude completed/cancelled)
    // Today began at Riyadh's midnight, not the server's.
    const startOfToday = businessDayStart(businessToday(now));
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const statRows = await db.maintenanceRequest.findMany({
      where: {
        priority: MaintenancePriority.EMERGENCY,
        deletedAt: null,
        status: { notIn: CLOSED_STATUSES },
      },
      select: {
        status: true,
        assignedToId: true,
        createdAt: true,
        completedDate: true,
      },
    });

    let statistics: Record<string, unknown>;
    if (statRows.length === 0) {
      statistics = {
        total: 0,
        active: 0,
        critical: 0,
        overdue: 0,
        completed: 0,
        unassigned: 0,
        avgResponseTime: 0,
        escalated: 0,
        todayCreated: 0,
        weekCreated: 0,
      };
    } else {
      const responseTimes: number[] = [];
      let active = 0;
      let critical = 0;
      let overdue = 0;
      let completed = 0;
      let unassigned = 0;
      let todayCreated = 0;
      let weekCreated = 0;

      for (const row of statRows) {
        const hours = hoursSince(row.createdAt, now);
        const rowOverdue = !CLOSED_STATUSES.includes(row.status) && hours > 2;

        if (ACTIVE_STATUSES.includes(row.status)) active += 1;
        if (!CLOSED_STATUSES.includes(row.status) && hours > 4) critical += 1;
        if (rowOverdue) overdue += 1;
        if (row.status === MaintenanceStatus.COMPLETED) completed += 1;
        if (!row.assignedToId && ACTIVE_STATUSES.includes(row.status)) {
          unassigned += 1;
        }
        if (row.createdAt >= startOfToday) todayCreated += 1;
        if (row.createdAt >= sevenDaysAgo) weekCreated += 1;
        if (row.status === MaintenanceStatus.COMPLETED && row.completedDate) {
          responseTimes.push(hoursSince(row.createdAt, row.completedDate));
        }
      }

      statistics = {
        total: statRows.length,
        active,
        critical,
        overdue,
        completed,
        unassigned,
        todayCreated,
        weekCreated,
        avgResponseTime:
          responseTimes.length > 0
            ? responseTimes.reduce((sum, value) => sum + value, 0) /
              responseTimes.length
            : null,
        escalated: 0,
      };
    }

    return createSuccessResponse(
      {
        requests: result.data,
        pagination: result.pagination,
        statistics,
      },
      "Emergency maintenance requests retrieved successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});

// ============================================================================
// POST /api/maintenance/emergency - Create emergency maintenance request
// ============================================================================

export const POST = withPermissionAndDB("maintenance_management")(async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    // Validate request body with emergency-specific requirements
    const emergencySchema = maintenanceRequestSchema.extend({
      priority: z.literal(MaintenancePriority.EMERGENCY),
      category: z.enum([
        "Emergency",
        "Plumbing",
        "Electrical",
        "HVAC",
        "Security",
        "Other",
      ]),
      contactPhone: z.string().optional(),
      emergencyType: z
        .enum([
          "water_leak",
          "electrical_hazard",
          "gas_leak",
          "security_breach",
          "fire_hazard",
          "structural_damage",
          "hvac_failure",
          "other",
        ])
        .optional(),
    });

    const validation = validateSchema(emergencySchema, {
      ...body,
      priority: MaintenancePriority.EMERGENCY, // Force emergency priority
    });

    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }

    const emergencyData = validation.data;

    // Verify property exists, and that it is one this caller holds — the id
    // comes from the request body.
    const property = await db.property.findFirst({
      where: withScope({ id: emergencyData.propertyId }, propertyScope(user)),
    });
    if (!property) {
      return createErrorResponse("Property not found", 404);
    }

    const tenant = await db.user.findFirst({
      where: { id: emergencyData.tenantId },
    });
    if (!tenant || !tenant.isActive) {
      return createErrorResponse("Tenant not found", 404);
    }

    const tenantAccessProfile = await resolveAccessProfile(tenant.role);
    if (!tenantAccessProfile.isTenant) {
      return createErrorResponse("Selected user is not a tenant account", 400);
    }

    let assignedTo = emergencyData.assignedTo;
    if (!assignedTo) {
      const availableStaff = await db.user.findMany({
        where: { isActive: true },
        select: { id: true, role: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      });

      for (const staffUser of availableStaff) {
        const staffAccessProfile = await resolveAccessProfile(staffUser.role);
        if (!canHandleEmergencyMaintenance(staffAccessProfile)) {
          continue;
        }

        assignedTo = staffUser.id;
        break;
      }
    }

    // Create emergency maintenance request (drop the schema-only fields)
    const {
      assignedTo: _assignedTo,
      emergencyType: _emergencyType,
      ...requestData
    } = emergencyData;

    const emergencyRequest = await db.maintenanceRequest.create({
      data: {
        ...requestData,
        assignedToId: assignedTo ?? null,
        status: assignedTo
          ? MaintenanceStatus.ASSIGNED
          : MaintenanceStatus.SUBMITTED,
        priority: MaintenancePriority.EMERGENCY,
        category: emergencyData.category || "Emergency",
        organizationId: user.organizationId!,
      },
    });

    // Populate the created request for response
    const populated = await db.maintenanceRequest.findFirst({
      where: { id: emergencyRequest.id },
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
          },
        },
        tenant: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        assignedTo: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    const populatedRequest = populated
      ? {
          ...populated,
          propertyId: populated.property
            ? {
                ...populated.property,
                address: {
                  street: populated.property.addressStreet,
                  city: populated.property.addressCity,
                  state: populated.property.addressState,
                  zipCode: populated.property.addressZipCode,
                  country: populated.property.addressCountry,
                },
              }
            : populated.propertyId,
          tenantId: populated.tenant ?? populated.tenantId,
          assignedTo: populated.assignedTo ?? null,
          property: undefined,
          tenant: undefined,
        }
      : null;

    // Raised as an emergency: the entry carries its priority and who it went
    // to (the first member of staff who can take it, when none was named).
    void recordActivity({
      action: AuditAction.CREATE,
      recordType: "maintenance",
      recordId: emergencyRequest.id,
      recordName: maintenanceName(emergencyRequest),
      after: compact(maintenanceSnapshot(populated ?? emergencyRequest)),
    });

    // Staff hear by SMS/WhatsApp at once, where the office sends that
    // (Settings → Messaging). Email and push are still to come.
    void import("@/lib/messaging/events").then(
      ({ notifyMaintenanceEmergency }) =>
        notifyMaintenanceEmergency(emergencyRequest.id),
    );

    return createSuccessResponse(
      populatedRequest,
      "Emergency maintenance request created successfully",
    );
  } catch (error) {
    return handleApiError(error);
  }
});
