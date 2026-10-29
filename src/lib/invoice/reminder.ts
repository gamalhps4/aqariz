import "server-only";

/**
 * PropertyPro - Rent reminder for one installment
 *
 * The one way a rent reminder reaches a tenant: email, in-app, and SMS and
 * WhatsApp where the office has switched those on for the event (Settings →
 * Messaging), in the office's language. The daily cron
 * (api/cron/payment-reminders) sends it on its cadence; "Send reminder" on an
 * invoice, single or bulk, sends it on demand. The manual buttons used to
 * append to `remindersSent` and send nothing — the office saw "Reminder sent"
 * and the tenant heard nothing.
 */

import { db, type MoneyAsNumber } from "@/lib/db/prisma";
import { Prisma } from "@/generated/prisma/client";
import { InvoiceStatus } from "@/types";
import {
  notificationService,
  NotificationPriority,
  NotificationType,
} from "@/lib/notification-service";
import {
  recipientLocale,
  type RecipientLocale,
} from "@/lib/i18n/recipient-locale";
import { pluralKey, translateFor } from "@/lib/i18n/translate";
import { businessDaysUntil } from "@/lib/dates/business-day";
import { officeName, rentMessage } from "@/lib/messaging/events";

/** What a reminder reads off the installment. */
export const REMINDER_INVOICE_SELECT = {
  id: true,
  dueDate: true,
  leaseId: true,
  propertyId: true,
  balanceRemaining: true,
  remindersSent: true,
  tenant: {
    select: { id: true, email: true, firstName: true, lastName: true },
  },
  property: { select: { name: true } },
} satisfies Prisma.InvoiceSelect;

export type ReminderInvoice = MoneyAsNumber<
  Prisma.InvoiceGetPayload<{ select: typeof REMINDER_INVOICE_SELECT }>
>;

export interface ReminderLogEntry {
  /** "upcoming", "overdue-7", or "manual" for one an office sent itself. */
  stage: string;
  sentAt: string;
}

/** The entries that carry a stage — the cron's idempotency key. Older manual
 * entries ({type, method, sentDate}) have none and are kept but not read. */
export function reminderLog(value: unknown): ReminderLogEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (entry): entry is ReminderLogEntry =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ReminderLogEntry).stage === "string",
  );
}

export interface ReminderOptions {
  locale: RecipientLocale;
  office: string;
  now: Date;
  /** Logged on the invoice; see ReminderLogEntry. */
  stage: string;
  /** Extra fields for the log entry (the kind an office picked in bulk). */
  logExtra?: Record<string, string>;
}

/**
 * Send the reminder and log it on the invoice. Upcoming or overdue is read
 * off the due date (Riyadh days). Returns false, sending nothing, when the
 * installment has no tenant to remind.
 *
 * Logged once attempted, whatever each channel answered: a cron stage is a
 * day of the cadence, and a re-run that day must not text the tenant a
 * second time because the mail server was down.
 */
export async function sendInvoiceReminder(
  invoice: ReminderInvoice,
  { locale, office, now, stage, logExtra }: ReminderOptions,
): Promise<boolean> {
  const tenant = invoice.tenant;
  if (!tenant?.id) return false;

  const offset = businessDaysUntil(invoice.dueDate, now);
  const isUpcoming = offset >= 0;
  const days = Math.abs(offset);
  const daysOverdue = isUpcoming ? 0 : days;

  const tenantName =
    [tenant.firstName, tenant.lastName].filter(Boolean).join(" ").trim() ||
    translateFor(locale, "notifications.message.recipient.tenant");
  const propertyName = invoice.property?.name ?? "";
  const amount = Number(invoice.balanceRemaining) || 0;
  const messageBase = isUpcoming
    ? "notifications.message.paymentReminder"
    : "notifications.message.paymentOverdue";
  const messageKey =
    isUpcoming && days === 0
      ? `${messageBase}.message.today`
      : pluralKey(`${messageBase}.message`, days);

  await notificationService.sendNotification({
    type: isUpcoming
      ? NotificationType.PAYMENT_REMINDER
      : NotificationType.PAYMENT_OVERDUE,
    priority:
      daysOverdue >= 7 ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
    userId: tenant.id,
    title: translateFor(locale, `${messageBase}.title`),
    message: translateFor(locale, messageKey, { days }),
    data: {
      audience: "tenant",
      recipientRole: "tenant",
      tenantId: tenant.id,
      invoiceId: invoice.id,
      leaseId: invoice.leaseId ?? undefined,
      propertyId: invoice.propertyId ?? undefined,
      userEmail: tenant.email,
      userName: tenantName,
      propertyName,
      rentAmount: amount,
      dueDate: invoice.dueDate.toISOString(),
      daysOverdue,
      stage,
    },
    phone: rentMessage(
      locale,
      isUpcoming ? "payment_reminder" : "payment_overdue",
      {
        office,
        name: tenantName,
        property: propertyName,
        amount,
        dueDate: invoice.dueDate,
        days,
      },
    ),
    // No address: the in-app notice and the phone still go.
    ...(tenant.email
      ? {}
      : {
          preferences: {
            email: false,
            sms: true,
            whatsapp: true,
            push: true,
            inApp: true,
          },
        }),
  });

  // Appended to the whole stored list, not just the staged entries, so the
  // log keeps manual reminders from before entries carried a stage.
  const stored = Array.isArray(invoice.remindersSent)
    ? invoice.remindersSent
    : [];
  await db.invoice.update({
    where: { id: invoice.id },
    data: {
      remindersSent: [
        ...stored,
        { ...logExtra, stage, sentAt: now.toISOString() },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  return true;
}

/** The statuses the cron reminds about: issued, and not yet settled. */
const REMINDABLE_STATUSES = new Set<string>([
  InvoiceStatus.ISSUED,
  InvoiceStatus.PARTIAL,
  InvoiceStatus.OVERDUE,
]);

export type ManualReminderResult =
  | { ok: true; invoiceNumber: string | null }
  | { ok: false; error: string; status: number };

/**
 * "Send reminder" on one installment, from the invoice page or the bulk
 * dialog. The caller has already scoped `invoiceId` to what the office may
 * see. `context` is reused across a bulk run: the office's language and name
 * are the same for every row.
 */
export async function sendManualInvoiceReminder(
  invoiceId: string,
  options: {
    now?: Date;
    kind?: string;
    context?: { locale: RecipientLocale; office: string };
  } = {},
): Promise<ManualReminderResult> {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, deletedAt: null },
    select: { ...REMINDER_INVOICE_SELECT, status: true, invoiceNumber: true },
  });
  if (!invoice) return { ok: false, error: "Invoice not found", status: 404 };

  if (!REMINDABLE_STATUSES.has(invoice.status) || Number(invoice.balanceRemaining) <= 0) {
    return {
      ok: false,
      error:
        invoice.status === InvoiceStatus.SCHEDULED
          ? "Issue this installment before reminding the tenant"
          : "This invoice has nothing left to pay",
      status: 409,
    };
  }
  if (!invoice.tenant?.id) {
    return { ok: false, error: "This invoice has no tenant to remind", status: 409 };
  }

  const context = options.context ?? {
    locale: await recipientLocale(),
    office: await officeName(),
  };
  await sendInvoiceReminder(invoice, {
    ...context,
    now: options.now ?? new Date(),
    stage: "manual",
    logExtra: options.kind ? { type: options.kind } : undefined,
  });
  return { ok: true, invoiceNumber: invoice.invoiceNumber ?? null };
}
