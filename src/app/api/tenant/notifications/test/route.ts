/**
 * PropertyPro - Test Email Notification API
 * Sends test emails to verify notification settings
 */

import { NextRequest, NextResponse } from "next/server";
import { AuthenticatedAccessUser, withPermissionAndDB } from "@/lib/api-utils";
import { EmailService } from "@/lib/email-service";

// ============================================================================
// POST - Send test email notification
// ============================================================================

export const POST = withPermissionAndDB("profile_management")(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
    try {
      const body = await request.json();
      const { emailAddress } = body;

      if (!emailAddress) {
        return NextResponse.json(
          { error: "Email address is required" },
          { status: 400 }
        );
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailAddress)) {
        return NextResponse.json(
          { error: "Invalid email address format" },
          { status: 400 }
        );
      }

      const fullName = [user.firstName, user.lastName].filter(Boolean).join(" ");
      const emailData = {
        to: emailAddress,
        subject: "PropertyPro - Test Notification",
        html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px;">
            <h2 style="color: #333; margin-bottom: 20px;">Test Notification</h2>
            <p style="color: #666; line-height: 1.6;">
              Hello ${fullName || "Tenant"},
            </p>
            <p style="color: #666; line-height: 1.6;">
              This is a test email to verify that your notification settings are working correctly.
              You should receive payment reminders, confirmations, and other important notifications
              at this email address.
            </p>
            <div style="background-color: #e3f2fd; padding: 15px; border-radius: 4px; margin: 20px 0;">
              <p style="color: #1976d2; margin: 0; font-weight: bold;">
                ✓ Your notification settings are configured correctly!
              </p>
            </div>
            <p style="color: #666; line-height: 1.6;">
              If you have any questions or need assistance, please contact your property manager.
            </p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
            <p style="color: #999; font-size: 12px; text-align: center;">
              This is an automated message from PropertyPro. Please do not reply to this email.
            </p>
          </div>
        </div>
      `,
        text: `
        Test Notification
        
        Hello ${fullName || "Tenant"},
        
        This is a test email to verify that your notification settings are working correctly.
        You should receive payment reminders, confirmations, and other important notifications
        at this email address.
        
        ✓ Your notification settings are configured correctly!
        
        If you have any questions or need assistance, please contact your property manager.
        
        This is an automated message from PropertyPro. Please do not reply to this email.
      `,
      };

      const emailService = new EmailService();
      await emailService.sendTestEmail(emailAddress);

      return NextResponse.json({
        success: true,
        message: "Test email sent successfully",
        data: {
          emailAddress,
          sentAt: new Date().toISOString(),
        },
      });
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "Failed to send test email",
        },
        { status: 500 }
      );
    }
  }
);
