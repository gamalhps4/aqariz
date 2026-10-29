/**
 * PropertyPro - Tenants API Routes
 * CRUD operations for tenant management
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { applyScope, tenantRecordScope, withScope } from "@/lib/db/scopes";
import { tenantIdsInScope } from "@/lib/db/tenant-scope";
import {
  EXPORT_ROW_LIMIT,
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";

import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countTenantAccounts } from "@/lib/billing/usage";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus, UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parsePaginationParams,
  createPaginationInfo,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  userSchema,
  personEmailSchema,
  paginationSchema,
  validateSchema,
} from "@/lib/validations";
import { withUserNameDerivation } from "@/lib/tenant-status";
import { normalizeEntityType } from "@/lib/full-name";
import {
  PERSON_FIELD_MESSAGES,
  readOptionalEmail,
  readPersonName,
} from "@/lib/person-fields";
import { isEmailTaken } from "@/lib/person-email";
import { archiveTenantRecords } from "@/lib/tenant-archive";
import { encryptSensitiveValue } from "@/lib/security/field-encryption";
import {
  setUserPassword,
  validatePasswordStrength,
} from "@/lib/auth-credentials";
import {
  createTenantInvitationToken,
  type TenantInvitationData,
} from "@/lib/invitation-utils";
import { emailService } from "@/lib/email-service";
import { authDb } from "@/lib/db/prisma";
import { z } from "zod";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { businessDay, businessToday } from "@/lib/dates/business-day";

// Schema for tenants listing filters (extends pagination with status)
const tenantFilterSchema = paginationSchema.extend({
  status: z
    .enum([
      "pending",
      "approved",
      "active",
      "inactive",
      "moved_out",
      "terminated",
      "under_review",
      "application_submitted",
    ])
    .optional(),
  propertyId: z.string().optional(),
});

/** Never expose the (encrypted) SSN through the tenants API. (User rows no
 * longer carry ssn at all — this now only strips it from Tenant profiles.) */
function stripSsn<T extends object>(row: T) {
  const { ssn, ...rest } = row as T & { ssn?: unknown };
  void ssn;
  return rest;
}

async function addActiveLeaseMetadata(tenants: any[]) {
  if (!Array.isArray(tenants) || tenants.length === 0) {
    return [];
  }

  const tenantIds = tenants.map((tenant) => tenant.id).filter(Boolean);
  if (tenantIds.length === 0) {
    return tenants.map((tenant) => ({
      ...tenant,
      hasActiveLease: false,
      activeLeaseCount: 0,
    }));
  }

  const activeLeaseCounts = await db.lease.groupBy({
    by: ["tenantId"],
    where: {
      tenantId: { in: tenantIds },
      status: LeaseStatus.ACTIVE,
      deletedAt: null,
    },
    _count: { _all: true },
  });

  const countByTenantId = new Map(
    activeLeaseCounts.map((item) => [item.tenantId, item._count._all])
  );

  return tenants.map((tenant) => {
    const activeLeaseCount = countByTenantId.get(tenant.id) || 0;

    return {
      ...tenant,
      hasActiveLease: activeLeaseCount > 0,
      activeLeaseCount,
    };
  });
}

// ============================================================================
// GET /api/tenants - Get all tenants with pagination and filtering
// ============================================================================

export const GET = withPermissionAndDB(["tenant_view", "tenant_management"])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = new URL(request.url);
      const paginationParams = parsePaginationParams(searchParams);

      // Parse filter parameters
      const filterParams = {
        ...paginationParams,
        status: searchParams.get("status") || undefined,
        propertyId: searchParams.get("propertyId") || undefined,
      };

      // Validate filter parameters (use tenant-specific filter schema)
      const validation = validateSchema(tenantFilterSchema, filterParams);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const filters = validation.data;

      // Build query based on user role and filters
      const where: Prisma.UserWhereInput = {
        role: UserRole.TENANT, // Only fetch users with tenant role
        deletedAt: null, // Exclude soft-deleted tenants
      };

      // Apply filters - support both legacy and new status filtering
      let statusOr: Prisma.UserWhereInput[] | null = null;
      if (filters.status) {
        switch (filters.status) {
          case "pending":
            // Legacy support: map to new status system
            statusOr = [
              { tenantStatus: "application_submitted" },
              { tenantStatus: "under_review" },
            ];
            break;
          case "approved":
          case "active":
          case "inactive":
          case "moved_out":
          case "terminated":
          case "under_review":
          case "application_submitted":
            where.tenantStatus = filters.status;
            break;
          default:
            break;
        }
      }

      // Search across firstName/lastName/email
      const search = filters.search;
      const searchOr: Prisma.UserWhereInput[] | null = search
        ? [
            { firstName: { contains: search, mode: "insensitive" } },
            { lastName: { contains: search, mode: "insensitive" } },
            { email: { contains: search, mode: "insensitive" } },
          ]
        : null;

      if (statusOr && searchOr) {
        where.AND = [{ OR: statusOr }, { OR: searchOr }];
      } else if (statusOr) {
        where.OR = statusOr;
      } else if (searchOr) {
        where.OR = searchOr;
      }

      // AND-ed after every caller-supplied filter. A narrowed employee sees
      // the tenants holding a lease in one of their buildings — the tenant
      // row itself carries no building, so this fragment is a relation
      // filter through the lease (see tenantRecordScope).
      applyScope(where, tenantRecordScope(user));

      // Same `where` as the list, so the file carries exactly what the
      // screen does. Sensitive columns are left out deliberately: an export
      // leaves the building, and an ID number belongs on a contract rather
      // than in a spreadsheet nobody tracks.
      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport.
      if (rawFormat && !canExport(user, "tenant_export", "tenant_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }
        const rows = await db.user.findMany({
          where,
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            tenantStatus: true,
            createdAt: true,
            leasesAsTenant: {
              where: { deletedAt: null },
              orderBy: { startDate: "desc" },
              take: 1,
              select: {
                status: true,
                startDate: true,
                endDate: true,
                rentAmount: true,
                currency: true,
                property: { select: { name: true } },
                unit: { select: { unitNumber: true } },
              },
            },
          },
          orderBy: { createdAt: "desc" },
          take: EXPORT_ROW_LIMIT,
        });

        const sheet: ReportSheet<(typeof rows)[number]> = {
          title: "Tenants",
          columns: [
            {
              header: "Name",
              value: (row) => `${row.firstName} ${row.lastName}`.trim(),
            },
            { header: "Phone", value: (row) => row.phone ?? "" },
            // Blank where the tenant was recorded without one, which is a
            // real answer now rather than a missing value.
            { header: "Email", value: (row) => row.email ?? "" },
            { header: "Status", value: (row) => row.tenantStatus ?? "" },
            {
              header: "Building",
              value: (row) => row.leasesAsTenant[0]?.property?.name ?? "",
            },
            {
              header: "Unit",
              value: (row) => row.leasesAsTenant[0]?.unit?.unitNumber ?? "",
            },
            {
              header: "Contract status",
              value: (row) => row.leasesAsTenant[0]?.status ?? "",
            },
            {
              header: "Contract start",
              value: (row) =>
                row.leasesAsTenant[0] ? businessDay(row.leasesAsTenant[0].startDate) : "",
            },
            {
              header: "Contract end",
              value: (row) =>
                row.leasesAsTenant[0] ? businessDay(row.leasesAsTenant[0].endDate) : "",
            },
            {
              header: "Rent",
              value: (row) =>
                row.leasesAsTenant[0]
                  ? Number(row.leasesAsTenant[0].rentAmount)
                  : "",
            },
            { header: "Added", value: (row) => businessDay(row.createdAt) },
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
          fileName: "Tenants",
          dateStamp: businessToday(),
        });
      }

      const sortField =
        filters.sortBy && filters.sortBy in Prisma.UserScalarFieldEnum
          ? filters.sortBy
          : "createdAt";
      const sortOrder = filters.sortOrder === "asc" ? "asc" : "desc";

      const page = filters.page ?? 1;
      const limit = filters.limit ?? 10;

      const [data, total] = await Promise.all([
        db.user.findMany({
          where,
          orderBy: { [sortField]: sortOrder },
          skip: (page - 1) * limit,
          take: limit,
        }),
        db.user.count({ where }),
      ]);

      const result = {
        data,
        pagination: createPaginationInfo(page, limit, total),
      };

      const sanitized = result.data.map((tenant) => stripSsn(tenant));
      const populatedData = await addActiveLeaseMetadata(sanitized);

      return createSuccessResponse(
        populatedData,
        "Tenants retrieved successfully",
        result.pagination
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// POST /api/tenants - Create a new tenant
// ============================================================================

export const POST = withPermissionAndDB(["tenant_create", "tenant_management"])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Two creation modes: `sendInvitation: true` emails a setup link and
      // creates NO user row (setup-password creates it on acceptance);
      // otherwise the account is created immediately with the given password.
      const sendInvitation = body.sendInvitation === true;

      // The tenant forms ask for ONE name field, because that is what the
      // contract has — see lib/full-name.ts. `User` still stores two columns,
      // so the split happens here, before validation. One word is a name: it
      // leaves the second column empty, where it used to come back as
      // "lastName: Last name is required" — in English, whatever the screen
      // spoke. Name and email are refused with a code the screens translate.
      const name = readPersonName(body);
      if (!name.ok) {
        return createErrorResponse(
          PERSON_FIELD_MESSAGES[name.error],
          400,
          undefined,
          name.error,
        );
      }
      const emailField = readOptionalEmail(body.email);
      if (!emailField.ok) {
        return createErrorResponse(
          PERSON_FIELD_MESSAGES[emailField.error],
          400,
          undefined,
          emailField.error,
        );
      }
      const namedBody = {
        ...body,
        ...name.value,
        email: emailField.value ?? undefined,
      };

      // Transform and prepare tenant data
      const tenantData = {
        ...namedBody,
        role: UserRole.TENANT, // Ensure tenant role
        // Transform date strings to Date objects
        dateOfBirth: body.dateOfBirth ? new Date(body.dateOfBirth) : undefined,
        moveInDate: body.moveInDate ? new Date(body.moveInDate) : undefined,
        applicationDate: new Date(), // Set current date as application date
        // Set default tenant status if not provided
        tenantStatus: body.tenantStatus || "application_submitted",
        // Transform employment info dates
        employmentInfo:
          body.employmentInfo?.employer
            ? {
                ...body.employmentInfo,
                startDate: body.employmentInfo.startDate
                  ? new Date(body.employmentInfo.startDate)
                  : new Date(),
              }
            : undefined,
      };

      // Validate the transformed data. `userSchema` still governs staff
      // accounts, which exist in order to sign in and therefore must carry an
      // address; a tenant is a party to a contract first, and this office
      // records plenty of them with a phone number and a national ID alone.
      // Password is validated below rather than here, because whether one is
      // required depends on which of the three modes this is.
      const validation = validateSchema(
        userSchema.extend({
          email: personEmailSchema,
          password: z.string().optional(),
          // Read above: one field, split losslessly, the second part
          // possibly empty.
          firstName: z.string().trim().min(1).max(160),
          lastName: z.string().trim().max(160).optional().default(""),
        }),
        tenantData
      );
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const userData = validation.data as any;
      const tenantEmail: string | null = userData.email?.trim() || null;

      // `entityType` and `idNumber` are two of the five fields the contract
      // needs, and the Tenant model has columns for both. The form's notes
      // (an inquiry's text, when "Create tenant" came from the inbox) have
      // no place in `userSchema`, which dropped them. Read here so a direct
      // create and an invitation carry the same record.
      const entityType = normalizeEntityType(body.entityType);
      const idNumber =
        typeof body.idNumber === "string" && body.idNumber.trim()
          ? body.idNumber.trim()
          : undefined;
      const notes = z
        .string()
        .trim()
        .max(5000, "Notes are too long")
        .optional()
        .safeParse(body.applicationNotes ?? undefined);
      if (!notes.success) {
        return createErrorResponse(notes.error.issues[0].message, 400);
      }
      const applicationNotes = notes.data || undefined;

      // An invitation is an email. There is nothing to send it to.
      if (sendInvitation && !tenantEmail) {
        return createErrorResponse(
          "An invitation needs an email address. Add one, or create the tenant without an invitation.",
          400
        );
      }

      // A tenant with no address has no way to sign in, so no credential is
      // created. With one, the office no longer sets a password (the forms
      // dropped the field, 2026-10-16): the tenant chooses one through
      // "Forgot your password?", which writes the first credential. A caller
      // that still sends a password gets it, checked against the policy.
      const submittedPassword =
        typeof body.password === "string" && body.password !== ""
          ? body.password
          : null;
      const wantsCredential =
        !sendInvitation && tenantEmail !== null && submittedPassword !== null;
      if (wantsCredential) {
        const weakness = validatePasswordStrength(submittedPassword);
        if (weakness) {
          return createErrorResponse(weakness, 400);
        }
      }

      // Emails are globally unique (across organizations, including
      // soft-deleted rows), so the duplicate check must look beyond this org.
      // Skipped entirely when there is no address: NULL is not a value that
      // can collide, and two tenants recorded without email are two people.
      if (tenantEmail && (await isEmailTaken(tenantEmail))) {
        return createErrorResponse(
          "Another account already uses this email address.",
          409,
          undefined,
          "EMAIL_TAKEN",
        );
      }

      if (sendInvitation) {
        // Re-bound so the type says what the guard above already established:
        // an invitation without an address was rejected before reaching here.
        const inviteeEmail = tenantEmail as string;

        const invitationData: TenantInvitationData = {
          firstName: userData.firstName,
          lastName: userData.lastName,
          phone: userData.phone,
          avatar: userData.avatar || undefined,
          dateOfBirth: body.dateOfBirth || undefined,
          employmentInfo: body.employmentInfo?.employer
            ? body.employmentInfo
            : undefined,
          emergencyContacts: userData.emergencyContacts,
          creditScore: userData.creditScore,
          moveInDate: body.moveInDate || undefined,
          // Dropped before, so an invited company came back an individual
          // with no registration, and its uploaded documents and notes were
          // lost on acceptance.
          entityType,
          idNumber,
          applicationNotes,
          documents: userData.documents,
        };

        const invitation = await createTenantInvitationToken({
          email: inviteeEmail,
          tenantData: invitationData,
          invitedById: user.id,
        });
        if (!invitation.success || !invitation.token) {
          return createErrorResponse(
            invitation.error || "Failed to create the invitation",
            500
          );
        }

        const inviterName =
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email;
        // The mail transport throws rather than answering false (a refused
        // SMTP login came back as a 500 carrying the server's own text);
        // either way the invitation exists and the office is told to re-send.
        const sent = await emailService
          .sendTenantInvitation(
            inviteeEmail,
            `${userData.firstName} ${userData.lastName}`,
            invitation.token,
            inviterName
          )
          .catch((error) => {
            console.error("Tenant invitation email failed:", error);
            return false;
          });
        if (!sent) {
          return createErrorResponse(
            "Invitation created but the email could not be sent. Check the email settings and re-invite.",
            502
          );
        }

        return createSuccessResponse(
          { invited: true, email: inviteeEmail },
          "Invitation sent successfully"
        );
      }

      // Create the tenant user (passwords live on Better Auth accounts, not here)
      const createData = withUserNameDerivation({
        organizationId: user.organizationId!,
        email: tenantEmail,
        firstName: userData.firstName,
        lastName: userData.lastName,
        phone: userData.phone,
        role: UserRole.TENANT,
        avatar: userData.avatar || undefined,
        bio: userData.bio,
        location: userData.location,
        city: userData.city,
        website: userData.website || undefined,
        address: userData.address,
        tenantStatus: userData.tenantStatus,
        dateOfBirth: userData.dateOfBirth,
        emergencyContacts: userData.emergencyContacts as
          | Prisma.InputJsonValue
          | undefined,
        documents: userData.documents,
        backgroundCheckStatus: userData.backgroundCheckStatus,
        applicationDate: userData.applicationDate,
        moveInDate: userData.moveInDate,
        moveOutDate: userData.moveOutDate,
        applicationNotes,
      });

      await enforcePlanLimit(
        user.organizationId!,
        "tenants",
        await countTenantAccounts(),
      );

      const tenant = await db.user.create({
        data: createData as Prisma.UserUncheckedCreateInput,
      });

      // Sensitive PII lives only on the Tenant profile — the create path used
      // to write it onto the User row while updates wrote the profile,
      // leaving two divergent copies (SSN included).
      // The create path used to skip `entityType` and `idNumber` too, so a
      // tenant recorded as a company with a commercial registration came back
      // as an individual with none.
      if (
        userData.ssn !== undefined ||
        userData.employmentInfo !== undefined ||
        userData.creditScore !== undefined ||
        entityType !== "individual" ||
        idNumber !== undefined
      ) {
        await db.tenant.create({
          data: {
            organizationId: user.organizationId!,
            userId: tenant.id,
            entityType,
            idNumber,
            ssn: userData.ssn
              ? encryptSensitiveValue(userData.ssn) ?? undefined
              : undefined,
            employmentInfo: userData.employmentInfo as
              | Prisma.InputJsonValue
              | undefined,
            creditScore: userData.creditScore,
            applicationDate: userData.applicationDate ?? new Date(),
          },
        });
      }

      if (wantsCredential && submittedPassword !== null) {
        try {
          // Store the credential on the Better Auth account — without this the
          // tenant has no way to sign in. No sessions exist yet to revoke.
          await setUserPassword(tenant.id, submittedPassword, {
            revokeSessions: false,
          });
        } catch (credentialError) {
          // Roll the user row back so a retry is not refused as a duplicate.
          await authDb.user.delete({ where: { id: tenant.id } }).catch(() => {});
          throw credentialError;
        }
      }

      return createSuccessResponse(
        stripSsn(tenant),
        "Tenant created successfully",
        undefined
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/tenants - Bulk update tenants (admin only)
// ============================================================================

// Columns that may be bulk-updated on tenant users (the old code stripped
// _id/userId/createdAt/updatedAt and passed the rest through).
const BULK_UPDATABLE_TENANT_FIELDS = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "avatar",
  "bio",
  "location",
  "city",
  "website",
  "address",
  "isActive",
  "emailVerified",
  "tenantStatus",
  "dateOfBirth",
  "employmentInfo",
  "emergencyContacts",
  "documents",
  "creditScore",
  "backgroundCheckStatus",
  "applicationDate",
  "screeningScore",
  "applicationNotes",
  "moveInDate",
  "moveOutDate",
  "preferredContactMethod",
  "emergencyContactVerified",
  "notificationPreferences",
]);

export const PUT = withPermissionAndDB(["tenant_edit", "bulk_operations"], {
  requireAllPermissions: true,
})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      const { tenantIds, updates } = body;

      if (!Array.isArray(tenantIds) || tenantIds.length === 0) {
        return createErrorResponse("Tenant IDs array is required", 400);
      }

      if (!updates || typeof updates !== "object") {
        return createErrorResponse("Updates object is required", 400);
      }

      // Remove fields that shouldn't be bulk updated
      const allowedUpdates: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(updates)) {
        if (BULK_UPDATABLE_TENANT_FIELDS.has(key)) {
          allowedUpdates[key] = value;
        }
      }

      // Derived fields (were Mongoose pre-update middleware): keep Better
      // Auth's `name`/`emailVerifiedFlag` in step with the app's writes.
      if ("emailVerified" in allowedUpdates) {
        allowedUpdates.emailVerifiedFlag = Boolean(allowedUpdates.emailVerified);
      }
      if (allowedUpdates.firstName && allowedUpdates.lastName) {
        const composed = [allowedUpdates.firstName, allowedUpdates.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        if (composed) allowedUpdates.name = composed;
      }

      // Only the tenants this caller may reach: the ids come from the
      // request, and an administrator narrowed to some buildings could
      // otherwise rewrite tenants in all the others.
      const result = await db.user.updateMany({
        where: withScope(
          { id: { in: tenantIds }, role: UserRole.TENANT },
          tenantRecordScope(user),
        ),
        data: allowedUpdates,
      });

      return createSuccessResponse(
        {
          matchedCount: result.count,
          modifiedCount: result.count,
        },
        `${result.count} tenants updated successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/tenants - Bulk delete tenants (admin only)
// ============================================================================

export const DELETE = withPermissionAndDB(
  // Bulk removal is still removal: it takes the delete right, not the edit one.
  ["tenant_delete", "bulk_operations"],
  {
    requireAllPermissions: true,
  }
)(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      if (!user.isAdmin) {
        return createErrorResponse("Insufficient permissions", 403);
      }

      const { searchParams } = new URL(request.url);
      const requested = (searchParams.get("ids")?.split(",") || []).filter(Boolean);

      if (requested.length === 0) {
        return createErrorResponse("Tenant IDs are required", 400);
      }

      // Only the tenants this caller may reach (lib/db/tenant-scope.ts); the
      // rest of the list is left alone and the count below says so.
      const tenantIds = await tenantIdsInScope(user, requested);
      if (tenantIds.length === 0) {
        return createErrorResponse("No tenants found to delete", 404);
      }

      // Check for active leases — in any building, not only the caller's
      const activeLeases = await db.lease.count({
        where: {
          tenantId: { in: tenantIds },
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
      });

      if (activeLeases > 0) {
        return createErrorResponse(
          "Cannot delete tenants with active leases. Please terminate leases first.",
          409,
          undefined,
          "TENANT_HAS_ACTIVE_LEASE",
        );
      }

      // ARCHIVE, never destroy. This endpoint used to call
      // `user.deleteMany()` — a real hard delete available to any
      // organization admin, which the archiving rules forbid: permanent
      // deletion belongs to the System Owner or a platform Super Admin, and
      // only through the archive (DELETE /api/archive/[category]/[id]).
      //
      // Rows are stamped instead, so they land in the archive and can be
      // restored or destroyed there by someone entitled to — every one of
      // them, including a tenant who never had a profile row (see
      // lib/tenant-archive.ts).
      const archivedCount = await archiveTenantRecords(
        tenantIds,
        user.organizationId!,
      );

      // One entry for the selection, naming every tenant it archived.
      void recordActivity({
        action: AuditAction.BULK_DELETE,
        recordType: "tenant",
        recordId: tenantIds.length === 1 ? tenantIds[0] : null,
        messageKey: "admin.audit.msg.bulk_archive",
        messageParams: { count: archivedCount },
        details: { tenantIds, archived: archivedCount },
      });

      return createSuccessResponse(
        {
          archivedCount,
          // Kept so existing callers reading `deletedCount` keep working.
          deletedCount: archivedCount,
        },
        `${archivedCount} tenant(s) moved to the archive`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
