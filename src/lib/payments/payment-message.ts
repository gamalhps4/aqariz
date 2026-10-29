import "server-only";

/**
 * PropertyPro - The message an office sends about one payment
 *
 * The WhatsApp and SMS icons on the Payments page send the tenant a message
 * about that row, written from the row itself: a receipt once it is paid, a
 * reminder while it is due, an overdue notice once its due date has passed.
 * The words are the same builders the automatic messages use
 * (lib/messaging/events), so a message sent by hand reads like the one the
 * system sends on its own, and on WhatsApp through Meta it goes as the
 * event's approved template.
 */

import { db } from "@/lib/db/prisma";
import { PaymentStatus } from "@/types";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { translateFor } from "@/lib/i18n/translate";
import { businessDaysUntil } from "@/lib/dates/business-day";
import {
  officeName,
  receiptMessage,
  rentMessage,
  type EventMessage,
} from "@/lib/messaging/events";
import type { MessagingEvent } from "@/lib/messaging/registry";
import { paymentNumbersAvailable } from "@/lib/payments/payment-number";
import { receiptNumberFor } from "@/lib/payments/receipt-number";
import type { Prisma } from "@/generated/prisma/client";

export interface PaymentMessage {
  event: MessagingEvent;
  message: EventMessage;
  /** The tenant's user id: the recipient, and whose history it joins. */
  tenantId: string;
  tenantName: string;
  phone: string | null;
  language: string;
}

export type PaymentMessageResult =
  | ({ ok: true } & PaymentMessage)
  | { ok: false; error: string; status: number };

/** Nothing is owed and nothing was received: there is nothing to say. */
const SILENT_STATUSES = new Set<string>([
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
]);

function fullName(user: { firstName?: string | null; lastName?: string | null } | null) {
  return [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim();
}

/**
 * The message for one payment, or why there is none. `scope` is the caller's
 * payment scope, so a payment they cannot see is a payment they cannot text
 * about.
 */
export async function paymentMessageFor(
  paymentId: string,
  scope: Prisma.PaymentWhereInput,
  now: Date = new Date(),
): Promise<PaymentMessageResult> {
  const payment = await db.payment.findFirst({
    where: { AND: [{ id: paymentId }, scope] },
    select: {
      id: true,
      tenantId: true,
      amount: true,
      amountPaid: true,
      status: true,
      dueDate: true,
      paidDate: true,
      tenant: { select: { firstName: true, lastName: true, phone: true } },
      property: { select: { name: true } },
      // Left out until the database has the column (payment-number.ts).
      ...((await paymentNumbersAvailable()) ? { number: true } : {}),
    },
  });
  if (!payment) return { ok: false, error: "Payment not found", status: 404 };
  if (!payment.tenantId) {
    return { ok: false, error: "This payment has no tenant to message", status: 409 };
  }
  if (SILENT_STATUSES.has(payment.status)) {
    return {
      ok: false,
      error: "There is nothing to tell the tenant about a cancelled or refunded payment",
      status: 409,
    };
  }

  const locale = await recipientLocale();
  const office = await officeName();
  const name =
    fullName(payment.tenant) ||
    translateFor(locale, "notifications.message.recipient.tenant");

  const amount = Number(payment.amount) || 0;
  const received = Number(payment.amountPaid) || 0;
  const base = {
    tenantId: payment.tenantId,
    tenantName: name,
    phone: payment.tenant?.phone ?? null,
    language: locale.language,
  };

  if (payment.status === PaymentStatus.PAID) {
    const number = (payment as { number?: number | null }).number ?? null;
    return {
      ok: true,
      ...base,
      event: "payment_receipt",
      message: receiptMessage(locale, {
        office,
        name,
        amount: received || amount,
        receiptNumber: receiptNumberFor(payment.id, null, number),
        paidDate: payment.paidDate ?? now,
      }),
    };
  }

  // Still owed: what is left of it, as of the due date in Riyadh days.
  const owed = Math.max(amount - received, 0) || amount;
  const offset = businessDaysUntil(payment.dueDate, now);
  const event: MessagingEvent = offset < 0 ? "payment_overdue" : "payment_reminder";
  return {
    ok: true,
    ...base,
    event,
    message: rentMessage(locale, event, {
      office,
      name,
      property: payment.property?.name ?? "",
      amount: owed,
      dueDate: payment.dueDate,
      days: Math.abs(offset),
    }),
  };
}
