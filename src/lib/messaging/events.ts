import "server-only";

/**
 * PropertyPro - What each event's SMS and WhatsApp message says
 *
 * One builder per event: the SMS text in the recipient's language (the
 * office's display language, `recipient-locale.ts`), from the catalogue keys
 * `notifications.sms.event.*`, and the values for the event's named WhatsApp
 * template parameters (registry.ts `EVENT_TEMPLATE_PARAMS`) — both from the
 * same figures, so the two channels never disagree.
 *
 * Also the three events that had no notice at all before messaging — a
 * payment received, a maintenance request's status changing, an emergency
 * request — as fire-and-forget senders their write paths call after their
 * own work has committed.
 */

import { db } from "@/lib/db/prisma";
import { formatCurrency } from "@/lib/utils/formatting";
import {
  recipientLocale,
  type RecipientLocale,
} from "@/lib/i18n/recipient-locale";
import { formatDateFor, translateFor } from "@/lib/i18n/translate";
import { getOrgContext } from "@/lib/tenancy/context";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import { PaymentStatus, UserRole } from "@/types";
import { sendMessage } from "./dispatch";
import {
  MESSAGING_CHANNELS,
  type MessagingEvent,
} from "./registry";

export interface EventMessage {
  body: string;
  templateParams: Record<string, string>;
}

const officeNames = new Map<string, { name: string; at: number }>();

/** The office's name, as it signs its messages. Cached per office. */
export async function officeName(): Promise<string> {
  const organizationId = getOrgContext()?.organizationId;
  if (!organizationId) return process.env.APP_NAME || "PropertyPro";
  const cached = officeNames.get(organizationId);
  if (cached && Date.now() - cached.at < 300_000) return cached.name;
  const organization = await db.organization.findFirst({
    where: { id: organizationId },
    select: { name: true },
  });
  const name = organization?.name?.trim() || process.env.APP_NAME || "PropertyPro";
  if (officeNames.size > 500) officeNames.clear();
  officeNames.set(organizationId, { name, at: Date.now() });
  return name;
}

function day(locale: RecipientLocale, value: Date | string): string {
  return formatDateFor(locale.language, value, {
    style: "medium",
    timeZone: locale.timeZone,
  });
}

function money(locale: RecipientLocale, amount: number): string {
  return formatCurrency(Number(amount) || 0, locale.currency);
}

// ============================================================================
// Builders
// ============================================================================

export interface RentFigures {
  office: string;
  name: string;
  property: string;
  amount: number;
  dueDate: Date | string;
  /** Days until due (reminder) or days overdue. */
  days: number;
}

export function rentMessage(
  locale: RecipientLocale,
  event: "payment_reminder" | "payment_overdue",
  figures: RentFigures,
): EventMessage {
  const values = {
    office: figures.office,
    name: figures.name,
    property: figures.property,
    amount: money(locale, figures.amount),
    date: day(locale, figures.dueDate),
  };
  const key =
    event === "payment_reminder"
      ? "notifications.sms.event.paymentReminder"
      : "notifications.sms.event.paymentOverdue";
  return {
    body: translateFor(locale, key, values),
    templateParams: {
      recipient_name: values.name,
      office_name: values.office,
      property_name: values.property,
      amount: values.amount,
      due_date: values.date,
      days: String(figures.days),
    },
  };
}

export function receiptMessage(
  locale: RecipientLocale,
  figures: {
    office: string;
    name: string;
    amount: number;
    receiptNumber: string;
    paidDate: Date | string;
  },
): EventMessage {
  const values = {
    office: figures.office,
    name: figures.name,
    amount: money(locale, figures.amount),
    receipt: figures.receiptNumber,
    date: day(locale, figures.paidDate),
  };
  return {
    body: translateFor(locale, "notifications.sms.event.paymentReceipt", values),
    templateParams: {
      recipient_name: values.name,
      office_name: values.office,
      amount: values.amount,
      receipt_number: values.receipt,
      payment_date: values.date,
    },
  };
}

export function leaseExpiryMessage(
  locale: RecipientLocale,
  figures: {
    office: string;
    name: string;
    property: string;
    endDate: Date | string;
    days: number;
    /** Set for the owner's or manager's copy. */
    tenantName?: string;
  },
): EventMessage {
  const values = {
    office: figures.office,
    name: figures.name,
    property: figures.property,
    date: day(locale, figures.endDate),
    tenant: figures.tenantName ?? "",
  };
  return {
    body: translateFor(
      locale,
      figures.tenantName !== undefined
        ? "notifications.sms.event.leaseExpiryStaff"
        : "notifications.sms.event.leaseExpiry",
      values,
    ),
    templateParams: {
      recipient_name: values.name,
      office_name: values.office,
      property_name: values.property,
      end_date: values.date,
      days: String(figures.days),
    },
  };
}

/** "in_progress" → the catalogue's "maintenance.status.inProgress". */
function statusLabel(locale: RecipientLocale, status: string): string {
  const key = status.replace(/_([a-z])/g, (_, letter: string) =>
    letter.toUpperCase(),
  );
  return translateFor(locale, `maintenance.status.${key}`, undefined, status);
}

export function maintenanceUpdateMessage(
  locale: RecipientLocale,
  figures: { office: string; name: string; title: string; status: string },
): EventMessage {
  const values = {
    office: figures.office,
    name: figures.name,
    title: figures.title,
    status: statusLabel(locale, figures.status),
  };
  return {
    body: translateFor(
      locale,
      "notifications.sms.event.maintenanceUpdate",
      values,
    ),
    templateParams: {
      recipient_name: values.name,
      office_name: values.office,
      request_title: values.title,
      status: values.status,
    },
  };
}

export function emergencyMessage(
  locale: RecipientLocale,
  figures: { office: string; name: string; title: string; property: string },
): EventMessage {
  return {
    body: translateFor(locale, "notifications.sms.event.emergency", {
      office: figures.office,
      title: figures.title,
      property: figures.property,
    }),
    templateParams: {
      recipient_name: figures.name,
      office_name: figures.office,
      property_name: figures.property,
      request_title: figures.title,
    },
  };
}

// ============================================================================
// Senders
// ============================================================================

function fullName(user: { firstName?: string | null; lastName?: string | null } | null) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
}

/** Send one event's message to one person on every channel the office uses. */
export async function sendEventMessage(
  event: MessagingEvent,
  userId: string,
  message: EventMessage,
  locale: RecipientLocale,
): Promise<void> {
  for (const channel of MESSAGING_CHANNELS) {
    await sendMessage({
      channel,
      purpose: "automation",
      event,
      recipient: { userId },
      body: message.body,
      templateParams: message.templateParams,
      language: locale.language,
    });
  }
}

/**
 * The tenant's receipt by SMS/WhatsApp once a payment is received. Call
 * after the payment's own transaction has committed; never throws.
 */
export async function notifyPaymentReceived(paymentId: string): Promise<void> {
  try {
    const payment = await db.payment.findFirst({
      where: { id: paymentId },
      select: {
        id: true,
        tenantId: true,
        amount: true,
        amountPaid: true,
        paidDate: true,
        status: true,
        tenant: { select: { firstName: true, lastName: true } },
        // Left out until the database has the column (payment-number.ts).
        ...((await paymentNumbersAvailable()) ? { number: true } : {}),
      },
    });
    if (!payment?.tenantId) return;
    // Money received: paid in full or in part.
    if (
      payment.status !== PaymentStatus.PAID &&
      payment.status !== PaymentStatus.PARTIAL
    ) {
      return;
    }
    const number = (payment as { number?: number | null }).number ?? null;
    const locale = await recipientLocale();
    const message = receiptMessage(locale, {
      office: await officeName(),
      name:
        fullName(payment.tenant) ||
        translateFor(locale, "notifications.message.recipient.tenant"),
      amount: Number(payment.amountPaid ?? payment.amount) || 0,
      receiptNumber: receiptNumberFor(payment.id, null, number),
      paidDate: payment.paidDate ?? new Date(),
    });
    await sendEventMessage("payment_receipt", payment.tenantId, message, locale);
  } catch (error) {
    console.error(`Receipt message for payment ${paymentId} failed`, error);
  }
}

/** The tenant hears that their request moved on. Never throws. */
export async function notifyMaintenanceStatus(
  requestId: string,
  status: string,
): Promise<void> {
  try {
    const request = await db.maintenanceRequest.findFirst({
      where: { id: requestId },
      select: {
        title: true,
        tenantId: true,
        tenant: { select: { firstName: true, lastName: true } },
      },
    });
    if (!request?.tenantId) return;
    const locale = await recipientLocale();
    const message = maintenanceUpdateMessage(locale, {
      office: await officeName(),
      name:
        fullName(request.tenant) ||
        translateFor(locale, "notifications.message.recipient.tenant"),
      title: request.title,
      status,
    });
    await sendEventMessage(
      "maintenance_update",
      request.tenantId,
      message,
      locale,
    );
  } catch (error) {
    console.error(`Maintenance message for request ${requestId} failed`, error);
  }
}

/**
 * Staff hear about an emergency request at once: whoever it is assigned to,
 * the building's manager, or — when neither is set — the office's
 * administrators. Never throws.
 */
export async function notifyMaintenanceEmergency(
  requestId: string,
): Promise<void> {
  try {
    const request = await db.maintenanceRequest.findFirst({
      where: { id: requestId },
      select: {
        title: true,
        assignedToId: true,
        property: { select: { name: true, managerId: true } },
      },
    });
    if (!request) return;
    let recipients = [request.assignedToId, request.property?.managerId].filter(
      (id): id is string => Boolean(id),
    );
    if (recipients.length === 0) {
      const admins = await db.user.findMany({
        where: { role: UserRole.ADMIN, deletedAt: null, isActive: true },
        select: { id: true },
        take: 5,
      });
      recipients = admins.map((admin) => admin.id);
    }
    const users = await db.user.findMany({
      where: { id: { in: Array.from(new Set(recipients)) } },
      select: { id: true, firstName: true, lastName: true },
    });
    const locale = await recipientLocale();
    const office = await officeName();
    for (const user of users) {
      const message = emergencyMessage(locale, {
        office,
        name:
          fullName(user) ||
          translateFor(locale, "notifications.message.recipient.user"),
        title: request.title,
        property: request.property?.name ?? "",
      });
      await sendEventMessage("maintenance_emergency", user.id, message, locale);
    }
  } catch (error) {
    console.error(`Emergency message for request ${requestId} failed`, error);
  }
}
