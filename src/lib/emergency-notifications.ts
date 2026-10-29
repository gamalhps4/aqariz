/**
 * PropertyPro - Emergency Notification System
 * Handle real-time notifications for emergency maintenance requests
 */

import { db } from "@/lib/db/prisma";
import { getOrgContext } from "@/lib/tenancy/context";
import { publish } from "@/lib/realtime/bus";
import { sendPushToUsers } from "@/lib/push/send";

// Notification types
export enum NotificationType {
  EMAIL = "email",
  SMS = "sms",
  PUSH = "push",
  IN_APP = "in_app",
}

export enum NotificationPriority {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

export interface NotificationTemplate {
  subject: string;
  body: string;
  smsText?: string;
  pushTitle?: string;
  pushBody?: string;
}

export interface NotificationRecipient {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  role: string;
  preferences: {
    email: boolean;
    sms: boolean;
    push: boolean;
  };
}

export interface EmergencyNotification {
  id: string;
  type: NotificationType;
  priority: NotificationPriority;
  recipient: NotificationRecipient;
  template: NotificationTemplate;
  data: any;
  scheduledAt: Date;
  sentAt?: Date;
  status: "pending" | "sent" | "failed" | "cancelled";
  retryCount: number;
  maxRetries: number;
}

// Emergency notification templates
export const EMERGENCY_TEMPLATES = {
  NEW_EMERGENCY: {
    subject: "🚨 EMERGENCY: New Critical Maintenance Request",
    body: `
      <h2 style="color: #dc2626;">EMERGENCY MAINTENANCE REQUEST</h2>
      <p><strong>Property:</strong> {{propertyName}}</p>
      <p><strong>Address:</strong> {{propertyAddress}}</p>
      <p><strong>Emergency Type:</strong> {{emergencyType}}</p>
      <p><strong>Title:</strong> {{title}}</p>
      <p><strong>Description:</strong> {{description}}</p>
      <p><strong>Tenant:</strong> {{tenantName}} ({{tenantPhone}})</p>
      <p><strong>Safety Risk:</strong> {{safetyRisk}}</p>
      <p><strong>Immediate Action Taken:</strong> {{immediateAction}}</p>
      <p><strong>Created:</strong> {{createdAt}}</p>
      
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; margin: 16px 0; border-radius: 8px;">
        <p style="color: #dc2626; font-weight: bold;">⚠️ This is an emergency request requiring immediate attention!</p>
        <p>Please respond within 2 hours to meet SLA requirements.</p>
      </div>
      
      <a href="{{viewUrl}}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
        View Emergency Request
      </a>
    `,
    smsText:
      "🚨 EMERGENCY: {{emergencyType}} at {{propertyName}}. {{title}}. Tenant: {{tenantName}} {{tenantPhone}}. View: {{viewUrl}}",
    pushTitle: "🚨 Emergency Maintenance",
    pushBody: "{{emergencyType}} at {{propertyName}} - {{title}}",
  },

  EMERGENCY_ASSIGNED: {
    subject: "🚨 Emergency Assigned: {{title}}",
    body: `
      <h2 style="color: #dc2626;">Emergency Request Assigned to You</h2>
      <p>You have been assigned an emergency maintenance request:</p>
      <p><strong>Property:</strong> {{propertyName}}</p>
      <p><strong>Title:</strong> {{title}}</p>
      <p><strong>Emergency Type:</strong> {{emergencyType}}</p>
      <p><strong>Safety Risk:</strong> {{safetyRisk}}</p>
      <p><strong>Time Elapsed:</strong> {{timeElapsed}}</p>
      
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; margin: 16px 0; border-radius: 8px;">
        <p style="color: #dc2626; font-weight: bold;">Please respond immediately!</p>
      </div>
      
      <a href="{{viewUrl}}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        Accept Assignment
      </a>
    `,
    smsText:
      "🚨 Emergency assigned: {{title}} at {{propertyName}}. {{timeElapsed}} elapsed. Accept: {{viewUrl}}",
    pushTitle: "Emergency Assigned",
    pushBody: "{{title}} at {{propertyName}}",
  },

  EMERGENCY_OVERDUE: {
    subject: "⚠️ OVERDUE: Emergency Request Past SLA",
    body: `
      <h2 style="color: #dc2626;">OVERDUE EMERGENCY REQUEST</h2>
      <p>The following emergency request is past the 2-hour SLA:</p>
      <p><strong>Property:</strong> {{propertyName}}</p>
      <p><strong>Title:</strong> {{title}}</p>
      <p><strong>Time Elapsed:</strong> {{timeElapsed}}</p>
      <p><strong>Assigned To:</strong> {{assignedTo}}</p>
      
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; margin: 16px 0; border-radius: 8px;">
        <p style="color: #dc2626; font-weight: bold;">⚠️ This request requires immediate escalation!</p>
      </div>
      
      <a href="{{escalateUrl}}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        Escalate Now
      </a>
    `,
    smsText:
      "⚠️ OVERDUE: {{title}} at {{propertyName}} - {{timeElapsed}} elapsed. Escalate: {{escalateUrl}}",
    pushTitle: "Emergency Overdue",
    pushBody: "{{title}} - {{timeElapsed}} elapsed",
  },

  EMERGENCY_ESCALATED: {
    subject: "🚨 ESCALATED: Critical Emergency Request",
    body: `
      <h2 style="color: #dc2626;">ESCALATED EMERGENCY REQUEST</h2>
      <p>An emergency request has been escalated to you:</p>
      <p><strong>Property:</strong> {{propertyName}}</p>
      <p><strong>Title:</strong> {{title}}</p>
      <p><strong>Original Assignee:</strong> {{originalAssignee}}</p>
      <p><strong>Escalation Reason:</strong> {{escalationReason}}</p>
      <p><strong>Time Elapsed:</strong> {{timeElapsed}}</p>
      
      <div style="background: #fef2f2; border: 1px solid #fecaca; padding: 16px; margin: 16px 0; border-radius: 8px;">
        <p style="color: #dc2626; font-weight: bold;">🚨 CRITICAL: Immediate action required!</p>
      </div>
      
      <a href="{{viewUrl}}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        Take Immediate Action
      </a>
    `,
    smsText:
      "🚨 ESCALATED: {{title}} at {{propertyName}}. Reason: {{escalationReason}}. Act now: {{viewUrl}}",
    pushTitle: "Emergency Escalated",
    pushBody: "{{title}} escalated - immediate action required",
  },

  EMERGENCY_COMPLETED: {
    subject: "✅ Emergency Resolved: {{title}}",
    body: `
      <h2 style="color: #16a34a;">Emergency Request Completed</h2>
      <p>The following emergency request has been resolved:</p>
      <p><strong>Property:</strong> {{propertyName}}</p>
      <p><strong>Title:</strong> {{title}}</p>
      <p><strong>Resolved By:</strong> {{resolvedBy}}</p>
      <p><strong>Resolution Time:</strong> {{resolutionTime}}</p>
      <p><strong>Total Cost:</strong> $\{{actualCost}}</p>
      
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; padding: 16px; margin: 16px 0; border-radius: 8px;">
        <p style="color: #16a34a; font-weight: bold;">✅ Emergency successfully resolved!</p>
      </div>
      
      <a href="{{viewUrl}}" style="background: #16a34a; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
        View Details
      </a>
    `,
    smsText:
      "✅ Emergency resolved: {{title}} at {{propertyName}}. Time: {{resolutionTime}}. Cost: ${{actualCost}}",
    pushTitle: "Emergency Resolved",
    pushBody: "{{title}} completed in {{resolutionTime}}",
  },
};

// Emergency notification service
export class EmergencyNotificationService {
  private static instance: EmergencyNotificationService;
  private notifications: Map<string, EmergencyNotification> = new Map();

  static getInstance(): EmergencyNotificationService {
    if (!EmergencyNotificationService.instance) {
      EmergencyNotificationService.instance =
        new EmergencyNotificationService();
    }
    return EmergencyNotificationService.instance;
  }

  // Send emergency notification
  async sendEmergencyNotification(
    templateKey: keyof typeof EMERGENCY_TEMPLATES,
    recipients: NotificationRecipient[],
    data: any,
    priority: NotificationPriority = NotificationPriority.CRITICAL
  ): Promise<void> {
    const template = EMERGENCY_TEMPLATES[templateKey];

    for (const recipient of recipients) {
      // Send email if enabled
      if (recipient.preferences.email && recipient.email) {
        await this.sendEmailNotification(recipient, template, data, priority);
      }

      // Send SMS if enabled and critical/high priority
      if (
        recipient.preferences.sms &&
        recipient.phone &&
        (priority === NotificationPriority.CRITICAL ||
          priority === NotificationPriority.HIGH)
      ) {
        await this.sendSMSNotification(recipient, template, data, priority);
      }

      // Send push notification if enabled
      if (recipient.preferences.push) {
        await this.sendPushNotification(recipient, template, data, priority);
      }

      // Always send in-app notification for emergencies
      await this.sendInAppNotification(recipient, template, data, priority);
    }
  }

  // Send email notification
  private async sendEmailNotification(
    recipient: NotificationRecipient,
    template: NotificationTemplate,
    data: any,
    priority: NotificationPriority
  ): Promise<void> {
    try {
      const subject = this.interpolateTemplate(template.subject, data);
      const body = this.interpolateTemplate(template.body, data);

      // In a real implementation, this would integrate with an email service
      // like SMTP/Nodemailer, AWS SES, or similar
      const emailData = {
        to: recipient.email,
        subject,
        html: body,
        priority:
          priority === NotificationPriority.CRITICAL ? "high" : "normal",
      };

      // Mock email sending - replace with actual email service

      // TODO: Integrate with actual email service
      // await emailService.send(emailData);
    } catch (error) {
      console.error("Failed to send emergency email:", error);
      throw error;
    }
  }

  // Send SMS notification
  private async sendSMSNotification(
    recipient: NotificationRecipient,
    template: NotificationTemplate,
    data: any,
    priority: NotificationPriority
  ): Promise<void> {
    try {
      if (!template.smsText) return;

      const message = this.interpolateTemplate(template.smsText, data);

      // In a real implementation, this would integrate with an SMS service
      // like Twilio, AWS SNS, or similar
      const smsData = {
        to: recipient.phone,
        message,
        priority:
          priority === NotificationPriority.CRITICAL ? "high" : "normal",
      };

      // Mock SMS sending - replace with actual SMS service

      // TODO: Integrate with actual SMS service
      // await smsService.send(smsData);
    } catch (error) {
      console.error("Failed to send emergency SMS:", error);
      throw error;
    }
  }

  // Send push notification
  private async sendPushNotification(
    recipient: NotificationRecipient,
    template: NotificationTemplate,
    data: any,
    priority: NotificationPriority
  ): Promise<void> {
    try {
      if (!template.pushTitle || !template.pushBody) return;

      const title = this.interpolateTemplate(template.pushTitle, data);
      const body = this.interpolateTemplate(template.pushBody, data);

      // In a real implementation, this would integrate with a push service
      // like Firebase Cloud Messaging, Apple Push Notifications, etc.
      const pushData = {
        userId: recipient.id,
        title,
        body,
        priority:
          priority === NotificationPriority.CRITICAL ? "high" : "normal",
        data: {
          type: "emergency",
          requestId: data.requestId,
        },
      };

      // Mock push notification - replace with actual push service

      // TODO: Integrate with actual push notification service
      // await pushService.send(pushData);
    } catch (error) {
      console.error("Failed to send emergency push notification:", error);
      throw error;
    }
  }

  // Send in-app notification
  private async sendInAppNotification(
    recipient: NotificationRecipient,
    template: NotificationTemplate,
    data: any,
    priority: NotificationPriority
  ): Promise<void> {
    try {
      const title = this.interpolateTemplate(
        template.pushTitle || template.subject,
        data
      );
      const message = this.interpolateTemplate(
        template.pushBody || template.subject,
        data
      );

      // Store in-app notification in database
      const notificationData = {
        userId: recipient.id,
        type: "emergency",
        title,
        message,
        priority,
        data: {
          requestId: data.requestId,
          emergencyType: data.emergencyType,
        },
        read: false,
        createdAt: new Date(),
      };

      if (!notificationData.userId || typeof notificationData.userId !== "string") {
        console.warn(
          "Skipping emergency in-app notification storage: invalid user id",
          notificationData.userId
        );
        return;
      }

      // Creates must carry organizationId. Route callers have an org context;
      // bypass contexts resolve it from the target user's record.
      let organizationId = getOrgContext()?.organizationId ?? null;
      if (!organizationId) {
        const targetUser = await db.user.findFirst({
          where: { id: notificationData.userId },
          select: { organizationId: true },
        });
        organizationId = targetUser?.organizationId ?? null;
      }

      if (!organizationId) {
        console.warn(
          "Skipping emergency in-app notification storage: no organization resolved for user",
          notificationData.userId
        );
        return;
      }

      const created = await db.notification.create({
        data: {
          organizationId,
          userId: notificationData.userId,
          type: notificationData.type,
          title: notificationData.title,
          message: notificationData.message,
          priority: notificationData.priority,
          metadata: {
            requestId: notificationData.data.requestId,
            emergencyType: notificationData.data.emergencyType,
          },
          actionUrl: data.viewUrl,
        },
      });

      publish({
        type: "notification.created",
        userId: notificationData.userId,
        notification: {
          id: created.id,
          title: notificationData.title,
          message: notificationData.message,
          type: notificationData.type,
          priority: notificationData.priority,
          actionUrl: data.viewUrl,
          createdAt: created.createdAt ?? new Date(),
        },
      });

      void sendPushToUsers([notificationData.userId], {
        title: notificationData.title,
        body: notificationData.message.slice(0, 160),
        url: data.viewUrl || "/dashboard/notifications",
        tag: `notification-${created.id}`,
      });
    } catch (error) {
      console.error("Failed to send in-app emergency notification:", error);
      throw error;
    }
  }

  // Interpolate template variables
  private interpolateTemplate(template: string, data: any = {}): string {
    return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      // Handle special cases for cost fields
      if (key === "totalCost" || key === "actualCost") {
        return data.totalCost || data.actualCost || data.estimatedCost || "0";
      }
      // Return the value if it exists, otherwise return empty string
      return data[key] !== undefined ? String(data[key]) : "";
    });
  }

  // Get notification recipients based on emergency type and property
  async getEmergencyRecipients(
    emergencyType: string,
    propertyId: string,
    excludeUserId?: string
  ): Promise<NotificationRecipient[]> {
    // In a real implementation, this would query the database for:
    // 1. Property managers for the specific property
    // 2. Maintenance staff available for emergency calls
    // 3. Super admins
    // 4. On-call personnel based on time/day

    // Mock recipients - replace with actual database query
    const mockRecipients: NotificationRecipient[] = [
      {
        id: "manager1",
        name: "Property Manager",
        email: "manager@property.com",
        phone: "+1234567890",
        role: "property_manager",
        preferences: { email: true, sms: true, push: true },
      },
      {
        id: "maintenance1",
        name: "Maintenance Staff",
        email: "maintenance@property.com",
        phone: "+1234567891",
        role: "maintenance_staff",
        preferences: { email: true, sms: true, push: true },
      },
    ];

    // Filter out the user who created the request
    return mockRecipients.filter((r) => r.id !== excludeUserId);
  }
}
