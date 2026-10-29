/**
 * PropertyPro - Invitation Utilities
 * Utility functions for managing password reset tokens
 */

import crypto from "crypto";
import { db } from "@/lib/db/prisma";
import type { InvitationToken, Prisma } from "@/generated/prisma/client";
import { bypassOrgScope, requireOrgId } from "@/lib/tenancy/context";
import { emailService } from "@/lib/email-service";

/** Shape of the `tenantData` Json column on tenant-invitation tokens. */
export interface TenantInvitationData {
  firstName: string;
  lastName: string;
  phone?: string;
  role?: string;
  avatar?: string;
  // Additional tenant-specific data
  dateOfBirth?: string;
  employmentInfo?: {
    employer: string;
    position: string;
    income: number;
    startDate: string;
  };
  emergencyContacts?: Array<{
    name: string;
    relationship: string;
    phone: string;
    email?: string;
  }>;
  creditScore?: number;
  moveInDate?: string;
  applicationNotes?: string;
  /** "individual" or a company kind; see lib/full-name `normalizeEntityType`. */
  entityType?: string;
  /** National ID, iqama or commercial registration. */
  idNumber?: string;
  /** Uploaded file URLs, as `User.documents` holds them. */
  documents?: string[];
}

/** What an admin fills in when inviting a colleague. Unlike a tenant
 * invitation this carries a role, which the acceptance route applies verbatim
 * — so the role is authorised at invite time, not at acceptance. */
export interface MemberInvitationData {
  firstName: string;
  lastName: string;
  role: string;
  /**
   * What the role is called, for the email: a permission group's stored name
   * is a key ("group_2"). Absent on invitations sent before it was kept.
   */
  roleLabel?: string;
  phone?: string;
  invitedByName?: string;
}

// Generate secure random token
export function generateSecureToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

// Create tenant invitation token. The tenant's User row is NOT created here —
// /api/auth/setup-password creates it when the invitee accepts, so an ignored
// invitation leaves nothing behind but the token (which the cleanup cron
// purges after expiry).
export async function createTenantInvitationToken(input: {
  email: string;
  tenantData: TenantInvitationData;
  invitedById: string;
}): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    const email = input.email.toLowerCase();

    // Re-inviting replaces any pending invitation for this email.
    await db.invitationToken.deleteMany({
      where: { email, type: "tenant_invitation", isUsed: false },
    });

    const token = generateSecureToken();
    // 24 hours — the invitation email promises exactly this window.
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.invitationToken.create({
      data: {
        organizationId: requireOrgId(),
        email,
        token,
        type: "tenant_invitation",
        tenantData: input.tenantData as unknown as Prisma.InputJsonValue,
        invitedById: input.invitedById,
        expiresAt,
        isUsed: false,
      },
    });

    return { success: true, token };
  } catch (error) {
    console.error("Error creating tenant invitation token:", error);
    return { success: false, error: "Failed to create invitation token" };
  }
}

/** Days a staff invitation stays valid. Longer than the 24h tenant window: a
 * colleague being onboarded may not be at a desk today. */
const MEMBER_INVITATION_TTL_DAYS = 7;

/**
 * Invite a staff member. Replaces any pending invitation for the same address
 * so "resend" and "re-invite with a different role" both do the obvious thing.
 */
export async function createMemberInvitationToken(input: {
  email: string;
  memberData: MemberInvitationData;
  invitedById: string;
}): Promise<{ success: boolean; token?: string; expiresAt?: Date; error?: string }> {
  try {
    const email = input.email.toLowerCase().trim();

    await db.invitationToken.deleteMany({
      where: { email, type: "member_invitation", isUsed: false },
    });

    const token = generateSecureToken();
    const expiresAt = new Date(
      Date.now() + MEMBER_INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await db.invitationToken.create({
      data: {
        organizationId: requireOrgId(),
        email,
        token,
        type: "member_invitation",
        // Same Json column the tenant flow uses; the `type` discriminates.
        tenantData: input.memberData as unknown as Prisma.InputJsonValue,
        invitedById: input.invitedById,
        expiresAt,
        isUsed: false,
      },
    });

    return { success: true, token, expiresAt };
  } catch (error) {
    console.error("Error creating member invitation token:", error);
    return { success: false, error: "Failed to create invitation" };
  }
}

/** Deliver (or re-deliver) a staff invitation email. */
export async function sendMemberInvitation(
  token: string,
  data: MemberInvitationData,
  email: string,
  organizationName: string,
  expiresAt: Date,
): Promise<{ success: boolean; error?: string }> {
  try {
    const sent = await emailService.sendMemberInvitation(
      email,
      `${data.firstName} ${data.lastName}`.trim(),
      token,
      data.invitedByName || "your administrator",
      organizationName,
      data.roleLabel || data.role,
      expiresAt,
    );
    if (!sent) {
      return { success: false, error: "Failed to send invitation email" };
    }
    return { success: true };
  } catch (error) {
    console.error("Error sending member invitation:", error);
    return { success: false, error: "Failed to send invitation email" };
  }
}

// Create password reset token
export async function createPasswordResetToken(
  userId: string,
  email: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    // Remove any existing password reset tokens for this user
    await db.invitationToken.deleteMany({
      where: {
        userId,
        type: "password_reset",
      },
    });

    // Generate secure token
    const token = generateSecureToken();

    // Create password reset token (expires in 1 hour)
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.invitationToken.create({
      data: {
        organizationId: requireOrgId(),
        email: email.toLowerCase(),
        token,
        type: "password_reset",
        userId,
        invitedById: userId, // Self-initiated
        expiresAt,
        isUsed: false,
      },
    });

    return {
      success: true,
      token,
    };
  } catch (error) {
    console.error("Error creating password reset token:", error);
    return {
      success: false,
      error: "Failed to create password reset token",
    };
  }
}

// Send password reset email
export async function sendPasswordResetEmail(
  token: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Find the reset token
    const resetToken = await bypassOrgScope(() =>
      db.invitationToken.findFirst({
        where: {
          token,
          type: "password_reset",
          isUsed: false,
          expiresAt: { gt: new Date() },
        },
      }),
    );

    if (!resetToken) {
      return {
        success: false,
        error: "Invalid or expired reset token",
      };
    }

    // Send password reset email
    const emailSent = await emailService.sendPasswordReset(
      resetToken.email,
      userName,
      token
    );

    if (!emailSent) {
      return {
        success: false,
        error: "Failed to send password reset email",
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error sending password reset email:", error);
    return {
      success: false,
      error: "Failed to send password reset email",
    };
  }
}

// Create email change verification token
export async function createEmailChangeToken(
  userId: string,
  newEmail: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    // Remove any existing email change tokens for this user
    await db.invitationToken.deleteMany({
      where: {
        userId,
        type: "email_change",
      },
    });

    const token = generateSecureToken();

    // Email change token expires in 1 hour
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000);

    await db.invitationToken.create({
      data: {
        organizationId: requireOrgId(),
        email: newEmail.toLowerCase(), // The address that receives the verification link
        newEmail: newEmail.toLowerCase(),
        token,
        type: "email_change",
        userId,
        invitedById: userId, // Self-initiated
        expiresAt,
        isUsed: false,
      },
    });

    return {
      success: true,
      token,
    };
  } catch (error) {
    console.error("Error creating email change token:", error);
    return {
      success: false,
      error: "Failed to create email change token",
    };
  }
}

// Send email change verification to the NEW address
export async function sendEmailChangeVerification(
  token: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const changeToken = await db.invitationToken.findFirst({
      where: {
        token,
        type: "email_change",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!changeToken) {
      return {
        success: false,
        error: "Invalid or expired email change token",
      };
    }

    const emailSent = await emailService.sendEmailChangeVerification(
      changeToken.newEmail!,
      userName,
      token
    );

    if (!emailSent) {
      return {
        success: false,
        error: "Failed to send verification email",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending email change verification:", error);
    return {
      success: false,
      error: "Failed to send verification email",
    };
  }
}

// Create email verification token (verifies the user's CURRENT email)
export async function createEmailVerificationToken(
  userId: string,
  email: string
): Promise<{ success: boolean; token?: string; error?: string }> {
  try {
    // Remove any existing verification tokens for this user
    await db.invitationToken.deleteMany({
      where: {
        userId,
        type: "email_verification",
      },
    });

    const token = generateSecureToken();

    // Verification token expires in 24 hours
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await db.invitationToken.create({
      data: {
        organizationId: requireOrgId(),
        email: email.toLowerCase(),
        token,
        type: "email_verification",
        userId,
        invitedById: userId, // Self-initiated
        expiresAt,
        isUsed: false,
      },
    });

    return { success: true, token };
  } catch (error) {
    console.error("Error creating email verification token:", error);
    return {
      success: false,
      error: "Failed to create email verification token",
    };
  }
}

// Send the verification link to the user's current email
export async function sendEmailVerificationLink(
  token: string,
  userName: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const verificationToken = await db.invitationToken.findFirst({
      where: {
        token,
        type: "email_verification",
        isUsed: false,
        expiresAt: { gt: new Date() },
      },
    });

    if (!verificationToken) {
      return {
        success: false,
        error: "Invalid or expired verification token",
      };
    }

    const emailSent = await emailService.sendEmailVerification(
      verificationToken.email,
      userName,
      token
    );

    if (!emailSent) {
      return {
        success: false,
        error: "Failed to send verification email",
      };
    }

    return { success: true };
  } catch (error) {
    console.error("Error sending email verification:", error);
    return {
      success: false,
      error: "Failed to send verification email",
    };
  }
}

// Validate and get invitation token
export async function validateInvitationToken(
  token: string,
  type?:
    | "tenant_invitation"
    | "member_invitation"
    | "password_reset"
    | "email_change"
    | "email_verification"
): Promise<{
  success: boolean;
  invitation?: InvitationToken;
  error?: string;
}> {
  try {
    // The token is a high-entropy bearer credential. This is the only global
    // lookup; callers must use the returned organizationId for tenant data.
    const invitation = await bypassOrgScope(() =>
      db.invitationToken.findFirst({
        where: {
          token,
          isUsed: false,
          expiresAt: { gt: new Date() },
          ...(type ? { type } : {}),
        },
      }),
    );

    if (!invitation) {
      return {
        success: false,
        error: "Invalid or expired token",
      };
    }

    return {
      success: true,
      invitation,
    };
  } catch (error) {
    console.error("Error validating invitation token:", error);
    return {
      success: false,
      error: "Failed to validate token",
    };
  }
}

// Mark invitation token as used
export async function markTokenAsUsed(
  token: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await bypassOrgScope(() =>
      db.invitationToken.updateMany({
        where: {
          token,
          isUsed: false,
          expiresAt: { gt: new Date() },
        },
        data: {
          isUsed: true,
          usedAt: new Date(),
        },
      }),
    );

    if (result.count === 0) {
      return {
        success: false,
        error: "Invalid or expired token",
      };
    }

    return {
      success: true,
    };
  } catch (error) {
    console.error("Error marking token as used:", error);
    return {
      success: false,
      error: "Failed to mark token as used",
    };
  }
}

// Cleanup expired tokens (run from the cleanup cron)
export async function cleanupExpiredTokens(): Promise<number> {
  try {
    const result = await bypassOrgScope(() =>
      db.invitationToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            {
              isUsed: true,
              usedAt: {
                lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
              },
            },
          ],
        },
      }),
    );
    return result.count;
  } catch (error) {
    console.error("Error cleaning up expired tokens:", error);
    return 0;
  }
}
