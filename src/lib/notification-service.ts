/**
 * PropertyPro - Comprehensive Notification Service
 * Handles automated notifications, SMS integration, and scheduling
 *
 * Text a notification falls back on (its default title and message, the SMS
 * wording) is written in the recipient's language — their organization's
 * display language, see `lib/i18n/recipient-locale.ts` — from the catalogue
 * keys `notifications.message.*` and `notifications.sms.*`. A title and
 * message the caller already wrote are sent as written.
 *
 * SMS and WhatsApp go through the office's messaging gateway
 * (`lib/messaging/dispatch.ts`): only for the types that are a messaging
 * event (`MESSAGING_EVENT_OF`), only when the office has that event switched
 * on for the channel, never to someone who opted out — and every attempt is
 * written to the message log.
 */

import { emailService } from "./email-service";
import { db } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import { publish } from "@/lib/realtime/bus";
import { sendPushToUsers } from "@/lib/push/send";
import { sendMessage } from "@/lib/messaging/dispatch";
import type {
  MessagingChannel,
  MessagingEvent,
} from "@/lib/messaging/registry";
import {
  recipientLocale,
  type RecipientLocale,
} from "@/lib/i18n/recipient-locale";
import { translateFor } from "@/lib/i18n/translate";

// Notification types
export enum NotificationType {
  PAYMENT_REMINDER = "payment_reminder",
  PAYMENT_OVERDUE = "payment_overdue",
  LEASE_EXPIRY = "lease_expiry",
  LEASE_RENEWAL = "lease_renewal",
  MAINTENANCE_UPDATE = "maintenance_update",
  MAINTENANCE_EMERGENCY = "maintenance_emergency",
  WELCOME = "welcome",
  ACCOUNT_ACTIVATION = "account_activation",
  PASSWORD_RESET = "password_reset",
  SYSTEM_ANNOUNCEMENT = "system_announcement",
  PROPERTY_UPDATE = "property_update",
  /** Money a gateway took that could not settle its payment (lib/payments/gateway-review.ts). */
  PAYMENT_REVIEW = "payment_review",
}

/** The notification types an office can text or WhatsApp about. */
export const MESSAGING_EVENT_OF: Partial<Record<NotificationType, MessagingEvent>> =
  {
    [NotificationType.PAYMENT_REMINDER]: "payment_reminder",
    [NotificationType.PAYMENT_OVERDUE]: "payment_overdue",
    [NotificationType.LEASE_EXPIRY]: "lease_expiry",
    [NotificationType.MAINTENANCE_UPDATE]: "maintenance_update",
    [NotificationType.MAINTENANCE_EMERGENCY]: "maintenance_emergency",
  };

// Notification priority levels
export enum NotificationPriority {
  LOW = "low",
  NORMAL = "normal",
  HIGH = "high",
  CRITICAL = "critical",
}

// Notification preferences interface
export interface NotificationPreferences {
  email: boolean;
  sms: boolean;
  /**
   * WhatsApp is a first-class channel here, not a flavour of SMS: the scope
   * names it alongside the other two, and it reaches a tenant who reads
   * nothing else.
   */
  whatsapp: boolean;
  push: boolean;
  inApp: boolean;
}

// Notification data interface
export interface NotificationData {
  type: NotificationType;
  priority: NotificationPriority;
  userId: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  scheduledFor?: Date;
  preferences?: NotificationPreferences;
  /**
   * The SMS/WhatsApp wording and the event's template values
   * (`lib/messaging/events.ts`). Without it the phone gets "title: message".
   */
  phone?: { body: string; templateParams: Record<string, string> };
}

// Scheduled notification interface
export interface ScheduledNotification {
  id: string;
  type: NotificationType;
  userId: string;
  scheduledFor: Date;
  data: Record<string, any>;
  status: "pending" | "sent" | "failed" | "cancelled";
  createdAt: Date;
}

export class NotificationService {
  private scheduledNotifications: Map<string, ScheduledNotification> =
    new Map();
  private schedulerStarted = false;

  // Start the minute check the first time something is scheduled, not when
  // the module is imported: every route that sends a notification imports
  // this file, and none of them should leave a timer running for nothing.
  private initializeScheduler(): void {
    if (this.schedulerStarted) return;
    this.schedulerStarted = true;
    setInterval(() => {
      this.processScheduledNotifications();
    }, 60000);
  }

  // Process scheduled notifications
  private async processScheduledNotifications(): Promise<void> {
    const now = new Date();

    for (const [id, notification] of this.scheduledNotifications) {
      if (
        notification.status === "pending" &&
        notification.scheduledFor <= now
      ) {
        try {
          await this.sendNotification({
            type: notification.type,
            priority: NotificationPriority.NORMAL,
            userId: notification.userId,
            title: "",
            message: "",
            data: notification.data,
          });

          notification.status = "sent";
        } catch (error) {
          console.error(`Failed to send scheduled notification ${id}:`, error);
          notification.status = "failed";
        }
      }
    }
  }

  // Schedule a notification
  async scheduleNotification(
    type: NotificationType,
    userId: string,
    scheduledFor: Date,
    data: Record<string, any>
  ): Promise<string> {
    const id = `${type}_${userId}_${Date.now()}`;

    const scheduledNotification: ScheduledNotification = {
      id,
      type,
      userId,
      scheduledFor,
      data,
      status: "pending",
      createdAt: new Date(),
    };

    this.scheduledNotifications.set(id, scheduledNotification);
    this.initializeScheduler();
    return id;
  }

  // Cancel a scheduled notification
  cancelScheduledNotification(id: string): boolean {
    const notification = this.scheduledNotifications.get(id);
    if (notification && notification.status === "pending") {
      notification.status = "cancelled";
      return true;
    }
    return false;
  }

  /**
   * The language this notification is written in. The request's or sweep's
   * organization when there is one (no extra lookup), else the recipient's.
   */
  private localeFor(data: NotificationData): Promise<RecipientLocale> {
    return recipientLocale({
      organizationId:
        (typeof data.data?.organizationId === "string"
          ? data.data.organizationId
          : null) ?? getOrgContext()?.organizationId,
      userId: data.userId,
      email: typeof data.data?.userEmail === "string" ? data.data.userEmail : null,
    });
  }

  // Send immediate notification
  async sendNotification(data: NotificationData): Promise<boolean> {
    try {
      const locale = await this.localeFor(data);
      // Get user preferences (in real implementation, fetch from database)
      // SMS and WhatsApp cost money per message: whether this one goes out
      // is the office's choice per event (Settings → Messaging), and the
      // recipient's — not the notification's priority.
      const preferences = data.preferences || {
        email: true,
        sms: true,
        whatsapp: true,
        push: true,
        inApp: true,
      };

      let success = true;

      // Send email notification
      if (preferences.email) {
        success = (await this.sendEmailNotification(data, locale)) && success;
      }

      if (preferences.sms) {
        success = (await this.sendPhoneMessage("sms", data, locale)) && success;
      }

      if (preferences.whatsapp) {
        success =
          (await this.sendPhoneMessage("whatsapp", data, locale)) && success;
      }

      // Send push notification (placeholder)
      if (preferences.push) {
        success = (await this.sendPushNotification(data)) && success;
      }

      // Store in-app notification (placeholder)
      if (preferences.inApp) {
        success = (await this.storeInAppNotification(data, locale)) && success;
      }

      return success;
    } catch (error) {
      console.error("Failed to send notification:", error);
      return false;
    }
  }

  // Send email notification based on type
  private async sendEmailNotification(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    try {
      switch (data.type) {
        case NotificationType.PAYMENT_REMINDER:
          return await this.sendPaymentReminderEmail(data, locale);
        case NotificationType.PAYMENT_OVERDUE:
          return await this.sendPaymentOverdueEmail(data, locale);
        case NotificationType.LEASE_EXPIRY:
          return await this.sendLeaseExpiryEmail(data, locale);
        case NotificationType.MAINTENANCE_UPDATE:
          return await this.sendMaintenanceUpdateEmail(data, locale);
        default:
          return await this.sendGenericEmail(data, locale);
      }
    } catch (error) {
      console.error("Failed to send email notification:", error);
      return false;
    }
  }

  /**
   * One line of text for a phone: the title, then the message.
   *
   * Deliberately plain — SMS has no formatting, and a WhatsApp template
   * substitutes this as a single parameter.
   */
  private phoneBody(data: NotificationData, locale: RecipientLocale): string {
    const title = this.resolveNotificationTitle(data, locale);
    const message = this.resolveNotificationMessage(data, locale);
    return title && message ? `${title}: ${message}` : title || message;
  }

  /**
   * One SMS or WhatsApp message through the office's gateway. The number is
   * read fresh by the dispatcher (a number changed this morning is the one
   * used tonight), and the outcome is in the message log either way.
   *
   * Only a provider's refusal counts as a failure. A channel the office has
   * not switched on, an opted-out recipient or a missing number is a choice
   * someone made, not a failed notification — the email still went.
   */
  private async sendPhoneMessage(
    channel: MessagingChannel,
    data: NotificationData,
    locale: RecipientLocale,
  ): Promise<boolean> {
    const event = MESSAGING_EVENT_OF[data.type];
    if (!event || !data.userId) return true;

    const outcome = await sendMessage({
      channel,
      purpose: "automation",
      event,
      recipient: { userId: data.userId },
      body: data.phone?.body || this.phoneBody(data, locale),
      templateParams: data.phone?.templateParams,
      language: locale.language,
    });
    return outcome.status !== "failed";
  }

  // Send push notification (placeholder)
  private async sendPushNotification(data: NotificationData): Promise<boolean> {
    // TODO: Implement push notification service (Firebase, OneSignal, etc.)

    return true;
  }

  // Store in-app notification
  private async storeInAppNotification(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    try {
      const userId = data.userId;

      if (!userId || typeof userId !== "string") {
        console.warn("Skipping in-app notification storage: invalid userId");
        return false;
      }

      // Creates must carry organizationId. Route callers have an org context;
      // bypass contexts (cron/automation) resolve it from the target user.
      let organizationId = getOrgContext()?.organizationId ?? null;
      if (!organizationId) {
        const targetUser = await db.user.findFirst({
          where: { id: userId },
          select: { organizationId: true },
        });
        organizationId = targetUser?.organizationId ?? null;
      }

      if (!organizationId) {
        console.warn(
          "Skipping in-app notification storage: no organization resolved for user",
          userId
        );
        return false;
      }

      const title = this.resolveNotificationTitle(data, locale);
      const message = this.resolveNotificationMessage(data, locale);
      const actionUrl = data.data?.actionUrl;

      const created = await db.notification.create({
        data: {
          organizationId,
          userId,
          title,
          message,
          type: data.type,
          priority: data.priority,
          actionUrl,
          metadata: data.data || {},
        },
      });

      publish({
        type: "notification.created",
        userId,
        notification: {
          id: created.id,
          title,
          message,
          type: data.type,
          priority: data.priority,
          actionUrl,
          createdAt: created.createdAt ?? new Date(),
        },
      });

      void sendPushToUsers([userId], {
        title,
        body: message.slice(0, 160),
        url: actionUrl || "/dashboard/notifications",
        tag: `notification-${created.id}`,
      });

      return true;
    } catch (error) {
      console.error("Failed to store in-app notification:", error);
      return false;
    }
  }

  // Email notification methods
  private async sendPaymentReminderEmail(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    const {
      userEmail,
      userName,
      propertyName,
      rentAmount,
      dueDate,
      daysOverdue,
    } = data.data || {};
    return await emailService.sendPaymentReminder(
      userEmail,
      userName,
      propertyName,
      rentAmount,
      new Date(dueDate),
      daysOverdue || 0,
      { language: locale.language }
    );
  }

  private async sendPaymentOverdueEmail(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    const {
      userEmail,
      userName,
      propertyName,
      rentAmount,
      dueDate,
      daysOverdue,
    } = data.data || {};
    return await emailService.sendPaymentReminder(
      userEmail,
      userName,
      propertyName,
      rentAmount,
      new Date(dueDate),
      daysOverdue,
      { language: locale.language }
    );
  }

  private async sendLeaseExpiryEmail(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    const {
      userEmail,
      userName,
      propertyName,
      expiryDate,
      daysUntilExpiry,
      isLandlord,
      tenantName,
      leaseId,
    } = data.data || {};

    // Send landlord-specific email if this is for a property owner/manager
    if (isLandlord) {
      return await emailService.sendLeaseExpiryReminderToLandlord(
        userEmail,
        userName,
        propertyName,
        tenantName,
        new Date(expiryDate),
        daysUntilExpiry,
        leaseId,
        { language: locale.language }
      );
    }

    // Send tenant-specific email
    return await emailService.sendLeaseExpiryReminder(
      userEmail,
      userName,
      propertyName,
      new Date(expiryDate),
      daysUntilExpiry,
      { language: locale.language }
    );
  }

  private async sendMaintenanceUpdateEmail(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    const {
      userEmail,
      userName,
      requestId,
      propertyName,
      status,
      description,
      notes,
    } = data.data || {};
    return await emailService.sendMaintenanceUpdate(
      userEmail,
      userName,
      requestId,
      propertyName,
      status,
      description,
      notes,
      { language: locale.language }
    );
  }

  private async sendGenericEmail(
    data: NotificationData,
    locale: RecipientLocale
  ): Promise<boolean> {
    const { userEmail, userName } = data.data || {};
    return await emailService.sendNotification(
      userEmail,
      userName,
      this.resolveNotificationTitle(data, locale),
      this.resolveNotificationMessage(data, locale),
      undefined,
      { language: locale.language }
    );
  }

  private resolveNotificationTitle(
    data: NotificationData,
    locale: RecipientLocale
  ): string {
    if (data.title?.trim()) {
      return data.title;
    }

    const fallbackTitle =
      typeof data.data?.title === "string" && data.data.title.trim()
        ? data.data.title
        : null;

    if (fallbackTitle) {
      return fallbackTitle;
    }

    return translateFor(
      locale,
      `notifications.message.default.title.${NotificationService.defaultKey(data.type)}`
    );
  }

  /** The default-text key for a type; types without their own share "other". */
  private static defaultKey(type: NotificationType): string {
    switch (type) {
      case NotificationType.PAYMENT_REMINDER:
      case NotificationType.PAYMENT_OVERDUE:
      case NotificationType.LEASE_EXPIRY:
      case NotificationType.MAINTENANCE_UPDATE:
      case NotificationType.MAINTENANCE_EMERGENCY:
      case NotificationType.SYSTEM_ANNOUNCEMENT:
        return type;
      default:
        return "other";
    }
  }

  private resolveNotificationMessage(
    data: NotificationData,
    locale: RecipientLocale
  ): string {
    if (data.message?.trim()) {
      return data.message;
    }

    const fallbackMessage =
      typeof data.data?.message === "string" && data.data.message.trim()
        ? data.data.message
        : null;

    if (fallbackMessage) {
      return fallbackMessage;
    }

    return translateFor(
      locale,
      `notifications.message.default.message.${NotificationService.defaultKey(data.type)}`
    );
  }
}

// Create singleton instance
export const notificationService = new NotificationService();
