/**
 * PropertyPro - Payment Communication Service
 * Automated payment reminders and notifications with smart scheduling
 *
 * Reminders are written in the language of the tenant's office (its display
 * settings), with amounts in the payment's own currency and dates in the
 * office's time zone. The wording is the catalogue's
 * (`notifications.email.schedule.*`); which language is decided by
 * `lib/i18n/recipient-locale.ts`.
 */

import { PaymentStatus } from "@/types";
import { db } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/utils/formatting";
import {
  recipientLocale,
  type RecipientLocale,
} from "@/lib/i18n/recipient-locale";
import {
  fillPlaceholders,
  formatDateFor,
  translateFor,
} from "@/lib/i18n/translate";
import { escapeHtml } from "@/lib/templates/transactional-emails";

export interface NotificationTemplate {
  id: string;
  name: string;
  subject: string;
  htmlContent: string;
  textContent: string;
  variables: string[];
}

/**
 * One message of the reminder schedule, as catalogue keys under
 * `notifications.email.schedule.` — see `PaymentCommunicationService.templates`.
 */
interface ScheduleTemplate {
  id: string;
  name: string;
  /** The template's own key group: `<key>.subject`, `<key>.heading`, … */
  key: string;
  parts: Array<{
    text?: string;
    strong?: boolean;
    details?: boolean;
    link?: string;
    button?: string;
    color?: string;
  }>;
  variables: string[];
}

export interface NotificationSchedule {
  type: "reminder" | "overdue" | "final_notice" | "confirmation";
  triggerDays: number; // Days before/after due date (negative = before, positive = after)
  enabled: boolean;
  channels: ("email" | "sms" | "push")[];
  templateId: string;
  priority: "low" | "medium" | "high";
}

export interface CommunicationConfig {
  schedules: NotificationSchedule[];
  globalSettings: {
    enableEmail: boolean;
    enableSMS: boolean;
    enablePush: boolean;
    businessHours: {
      start: string; // "09:00"
      end: string; // "17:00"
      timezone: string;
    };
    respectDoNotDisturb: boolean;
  };
}

export interface NotificationResult {
  notificationId: string;
  paymentId: string;
  tenantId: string;
  type: string;
  channels: string[];
  status: "sent" | "failed" | "scheduled";
  sentAt?: Date;
  scheduledFor?: Date;
  error?: string;
}

export interface CommunicationBatch {
  batchId: string;
  totalNotifications: number;
  successCount: number;
  failureCount: number;
  results: NotificationResult[];
  processedAt: Date;
}

export class PaymentCommunicationService {
  private defaultConfig: CommunicationConfig = {
    schedules: [
      {
        type: "reminder",
        triggerDays: -7,
        enabled: true,
        channels: ["email"],
        templateId: "payment_reminder_7_days",
        priority: "low",
      },
      {
        type: "reminder",
        triggerDays: -3,
        enabled: true,
        channels: ["email"],
        templateId: "payment_reminder_3_days",
        priority: "medium",
      },
      {
        type: "reminder",
        triggerDays: -1,
        enabled: true,
        channels: ["email", "sms"],
        templateId: "payment_reminder_1_day",
        priority: "high",
      },
      {
        type: "reminder",
        triggerDays: 0,
        enabled: true,
        channels: ["email", "sms"],
        templateId: "payment_due_today",
        priority: "high",
      },
      {
        type: "overdue",
        triggerDays: 1,
        enabled: true,
        channels: ["email", "sms"],
        templateId: "payment_overdue_1_day",
        priority: "high",
      },
      {
        type: "overdue",
        triggerDays: 5,
        enabled: true,
        channels: ["email", "sms"],
        templateId: "payment_overdue_5_days",
        priority: "high",
      },
      {
        type: "final_notice",
        triggerDays: 15,
        enabled: true,
        channels: ["email", "sms"],
        templateId: "payment_final_notice",
        priority: "high",
      },
    ],
    globalSettings: {
      enableEmail: true,
      enableSMS: false,
      enablePush: false,
      businessHours: {
        start: "09:00",
        end: "17:00",
        timezone: "America/New_York",
      },
      respectDoNotDisturb: true,
    },
  };

  /**
   * The schedule's messages, by template id. The wording is the shared
   * catalogue's (`notifications.email.schedule.*`), written in the tenant's
   * office's language when a reminder goes out — see `renderTemplate`. Each
   * entry lists its parts in order; `strong` sets a paragraph in bold, and
   * `button` is the coloured payment link.
   */
  private templates: Record<string, ScheduleTemplate> = {
    payment_reminder_7_days: {
      id: "payment_reminder_7_days",
      name: "7-Day Payment Reminder",
      key: "reminder7",
      parts: [
        { text: "reminder7.body" },
        { details: true },
        { text: "reminder7.portal" },
        { text: "reminder7.thanks" },
      ],
      variables: ["tenantName", "amount", "dueDate", "propertyName"],
    },
    payment_reminder_3_days: {
      id: "payment_reminder_3_days",
      name: "3-Day Payment Reminder",
      key: "reminder3",
      parts: [
        { text: "reminder3.body" },
        { text: "reminder3.onTime" },
        { link: "payNow" },
      ],
      variables: ["tenantName", "amount", "dueDate", "propertyName", "paymentLink"],
    },
    payment_reminder_1_day: {
      id: "payment_reminder_1_day",
      name: "1-Day Payment Reminder",
      key: "reminder1",
      parts: [
        { text: "reminder1.body", strong: true },
        { text: "payPrompt" },
        { button: "payNow", color: "#007bff" },
      ],
      variables: ["tenantName", "amount", "dueDate", "propertyName", "paymentLink"],
    },
    payment_due_today: {
      id: "payment_due_today",
      name: "Payment Due Today",
      key: "dueToday",
      parts: [
        { text: "dueToday.body", strong: true },
        { text: "payPrompt" },
        { button: "dueToday.button", color: "#dc3545" },
      ],
      variables: ["tenantName", "amount", "dueDate", "propertyName", "paymentLink"],
    },
    payment_overdue_1_day: {
      id: "payment_overdue_1_day",
      name: "1-Day Overdue Notice",
      key: "overdue1",
      parts: [
        { text: "overdue1.body", strong: true },
        { text: "payPrompt" },
        { text: "overdue1.disregard" },
        { button: "payNow", color: "#dc3545" },
      ],
      variables: ["tenantName", "amount", "dueDate", "propertyName", "paymentLink"],
    },
    payment_overdue_5_days: {
      id: "payment_overdue_5_days",
      name: "5-Day Overdue Notice",
      key: "overdue5",
      parts: [
        { text: "overdue5.body", strong: true },
        { text: "overdue5.contact" },
        { text: "totalDue" },
        { button: "payNow", color: "#dc3545" },
        { text: "contactLine" },
      ],
      variables: [
        "tenantName",
        "amount",
        "dueDate",
        "propertyName",
        "paymentLink",
        "totalAmountDue",
        "contactPhone",
        "contactEmail",
      ],
    },
    payment_final_notice: {
      id: "payment_final_notice",
      name: "Final Notice",
      key: "finalNotice",
      parts: [
        { text: "finalNotice.lead", strong: true },
        { text: "finalNotice.body" },
        { text: "finalNotice.consequence" },
        { text: "totalDue" },
        { text: "finalNotice.contact", strong: true },
      ],
      variables: [
        "tenantName",
        "amount",
        "dueDate",
        "propertyName",
        "daysOverdue",
        "totalAmountDue",
        "contactPhone",
        "contactEmail",
      ],
    },
  };

  /**
   * One message of the schedule, written in `locale`. The subject, heading
   * and plain-text version are each template's own entries
   * (`<key>.subject`, `<key>.heading`, `<key>.text`).
   */
  private renderTemplate(
    template: ScheduleTemplate,
    variables: Record<string, string | number>,
    locale: RecipientLocale
  ): { subject: string; htmlContent: string; textContent: string } {
    const base = "notifications.email.schedule";
    const plain = (key: string) =>
      translateFor(locale, `${base}.${key}`, variables);
    const escaped: Record<string, string> = {};
    for (const [name, value] of Object.entries(variables)) {
      escaped[name] = escapeHtml(value);
    }
    const html = (key: string) =>
      fillPlaceholders(escapeHtml(translateFor(locale, `${base}.${key}`)), escaped);
    const label = (key: string) =>
      escapeHtml(translateFor(locale, `notifications.email.label.${key}`));

    const parts = template.parts.map((part) => {
      if (part.text) {
        const text = html(part.text);
        return `<p>${part.strong ? `<strong>${text}</strong>` : text}</p>`;
      }
      if (part.details) {
        return `<p><strong>${html(`${template.key}.detailsTitle`)}</strong></p>
        <ul>
          <li>${label("amountDue")}: ${escaped.amount}</li>
          <li>${label("dueDate")}: ${escaped.dueDate}</li>
          <li>${label("property")}: ${escaped.propertyName}</li>
        </ul>`;
      }
      if (part.link) {
        return `<p><a href="${escaped.paymentLink}">${html(part.link)}</a></p>`;
      }
      if (part.button) {
        return `<p><a href="${escaped.paymentLink}" style="background-color: ${part.color}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">${html(part.button)}</a></p>`;
      }
      return "";
    });

    const align = locale.dir === "rtl" ? "right" : "left";
    const htmlContent = `
      <div dir="${locale.dir}" lang="${locale.language}" style="direction: ${locale.dir}; text-align: ${align}; font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, 'Noto Sans Arabic', sans-serif;">
        <h2>${html(`${template.key}.heading`)}</h2>
        <p>${fillPlaceholders(
          escapeHtml(translateFor(locale, "notifications.email.greeting")),
          { name: escaped.tenantName ?? "" }
        )}</p>
        ${parts.join("\n        ")}
      </div>
    `;

    return {
      subject: plain(`${template.key}.subject`),
      htmlContent,
      textContent: plain(`${template.key}.text`),
    };
  }

  /**
   * Process automated notifications for all eligible payments
   */
  async processAutomatedNotifications(
    config: Partial<CommunicationConfig> = {}
  ): Promise<CommunicationBatch> {
    const finalConfig = { ...this.defaultConfig, ...config };
    const batchId = crypto.randomUUID();
    const results: NotificationResult[] = [];

    try {
      // Get all payments that might need notifications
      const payments = await db.payment.findMany({
        where: {
          status: {
            notIn: [PaymentStatus.PAID, PaymentStatus.CANCELLED],
          },
          deletedAt: null,
        },
        include: {
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          property: { select: { id: true, name: true } },
        },
      });


      // Process each payment
      for (const payment of payments) {
        const paymentResults = await this.processPaymentNotifications(
          payment,
          finalConfig
        );
        results.push(...paymentResults);
      }

      const successCount = results.filter((r) => r.status === "sent").length;
      const failureCount = results.filter((r) => r.status === "failed").length;

      return {
        batchId,
        totalNotifications: results.length,
        successCount,
        failureCount,
        results,
        processedAt: new Date(),
      };
    } catch (error) {
      console.error("Error processing automated notifications:", error);
      throw error;
    }
  }

  /**
   * Process notifications for a specific payment
   */
  private async processPaymentNotifications(
    payment: any,
    config: CommunicationConfig
  ): Promise<NotificationResult[]> {
    const results: NotificationResult[] = [];
    const now = new Date();
    const dueDate = new Date(payment.dueDate);
    const daysDiff = Math.ceil(
      (now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Check each notification schedule
    for (const schedule of config.schedules) {
      if (!schedule.enabled) continue;

      // Check if this notification should be triggered
      const shouldTrigger = this.shouldTriggerNotification(
        daysDiff,
        schedule,
        payment
      );

      if (shouldTrigger) {
        const result = await this.sendNotification(payment, schedule, config);
        results.push(result);
      }
    }

    return results;
  }

  /**
   * Determine if a notification should be triggered
   */
  private shouldTriggerNotification(
    daysDiff: number,
    schedule: NotificationSchedule,
    payment: any
  ): boolean {
    // Check if we're at the right trigger point
    if (daysDiff !== schedule.triggerDays) {
      return false;
    }

    // Check if this notification has already been sent
    const alreadySent = payment.remindersSent?.some(
      (reminder: any) =>
        reminder.type === schedule.type &&
        Math.abs(new Date(reminder.sentDate).getTime() - new Date().getTime()) <
          24 * 60 * 60 * 1000
    );

    return !alreadySent;
  }

  /**
   * Send a notification
   */
  private async sendNotification(
    payment: any,
    schedule: NotificationSchedule,
    config: CommunicationConfig
  ): Promise<NotificationResult> {
    const notificationId = crypto.randomUUID();

    try {
      const template = this.templates[schedule.templateId];
      if (!template) {
        throw new Error(`Template not found: ${schedule.templateId}`);
      }

      // Prepare notification data, in the language of the tenant's office
      const locale = await recipientLocale({
        organizationId: payment.organizationId,
        userId: payment.tenantId,
      });
      const notificationData = this.prepareNotificationData(
        payment,
        template,
        locale
      );

      // Send through enabled channels
      const channelResults = await Promise.all(
        schedule.channels.map((channel) =>
          this.sendThroughChannel(channel, notificationData, config)
        )
      );

      // Update payment with reminder sent
      await this.recordReminderSent(
        payment.id,
        schedule.type,
        schedule.channels
      );

      const allSuccessful = channelResults.every((result) => result.success);

      return {
        notificationId,
        paymentId: payment.id,
        tenantId: payment.tenantId,
        type: schedule.type,
        channels: schedule.channels,
        status: allSuccessful ? "sent" : "failed",
        sentAt: new Date(),
        error: allSuccessful ? undefined : "Some channels failed",
      };
    } catch (error) {
      console.error(`Error sending notification ${notificationId}:`, error);

      return {
        notificationId,
        paymentId: payment.id,
        tenantId: payment.tenantId,
        type: schedule.type,
        channels: schedule.channels,
        status: "failed",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Prepare notification data with variable substitution
   */
  private prepareNotificationData(
    payment: any,
    template: ScheduleTemplate,
    locale: RecipientLocale
  ): any {
    const property = payment.property;
    const user = payment.tenant;
    const currency = payment.currency || locale.currency;

    const variables = {
      tenantName: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim(),
      amount: formatCurrency(Number(payment.amount) || 0, currency),
      dueDate: formatDateFor(locale.language, payment.dueDate, {
        timeZone: locale.timeZone,
      }),
      propertyName: property?.name ?? "",
      paymentLink: `${process.env.NEXT_PUBLIC_APP_URL}/tenant/payments`,
      totalAmountDue: formatCurrency(
        (Number(payment.amount) || 0) + (Number(payment.lateFeeApplied) || 0),
        currency
      ),
      daysOverdue: Math.max(
        0,
        Math.ceil(
          (new Date().getTime() - new Date(payment.dueDate).getTime()) /
            (1000 * 60 * 60 * 24)
        )
      ),
      contactPhone: process.env.CONTACT_PHONE || "(555) 123-4567",
      contactEmail: process.env.CONTACT_EMAIL || "support@PropertyPro.com",
    };

    const { subject, htmlContent, textContent } = this.renderTemplate(
      template,
      variables,
      locale
    );

    return {
      to: user.email,
      phone: user.phone,
      subject,
      htmlContent,
      textContent,
      variables,
    };
  }

  /**
   * Send notification through specific channel
   */
  private async sendThroughChannel(
    channel: string,
    notificationData: any,
    config: CommunicationConfig
  ): Promise<{ success: boolean; error?: string }> {
    try {
      switch (channel) {
        case "email":
          if (!config.globalSettings.enableEmail) {
            return { success: false, error: "Email notifications disabled" };
          }
          return await this.sendEmail(notificationData);

        case "sms":
          if (!config.globalSettings.enableSMS) {
            return { success: false, error: "SMS notifications disabled" };
          }
          return await this.sendSMS(notificationData);

        case "push":
          if (!config.globalSettings.enablePush) {
            return { success: false, error: "Push notifications disabled" };
          }
          return await this.sendPushNotification(notificationData);

        default:
          return { success: false, error: `Unknown channel: ${channel}` };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Send email notification
   */
  private async sendEmail(
    data: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const { emailService } = await import("./email.service");

      const result = await emailService.sendEmail({
        to: data.to,
        subject: data.subject,
        html: data.htmlContent,
        text: data.textContent,
      });

      if (result.success) {

        return { success: true };
      } else {
        console.error("Email sending failed:", result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error("Email service error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Email sending failed",
      };
    }
  }

  /**
   * Send SMS notification (disabled - SMS service not configured)
   */
  private async sendSMS(
    data: any
  ): Promise<{ success: boolean; error?: string }> {
    console.warn("SMS service not configured, skipping SMS notification");
    return { success: false, error: "SMS service not configured" };
  }

  /**
   * Send push notification
   */
  private async sendPushNotification(
    data: any
  ): Promise<{ success: boolean; error?: string }> {
    try {
      // TODO: Implement actual push notification sending

      // Simulate push notification sending
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Push notification failed",
      };
    }
  }

  /**
   * Record that a reminder was sent
   */
  private async recordReminderSent(
    paymentId: string,
    type: string,
    channels: string[]
  ): Promise<void> {
    const payment = await db.payment.findFirst({
      where: { id: paymentId },
      select: { remindersSent: true },
    });
    if (!payment) return;

    await db.payment.update({
      where: { id: paymentId },
      data: {
        remindersSent: [
          ...(((payment.remindersSent as unknown) as any[]) ?? []),
          {
            type,
            sentDate: new Date().toISOString(),
            method: channels.join(","),
          },
        ],
      },
    });
  }
}

export const paymentCommunicationService = new PaymentCommunicationService();
