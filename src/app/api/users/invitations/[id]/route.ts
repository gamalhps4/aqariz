/**
 * PropertyPro - Staff invitation actions (resend / revoke)
 *
 * Both operate on the invitation row inside the caller's organization, so RLS
 * already prevents touching another tenant's invitations — the id in the URL
 * simply will not resolve.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
} from "@/lib/api-utils";
import {
  createMemberInvitationToken,
  sendMemberInvitation,
  type MemberInvitationData,
} from "@/lib/invitation-utils";
import {
  auditService,
  AuditCategory,
  AuditAction,
  AuditSeverity,
} from "@/lib/audit-service";
import { USER_CREATE_PERMISSIONS } from "@/lib/permissions-manager";
import { assertCanAssignRole } from "@/lib/role-assignment";
import { roleDisplayName } from "@/lib/role-display";
import { loadGroupNames } from "@/lib/user-response";

// ============================================================================
// POST /api/users/invitations/[id] - Resend
// ============================================================================

export const POST = withPermissionAndDB([...USER_CREATE_PERMISSIONS])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;

      const invitation = await db.invitationToken.findFirst({
        where: { id, type: "member_invitation", isUsed: false },
      });
      if (!invitation) {
        return createErrorResponse("Invitation not found", 404);
      }

      const memberData =
        invitation.tenantData as unknown as MemberInvitationData;

      // Resending re-issues the invitation in the sender's name, so the
      // sender must be able to hand out its role themselves.
      const roleError = await assertCanAssignRole(user, memberData.role);
      if (roleError) return createErrorResponse(roleError, 403);

      // Invitations sent before the group's name was kept with them.
      if (!memberData.roleLabel) {
        memberData.roleLabel = roleDisplayName(memberData.role, {
          group: (await loadGroupNames()).get(memberData.role),
        });
      }

      const organization = await db.organization.findFirst({
        where: { id: user.organizationId! },
        select: { name: true },
      });

      // Resending mints a fresh token and expiry rather than re-mailing the
      // old one: the previous link may already have expired, and rotating it
      // invalidates a link that could have leaked.
      const token = await createMemberInvitationToken({
        email: invitation.email,
        memberData,
        invitedById: user.id,
      });
      if (!token.success || !token.token || !token.expiresAt) {
        return createErrorResponse(token.error ?? "Failed to resend", 500);
      }

      const delivery = await sendMemberInvitation(
        token.token,
        memberData,
        invitation.email,
        organization?.name ?? "your organization",
        token.expiresAt,
      );
      if (!delivery.success) {
        return createErrorResponse(
          delivery.error ?? "Failed to send invitation email",
          502,
        );
      }

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.UPDATE,
          severity: AuditSeverity.LOW,
          description: `Resent invitation to ${invitation.email}`,
          resourceType: "invitation",
          resourceId: invitation.email,
          resourceName: invitation.email,
          tags: ["user", "invitation", "resend"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      return createSuccessResponse(
        { email: invitation.email, expiresAt: token.expiresAt },
        `Invitation resent to ${invitation.email}`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to resend invitation");
    }
  },
);

// ============================================================================
// DELETE /api/users/invitations/[id] - Revoke
// ============================================================================

export const DELETE = withPermissionAndDB([
  ...USER_CREATE_PERMISSIONS,
  "user_delete",
])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    context: { params: Promise<{ id: string }> },
  ) => {
    try {
      const { id } = await context.params;

      const invitation = await db.invitationToken.findFirst({
        where: { id, type: "member_invitation", isUsed: false },
        select: { id: true, email: true, tenantData: true },
      });
      if (!invitation) {
        return createErrorResponse("Invitation not found", 404);
      }

      // Revoking an invitation is refusing someone their role, so it is for
      // those who could have handed that role out.
      const invitedRole = (
        invitation.tenantData as unknown as MemberInvitationData | null
      )?.role;
      if (invitedRole) {
        const roleError = await assertCanAssignRole(user, invitedRole);
        if (roleError) return createErrorResponse(roleError, 403);
      }

      // Hard delete, not a soft "used" flag: the token must stop working now.
      await db.invitationToken.deleteMany({ where: { id: invitation.id } });

      await auditService.logEvent(
        {
          category: AuditCategory.USER_MANAGEMENT,
          action: AuditAction.DELETE,
          severity: AuditSeverity.MEDIUM,
          description: `Revoked invitation for ${invitation.email}`,
          resourceType: "invitation",
          resourceId: invitation.email,
          resourceName: invitation.email,
          tags: ["user", "invitation", "revoke"],
        },
        auditService.extractContextFromRequest(request, user),
      );

      return createSuccessResponse(
        { email: invitation.email },
        `Invitation for ${invitation.email} revoked`,
      );
    } catch (error) {
      return handleApiError(error, "Failed to revoke invitation");
    }
  },
);
