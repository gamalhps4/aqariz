/**
 * PropertyPro - Individual Tenant API Routes
 * CRUD operations for individual tenants
 *
 * Every method reaches the tenant through `findTenantInScope`: the id the
 * request named, AND-ed with the caller's tenant scope. A tenant reaches
 * themselves, an employee narrowed to some buildings reaches the tenants with
 * a contract in one of them, and anyone else gets a 404.
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { findTenantInScope } from "@/lib/db/tenant-scope";
import { Prisma } from "@/generated/prisma/client";
import { LeaseStatus, UserRole } from "@/types";
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
import { tenantSelfEditSchema, validateSchema } from "@/lib/validations";
import {
  changeTenantStatus,
  withUserNameDerivation,
} from "@/lib/tenant-status";
import { encryptSensitiveValue } from "@/lib/security/field-encryption";
import {
  PERSON_FIELD_MESSAGES,
  readOptionalEmail,
  readPersonName,
} from "@/lib/person-fields";
import { isEmailTaken } from "@/lib/person-email";
import { archiveTenantRecords } from "@/lib/tenant-archive";
import { z } from "zod";
import { deleteFromR2 } from "@/lib/r2-server";
import { isR2Url, extractObjectKey } from "@/lib/r2";
import { AuditAction, recordActivity } from "@/lib/audit-domain";

/** Never expose the (encrypted) SSN through the tenants API. */
function stripSsn<T extends object>(row: T & { ssn?: unknown }) {
  const { ssn, ...rest } = row;
  return rest;
}

// ============================================================================
// GET /api/tenants/[id] - Get a specific tenant
// ============================================================================

export const GET = withAccessAndDB({
  roles: [UserRole.TENANT],
  permissions: ["tenant_view", "tenant_management"],
  match: "any",
})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid tenant ID", 400);
      }

      // Scoped in the query — see lib/db/tenant-scope.ts. Loading the row and
      // then asking `tenantRecordAllows` refused every restricted employee,
      // whose entitlement runs through a contract the row does not carry.
      const tenantUser = await findTenantInScope(user, id);
      if (!tenantUser) {
        return createErrorResponse("Tenant not found", 404);
      }

      // Find the tenant profile
      const tenantProfile = await db.tenant.findFirst({
        where: { userId: id },
      });

      const activeLeaseCount = await db.lease.count({
        where: {
          tenantId: id,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
      });

      // Combine user and tenant profile data
      const combinedTenantData = {
        ...stripSsn(tenantUser),
        ...(tenantProfile ? stripSsn(tenantProfile) : {}),
        hasActiveLease: activeLeaseCount > 0,
        activeLeaseCount,
      };

      return createSuccessResponse(
        combinedTenantData,
        "Tenant retrieved successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PUT /api/tenants/[id] - Update a specific tenant
// ============================================================================

export const PUT = withAccessAndDB({
  roles: [UserRole.TENANT],
  permissions: ["tenant_edit", "tenant_management"],
  match: "any",
})(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid tenant ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Scoped in the query — see GET above.
      const tenantUser = await findTenantInScope(user, id);
      if (!tenantUser) {
        return createErrorResponse("Tenant not found", 404);
      }

      // A tenant reaches only their own record, and on it only their phone
      // and emergency contacts; anything else is refused, not applied.
      if (user.isTenant) {
        const own = tenantSelfEditSchema.safeParse(body);
        if (!own.success) {
          return createErrorResponse(
            `Validation failed: ${own.error.errors.map((e) => e.message).join(", ")}`,
            400,
          );
        }
      }

      // Create a tenant-specific update schema that handles string dates
      const tenantUpdateSchema = z.object({
        userId: z.string().optional(), // Allow userId for creation
        dateOfBirth: z
          .union([z.string(), z.date()])
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            if (typeof val === "string") return new Date(val);
            return val;
          }),
        // The scope's tenant identity: one name, what kind of party they
        // are, and the number that identifies them.
        fullName: z.string().trim().max(160).optional(),
        entityType: z.enum(["individual", "company"]).optional(),
        idNumber: z.string().trim().max(60).nullable().optional(),
        ssn: z.string().optional(),
        employmentInfo: z
          .object({
            employer: z.string(),
            position: z.string(),
            income: z.number(),
            startDate: z.union([z.string(), z.date()]).transform((val) => {
              if (typeof val === "string") return new Date(val);
              return val;
            }),
          })
          .optional(),
        emergencyContacts: z
          .array(
            z.object({
              name: z.string(),
              relationship: z.string(),
              phone: z.string(),
              email: z.string().optional(),
            })
          )
          .optional(),
        creditScore: z.number().min(300).max(850).optional(),
        moveInDate: z
          .union([z.string(), z.date()])
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            if (typeof val === "string") return new Date(val);
            return val;
          }),
        moveOutDate: z
          .union([z.string(), z.date()])
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            if (typeof val === "string") return new Date(val);
            return val;
          }),
        applicationDate: z
          .union([z.string(), z.date()])
          .optional()
          .transform((val) => {
            if (!val) return undefined;
            if (typeof val === "string") return new Date(val);
            return val;
          }),
        documents: z.array(z.string()).optional(),
        notes: z.string().optional(),
      });

      const validation = validateSchema(tenantUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const updateData = validation.data;

      // Prevent certain fields from being updated by tenants
      if (user.isTenant) {
        delete updateData.creditScore;
        delete updateData.moveInDate;
        delete updateData.moveOutDate;
      }

      // Build tenant-profile column writes (drop non-columns like notes/userId)
      const profileData: Prisma.TenantUncheckedUpdateInput = {};
      if (updateData.entityType !== undefined)
        profileData.entityType = updateData.entityType;
      if (updateData.idNumber !== undefined)
        profileData.idNumber = updateData.idNumber || null;
      if (updateData.dateOfBirth !== undefined)
        profileData.dateOfBirth = updateData.dateOfBirth;
      if (updateData.ssn !== undefined)
        profileData.ssn = encryptSensitiveValue(updateData.ssn) ?? undefined;
      if (updateData.employmentInfo !== undefined)
        profileData.employmentInfo =
          updateData.employmentInfo as Prisma.InputJsonValue;
      if (updateData.emergencyContacts !== undefined)
        profileData.emergencyContacts =
          updateData.emergencyContacts as Prisma.InputJsonValue;
      if (updateData.creditScore !== undefined)
        profileData.creditScore = updateData.creditScore;
      if (updateData.moveInDate !== undefined)
        profileData.moveInDate = updateData.moveInDate;
      if (updateData.moveOutDate !== undefined)
        profileData.moveOutDate = updateData.moveOutDate;
      if (updateData.applicationDate !== undefined)
        profileData.applicationDate = updateData.applicationDate;
      if (updateData.documents !== undefined)
        profileData.documents = updateData.documents;

      // Update User model fields (firstName, lastName, email, phone, avatar, tenantStatus)
      let userUpdateData: Record<string, unknown> = {};

      // One name field on the form; two columns underneath. The split is
      // lossless on rejoin — see lib/full-name.ts — so editing a name never
      // rewrites it into something the office did not type. One word is a
      // name: its second column is simply empty.
      if (body.fullName !== undefined) {
        const name = readPersonName({ fullName: body.fullName });
        if (!name.ok) {
          return createErrorResponse(
            PERSON_FIELD_MESSAGES[name.error],
            400,
            undefined,
            name.error,
          );
        }
        userUpdateData.firstName = name.value.firstName;
        userUpdateData.lastName = name.value.lastName;
      } else {
        // The older two-field shape, one column at a time as sent.
        if (body.firstName !== undefined) {
          const firstName =
            typeof body.firstName === "string" ? body.firstName.trim() : "";
          if (!firstName) {
            return createErrorResponse(
              PERSON_FIELD_MESSAGES.NAME_REQUIRED,
              400,
              undefined,
              "NAME_REQUIRED",
            );
          }
          userUpdateData.firstName = firstName;
        }
        if (body.lastName !== undefined)
          userUpdateData.lastName =
            typeof body.lastName === "string" ? body.lastName.trim() : "";
      }

      // Optional, like everywhere a tenant is recorded: blank means "no
      // address" and is stored as NULL. The edit form used to insist on one,
      // so a tenant saved without an email could not be edited at all.
      if (body.email !== undefined) {
        const email = readOptionalEmail(body.email);
        if (!email.ok) {
          return createErrorResponse(
            PERSON_FIELD_MESSAGES[email.error],
            400,
            undefined,
            email.error,
          );
        }
        const current = tenantUser.email?.toLowerCase() ?? null;
        if (email.value !== current) {
          if (email.value && (await isEmailTaken(email.value, id))) {
            return createErrorResponse(
              "Another account already uses this email address.",
              409,
              undefined,
              "EMAIL_TAKEN",
            );
          }
          userUpdateData.email = email.value;
        }
      }
      if (body.phone !== undefined) userUpdateData.phone = body.phone;
      if (body.tenantStatus !== undefined)
        userUpdateData.tenantStatus = body.tenantStatus;
      // The edit form's notes. They were sent and never written: the schema
      // above has no column for them, and nothing below read them.
      if (typeof body.applicationNotes === "string" && !user.isTenant)
        userUpdateData.applicationNotes = body.applicationNotes.slice(0, 5000);

      // Nothing is written until every field above has been accepted: a
      // refused email must not leave the profile half-saved behind it.

      // Find or create the tenant profile, applying the updates
      let tenantProfile = await db.tenant.findFirst({ where: { userId: id } });
      if (tenantProfile) {
        tenantProfile = await db.tenant.update({
          where: { id: tenantProfile.id },
          data: profileData,
        });
      } else {
        tenantProfile = await db.tenant.create({
          data: {
            ...(profileData as Prisma.TenantUncheckedCreateInput),
            userId: id,
            organizationId:
              tenantUser.organizationId ?? user.organizationId!,
            applicationDate:
              (profileData.applicationDate as Date | undefined) ?? new Date(),
          },
        });
      }

      // Handle avatar update with old avatar deletion
      if (body.avatar !== undefined) {
        // Delete old avatar from R2 if it exists and is different from the new one
        if (tenantUser.avatar && tenantUser.avatar !== body.avatar) {
          try {
            // Extract object key from URL
            let objectKey: string | null = tenantUser.avatar;
            if (
              tenantUser.avatar.startsWith("http://") ||
              tenantUser.avatar.startsWith("https://")
            ) {
              if (isR2Url(tenantUser.avatar)) {
                objectKey = extractObjectKey(tenantUser.avatar);
              } else {
                console.warn(`Skipping non-R2 URL: ${tenantUser.avatar}`);
                objectKey = null;
              }
            }

            if (objectKey) {
              const deleted = await deleteFromR2(objectKey);
              if (deleted) {
              } else {
                console.warn(
                  `Failed to delete old tenant avatar from R2: ${tenantUser.avatar}`
                );
              }
            }
          } catch (error) {
            console.error(
              `Error deleting old tenant avatar from R2: ${tenantUser.avatar}`,
              error
            );
            // Continue even if old avatar deletion fails
          }
        }
        userUpdateData.avatar = body.avatar;
      }

      // Update the User model if there are any user fields to update
      if (Object.keys(userUpdateData).length > 0) {
        // Keep the derived `name` in step with firstName/lastName writes
        userUpdateData = withUserNameDerivation(userUpdateData, tenantUser);
        await db.user.update({
          where: { id },
          data: userUpdateData as Prisma.UserUpdateInput,
        });
      }

      // Return the updated tenant user with the tenant profile merged in
      const updatedTenant = await db.user.findFirst({ where: { id } });

      return createSuccessResponse(
        {
          ...(updatedTenant ? stripSsn(updatedTenant) : {}),
          ...stripSsn(tenantProfile),
        },
        "Tenant updated successfully"
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// DELETE /api/tenants/[id] - Delete a specific tenant
// ============================================================================

// Delete is its own right. It used to ask for `tenant_edit`, so every role
// that could correct a phone number could also remove the tenant — the
// review asks for the two to be granted separately.
export const DELETE = withPermissionAndDB(["tenant_delete", "tenant_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid tenant ID", 400);
      }

      // Scoped in the query — see GET above. It used to find any tenant in
      // the organization, whatever buildings the caller had been given.
      const tenant = await findTenantInScope(user, id);
      if (!tenant) {
        return createErrorResponse("Tenant not found", 404);
      }

      // Any active contract, in any building — including ones outside the
      // caller's reach, which they could not end themselves.
      const activeLeases = await db.lease.count({
        where: {
          tenantId: id,
          status: LeaseStatus.ACTIVE,
          deletedAt: null,
        },
      });

      if (activeLeases > 0) {
        return createErrorResponse(
          "Cannot delete tenant with active leases. Please terminate all leases first.",
          409,
          undefined,
          "TENANT_HAS_ACTIVE_LEASE",
        );
      }

      // To the archive: the user row and a profile row, created already
      // archived when the tenant had none, so every deleted tenant can be
      // found and restored. The photo is kept — a restored tenant gets it
      // back — and goes only at the archive's permanent delete.
      await archiveTenantRecords([id], tenant.organizationId ?? user.organizationId!);

      void recordActivity({
        action: AuditAction.ARCHIVE,
        recordType: "tenant",
        recordId: id,
        recordName:
          [tenant.firstName, tenant.lastName].filter(Boolean).join(" ") ||
          tenant.email ||
          null,
      });

      return createSuccessResponse({ id }, "Tenant moved to the archive");
    } catch (error) {
      return handleApiError(error);
    }
  }
);

// ============================================================================
// PATCH /api/tenants/[id] - Partial update (status change, etc.)
// ============================================================================

export const PATCH = withPermissionAndDB(["tenant_edit", "tenant_management"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
  ) => {
    try {
      const { id } = await params;

      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid tenant ID", 400);
      }

      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse(error!, 400);
      }

      // Scoped in the query — see GET above.
      const tenant = await findTenantInScope(user, id);
      if (!tenant) {
        return createErrorResponse("Tenant not found", 404);
      }

      // Handle specific patch operations
      const { action, ...data } = body;

      switch (action) {
        case "approveApplication":
          await changeTenantStatus(tenant, {
            newStatus: "approved",
            changedBy: user.id,
            reason: data.reason || "Application approved by staff",
            notes: data.notes,
          });
          break;

        case "rejectApplication":
          await changeTenantStatus(tenant, {
            newStatus: "terminated",
            changedBy: user.id,
            reason: data.reason || "Application rejected by staff",
            notes: data.notes,
          });
          break;

        case "changeStatus":
          if (!data.newStatus) {
            return createErrorResponse("New status is required", 400);
          }
          await changeTenantStatus(tenant, {
            newStatus: data.newStatus,
            changedBy: user.id,
            reason: data.reason,
            notes: data.notes,
          });
          break;

        case "moveIn": {
          if (!data.moveInDate) {
            return createErrorResponse("Move-in date is required", 400);
          }
          const moveInDate = new Date(data.moveInDate);
          const extraData: Prisma.UserUpdateInput = {
            moveInDate,
          };
          if (data.leaseId) {
            extraData.currentLeaseId = data.leaseId;
            extraData.leaseHistory = [
              ...(((tenant.leaseHistory as unknown[]) ?? []) as unknown[]),
              {
                leaseId: data.leaseId,
                startDate: moveInDate,
                status: "active",
              },
            ] as Prisma.InputJsonValue;
          }
          await changeTenantStatus(tenant, {
            newStatus: "active",
            changedBy: user.id,
            reason: "Tenant moved in",
            extraData,
          });
          break;
        }

        case "moveOut": {
          if (!data.moveOutDate) {
            return createErrorResponse("Move-out date is required", 400);
          }
          const moveOutDate = new Date(data.moveOutDate);
          const extraData: Prisma.UserUpdateInput = {
            moveOutDate,
          };
          if (tenant.currentLeaseId) {
            const leaseHistory = (
              ((tenant.leaseHistory as unknown[]) ?? []) as any[]
            ).map((entry) =>
              entry?.leaseId === tenant.currentLeaseId
                ? { ...entry, endDate: moveOutDate, status: "completed" }
                : entry
            );
            extraData.leaseHistory = leaseHistory as Prisma.InputJsonValue;
            extraData.currentLeaseId = null;
          }
          await changeTenantStatus(tenant, {
            newStatus: "moved_out",
            changedBy: user.id,
            reason: data.reason || "Tenant moved out",
            extraData,
          });
          break;
        }

        case "updateCreditScore":
          if (
            !data.creditScore ||
            data.creditScore < 300 ||
            data.creditScore > 850
          ) {
            return createErrorResponse(
              "Valid credit score (300-850) is required",
              400
            );
          }
          // PII home is the Tenant profile, not the User row.
          await db.tenant.upsert({
            where: { userId: id },
            update: { creditScore: data.creditScore },
            create: {
              userId: id,
              organizationId:
                tenant.organizationId ?? user.organizationId!,
              creditScore: data.creditScore,
            },
          });
          break;

        case "updateScreeningScore":
          if (
            data.screeningScore !== undefined &&
            (data.screeningScore < 0 || data.screeningScore > 100)
          ) {
            return createErrorResponse(
              "Valid screening score (0-100) is required",
              400
            );
          }
          await db.user.update({
            where: { id },
            data: { screeningScore: data.screeningScore ?? null },
          });
          break;

        case "addDocument":
          if (!data.document) {
            return createErrorResponse("Document URL is required", 400);
          }
          await db.user.update({
            where: { id },
            data: { documents: [...tenant.documents, data.document] },
          });
          break;

        case "removeDocument":
          if (!data.document) {
            return createErrorResponse("Document URL is required", 400);
          }
          await db.user.update({
            where: { id },
            data: {
              documents: tenant.documents.filter(
                (doc) => doc !== data.document
              ),
            },
          });
          break;

        case "addEmergencyContact":
          if (!data.contact) {
            return createErrorResponse("Emergency contact is required", 400);
          }
          await db.user.update({
            where: { id },
            data: {
              emergencyContacts: [
                ...(((tenant.emergencyContacts as unknown[]) ??
                  []) as unknown[]),
                data.contact,
              ] as Prisma.InputJsonValue,
            },
          });
          break;

        case "removeEmergencyContact": {
          if (data.contactIndex === undefined) {
            return createErrorResponse("Contact index is required", 400);
          }
          const contacts = [
            ...(((tenant.emergencyContacts as unknown[]) ?? []) as unknown[]),
          ];
          contacts.splice(data.contactIndex, 1);
          await db.user.update({
            where: { id },
            data: { emergencyContacts: contacts as Prisma.InputJsonValue },
          });
          break;
        }

        case "updateEmployment":
          if (!data.employmentInfo) {
            return createErrorResponse(
              "Employment information is required",
              400
            );
          }
          // PII home is the Tenant profile, not the User row.
          await db.tenant.upsert({
            where: { userId: id },
            update: {
              employmentInfo: data.employmentInfo as Prisma.InputJsonValue,
            },
            create: {
              userId: id,
              organizationId:
                tenant.organizationId ?? user.organizationId!,
              employmentInfo: data.employmentInfo as Prisma.InputJsonValue,
            },
          });
          break;

        case "updateApplicationNotes":
          await db.user.update({
            where: { id },
            data: { applicationNotes: data.notes || "" },
          });
          break;

        case "verifyEmergencyContact":
          await db.user.update({
            where: { id },
            data: { emergencyContactVerified: data.verified === true },
          });
          break;

        case "updatePreferredContact":
          if (!["email", "phone", "text", "app"].includes(data.method)) {
            return createErrorResponse("Invalid contact method", 400);
          }
          await db.user.update({
            where: { id },
            data: { preferredContactMethod: data.method },
          });
          break;

        case "startReview":
          await changeTenantStatus(tenant, {
            newStatus: "under_review",
            changedBy: user.id,
            reason: data.reason || "Application review started",
            notes: data.notes,
          });
          break;

        case "activateTenant":
          await changeTenantStatus(tenant, {
            newStatus: "active",
            changedBy: user.id,
            reason: data.reason || "Tenant activated",
            notes: data.notes,
          });
          break;

        case "deactivateTenant":
          await changeTenantStatus(tenant, {
            newStatus: "inactive",
            changedBy: user.id,
            reason: data.reason || "Tenant deactivated",
            notes: data.notes,
          });
          break;

        case "terminateTenant":
          await changeTenantStatus(tenant, {
            newStatus: "terminated",
            changedBy: user.id,
            reason: data.reason || "Tenant terminated",
            notes: data.notes,
          });
          break;

        default:
          return createErrorResponse("Invalid action", 400);
      }

      // Refresh tenant data to get updated fields
      const updatedTenant = await db.user.findFirst({ where: { id } });

      return createSuccessResponse(
        updatedTenant ? stripSsn(updatedTenant) : updatedTenant,
        `Tenant ${action} completed successfully`
      );
    } catch (error) {
      return handleApiError(error);
    }
  }
);
