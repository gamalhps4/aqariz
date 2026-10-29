/**
 * PropertyPro - Bulk Email API Route
 * Send emails to multiple users
 */

import { NextRequest } from "next/server";
import { db } from "@/lib/db/prisma";
import { UserRole } from "@/types";
import {
  AuthenticatedAccessUser,
  createSuccessResponse,
  createErrorResponse,
  handleApiError,
  withPermissionAndDB,
  parseRequestBody,
} from "@/lib/api-utils";
import { canManageTargetUser } from "@/lib/permissions-manager";
import { resolveAccessProfile } from "@/lib/server-permissions";

// ============================================================================
// POST /api/users/bulk-email - Send bulk email to users
// ============================================================================

export const POST = withPermissionAndDB("company_settings")(async (
  user: AuthenticatedAccessUser,
  request: NextRequest
) => {
  try {
    const { success, data: body, error } = await parseRequestBody(request);
    if (!success) {
      return createErrorResponse(error!, 400);
    }

    const { userIds, subject, message } = body;

    // Validate input
    if (!userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return createErrorResponse("User IDs are required", 400);
    }

    if (!subject || !message) {
      return createErrorResponse("Subject and message are required", 400);
    }

    if (subject.length > 200) {
      return createErrorResponse("Subject must be 200 characters or less", 400);
    }

    if (message.length > 5000) {
      return createErrorResponse(
        "Message must be 5000 characters or less",
        400
      );
    }

    // Fetch target users (only active users receive email)
    const targetUsers = await db.user.findMany({
      where: {
        id: { in: (userIds as unknown[]).map(String) },
        isActive: true,
      },
      select: { id: true, firstName: true, lastName: true, email: true, role: true },
    });

    if (targetUsers.length === 0) {
      return createErrorResponse("No valid active users found", 404);
    }

    // Role-based access control
    if (user.isManager && !user.isAdmin) {
      const uniqueRoles = [
        ...new Set(targetUsers.map((targetUser) => targetUser.role || UserRole.TENANT)),
      ];
      const roleAccessMap = new Map(
        await Promise.all(
          uniqueRoles.map(async (role) => [role, await resolveAccessProfile(role)] as const)
        )
      );

      const hasProtectedUsers = targetUsers.some((targetUser) => {
        const targetAccess = roleAccessMap.get(targetUser.role || UserRole.TENANT);
        return targetAccess ? !canManageTargetUser(user, targetAccess) : true;
      });

      if (hasProtectedUsers) {
        return createErrorResponse(
          "Property managers cannot send emails to admin users",
          403
        );
      }
    }

    const results = {
      sent: 0,
      failed: 0,
      errors: [] as string[],
    };

    // Send emails to each user
    for (const targetUser of targetUsers) {
      try {
        // TODO: Implement actual email sending
        // This is a placeholder for email service integration
        const emailData = {
          to: targetUser.email,
          subject: subject,
          html: `
              <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #333;">PropertyPro Notification</h2>
                <p>Dear ${targetUser.firstName} ${targetUser.lastName},</p>
                <div style="background-color: #f9f9f9; padding: 20px; border-radius: 5px; margin: 20px 0;">
                  ${message.replace(/\n/g, "<br>")}
                </div>
                <p style="color: #666; font-size: 14px;">
                  This message was sent by ${
                    user.firstName || "PropertyPro Admin"
                  } via the PropertyPro system.
                </p>
                <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
                <p style="color: #999; font-size: 12px;">
                  PropertyPro Property Management System
                </p>
              </div>
            `,
          text: `
PropertyPro Notification

Dear ${targetUser.firstName} ${targetUser.lastName},

${message}

This message was sent by ${
            user.firstName || "PropertyPro Admin"
          } via the PropertyPro system.

PropertyPro Property Management System
            `.trim(),
        };

        // Simulate email sending (replace with actual email service)

        // In a real implementation, you would use a service like:
        // - SMTP/Nodemailer
        // - AWS SES
        // - Resend
        // etc.

        // For now, we'll simulate success
        await new Promise((resolve) => setTimeout(resolve, 100)); // Simulate API delay

        results.sent++;
      } catch (emailError) {
        console.error(
          `Failed to send email to ${targetUser.email}:`,
          emailError
        );
        results.failed++;
        results.errors.push(`Failed to send email to ${targetUser.email}`);
      }
    }

    // Log the bulk email activity

    return createSuccessResponse(
      {
        data: results,
        summary: {
          totalUsers: targetUsers.length,
          sent: results.sent,
          failed: results.failed,
        },
      },
      `Bulk email completed: ${results.sent} sent, ${results.failed} failed`
    );
  } catch (error) {
    return handleApiError(error);
  }
});

