/**
 * PropertyPro - Users API Routes
 * Handle user-related operations with role-based access control
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus, UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";
import {
  USER_CREATE_PERMISSIONS,
  USER_DELETE_PERMISSIONS,
  USER_EDIT_PERMISSIONS,
  canManageTargetUser,
  canViewTargetUser,
  canViewUsers,
} from "@/lib/permissions-manager";
import { checkRoleAssignment } from "@/lib/role-assignment";
import { roleDisplayName } from "@/lib/role-display";
import {
  USER_RESPONSE_SELECT,
  loadGroupNames,
  withRoleNames,
} from "@/lib/user-response";
import {
  assignmentRefusal,
  parseBuildingAssignment,
  type BuildingAssignment,
} from "@/lib/building-assignment";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { setUserPassword } from "@/lib/auth-credentials";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countStaffSeats } from "@/lib/billing/usage";
import { roleConsumesSeat } from "@/lib/billing/seat-guard";
import {
  buildReportResponse,
  canExport,
  EXPORT_DENIED_MESSAGE,
  EXPORT_ROW_LIMIT,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportSheet,
} from "@/lib/reports/export";
import { translations } from "@/locales";
import { businessDay } from "@/lib/dates/business-day";

/**
 * The columns a bulk update may write, across many people at once.
 *
 * It used to be every User column: a caller could set another person's
 * per-person permission grants, their building assignment, their 2FA flags
 * — the grants past the rule that nobody hands out a permission they do not
 * hold (/api/users/[id]/permissions), and the buildings past the one that
 * nobody assigns a building they cannot reach. The bulk screen sends a
 * status or a role; those, and the few preferences a bulk change can
 * reasonably carry, are all it may write.
 */
const BULK_EDITABLE_USER_FIELDS = new Set<string>([
  "role",
  "isActive",
  "emailVerified",
  "tenantStatus",
  "preferredContactMethod",
  "notificationPreferences",
]);

/** Keep only the columns a bulk update may write — see above. */
function sanitizeUserUpdates(
  updates: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(updates)) {
    if (BULK_EDITABLE_USER_FIELDS.has(key)) {
      data[key] = value;
    }
  }
  return data;
}

async function getRoleAccessMap(users: Array<{ role?: string | null }>) {
  const uniqueRoles = [...new Set(users.map((user) => user.role || UserRole.TENANT))];
  const accessEntries = await Promise.all(
    uniqueRoles.map(async (role) => [role, await resolveAccessProfile(role)] as const)
  );

  return new Map(accessEntries);
}

/**
 * Every role name actually in use in this organization, with its access
 * profile resolved.
 *
 * Visibility depends on a user's role, not on the user, so the whole filter can
 * be decided from this small set and then handed to Postgres as `role IN (...)`.
 * The listing used to load every user in the organization and filter in
 * memory before slicing a page out of the result — correct at ten users,
 * increasingly not at ten thousand.
 */
async function getOrgRoleAccessMap() {
  const rows = await db.user.findMany({
    where: { deletedAt: null },
    select: { role: true },
    distinct: ["role"],
  });
  return getRoleAccessMap(rows);
}

// ============================================================================
// GET /api/users - Get all users with filtering and pagination
// ============================================================================

export const GET = withPermissionAndDB(["user_view", "user_management"])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    if (!canViewUsers(user)) {
      return createErrorResponse("Insufficient permissions", 403);
    }

    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "12");
    const search = searchParams.get("search") || "";
    const role = searchParams.get("role") || "";
    const isActive = searchParams.get("isActive");
    const excludeTenant = searchParams.get("excludeTenant") === "true";
    const companyStaffOnly = searchParams.get("companyStaffOnly") === "true";

    // `?format=` downloads the list as filtered — the Employees list's export.
    const format = searchParams.get("format");
    if (format) {
      if (!canExport(user, "user_export", "user_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (!isReportFormat(format)) {
        return createErrorResponse(`Unsupported export format "${format}"`, 400);
      }
    }

    // Build filter query (soft-deleted users are excluded)
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    // Search filter
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: "insensitive" } },
        { lastName: { contains: search, mode: "insensitive" } },
        { email: { contains: search, mode: "insensitive" } },
      ];
    }

    // Role filter - support multiple roles separated by comma
    let roleCondition: string | { in?: string[]; not?: string } | undefined;
    if (role) {
      const roles = role
        .split(",")
        .map((r) => r.trim())
        .filter((r) => r);
      if (roles.length === 1) {
        roleCondition = roles[0];
      } else if (roles.length > 1) {
        roleCondition = { in: roles };
      }
    }

    // Exclude tenants when requested and no specific role filter is applied
    if (excludeTenant) {
      if (!roleCondition) {
        roleCondition = { not: UserRole.TENANT };
      } else if (typeof roleCondition === "string") {
        if (roleCondition === UserRole.TENANT) {
          // Force no tenant results
          roleCondition = { not: UserRole.TENANT };
        }
      } else if (roleCondition.in) {
        const rolesIn = roleCondition.in.filter(
          (r: string) => r !== UserRole.TENANT
        );
        roleCondition =
          rolesIn.length > 0 ? { in: rolesIn } : { not: UserRole.TENANT };
      }
    }

    if (roleCondition !== undefined) {
      where.role = roleCondition;
    }

    // Active status filter
    if (isActive !== null && isActive !== undefined && isActive !== "") {
      where.isActive = isActive === "true";
    }

    const roleAccessMap = await getOrgRoleAccessMap();
    const visibleRoleNames = [...roleAccessMap.entries()]
      .filter(([, targetAccess]) => {
        if (excludeTenant && targetAccess.isTenant) return false;
        if (companyStaffOnly && !targetAccess.isCompanyStaff) return false;
        return canViewTargetUser(user, targetAccess);
      })
      .map(([roleName]) => roleName);

    // The isSelf branch of canViewTargetUser, expressed in SQL: a caller always
    // sees their own row, whatever their role resolves to — but only when they
    // would survive excludeTenant/companyStaffOnly, which the old in-memory
    // pass applied to the caller too. AND-ed with the filters above rather than
    // merged into them, so it can never widen a search or a role filter.
    const visibility: Prisma.UserWhereInput[] = [
      { role: { in: visibleRoleNames } },
    ];
    const selfSurvivesFilters =
      (!excludeTenant || !user.isTenant) &&
      (!companyStaffOnly || user.isCompanyStaff);
    if (selfSurvivesFilters) {
      visibility.push({ id: user.id });
    }
    where.AND = [{ OR: visibility }];

    if (format && isReportFormat(format)) {
      const lang = reportLanguage(searchParams);
      const [everyone, groups] = await Promise.all([
        db.user.findMany({
          where,
          orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
          take: EXPORT_ROW_LIMIT,
          select: USER_RESPONSE_SELECT,
        }),
        loadGroupNames(),
      ]);
      const say = (key: string, english: string) =>
        translations[key]?.[lang] ?? english;
      // A group by its name in the file's language, a built-in role by the
      // catalogue's — never the key a group is stored under.
      const roleName = (role: string) =>
        roleDisplayName(role, {
          group: groups.get(role),
          language: lang,
          t: (key, options) =>
            translations[key]?.[lang] ?? options?.defaultValue ?? key,
        });
      const day = (value: Date | null) =>
        value ? businessDay(value) : "";
      const sheet: ReportSheet<(typeof everyone)[number]> = {
        title: "Employees",
        columns: [
          {
            header: "Name",
            value: (row) => `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim(),
          },
          { header: "Email", value: (row) => row.email ?? "" },
          { header: "Phone", value: (row) => row.phone ?? "" },
          {
            header: "Role",
            value: (row) => roleName(row.role),
          },
          {
            header: "Status",
            value: (row) =>
              row.isActive
                ? say("admin.usersPage.filters.active", "Active")
                : say("admin.usersPage.filters.inactive", "Inactive"),
          },
          { header: "Last login", value: (row) => day(row.lastLogin) },
          { header: "Created", value: (row) => day(row.createdAt) },
        ],
        rows: everyone,
        summary: [["Total", everyone.length]],
      };
      return buildReportResponse(sheet, {
        format,
        fileName: "Employees",
        dateStamp: day(new Date()),
        rtl: isRtlReportRequest(searchParams),
        lang,
      });
    }

    const skip = (page - 1) * limit;
    const [rows, total, groups] = await Promise.all([
      db.user.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        select: USER_RESPONSE_SELECT,
      }),
      db.user.count({ where }),
      loadGroupNames(),
    ]);

    // Each row with its role's names beside it: a group's stored name is a
    // key ("group_2"), and the list is read by people who may not hold
    // Manage roles, so cannot look the group up themselves.
    const users = rows.map((targetUser) => ({
      ...withRoleNames(targetUser, groups),
      accessProfile:
        roleAccessMap.get(targetUser.role || UserRole.TENANT) ?? null,
    }));

    // Calculate pagination info
    const pages = Math.ceil(total / limit);
    const hasNext = page < pages;
    const hasPrev = page > 1;

    return createSuccessResponse({
      users: users,
      pagination: {
        page,
        limit,
        total,
        pages,
        hasNext,
        hasPrev,
      },
    });
  } catch {
    return createErrorResponse("Failed to fetch users", 500);
  }
  }
);

// ============================================================================
// POST /api/users - Create a new user (Admin only)
// ============================================================================

export const POST = withPermissionAndDB([...USER_CREATE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const body = await request.json();

    // Basic validation
    if (!body.email || !body.password || !body.firstName || !body.lastName) {
      return createErrorResponse("Missing required fields", 400);
    }

    // Which compounds and buildings a new employee sees, set on the form that
    // creates them rather than afterwards on the Access tab — so a building
    // supervisor never exists, even for a minute, seeing everything. Held to
    // the Access tab's own rules (lib/building-assignment.ts).
    let buildings: BuildingAssignment = {
      restricted: false,
      compoundIds: [],
      propertyIds: [],
    };
    if (body.buildingScope !== undefined && body.buildingScope !== null) {
      const parsed = parseBuildingAssignment(body.buildingScope);
      if (!parsed.ok) {
        return createErrorResponse(parsed.message, 400);
      }
      buildings = parsed.assignment;
    }

    // Validate role (system role or existing custom role) through the one
    // gate every role-granting path shares — see role-assignment.ts. Creating
    // a plain tenant stays carved out: user_management, which this route
    // already requires, has always been enough for that.
    if (body.role && body.role !== UserRole.TENANT) {
      const decision = await checkRoleAssignment(user, body.role);
      if (decision.error) {
        return createErrorResponse(decision.error, decision.status);
      }
    }

    // Owners and tenants see only their own records under rules of their
    // own; a building assignment on one would be a fact nothing reads.
    const requestedRole = body.role || UserRole.TENANT;
    const requestedAccess = await resolveAccessProfile(requestedRole);
    const isClientAccount = requestedAccess.isOwner || requestedAccess.isTenant;
    if (isClientAccount && buildings.restricted) {
      return createErrorResponse(
        "Building access applies to employees. Owners and tenants already see only their own records.",
        400
      );
    }
    if (!isClientAccount) {
      const refusal = await assignmentRefusal(user, buildings);
      if (refusal) {
        return createErrorResponse(refusal, 403);
      }
    }

    // Billing seats are organization staff accounts. Tenant and property-owner
    // portal users do not consume a paid team seat — roleConsumesSeat is the
    // single answer to that question, and it is what countStaffSeats() counts.
    if (roleConsumesSeat(requestedRole)) {
      await enforcePlanLimit(
        user.organizationId!,
        "members",
        await countStaffSeats(),
      );
    }

    // Check if user already exists
    const existingUser = await db.user.findFirst({
      where: { email: body.email },
    });
    if (existingUser) {
      return createErrorResponse("User with this email already exists", 400);
    }

    // Create new user
    const savedUser = await db.user.create({
      data: {
        firstName: body.firstName,
        lastName: body.lastName,
        name: [body.firstName, body.lastName].filter(Boolean).join(" "),
        email: body.email,
        role: body.role || UserRole.TENANT,
        phone: body.phone || undefined,
        avatar: body.avatar || undefined,
        isActive: body.isActive !== undefined ? body.isActive : true,
        organizationId: user.organizationId!,
        scopeRestricted: buildings.restricted,
        scopedCompoundIds: buildings.compoundIds,
        scopedPropertyIds: buildings.propertyIds,
      },
    });

    // Better Auth keeps the hash on its account record; a brand-new user has
    // no sessions to revoke.
    await setUserPassword(savedUser.id, body.password, {
      revokeSessions: false,
    });

    const context = auditService.extractContextFromRequest(request, user);

    await auditService.logEvent(
      {
        category: AuditCategory.USER_MANAGEMENT,
        action: AuditAction.CREATE,
        severity: AuditSeverity.LOW,
        description: `Created user: ${savedUser.firstName} ${savedUser.lastName}`,
        resourceType: "user",
        resourceId: savedUser.id,
        resourceName: `${savedUser.firstName} ${savedUser.lastName}`,
        newValues: {
          firstName: savedUser.firstName,
          lastName: savedUser.lastName,
          email: savedUser.email,
          role: savedUser.role,
          isActive: savedUser.isActive,
          restricted: savedUser.scopeRestricted,
          compoundIds: savedUser.scopedCompoundIds,
          propertyIds: savedUser.scopedPropertyIds,
        },
        tags: ["user", "create"],
      },
      context
    );

    return createSuccessResponse(
      { data: savedUser },
      "User created successfully"
    );
  } catch (error) {
    return handleApiError(error);
  }
  }
);

// ============================================================================
// PUT /api/users - Bulk update users (Admin only)
// ============================================================================

// Bulk edits leave `withinOwnRights` off: for staff they stay with the
// Administrator, whatever a group is ticked.
export const PUT = withPermissionAndDB([...USER_EDIT_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();
      const { userIds, updates } = body;

      if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
        return createErrorResponse("User IDs are required", 400);
      }

      if (!updates || typeof updates !== "object") {
        return createErrorResponse("Updates are required", 400);
      }

      const ids = userIds.map(String);

      const targetUsers = await db.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, role: true, firstName: true, lastName: true },
      });

      if (targetUsers.length !== ids.length) {
        return createErrorResponse("Some users were not found", 404);
      }

      const roleAccessMap = await getRoleAccessMap(targetUsers);
      const blockedTarget = targetUsers.find((targetUser) => {
        const targetAccess = roleAccessMap.get(targetUser.role || UserRole.TENANT);
        return (
          !targetAccess ||
          !canManageTargetUser(user, targetAccess, {
            isSelf: targetUser.id === user.id,
          })
        );
      });

      if (blockedTarget) {
        return createErrorResponse(
          "You do not have permission to update one or more selected users",
          403
        );
      }

      // Same gate as POST. resolveAccessProfile used to stand in for it here,
      // but it answers with an empty permission set for a role that does not
      // exist — which reads as the tenant tier and passes.
      if (updates.role) {
        const decision = await checkRoleAssignment(user, updates.role);
        if (decision.error) {
          return createErrorResponse(decision.error, decision.status);
        }
      }

      // Remove sensitive/unknown fields from updates
      const data = sanitizeUserUpdates(updates);

      // Keep the derived verification flag in sync with emailVerified
      if ("emailVerified" in data) {
        data.emailVerifiedFlag = Boolean(data.emailVerified);
      }

      let matchedCount = 0;
      let modifiedCount = 0;

      if (data.firstName !== undefined || data.lastName !== undefined) {
        // Name is derived from firstName/lastName (previously a Mongoose
        // hook), so recompute it per user.
        for (const targetUser of targetUsers) {
          const first = (data.firstName ?? targetUser.firstName) as string;
          const last = (data.lastName ?? targetUser.lastName) as string;
          await db.user.update({
            where: { id: targetUser.id },
            data: {
              ...data,
              name: [first, last].filter(Boolean).join(" "),
            },
          });
        }
        matchedCount = targetUsers.length;
        modifiedCount = targetUsers.length;
      } else {
        const result = await db.user.updateMany({
          where: { id: { in: ids } },
          data,
        });
        matchedCount = result.count;
        modifiedCount = result.count;
      }

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.BULK_UPDATE,
          severity: AuditSeverity.MEDIUM,
          description: `Bulk updated ${userIds.length} users`,
          details: { userIds, updates },
          tags: ["user", "bulk_update"],
        },
        auditService.extractContextFromRequest(request, user)
      );

      return createSuccessResponse({
        data: {
          matchedCount,
          modifiedCount,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/users - Bulk deactivate users (Admin only)
// ============================================================================

export const DELETE = withPermissionAndDB([...USER_DELETE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const idsParam = searchParams.get("ids");

      if (!idsParam) {
        return createErrorResponse("User IDs are required", 400);
      }

      const userIds = idsParam.split(",");

      if (userIds.includes(user.id)) {
        return createErrorResponse("You cannot deactivate yourself", 400);
      }

      const targetUsers = await db.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, role: true },
      });

      if (targetUsers.length !== userIds.length) {
        return createErrorResponse("Some users were not found", 404);
      }

      const roleAccessMap = await getRoleAccessMap(targetUsers);
      const blockedTarget = targetUsers.find((targetUser) => {
        const targetAccess = roleAccessMap.get(targetUser.role || UserRole.TENANT);
        return !targetAccess || !canManageTargetUser(user, targetAccess);
      });

      if (blockedTarget) {
        return createErrorResponse(
          "You do not have permission to deactivate one or more selected users",
          403
        );
      }

      const tenantUserIds = targetUsers
        .filter((targetUser) => targetUser.role === UserRole.TENANT)
        .map((targetUser) => targetUser.id);

      if (tenantUserIds.length > 0) {
        const activeLease = await db.lease.count({
          where: {
            tenantId: { in: tenantUserIds },
            status: LeaseStatus.ACTIVE,
            deletedAt: null,
          },
        });

        if (activeLease > 0) {
          return createErrorResponse(
            "Cannot deactivate tenants with active leases. Please terminate the leases first.",
            409
          );
        }
      }

      // Deactivate users instead of deleting them
      const result = await db.user.updateMany({
        where: { id: { in: userIds } },
        data: { isActive: false },
      });

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.BULK_DELETE,
          severity: AuditSeverity.HIGH,
          description: `Bulk deactivated ${userIds.length} users`,
          details: { userIds },
          tags: ["user", "bulk_deactivate"],
        },
        auditService.extractContextFromRequest(request, user)
      );

      return createSuccessResponse({
        data: {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
      });
    } catch (error) {
      return handleApiError(error);
    }
  }
);
