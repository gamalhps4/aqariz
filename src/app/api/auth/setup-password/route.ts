/**
 * PropertyPro - Password Setup API
 *
 * Acceptance endpoint for both invitation kinds. Neither creates a user row
 * until this point — the invitation itself is the only artefact until someone
 * proves they hold the emailed token and chooses their own password.
 *
 *   tenant_invitation → renter account, role forced to TENANT
 *   member_invitation → staff account, role taken from the invitation (it was
 *                       authorised against the inviter's privileges when the
 *                       invitation was created) and re-checked against the
 *                       plan's seat limit here, because seats are consumed at
 *                       acceptance, not at invite time.
 */

export const dynamic = "force-dynamic";

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  parseRequestBody,
} from "@/lib/api-utils";
import {
  validateInvitationToken,
  markTokenAsUsed,
  type MemberInvitationData,
  type TenantInvitationData,
} from "@/lib/invitation-utils";
import { enforcePlanLimit, PlanLimitError } from "@/lib/billing/entitlements";
import { countStaffSeats } from "@/lib/billing/usage";
import { roleConsumesSeat } from "@/lib/billing/seat-guard";
import { emailService } from "@/lib/email-service";
import { z } from "zod";
import { runWithOrgContext } from "@/lib/tenancy/context";
import { UserRole } from "@/types";
import { normalizeEntityType } from "@/lib/full-name";
import { withRateLimit, rateLimitConfigs } from "@/lib/rate-limit";
import { AuditAction, recordAccountEvent } from "@/lib/audit-domain";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  setUserPassword,
} from "@/lib/auth-credentials";

// Password setup validation schema
const passwordSetupSchema = z
  .object({
    token: z.string().min(1, "Token is required"),
    password: z
      .string()
      .min(
        PASSWORD_MIN_LENGTH,
        `Password must be at least ${PASSWORD_MIN_LENGTH} characters long`
      )
      .max(
        PASSWORD_MAX_LENGTH,
        `Password cannot exceed ${PASSWORD_MAX_LENGTH} characters`
      ),
    confirmPassword: z.string().min(1, "Password confirmation is required"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

// ============================================================================
/**
 * The "your account is ready" email, after the account exists and the token
 * is spent. The mail transport throws on a refused login or a dead server,
 * and that used to turn a finished setup into a 500: the person saw an
 * error, and retrying hit an already-used token. The account is what they
 * came for; the email is a courtesy.
 */
async function sendActivationNotice(email: string, name: string): Promise<void> {
  try {
    await emailService.sendAccountActivated(email, name);
  } catch (error) {
    console.error("Account activated email failed:", error);
  }
}

// POST /api/auth/setup-password - Set up password from invitation token
// ============================================================================
export const POST = withRateLimit(rateLimitConfigs.passwordReset, handleSetupPassword);

async function handleSetupPassword(request: NextRequest) {
  try {
    // Parse request body
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    // Validate request data
    const validation = passwordSetupSchema.safeParse(body);
    if (!validation.success) {
      const errors = validation.error.errors.map((err) => err.message);
      return createErrorResponse(errors.join(", "), 400);
    }

    const { token, password } = validation.data;

    // Either invitation kind is accepted here; the type decides what is built.
    const tokenResult = await validateInvitationToken(token);
    if (
      !tokenResult.success ||
      !tokenResult.invitation ||
      !["tenant_invitation", "member_invitation"].includes(
        tokenResult.invitation.type,
      )
    ) {
      return createErrorResponse("Invalid or expired invitation token", 400);
    }

    const invitation = tokenResult.invitation;
    const isMemberInvitation = invitation.type === "member_invitation";

    return runWithOrgContext(
      {
        organizationId: invitation.organizationId,
        isPlatformAdmin: false,
      },
      async () => {
        const existingUser = await db.user.findFirst({
          where: { email: invitation.email },
        });
        if (existingUser) {
          return createErrorResponse(
            "An account with this email already exists",
            409,
          );
        }

        if (isMemberInvitation) {
          const memberData =
            invitation.tenantData as unknown as MemberInvitationData;

          // Seats are consumed here. Between invite and acceptance the plan
          // may have been downgraded or the last seat taken by someone else.
          if (roleConsumesSeat(memberData.role)) {
            try {
              await enforcePlanLimit(
                invitation.organizationId,
                "members",
                await countStaffSeats(),
              );
            } catch (limitError) {
              if (limitError instanceof PlanLimitError) {
                return createErrorResponse(
                  "This organization has no seats left on its current plan. Ask an administrator to upgrade, then use your invitation again.",
                  402,
                );
              }
              throw limitError;
            }
          }

          const member = await db.user.create({
            data: {
              firstName: memberData.firstName,
              lastName: memberData.lastName,
              name: [memberData.firstName, memberData.lastName]
                .filter(Boolean)
                .join(" "),
              email: invitation.email,
              role: memberData.role,
              phone: memberData.phone,
              isActive: true,
              // Clicking a link sent to this address proves control of it.
              emailVerified: new Date(),
              emailVerifiedFlag: true,
              organizationId: invitation.organizationId,
            },
          });

          await setUserPassword(member.id, password, {
            revokeSessions: false,
          });
          await markTokenAsUsed(token);

          await recordAccountEvent({
            action: AuditAction.PASSWORD_SETUP,
            user: member,
            request,
          });

          await sendActivationNotice(
            invitation.email,
            `${memberData.firstName} ${memberData.lastName}`.trim(),
          );

          return createSuccessResponse(
            { user: member, message: "Account created successfully" },
            "Your account is ready — you can sign in now.",
          );
        }

        const tenantData =
          invitation.tenantData as unknown as TenantInvitationData;
        const savedUser = await db.user.create({
          data: {
            firstName: tenantData.firstName,
            lastName: tenantData.lastName,
            name: [tenantData.firstName, tenantData.lastName]
              .filter(Boolean)
              .join(" "),
            email: invitation.email,
            role: UserRole.TENANT,
            phone: tenantData.phone,
            avatar: tenantData.avatar,
            isActive: true,
            emailVerified: new Date(),
            emailVerifiedFlag: true,
            dateOfBirth: tenantData.dateOfBirth
              ? new Date(tenantData.dateOfBirth)
              : undefined,
            emergencyContacts:
              (tenantData.emergencyContacts as unknown as Prisma.InputJsonValue) ??
              [],
            moveInDate: tenantData.moveInDate
              ? new Date(tenantData.moveInDate)
              : undefined,
            applicationNotes: tenantData.applicationNotes,
            documents: tenantData.documents ?? [],
            tenantStatus: "approved",
            applicationDate: new Date(),
            organizationId: invitation.organizationId,
          },
        });

        // The tenant profile, as a direct create writes it (api/tenants).
        // Invitations used to stop at the user row, so an invited company
        // came back an individual with no registration number.
        const entityType = normalizeEntityType(tenantData.entityType);
        if (
          entityType !== "individual" ||
          tenantData.idNumber ||
          tenantData.employmentInfo ||
          tenantData.creditScore !== undefined
        ) {
          await db.tenant.create({
            data: {
              organizationId: invitation.organizationId,
              userId: savedUser.id,
              entityType,
              idNumber: tenantData.idNumber || undefined,
              employmentInfo: tenantData.employmentInfo as
                | Prisma.InputJsonValue
                | undefined,
              creditScore: tenantData.creditScore,
              applicationDate: new Date(),
            },
          });
        }

        // A brand-new account has no sessions to revoke.
        await setUserPassword(savedUser.id, password, {
          revokeSessions: false,
        });
        await markTokenAsUsed(token);

        await recordAccountEvent({
          action: AuditAction.PASSWORD_SETUP,
          user: savedUser,
          request,
        });

        const userName = `${tenantData.firstName} ${tenantData.lastName}`;
        await sendActivationNotice(invitation.email, userName);

        return createSuccessResponse(
          {
            user: savedUser,
            message: "Account created successfully",
          },
          "Password setup completed successfully",
        );
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// ============================================================================
// GET /api/auth/setup-password - Validate invitation token
// ============================================================================
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return createErrorResponse("Token is required", 400);
    }

    const tokenResult = await validateInvitationToken(token);
    if (
      !tokenResult.success ||
      !tokenResult.invitation ||
      !["tenant_invitation", "member_invitation"].includes(
        tokenResult.invitation.type,
      )
    ) {
      return createErrorResponse("Invalid or expired invitation token", 400);
    }

    const invitation = tokenResult.invitation;
    const invitedData = invitation.tenantData as unknown as
      | TenantInvitationData
      | MemberInvitationData;

    return runWithOrgContext(
      {
        organizationId: invitation.organizationId,
        isPlatformAdmin: false,
      },
      async () => {
        const existingUser = await db.user.findFirst({
          where: { email: invitation.email },
        });
        if (existingUser) {
          return createErrorResponse(
            "An account with this email already exists",
            409,
          );
        }

        const fullName = `${invitedData.firstName} ${invitedData.lastName}`.trim();
        return createSuccessResponse(
          {
            valid: true,
            email: invitation.email,
            // `tenantName` is kept for the existing setup-password page; the
            // newer fields let it greet a staff member correctly.
            tenantName: fullName,
            name: fullName,
            kind:
              invitation.type === "member_invitation" ? "member" : "tenant",
            role:
              invitation.type === "member_invitation"
                ? (invitedData as MemberInvitationData).role
                : UserRole.TENANT,
            expiresAt: invitation.expiresAt,
          },
          "Token is valid",
        );
      },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
