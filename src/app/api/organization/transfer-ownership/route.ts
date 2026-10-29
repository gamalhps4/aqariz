/**
 * PropertyPro SaaS - Transfer organization ownership
 *
 * `Organization.ownerId` was written once at provisioning and never updated
 * anywhere, so an organization whose owner left was permanently stranded:
 * nobody could take over billing, and the account could not be closed.
 *
 * Only the current owner can hand it over — not an admin, and not a platform
 * operator on their behalf. Ownership carries billing authority, so the
 * handover is deliberately an act by the person who holds it.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
  withAccessAndDB,
} from "@/lib/api-utils";
import { bypassOrgScope } from "@/lib/tenancy/context";
import { verifyUserPassword } from "@/lib/auth-credentials";
import { emailService } from "@/lib/email-service";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";

const transferSchema = z.object({
  newOwnerId: z.string().min(1, "Choose who should take over"),
  // Ownership transfer is irreversible without the new owner's cooperation,
  // so it is password-confirmed like a password or email change.
  password: z.string().min(1, "Confirm your password to transfer ownership"),
});

export const POST = withAccessAndDB({})(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = transferSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }

      const organization = await db.organization.findFirst({
        where: { id: user.organizationId! },
        select: { id: true, name: true, ownerId: true },
      });
      if (!organization) {
        return createErrorResponse("Organization not found", 404);
      }
      if (organization.ownerId !== user.id) {
        return createErrorResponse(
          "Only the current owner can transfer ownership",
          403,
        );
      }
      if (parsed.data.newOwnerId === user.id) {
        return createErrorResponse("You already own this organization", 400);
      }

      if (!(await verifyUserPassword(user.id, parsed.data.password))) {
        return createErrorResponse("Password is incorrect", 401);
      }

      // The new owner must be a real, active member of this organization —
      // RLS already scopes this lookup, so an id from another tenant simply
      // will not resolve.
      const newOwner = await db.user.findFirst({
        where: { id: parsed.data.newOwnerId, deletedAt: null },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
        },
      });
      if (!newOwner) {
        return createErrorResponse("That person is not in this organization", 404);
      }
      if (!newOwner.isActive) {
        return createErrorResponse(
          "That account is deactivated — reactivate it first",
          409,
        );
      }
      // The owner of an organization receives the billing mail and the
      // dunning notices. Handing that to a record with no address would make
      // a failed subscription payment silent.
      if (!newOwner.email) {
        return createErrorResponse(
          "That person has no email address. Add one before making them the owner.",
          400,
        );
      }
      if (newOwner.role === UserRole.TENANT) {
        return createErrorResponse(
          "Tenants cannot own an organization. Give them a staff role first.",
          400,
        );
      }

      // Organizations are platform-writable only, and the new owner needs the
      // admin role to actually exercise the authority they just received.
      await bypassOrgScope(() =>
        db.$transaction([
          db.organization.update({
            where: { id: organization.id },
            data: { ownerId: newOwner.id },
          }),
          db.user.updateMany({
            where: { id: newOwner.id, role: { not: UserRole.ADMIN } },
            data: { role: UserRole.ADMIN },
          }),
        ]),
      );

      const context = auditService.extractContextFromRequest(request, user);
      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.UPDATE,
          severity: AuditSeverity.CRITICAL,
          description: `Organization ownership transferred to ${newOwner.email}`,
          resourceType: "organization",
          resourceId: organization.id,
          resourceName: organization.name,
          oldValues: { ownerId: user.id },
          newValues: { ownerId: newOwner.id },
          tags: ["organization", "ownership"],
        },
        context,
      );

      const newOwnerName =
        [newOwner.firstName, newOwner.lastName].filter(Boolean).join(" ") ||
        newOwner.email;

      // Both parties are told, so a transfer nobody expected is noticed.
      await Promise.all([
        emailService.sendNotification(
          newOwner.email,
          newOwnerName,
          `You now own ${organization.name}`,
          `${user.email} has transferred ownership of ${organization.name} to you. You are now responsible for billing and can transfer ownership again at any time.`,
          {
            text: "Open billing",
            url: `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/dashboard/settings/billing`,
          },
        ),
        emailService.sendNotification(
          user.email,
          [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email,
          `Ownership of ${organization.name} transferred`,
          `You transferred ownership of ${organization.name} to ${newOwner.email}. If this wasn't you, contact support immediately.`,
        ),
      ]).catch((mailError) => {
        // The transfer is committed; a mail failure must not imply otherwise.
        console.error("Ownership transfer notification failed:", mailError);
      });

      return createSuccessResponse(
        { ownerId: newOwner.id, ownerEmail: newOwner.email },
        `${newOwnerName} now owns ${organization.name}`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to transfer ownership");
    }
  },
);
