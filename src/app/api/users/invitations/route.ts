/**
 * PropertyPro - Staff invitations
 *
 * Replaces the "admin types a colleague's password into a form and texts it to
 * them" flow. No user row is created until the invitee sets their own
 * password; until then the pending invitation is the only artefact.
 *
 * The role is authorised here, at invite time, against the inviter's own
 * privileges — the acceptance route applies it verbatim, so it must never be
 * possible to invite someone into a role you could not assign yourself.
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
  withPermissionAndDB,
} from "@/lib/api-utils";
import { assertCanAssignRole } from "@/lib/role-assignment";
import { USER_CREATE_PERMISSIONS } from "@/lib/permissions-manager";
import { roleDisplayName } from "@/lib/role-display";
import { resolveAccessProfile } from "@/lib/server-permissions";
import { loadGroupNames } from "@/lib/user-response";
import { roleConsumesSeat } from "@/lib/billing/seat-guard";
import {
  createMemberInvitationToken,
  sendMemberInvitation,
  type MemberInvitationData,
} from "@/lib/invitation-utils";
import { enforcePlanLimit } from "@/lib/billing/entitlements";
import { countStaffSeats } from "@/lib/billing/usage";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";
import { bypassOrgScope } from "@/lib/tenancy/context";

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email("A valid email is required"),
  firstName: z.string().trim().min(1, "First name is required").max(80),
  lastName: z.string().trim().min(1, "Last name is required").max(80),
  role: z.string().trim().min(1, "Role is required"),
  phone: z.string().trim().max(40).optional(),
});

// ============================================================================
// GET /api/users/invitations - List pending staff invitations
// ============================================================================

// Read by everyone who sees the employee list; sending, resending and
// revoking stay with the people who may add employees.
export const GET = withPermissionAndDB([
  "user_view",
  ...USER_CREATE_PERMISSIONS,
])(
  async (_user: AuthenticatedAccessUser, _request: NextRequest) => {
    try {
      const groups = await loadGroupNames();
      const invitations = await db.invitationToken.findMany({
        where: { type: "member_invitation", isUsed: false },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          tenantData: true,
          invitedById: true,
          expiresAt: true,
          createdAt: true,
        },
      });

      const inviterIds = [
        ...new Set(invitations.map((invitation) => invitation.invitedById)),
      ];
      const inviters = inviterIds.length
        ? await db.user.findMany({
            where: { id: { in: inviterIds } },
            select: { id: true, firstName: true, lastName: true, email: true },
          })
        : [];
      const inviterById = new Map(inviters.map((row) => [row.id, row]));

      const now = Date.now();
      return createSuccessResponse(
        invitations.map((invitation) => {
          const data = invitation.tenantData as unknown as MemberInvitationData;
          const inviter = inviterById.get(invitation.invitedById);
          const role = data?.role ?? UserRole.MANAGER;
          return {
            id: invitation.id,
            email: invitation.email,
            firstName: data?.firstName ?? "",
            lastName: data?.lastName ?? "",
            role,
            // The group's names beside its key, as the user list sends them.
            roleLabel: groups.get(role)?.label ?? null,
            roleLabelAr: groups.get(role)?.labelAr ?? null,
            invitedBy: inviter
              ? [inviter.firstName, inviter.lastName].filter(Boolean).join(" ") ||
                inviter.email
              : "Unknown",
            invitedAt: invitation.createdAt,
            expiresAt: invitation.expiresAt,
            // Expired invitations stay listed so an admin can see why nobody
            // ever arrived, and resend in one click.
            expired: invitation.expiresAt.getTime() <= now,
          };
        }),
      );
    } catch (error) {
      return handleApiError(error, "Failed to load invitations");
    }
  },
);

// ============================================================================
// POST /api/users/invitations - Invite a staff member
// ============================================================================

export const POST = withPermissionAndDB([...USER_CREATE_PERMISSIONS])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const { success, data: body, error } = await parseRequestBody(request);
      if (!success) return createErrorResponse(error!, 400);

      const parsed = inviteSchema.safeParse(body);
      if (!parsed.success) {
        return createErrorResponse(
          parsed.error.errors.map((issue) => issue.message).join(", "),
          400,
        );
      }
      const { email, firstName, lastName, role, phone } = parsed.data;

      const roleError = await assertCanAssignRole(user, role);
      if (roleError) return createErrorResponse(roleError, 403);

      // An invitation carries no buildings: the colleague it makes sees the
      // whole organization. Someone limited to some buildings cannot make
      // that — they add staff from New employee, where the buildings are set.
      const invitedAccess = await resolveAccessProfile(role);
      if (user.scopedPropertyIds !== undefined && invitedAccess.isCompanyStaff) {
        return createErrorResponse(
          "You are limited to some buildings, so add this employee from New employee, where their buildings are set.",
          403,
        );
      }

      // Email is globally unique, so an address already in use anywhere blocks
      // the invitation rather than failing at acceptance.
      const existing = await bypassOrgScope(() =>
        db.user.findFirst({
          where: { email, deletedAt: undefined },
          select: { id: true },
        }),
      );
      if (existing) {
        return createErrorResponse(
          "An account with this email already exists",
          409,
        );
      }

      // Seats are counted against accepted staff only; a pending invitation
      // that is never accepted must not hold a seat hostage. The acceptance
      // route re-checks, which is what actually protects the limit — and it
      // asks roleConsumesSeat, so this must too: property owners are clients,
      // not staff, and countStaffSeats() has never counted them. Testing
      // `role !== TENANT` here refused an owner invitation at the seat cap
      // over a seat the owner would not have taken.
      if (roleConsumesSeat(role)) {
        await enforcePlanLimit(
          user.organizationId!,
          "members",
          await countStaffSeats(),
        );
      }

      const organization = await db.organization.findFirst({
        where: { id: user.organizationId! },
        select: { name: true },
      });

      const memberData: MemberInvitationData = {
        firstName,
        lastName,
        role,
        // The email is written in English: a group by its label.
        roleLabel: roleDisplayName(role, {
          group: (await loadGroupNames()).get(role),
        }),
        phone,
        invitedByName:
          [user.firstName, user.lastName].filter(Boolean).join(" ") ||
          user.email,
      };

      const token = await createMemberInvitationToken({
        email,
        memberData,
        invitedById: user.id,
      });
      if (!token.success || !token.token || !token.expiresAt) {
        return createErrorResponse(token.error ?? "Failed to invite", 500);
      }

      const delivery = await sendMemberInvitation(
        token.token,
        memberData,
        email,
        organization?.name ?? "your organization",
        token.expiresAt,
      );

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.CREATE,
          severity: AuditSeverity.MEDIUM,
          description: `Invited ${email} as ${role}`,
          resourceType: "invitation",
          resourceId: email,
          resourceName: `${firstName} ${lastName}`,
          newValues: { email, role, delivered: delivery.success },
          tags: ["user", "invitation"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      // The invitation exists either way — surfacing a failed send lets the
      // admin retry delivery instead of silently waiting for someone who was
      // never emailed.
      return createSuccessResponse(
        {
          email,
          role,
          expiresAt: token.expiresAt,
          emailDelivered: delivery.success,
        },
        delivery.success
          ? `Invitation sent to ${email}`
          : `Invitation created, but the email could not be sent (${delivery.error}). Use Resend once email is configured.`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to invite member");
    }
  },
);
