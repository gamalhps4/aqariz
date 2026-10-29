/**
 * PropertyPro - Owners API
 *
 * Lists everyone who owns property, whether or not they have an owner
 * profile.
 *
 * POST does one of two things, chosen by whether the body carries a `userId`:
 *   - with one: creates or updates the profile for that existing user;
 *   - without: creates a NEW owner outright — the person record and their
 *     profile together — which is what the owners page's "Add owner" needs.
 *
 * Neither branch touches the ownership relationship itself: that lives on
 * `Property.ownerId` and is set when a property is created or reassigned. A
 * brand-new owner therefore starts with no buildings, which is correct — the
 * office adds the person first and the portfolio after.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withAccessAndDB,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  ownerPersonCreateSchema,
  ownerProfileCreateSchema,
  validateSchema,
} from "@/lib/validations";
import {
  findOwnerInScope,
  listOwners,
  type OwnerSummary,
} from "@/lib/services/owner.service";
import {
  buildReportResponse,
  isReportFormat,
  isRtlReportRequest,
  reportLanguage,
  type ReportFormat,
  type ReportSheet,
  canExport,
  EXPORT_DENIED_MESSAGE,
} from "@/lib/reports/export";
import { runWithOrgTransaction } from "@/lib/db/prisma";
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
import { businessToday } from "@/lib/dates/business-day";

// ============================================================================
// GET /api/owners
// ============================================================================

export const GET = withAccessAndDB({
  // Office staff browse every owner; an owner reaches their own record, and
  // only their own — see onlyUserId below.
  //
  // `owner_view` belongs here because the property form asks this endpoint
  // who the owners are: a custom role allowed to add buildings but denied
  // `user_view` could otherwise reach a form it had no way to complete.
  roles: [UserRole.OWNER],
  permissions: ["tenant_management", "user_view", "owner_view"],
  match: "any",
})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { searchParams } = request.nextUrl;

      const owners = await listOwners({
        actor: user,
        currentUserId: user.id,
        onlyUserId: user.isOwner ? user.id : undefined,
        search: searchParams.get("search") || undefined,
        includeInactive: searchParams.get("includeInactive") === "true",
      });

      // Same list, same order, as a file. Payout details are deliberately
      // left out: an export leaves the building, and a bank account belongs
      // on the owner's page behind its own permission, not in a spreadsheet
      // nobody tracks.
      const rawFormat = searchParams.get("format");
      // Export is its own permission, not a by-product of being able to
      // read the list — see canExport.
      if (rawFormat && !canExport(user, "owner_export", "owner_management")) {
        return createErrorResponse(EXPORT_DENIED_MESSAGE, 403);
      }
      if (rawFormat) {
        if (!isReportFormat(rawFormat)) {
          return createErrorResponse(
            `Unsupported export format "${rawFormat}"`,
            400,
          );
        }

        const sheet: ReportSheet<OwnerSummary> = {
          title: "Owners",
          columns: [
            { header: "Owner", value: (row) => row.name },
            { header: "Company", value: (row) => row.companyName ?? "" },
            { header: "Phone", value: (row) => row.phone ?? "" },
            // Blank where the owner was recorded without one, which is a
            // real answer rather than a missing value.
            { header: "Email", value: (row) => row.email ?? "" },
            { header: "Buildings", value: (row) => row.propertyCount },
            { header: "Units", value: (row) => row.unitCount },
            { header: "Occupied", value: (row) => row.occupiedUnits },
            { header: "Occupancy %", value: (row) => row.occupancyRate },
            { header: "Active contracts", value: (row) => row.activeLeases },
            { header: "Monthly rent", value: (row) => row.monthlyRent },
            { header: "Outstanding", value: (row) => row.outstandingBalance },
            { header: "Active", value: (row) => (row.isActive ? "yes" : "no") },
          ],
          rows: owners,
          summary: [
            ["Owners", owners.length],
            [
              "Buildings",
              owners.reduce((total, row) => total + row.propertyCount, 0),
            ],
            ["Units", owners.reduce((total, row) => total + row.unitCount, 0)],
            [
              "Monthly rent",
              owners.reduce((total, row) => total + row.monthlyRent, 0),
            ],
            [
              "Outstanding",
              owners.reduce((total, row) => total + row.outstandingBalance, 0),
            ],
          ],
        };

        return buildReportResponse(sheet, {
          format: rawFormat as ReportFormat,
          rtl: isRtlReportRequest(searchParams),
          lang: reportLanguage(searchParams),
          fileName: "Owners",
          dateStamp: businessToday(),
        });
      }

      return createSuccessResponse(owners, "Owners retrieved successfully");
    } catch (error) {
      return handleApiError(error, "Failed to retrieve owners");
    }
  },
);

// ============================================================================
// POST /api/owners - create or update an owner profile
// ============================================================================

// Owners are their own module — their records carry bank and tax details —
// so adding one takes the owner right, not tenant or user management.
export const POST = withPermissionAndDB(["owner_create", "owner_management"])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body } = await parseRequestBody(request);
      if (!success) {
        return createErrorResponse("Invalid request body", 400);
      }

      // No userId means "this is somebody new" — create the person and the
      // profile together rather than making the operator go and provision a
      // user first.
      const rawUserId = (body as { userId?: unknown }).userId;
      if (typeof rawUserId !== "string" || rawUserId.trim() === "") {
        return createNewOwner(user, request, body);
      }

      const validation = validateSchema(ownerProfileCreateSchema, body);
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }

      const input = validation.data;

      // RLS keeps this inside the organization, so a profile cannot be
      // attached to a user in another one; the owner scope keeps an employee
      // narrowed to some buildings to the owners of those.
      const target = await findOwnerInScope(user, input.userId);
      if (!target) {
        return createErrorResponse("User not found in this organization", 404);
      }

      const data = {
        companyName: input.companyName ?? null,
        nationalId: input.nationalId ?? null,
        taxNumber: input.taxNumber ?? null,
        addressStreet: input.addressStreet ?? null,
        addressCity: input.addressCity ?? null,
        addressDistrict: input.addressDistrict ?? null,
        addressCountry: input.addressCountry ?? null,
        payoutMethod: input.payoutMethod ?? null,
        bankName: input.bankName ?? null,
        bankAccountName: input.bankAccountName ?? null,
        bankIban: input.bankIban ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      };

      // A soft-deleted profile still holds the unique userId, so a plain
      // create would fail on the second attempt to re-add an owner.
      const existing = await db.owner.findFirst({
        where: { userId: input.userId, deletedAt: undefined },
        select: { id: true },
      });

      const profile = existing
        ? await db.owner.update({
            where: { id: existing.id },
            data: { ...data, deletedAt: null },
          })
        : await db.owner.create({
            data: {
              ...data,
              organizationId: user.organizationId!,
              userId: input.userId,
            },
          });

      return createSuccessResponse(
        { owner: profile },
        existing
          ? "Owner profile updated successfully"
          : "Owner profile created successfully",
      );
    } catch (error) {
      return handleApiError(error, "Failed to save the owner profile");
    }
  },
);


// ============================================================================
// Creating an owner from scratch
// ============================================================================

/**
 * Create the owner's user row and their profile in ONE transaction.
 *
 * Both or neither: a half-finished owner (a user with no profile, or worse a
 * profile pointing at a user that failed to save) is exactly the kind of
 * disconnected record the data model is supposed to make impossible.
 *
 * No password is set. An owner is a portal user, not a member of staff, and
 * most never sign in at all — the office keeps the record so properties,
 * statements and payouts have somebody to belong to. Whoever does want portal
 * access gets it through the normal password-setup flow, which needs no
 * credential to exist first.
 */
async function createNewOwner(
  user: AuthenticatedAccessUser,
  request: NextRequest,
  body: unknown,
) {
  // Name and email are read first, so that the two refusals a person can put
  // right by typing come back with a code the dialog words in their language.
  // The name is one field, and one word is a name.
  const fields = body as {
    fullName?: unknown;
    firstName?: unknown;
    lastName?: unknown;
    email?: unknown;
  };
  const name = readPersonName(fields);
  if (!name.ok) {
    return createErrorResponse(
      PERSON_FIELD_MESSAGES[name.error],
      400,
      undefined,
      name.error,
    );
  }
  // Null, not "": the column is nullable precisely so that "this owner has no
  // email" is a fact the database records, rather than an empty string that
  // would collide with the next owner recorded the same way.
  const emailField = readOptionalEmail(fields.email);
  if (!emailField.ok) {
    return createErrorResponse(
      PERSON_FIELD_MESSAGES[emailField.error],
      400,
      undefined,
      emailField.error,
    );
  }
  const email = emailField.value;

  const validation = validateSchema(ownerPersonCreateSchema, {
    ...(body as object),
    firstName: name.value.firstName,
    lastName: name.value.lastName,
    email: email ?? undefined,
  });
  if (!validation.success) {
    return createErrorResponse(validation.errors.join(", "), 400);
  }

  const input = validation.data;

  // No role gate beyond the route's own. This creates exactly one kind of
  // account — the owner's, with no password and a portal that reads their own
  // buildings and nothing else — and nothing about it is the caller's to
  // choose. It used to ask `checkRoleAssignment` as well, which needs
  // `role_management`: only an Administrator holds that, so a Manager, whose
  // job registering owners is, was refused here and on Add Property's inline
  // "Add owner". `owner_create` is the right the review asked for.

  // Across every organization, archived rows included: the column is unique
  // platform-wide, so an address held anywhere cannot be saved here. Skipped
  // when there is no address — two owners recorded without one are two
  // people, and NULL is not a value that can be taken.
  if (email && (await isEmailTaken(email))) {
    return createErrorResponse(
      "Another account already uses this email address.",
      409,
      undefined,
      "EMAIL_TAKEN",
    );
  }

  // UserRole.OWNER is an unbilled role (see lib/billing/seat-guard.ts), so
  // adding an owner never consumes a paid team seat and no limit is enforced.
  const { owner, createdUser } = await runWithOrgTransaction(async (tx) => {
    const createdUser = await tx.user.create({
      data: {
        organizationId: user.organizationId!,
        firstName: input.firstName,
        lastName: input.lastName ?? "",
        name: `${input.firstName} ${input.lastName ?? ""}`.trim(),
        email,
        phone: input.phone || undefined,
        role: UserRole.OWNER,
        isActive: true,
      },
    });

    const owner = await tx.owner.create({
      data: {
        organizationId: user.organizationId!,
        userId: createdUser.id,
        companyName: input.companyName ?? null,
        nationalId: input.nationalId ?? null,
        taxNumber: input.taxNumber ?? null,
        addressStreet: input.addressStreet ?? null,
        addressCity: input.addressCity ?? null,
        addressDistrict: input.addressDistrict ?? null,
        addressCountry: input.addressCountry ?? null,
        payoutMethod: input.payoutMethod ?? null,
        bankName: input.bankName ?? null,
        bankAccountName: input.bankAccountName ?? null,
        bankIban: input.bankIban ?? null,
        notes: input.notes ?? null,
        isActive: input.isActive ?? true,
      },
    });

    return { owner, createdUser };
  });

  await auditService.logEvent(
    {
      category: AuditCategory.USER_MANAGEMENT,
      action: AuditAction.CREATE,
      severity: AuditSeverity.LOW,
      description: `Created owner: ${createdUser.name ?? createdUser.firstName}`,
      resourceType: "owner",
      resourceId: owner.id,
      resourceName:
        input.companyName || createdUser.name || email || createdUser.id,
      newValues: {
        userId: createdUser.id,
        email: createdUser.email,
        companyName: owner.companyName,
        role: UserRole.OWNER,
      },
      tags: ["owner", "create"],
    },
    auditService.extractContextFromRequest(request, user),
  );

  return createSuccessResponse(
    {
      owner,
      userId: createdUser.id,
      name: createdUser.name ?? input.firstName,
      // An employee narrowed to some buildings reaches the owners of those
      // (ownerRecordScope), and a new owner holds none yet — so their page
      // would answer 404 until a building of theirs is assigned. The dialog
      // says so instead of opening it.
      inReach: user.scopedPropertyIds === undefined,
    },
    "Owner created successfully",
  );
}
