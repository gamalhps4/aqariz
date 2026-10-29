/**
 * PropertyPro - Notification Automation
 *
 * The scheduled notices, run by cron routes — not by a timer inside the web
 * process. This used to be an in-process engine (`setInterval` every minute,
 * started by the first request to /api/notifications) with three sweeps:
 *
 *   - rent reminders before the due date and
 *   - overdue reminders, which re-sent to an overdue tenant EVERY day from the
 *     day it fell due, by email, in-app and — once a week late — SMS and
 *     WhatsApp, for as long as the rent stayed unpaid; and
 *   - lease-expiry notices.
 *
 * The rent sweeps duplicated `/api/cron/payment-reminders`, which reminds per
 * installment (invoice) three days before and on days 1, 7 and 14 after the
 * due date; a tenant could get both. They are gone: that cron is the one rent
 * reminder path and sends on every channel. The lease-expiry sweep is below,
 * run daily by `/api/cron/lease-expiry-notices`.
 *
 * Each notice is worded in the language of the office it is sent for (its
 * display settings), from the catalogue keys `notifications.message.*` and
 * `notifications.sms.event.*` — see lib/i18n/recipient-locale.ts. SMS and
 * WhatsApp follow the office's per-event switches (Settings → Messaging).
 */

import {
  notificationService,
  NotificationType,
  NotificationPriority,
} from "./notification-service";
import { db } from "@/lib/db/prisma";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { pluralKey, translateFor } from "@/lib/i18n/translate";
import {
  addBusinessDays,
  businessDayStart,
  businessToday,
} from "@/lib/dates/business-day";
import { leaseExpiryMessage, officeName } from "@/lib/messaging/events";

/** Days before a lease ends that its tenant, owner and manager hear about it. */
export const LEASE_EXPIRY_NOTICE_DAYS = [90, 60, 30, 14, 7] as const;

// Automation rule interface
export interface AutomationRule {
  id: string;
  name: string;
  type: NotificationType;
  trigger: "schedule" | "event" | "condition";
  conditions: Record<string, any>;
  schedule?: {
    frequency: "daily" | "weekly" | "monthly";
    time: string; // HH:MM format
    dayOfWeek?: number; // 0-6 for weekly
    dayOfMonth?: number; // 1-31 for monthly
  };
  enabled: boolean;
  lastRun?: Date;
  nextRun?: Date;
}

/**
 * The schedule, as the notifications API lists it. The cron routes run the
 * schedule itself; which events also go out by SMS or WhatsApp is the
 * office's choice in Settings → Messaging, not a rule here.
 */
export class NotificationAutomation {
  private automationRules: Map<string, AutomationRule> = new Map();

  constructor() {
    this.initializeDefaultRules();
  }

  private initializeDefaultRules(): void {
    this.addRule({
      id: "payment_reminder_3_days",
      name: "Payment Reminder - 3 Days Before Due",
      type: NotificationType.PAYMENT_REMINDER,
      trigger: "schedule",
      conditions: { daysBefore: 3 },
      schedule: { frequency: "daily", time: "08:00" },
      enabled: true,
    });
    this.addRule({
      id: "payment_overdue_steps",
      name: "Overdue Payment Reminders - Days 1, 7 and 14",
      type: NotificationType.PAYMENT_OVERDUE,
      trigger: "schedule",
      conditions: { daysOverdue: [1, 7, 14] },
      schedule: { frequency: "daily", time: "08:00" },
      enabled: true,
    });
    for (const daysBefore of LEASE_EXPIRY_NOTICE_DAYS) {
      this.addRule({
        id: `lease_expiry_${daysBefore}_days`,
        name: `Lease Expiry - ${daysBefore} Days Notice`,
        type: NotificationType.LEASE_EXPIRY,
        trigger: "schedule",
        conditions: { daysBefore },
        schedule: { frequency: "daily", time: "08:00" },
        enabled: true,
      });
    }
  }

  // Add automation rule
  addRule(rule: Omit<AutomationRule, "nextRun">): void {
    this.automationRules.set(rule.id, { ...rule });
  }

  // Remove automation rule
  removeRule(ruleId: string): boolean {
    return this.automationRules.delete(ruleId);
  }

  // Enable/disable rule
  toggleRule(ruleId: string, enabled: boolean): boolean {
    const rule = this.automationRules.get(ruleId);
    if (!rule) return false;
    rule.enabled = enabled;
    return true;
  }

  // Get all automation rules
  getAllRules(): AutomationRule[] {
    return Array.from(this.automationRules.values());
  }

  // Get rule by ID
  getRule(ruleId: string): AutomationRule | undefined {
    return this.automationRules.get(ruleId);
  }
}

// Create singleton instance
export const notificationAutomation = new NotificationAutomation();

type Person = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
} | null;

/** No address, no email: the in-app notice and the phone still go. */
const NO_EMAIL = {
  email: false,
  sms: true,
  whatsapp: true,
  push: true,
  inApp: true,
};

function nameOf(person: Person, fallback: string): string {
  return (
    `${person?.firstName || ""} ${person?.lastName || ""}`.trim() || fallback
  );
}

/**
 * Whether this person already had this lease's notice for this step — a cron
 * run repeated on the same day must not send it twice. The in-app
 * notification each notice stores is the record.
 */
async function alreadyNotified(
  userId: string,
  leaseId: string,
  daysBefore: number,
): Promise<boolean> {
  const existing = await db.notification.findFirst({
    where: {
      userId,
      type: NotificationType.LEASE_EXPIRY,
      AND: [
        { metadata: { path: ["leaseId"], equals: leaseId } },
        { metadata: { path: ["daysUntilExpiry"], equals: daysBefore } },
      ],
    },
    select: { id: true },
  });
  return Boolean(existing);
}

/**
 * Lease-expiry notices for the current organization: the tenant, the
 * building's owner and its manager hear 90, 60, 30, 14 and 7 days before the
 * contract ends. Days are Riyadh calendar days. Runs inside the office's
 * context (`forEachOrganization`).
 */
export async function sendLeaseExpiryNotices(
  now: Date = new Date(),
): Promise<{ leases: number; notices: number }> {
  const locale = await recipientLocale();
  const office = await officeName();
  const today = businessToday(now);
  let leases = 0;
  let notices = 0;

  for (const daysBefore of LEASE_EXPIRY_NOTICE_DAYS) {
    const day = addBusinessDays(today, daysBefore);
    const expiringLeases = await db.lease.findMany({
      where: {
        status: "active",
        deletedAt: null,
        endDate: {
          gte: businessDayStart(day),
          lt: businessDayStart(addBusinessDays(day, 1)),
        },
      },
      include: {
        tenant: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
        property: {
          select: {
            id: true,
            name: true,
            owner: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
            manager: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
        },
      },
    });

    for (const lease of expiringLeases) {
      leases += 1;
      const property = lease.property;
      const propertyName = property?.name;
      if (!propertyName) continue;

      const tenant = lease.tenant;
      const tenantName = nameOf(
        tenant,
        translateFor(locale, "notifications.message.recipient.tenant"),
      );
      const priority =
        daysBefore <= 30
          ? NotificationPriority.HIGH
          : NotificationPriority.NORMAL;
      const common = {
        leaseId: lease.id,
        propertyId: property?.id,
        propertyName,
        expiryDate: lease.endDate.toISOString(),
        daysUntilExpiry: daysBefore,
      };

      try {
        if (tenant?.id && !(await alreadyNotified(tenant.id, lease.id, daysBefore))) {
          await notificationService.sendNotification({
            type: NotificationType.LEASE_EXPIRY,
            priority,
            userId: tenant.id,
            title: translateFor(locale, "notifications.message.leaseExpiry.title"),
            message: translateFor(
              locale,
              pluralKey("notifications.message.leaseExpiry.message", daysBefore),
              { days: daysBefore },
            ),
            data: {
              ...common,
              audience: "tenant",
              recipientRole: "tenant",
              tenantId: tenant.id,
              userEmail: tenant.email,
              userName: tenantName,
            },
            phone: leaseExpiryMessage(locale, {
              office,
              name: tenantName,
              property: propertyName,
              endDate: lease.endDate,
              days: daysBefore,
            }),
            ...(tenant.email ? {} : { preferences: NO_EMAIL }),
          });
          notices += 1;
        }

        // The owner, and the manager when it is someone else.
        const staff = [
          { person: property?.owner ?? null, role: "owner" },
          { person: property?.manager ?? null, role: "manager" },
        ].filter(
          (entry, index, all) =>
            entry.person?.id &&
            all.findIndex((other) => other.person?.id === entry.person?.id) ===
              index,
        );
        for (const { person, role } of staff) {
          if (!person?.id) continue;
          if (await alreadyNotified(person.id, lease.id, daysBefore)) continue;
          const name = nameOf(
            person,
            translateFor(locale, "notifications.message.recipient.user"),
          );
          await notificationService.sendNotification({
            type: NotificationType.LEASE_EXPIRY,
            priority,
            userId: person.id,
            title: translateFor(
              locale,
              "notifications.message.leaseExpiryStaff.title",
            ),
            message: translateFor(
              locale,
              pluralKey(
                "notifications.message.leaseExpiryStaff.message",
                daysBefore,
              ),
              { days: daysBefore, property: propertyName },
            ),
            data: {
              ...common,
              audience: "staff",
              recipientRole: role,
              tenantId: tenant?.id,
              userEmail: person.email,
              userName: name,
              tenantName,
              isLandlord: true,
            },
            phone: leaseExpiryMessage(locale, {
              office,
              name,
              property: propertyName,
              endDate: lease.endDate,
              days: daysBefore,
              tenantName,
            }),
            ...(person.email ? {} : { preferences: NO_EMAIL }),
          });
          notices += 1;
        }
      } catch (error) {
        console.error(
          `Error sending lease expiry notices for lease ${lease.id}:`,
          error,
        );
      }
    }
  }

  return { leases, notices };
}
