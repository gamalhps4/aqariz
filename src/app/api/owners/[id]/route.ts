/**
 * PropertyPro - Single owner API
 *
 * `[id]` is the owner's USER id, not the profile row id — an owner exists as
 * soon as they own a property, long before any profile row does.
 *
 * Every method reaches the owner through `findOwnerInScope` / `getOwner`, so
 * an employee narrowed to some buildings reads and changes the owners of
 * those buildings only (ownerRecordScope), and anyone else gets a 404.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { UserRole } from "@/types";
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
import { ownerProfileUpdateSchema, validateSchema } from "@/lib/validations";
import { findOwnerInScope, getOwner } from "@/lib/services/owner.service";
import {
  PERSON_FIELD_MESSAGES,
  readOptionalEmail,
  readPersonName,
} from "@/lib/person-fields";
import { isEmailTaken } from "@/lib/person-email";
import {
  auditService,
  AuditAction,
  AuditCategory,
  AuditSeverity,
} from "@/lib/audit-service";

export const GET = withAccessAndDB({
  roles: [UserRole.OWNER],
  // The same rights as the list (GET /api/owners): a group given the owner
  // module's view right opened the list and was refused every row in it.
  permissions: ["tenant_management", "user_view", "owner_view", "owner_management"],
  match: "any",
})(
  async (
    user: AuthenticatedAccessUser,
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid owner ID", 400);
      }

      // An owner asking after another owner gets the 404 below, not a record;
      // so does an employee asking after an owner outside their buildings.
      const owner = await getOwner(id, {
        currentUserId: user.id,
        onlyUserId: user.isOwner ? user.id : undefined,
        actor: user,
      });
      if (!owner) {
        return createErrorResponse("Owner not found", 404);
      }

      return createSuccessResponse(owner, "Owner retrieved successfully");
    } catch (error) {
      return handleApiError(error, "Failed to retrieve the owner");
    }
  },
);

/** The columns that say who the owner is, as opposed to how they are paid. */
const IDENTITY_FIELDS = ["fullName", "firstName", "lastName", "email", "phone"];

export const PATCH = withPermissionAndDB([
  // Owners are their own module; editing one — bank and tax details included —
  // takes the owner right rather than tenant or user management.
  "owner_edit",
  "owner_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid owner ID", 400);
      }

      const { success, data: body } = await parseRequestBody(request);
      if (!success || !body || typeof body !== "object") {
        return createErrorResponse("Invalid request body", 400);
      }

      const validation = validateSchema(ownerProfileUpdateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const target = await findOwnerInScope(user, id);
      if (!target) {
        return createErrorResponse("Owner not found", 404);
      }

      // --- Who they are -----------------------------------------------------
      //
      // This page is the only place an owner's name, phone and email can be
      // corrected. Administration → Users asks for an email and a Latin name,
      // so an owner recorded without an address — the common case — could
      // never be edited at all.
      const identity: Prisma.UserUpdateInput = {};
      const fields = body as Record<string, unknown>;
      if (IDENTITY_FIELDS.some((key) => key in fields)) {
        // A member of staff who also owns buildings signs in with that name
        // and email. Changing them here would change someone's login from a
        // screen that is not about logins, so it is refused and pointed at
        // Employees.
        if (target.role !== UserRole.OWNER) {
          return createErrorResponse(
            "This owner is a member of staff. Change their name and email under Employees.",
            409,
            undefined,
            "OWNER_IS_STAFF",
          );
        }

        if (["fullName", "firstName", "lastName"].some((key) => key in fields)) {
          const name = readPersonName({
            fullName: fields.fullName,
            firstName: fields.firstName,
            lastName: fields.lastName,
          });
          if (!name.ok) {
            return createErrorResponse(
              PERSON_FIELD_MESSAGES[name.error],
              400,
              undefined,
              name.error,
            );
          }
          identity.firstName = name.value.firstName;
          identity.lastName = name.value.lastName;
          identity.name = `${name.value.firstName} ${name.value.lastName}`.trim();
        }

        if ("email" in fields) {
          const email = readOptionalEmail(fields.email);
          if (!email.ok) {
            return createErrorResponse(
              PERSON_FIELD_MESSAGES[email.error],
              400,
              undefined,
              email.error,
            );
          }
          const current = target.email?.toLowerCase() ?? null;
          if (email.value !== current) {
            if (email.value && (await isEmailTaken(email.value, id))) {
              return createErrorResponse(
                "Another account already uses this email address.",
                409,
                undefined,
                "EMAIL_TAKEN",
              );
            }
            identity.email = email.value;
          }
        }

        if ("phone" in fields) {
          const phone =
            typeof fields.phone === "string" ? fields.phone.trim().slice(0, 40) : "";
          identity.phone = phone || null;
        }
      }

      // --- How they are paid ------------------------------------------------
      const input = validation.data;
      const data = {
        ...(input.companyName !== undefined
          ? { companyName: input.companyName || null }
          : {}),
        ...(input.nationalId !== undefined
          ? { nationalId: input.nationalId || null }
          : {}),
        ...(input.taxNumber !== undefined
          ? { taxNumber: input.taxNumber || null }
          : {}),
        ...(input.addressStreet !== undefined
          ? { addressStreet: input.addressStreet || null }
          : {}),
        ...(input.addressDistrict !== undefined
          ? { addressDistrict: input.addressDistrict || null }
          : {}),
        ...(input.addressCity !== undefined
          ? { addressCity: input.addressCity || null }
          : {}),
        ...(input.addressCountry !== undefined
          ? { addressCountry: input.addressCountry || null }
          : {}),
        ...(input.payoutMethod !== undefined
          ? { payoutMethod: input.payoutMethod || null }
          : {}),
        ...(input.bankName !== undefined
          ? { bankName: input.bankName || null }
          : {}),
        ...(input.bankAccountName !== undefined
          ? { bankAccountName: input.bankAccountName || null }
          : {}),
        ...(input.bankIban !== undefined
          ? { bankIban: input.bankIban || null }
          : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      };

      const profile = await runWithOrgTransaction(async (tx) => {
        if (Object.keys(identity).length > 0) {
          await tx.user.update({ where: { id }, data: identity });
        }

        // Only when payout or tax details were sent: correcting a name must
        // not leave behind an empty profile that reads as "on file".
        if (Object.keys(data).length === 0) return null;

        // Upsert by hand: an owner may have no profile yet, and editing one
        // of their details is exactly when the first profile should come
        // into being — not a 404. A transaction reads archived rows too.
        const existing = await tx.owner.findFirst({
          where: { userId: id },
          select: { id: true },
        });
        return existing
          ? tx.owner.update({
              where: { id: existing.id },
              data: { ...data, deletedAt: null },
            })
          : tx.owner.create({
              data: { ...data, organizationId: user.organizationId!, userId: id },
            });
      });

      return createSuccessResponse(
        { owner: profile },
        "Owner updated successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to update the owner");
    }
  },
);

/**
 * DELETE — move the owner to the archive.
 *
 * Refused while they own a building, any building, including ones outside
 * the caller's reach: a building must always name an owner, and every owner
 * report, statement and agreement is built from that. Reassign or archive the
 * buildings first. With none left, the owner record goes to the archive —
 * the profile row the archive lists and, for an owner account, the user row
 * the owners list reads — and can be restored from there.
 */
export const DELETE = withPermissionAndDB([
  "owner_delete",
  "owner_management",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await params;
      if (!isValidObjectId(id)) {
        return createErrorResponse("Invalid owner ID", 400);
      }

      const target = await findOwnerInScope(user, id);
      if (!target) {
        return createErrorResponse("Owner not found", 404);
      }
      if (target.id === user.id) {
        return createErrorResponse("You cannot archive your own record.", 409);
      }

      const buildings = await db.property.count({
        where: { ownerId: id, deletedAt: null },
      });
      if (buildings > 0) {
        return createErrorResponse(
          `This owner still owns ${buildings} building(s). Reassign or archive them first.`,
          409,
          undefined,
          "OWNER_HAS_PROPERTIES",
        );
      }

      const profile = await db.owner.findFirst({
        where: { userId: id, deletedAt: undefined },
        select: { id: true, deletedAt: true, companyName: true },
      });
      // Someone with no profile who is not an owner account is not an owner
      // at all — a member of staff, say — and has nothing to archive here.
      if (!profile && target.role !== UserRole.OWNER) {
        return createErrorResponse("This person is not an owner", 404);
      }

      await runWithOrgTransaction(async (tx) => {
        const now = new Date();
        // The archive's Owners category lists profile rows, so an owner
        // recorded without one gets one — already archived — rather than
        // leaving the list and appearing nowhere.
        if (!profile) {
          await tx.owner.create({
            data: {
              organizationId: user.organizationId!,
              userId: id,
              isActive: false,
              deletedAt: now,
            },
          });
        } else if (!profile.deletedAt) {
          await tx.owner.update({
            where: { id: profile.id },
            data: { deletedAt: now, isActive: false },
          });
        }
        // Only an owner account is archived with its record. A member of
        // staff who held an owner profile keeps their sign-in.
        if (target.role === UserRole.OWNER) {
          await tx.user.updateMany({
            where: { id, deletedAt: null },
            data: { deletedAt: now, isActive: false },
          });
        }
      });

      const name =
        profile?.companyName ||
        `${target.firstName ?? ""} ${target.lastName ?? ""}`.trim() ||
        target.email ||
        id;
      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.DELETE,
          severity: AuditSeverity.MEDIUM,
          description: `Moved owner to the archive: ${name}`,
          resourceType: "owner",
          resourceId: id,
          resourceName: name,
          tags: ["owner", "archive"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      return createSuccessResponse(
        { userId: id, archived: true },
        "Owner moved to the archive",
      );
    } catch (error) {
      return handleApiError(error, "Failed to archive the owner");
    }
  },
);
