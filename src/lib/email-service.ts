/**
 * PropertyPro - Email Service
 * Comprehensive email service for tenant invitations, notifications, and password resets
 *
 * Every email is written in the recipient's language — their organization's
 * display language — and laid out right to left for Arabic. The wording lives
 * in the shared catalogue (`notifications.email.*` in
 * `src/locales/<language>/common.json`); the templates are built in
 * `lib/templates/transactional-emails.ts`; which language a recipient reads is
 * decided by `lib/i18n/recipient-locale.ts`.
 *
 * Callers need not say which language: each send method takes an optional
 * last argument, `{ language, organizationId }`, and without it the language
 * is found from the request's organization or the recipient's account.
 */

import nodemailer from "nodemailer";
import { getEmailConfig } from "@/lib/services/email-config.service";
import { getCompanyInfoServer } from "@/lib/utils/company-info-server";
import {
  recipientLocale,
  type RecipientLocale,
} from "@/lib/i18n/recipient-locale";
import { directionFor, isAppLanguage, toAppLanguage } from "@/lib/i18n/languages";
import {
  accountActivatedEmail,
  emailChangeEmail,
  emailVerificationEmail,
  eventCancellationEmail,
  eventInvitationEmail,
  eventReminderEmail,
  eventUpdateEmail,
  leaseExpiryEmail,
  leaseExpiryLandlordEmail,
  maintenanceUpdateEmail,
  memberInvitationEmail,
  notificationEmail,
  passwordResetEmail,
  paymentReminderEmail,
  rsvpConfirmationEmail,
  tenantInvitationEmail,
  testEmail,
  type EmailContext,
  type EmailTemplate,
} from "@/lib/templates/transactional-emails";

/**
 * Which language to write in. Both optional: by default the recipient's
 * organization decides (the request's, or the one their account belongs to).
 */
export interface EmailLanguageOptions {
  /** Write in this language ("ar", "en", …) whatever the organization uses. */
  language?: string;
  /** The recipient's organization, when the caller knows it. */
  organizationId?: string | null;
}

// Email service class
export class EmailService {
  private appName: string;
  private appUrl: string;
  private brandColor: string;

  // Default brand color used when no primaryColor is configured in settings.
  // Kept in sync with the app-wide default (public-branding / SettingsProvider
  // / DisplaySettings all default to #3B82F6).
  private static readonly DEFAULT_BRAND_COLOR = "#3B82F6";

  constructor() {
    // App-level branding used inside email templates.
    // Seeded from env; refreshed from admin display settings on each send
    // via refreshBrandName() so emails carry the tenant's business name/color.
    this.appName = process.env.APP_NAME || "PropertyPro";
    this.appUrl = process.env.APP_URL || "http://localhost:3000";
    this.brandColor = EmailService.DEFAULT_BRAND_COLOR;
  }

  // Resolve the business name and brand color from admin display settings
  // (DB-first), falling back to the APP_NAME env var / default color.
  // Returns what it resolved, so a template reads this send's branding even
  // when another send for another office is in flight.
  private async refreshBrandName(): Promise<{
    appName: string;
    brandColor: string;
  }> {
    try {
      const companyInfo = await getCompanyInfoServer();
      if (companyInfo?.name) {
        this.appName = companyInfo.name;
        this.brandColor =
          companyInfo.primaryColor || EmailService.DEFAULT_BRAND_COLOR;
        return { appName: this.appName, brandColor: this.brandColor };
      }
    } catch (error) {
      console.error("Failed to resolve branding for email:", error);
    }
    this.appName = process.env.APP_NAME || "PropertyPro";
    this.brandColor = EmailService.DEFAULT_BRAND_COLOR;
    return { appName: this.appName, brandColor: this.brandColor };
  }

  /** The recipient's language, unless the caller named one. */
  private async localeFor(
    recipientEmail: string,
    options?: EmailLanguageOptions,
  ): Promise<RecipientLocale> {
    const resolved = await recipientLocale({
      organizationId: options?.organizationId,
      email: recipientEmail,
    });
    const asked = options?.language
      ? toAppLanguage(options.language, resolved.language)
      : null;
    return asked && isAppLanguage(asked)
      ? { ...resolved, language: asked, dir: directionFor(asked) }
      : resolved;
  }

  /** Branding + language for one email. */
  private async contextFor(
    recipientEmail: string,
    options?: EmailLanguageOptions,
  ): Promise<EmailContext> {
    const [brand, locale] = await Promise.all([
      this.refreshBrandName(),
      this.localeFor(recipientEmail, options),
    ]);
    return { ...brand, appUrl: this.appUrl, locale };
  }

  // Build a transporter from the active (DB-first, env-fallback) config.
  private async getTransport() {
    const config = await getEmailConfig();
    const transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: config.auth,
    });
    return { transporter, config };
  }

  // Verify email service connection
  async verifyConnection(): Promise<boolean> {
    try {
      const { transporter } = await this.getTransport();
      await transporter.verify();
      return true;
    } catch (error) {
      console.error("Email service connection failed:", error);
      return false;
    }
  }

  // Send email with template
  private async sendEmail(
    to: string,
    template: EmailTemplate,
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
    }>
  ): Promise<boolean> {
    try {
      const { transporter, config } = await this.getTransport();

      const mailOptions = {
        from: `${config.fromName || this.appName} <${config.fromEmail}>`,
        to,
        subject: template.subject,
        html: template.html,
        text: template.text,
        attachments,
        ...(config.replyTo ? { replyTo: config.replyTo } : {}),
      };

      await transporter.sendMail(mailOptions);

      return true;
    } catch (error: any) {
      console.error("Failed to send email:", error);

      // Provide specific guidance for Gmail authentication errors
      if (error.code === "EAUTH" && error.responseCode === 535) {
        console.error(`
🚨 Gmail Authentication Error - Please check:
1. Enable 2-Factor Authentication on your Gmail account
2. Generate an App Password (not your regular Gmail password)
3. Use the App Password in EMAIL_SERVER_PASSWORD
4. Ensure EMAIL_SERVER_USER is your full Gmail address

Current config:
- User: ${process.env.EMAIL_SERVER_USER}
- Host: ${process.env.EMAIL_SERVER_HOST}
- Port: ${process.env.EMAIL_SERVER_PORT}

📖 Guide: https://support.google.com/accounts/answer/185833
        `);
      }

      throw error; // Re-throw to let the API handle the error response
    }
  }

  // Send tenant invitation email
  async sendTenantInvitation(
    tenantEmail: string,
    tenantName: string,
    invitationToken: string,
    invitedBy: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(tenantEmail, options);
    return this.sendEmail(
      tenantEmail,
      tenantInvitationEmail(ctx, {
        tenantName,
        invitedBy,
        invitationUrl: `${this.appUrl}/auth/setup-password?token=${invitationToken}`,
      })
    );
  }

  /**
   * Staff invitation. Distinct from the tenant one: it names the organization
   * and the role being granted, because a colleague accepting this is joining
   * a team, not a property.
   */
  async sendMemberInvitation(
    memberEmail: string,
    memberName: string,
    invitationToken: string,
    invitedBy: string,
    organizationName: string,
    role: string,
    expiresAt: Date,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(memberEmail, options);
    return this.sendEmail(
      memberEmail,
      memberInvitationEmail(ctx, {
        memberName,
        invitedBy,
        organizationName,
        role,
        expiresAt,
        invitationUrl: `${this.appUrl}/auth/setup-password?token=${invitationToken}`,
      })
    );
  }

  // Send password reset email
  async sendPasswordReset(
    userEmail: string,
    userName: string,
    resetToken: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(userEmail, options);
    return this.sendEmail(
      userEmail,
      passwordResetEmail(ctx, {
        userName,
        resetUrl: `${this.appUrl}/auth/reset-password?token=${resetToken}`,
      })
    );
  }

  // Send email change verification to the new address
  async sendEmailChangeVerification(
    newEmail: string,
    userName: string,
    token: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(newEmail, options);
    return this.sendEmail(
      newEmail,
      emailChangeEmail(ctx, {
        userName,
        newEmail,
        confirmUrl: `${this.appUrl}/auth/confirm-email-change?token=${token}`,
      })
    );
  }

  // Send an email-verification link to the user's current address
  async sendEmailVerification(
    userEmail: string,
    userName: string,
    token: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(userEmail, options);
    return this.sendEmail(
      userEmail,
      emailVerificationEmail(ctx, {
        userName,
        userEmail,
        verifyUrl: `${this.appUrl}/auth/verify-email?token=${token}`,
      })
    );
  }

  // Send account activation confirmation
  async sendAccountActivated(
    userEmail: string,
    userName: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(userEmail, options);
    return this.sendEmail(
      userEmail,
      accountActivatedEmail(ctx, {
        userName,
        loginUrl: `${this.appUrl}/auth/signin`,
      })
    );
  }

  // Send general notification email. The subject and message are the
  // caller's, already worded; the greeting and footer follow the recipient.
  async sendNotification(
    userEmail: string,
    userName: string,
    subject: string,
    message: string,
    actionButton?: {
      text: string;
      url: string;
    },
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(userEmail, options);
    return this.sendEmail(
      userEmail,
      notificationEmail(ctx, { userName, subject, message, actionButton })
    );
  }

  // Send email with custom template and attachments (public method)
  async sendEmailWithAttachments(
    to: string,
    template: EmailTemplate,
    attachments?: Array<{
      filename: string;
      content: Buffer | string;
      contentType?: string;
    }>
  ): Promise<boolean> {
    await this.refreshBrandName();
    return this.sendEmail(to, template, attachments);
  }

  // ============================================================================
  // CALENDAR EVENT EMAIL METHODS
  // ============================================================================

  // Send event invitation email
  async sendEventInvitation(
    attendeeEmail: string,
    attendeeName: string,
    event: {
      title: string;
      description?: string;
      startDate: Date;
      endDate?: Date;
      location?: string;
      organizer: string;
      type: string;
      allDay?: boolean;
    },
    invitationToken?: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(attendeeEmail, options);
    const rsvpUrl = invitationToken
      ? `${this.appUrl}/calendar/rsvp?token=${invitationToken}`
      : null;
    return this.sendEmail(
      attendeeEmail,
      eventInvitationEmail(ctx, { attendeeName, event, rsvpUrl })
    );
  }

  // Send event reminder email
  async sendEventReminder(
    attendeeEmail: string,
    attendeeName: string,
    event: {
      title: string;
      description?: string;
      startDate: Date;
      endDate?: Date;
      location?: string;
      type: string;
      allDay?: boolean;
    },
    reminderType: "1_hour" | "1_day" | "1_week" = "1_hour",
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(attendeeEmail, options);
    return this.sendEmail(
      attendeeEmail,
      eventReminderEmail(ctx, { attendeeName, event, reminderType })
    );
  }

  // Send event cancellation email
  async sendEventCancellation(
    attendeeEmail: string,
    attendeeName: string,
    event: {
      title: string;
      startDate: Date;
      location?: string;
      organizer: string;
      reason?: string;
    },
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(attendeeEmail, options);
    return this.sendEmail(
      attendeeEmail,
      eventCancellationEmail(ctx, { attendeeName, event })
    );
  }

  // Send event update email
  async sendEventUpdate(
    attendeeEmail: string,
    attendeeName: string,
    event: {
      title: string;
      startDate: Date;
      endDate?: Date;
      location?: string;
      organizer: string;
      allDay?: boolean;
    },
    changes: string[],
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(attendeeEmail, options);
    return this.sendEmail(
      attendeeEmail,
      eventUpdateEmail(ctx, { attendeeName, event, changes })
    );
  }

  // Send RSVP confirmation email
  async sendRSVPConfirmation(
    attendeeEmail: string,
    attendeeName: string,
    event: {
      title: string;
      startDate: Date;
      location?: string;
    },
    response: "accepted" | "declined" | "tentative",
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(attendeeEmail, options);
    return this.sendEmail(
      attendeeEmail,
      rsvpConfirmationEmail(ctx, { attendeeName, event, response })
    );
  }

  // Send payment reminder email
  async sendPaymentReminder(
    tenantEmail: string,
    tenantName: string,
    propertyName: string,
    rentAmount: number,
    dueDate: Date,
    daysOverdue: number = 0,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(tenantEmail, options);
    return this.sendEmail(
      tenantEmail,
      paymentReminderEmail(ctx, {
        tenantName,
        propertyName,
        rentAmount,
        dueDate,
        daysOverdue,
        paymentUrl: `${this.appUrl}/dashboard/payments/pay-rent`,
      })
    );
  }

  // Send lease expiry reminder
  async sendLeaseExpiryReminder(
    tenantEmail: string,
    tenantName: string,
    propertyName: string,
    expiryDate: Date,
    daysUntilExpiry: number,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(tenantEmail, options);
    return this.sendEmail(
      tenantEmail,
      leaseExpiryEmail(ctx, {
        tenantName,
        propertyName,
        expiryDate,
        daysUntilExpiry,
        leaseUrl: `${this.appUrl}/dashboard/leases/my-lease`,
      })
    );
  }

  // Send lease expiry reminder to landlord (property owner/manager)
  async sendLeaseExpiryReminderToLandlord(
    landlordEmail: string,
    landlordName: string,
    propertyName: string,
    tenantName: string,
    expiryDate: Date,
    daysUntilExpiry: number,
    leaseId?: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(landlordEmail, options);
    return this.sendEmail(
      landlordEmail,
      leaseExpiryLandlordEmail(ctx, {
        landlordName,
        propertyName,
        tenantName,
        expiryDate,
        daysUntilExpiry,
        leaseUrl: leaseId
          ? `${this.appUrl}/dashboard/leases/${leaseId}`
          : `${this.appUrl}/dashboard/leases`,
      })
    );
  }

  // Send maintenance update notification
  async sendMaintenanceUpdate(
    userEmail: string,
    userName: string,
    requestId: string,
    propertyName: string,
    status: string,
    description: string,
    notes?: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(userEmail, options);
    return this.sendEmail(
      userEmail,
      maintenanceUpdateEmail(ctx, {
        userName,
        requestId,
        propertyName,
        status,
        description,
        notes,
        requestUrl: `${this.appUrl}/dashboard/maintenance/${requestId}`,
      })
    );
  }

  // Send test email to verify configuration
  async sendTestEmail(
    recipientEmail: string,
    options?: EmailLanguageOptions
  ): Promise<boolean> {
    const ctx = await this.contextFor(recipientEmail, options);
    return this.sendEmail(
      recipientEmail,
      testEmail(ctx, { sentAt: new Date() })
    );
  }
}

// Create singleton instance
export const emailService = new EmailService();
