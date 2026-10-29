/**
 * PropertyPro - Gateway money that cannot settle its payment
 *
 * ./gateway-outcome.ts answers "review" when a gateway took money the payment
 * it was raised for cannot take: the payment was paid at the desk meanwhile
 * (the tenant paid twice), was already settled by another attempt, or was
 * refunded or cancelled. That money used to be logged to the server console
 * and nothing else — the tenant was charged twice and nobody knew.
 *
 * Now it is held as the tenant's credit (./tenant-credit.ts): a paid payment
 * of its own, carrying the gateway's reference (so "Refund" sends it back
 * through the same gateway), posted to the books as money received against
 * the tenant's account. The office is told — an in-app notification to its
 * admins and managers, and an activity entry. Recorded once: the gateway's
 * reference is unique per payment, so a replayed webhook finds it held.
 */

import "server-only";

import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { PaymentStatus, PaymentType, UserRole } from "@/types";
import type { Prisma } from "@/generated/prisma/client";
import type { GatewayPaymentState } from "@/lib/payments/gateway-adapter";
import { getGatewayDef, type GatewayId } from "@/lib/payments/gateway-registry";
import { gatewayColumnsAvailable } from "@/lib/payments/gateway-columns";
import { tenantCreditEntry, type TenantCreditReason } from "@/lib/payments/tenant-credit";
import { uniqueViolationTarget } from "@/lib/db/unique-violation";
import { AuditAction, recordActivity } from "@/lib/audit-domain";
import { postAfterCommit } from "@/lib/accounting/hooks";
import { recipientLocale } from "@/lib/i18n/recipient-locale";
import { translateFor } from "@/lib/i18n/translate";

export interface ReviewedPayment {
  id: string;
  organizationId: string;
  tenantId: string;
  propertyId: string;
  leaseId: string | null;
  description: string | null;
  gatewayPaymentId?: string | null;
}

export interface HeldCredit {
  /** The payment the money is held on; null when there was nothing to hold. */
  creditPaymentId: string | null;
  /** False when an earlier delivery already held it. */
  created: boolean;
}

/** The staff who look after an office's money: its admins and managers. */
async function officeStaffIds(): Promise<string[]> {
  const users = await db.user.findMany({
    where: { role: { in: [UserRole.ADMIN, UserRole.MANAGER] }, isActive: true },
    select: { id: true },
    take: 50,
  });
  return users.map((user) => user.id);
}

async function tellOffice(input: {
  organizationId: string;
  creditPaymentId: string;
  amount: number;
  currency: string;
  gatewayName: string;
  tenantName: string;
}): Promise<void> {
  const [staff, locale] = await Promise.all([
    officeStaffIds(),
    recipientLocale({ organizationId: input.organizationId }),
  ]);
  if (staff.length === 0) return;
  const values = {
    amount: `${input.amount.toFixed(2)} ${input.currency}`,
    gateway: input.gatewayName,
    tenant: input.tenantName,
  };
  const title = translateFor(locale, "notifications.message.paymentHeldAsCredit.title", values);
  const message = translateFor(locale, "notifications.message.paymentHeldAsCredit.message", values);
  const { notificationService, NotificationPriority, NotificationType } = await import(
    "@/lib/notification-service"
  );
  for (const userId of staff) {
    await notificationService.sendNotification({
      type: NotificationType.PAYMENT_REVIEW,
      priority: NotificationPriority.HIGH,
      userId,
      title,
      message,
      data: {
        organizationId: input.organizationId,
        paymentId: input.creditPaymentId,
        actionUrl: `/dashboard/payments/${input.creditPaymentId}`,
      },
      // In the app (and its push), not by email or text: it is the office's
      // own to-do, and SMS costs money per message.
      preferences: { email: false, sms: false, whatsapp: false, push: true, inApp: true },
    });
  }
}

/**
 * Hold gateway money that cannot settle `payment` as the tenant's credit,
 * and tell the office. Throws when it could not be held, so a webhook gives
 * its claim back and the gateway's retry tries again.
 */
export async function holdGatewayMoneyAsCredit(
  gateway: GatewayId,
  payment: ReviewedPayment,
  state: GatewayPaymentState,
  reason: TenantCreditReason,
  paymentMethod: string,
): Promise<HeldCredit> {
  const gatewayName = getGatewayDef(gateway)?.name ?? gateway;
  const amount = Math.round(Number(state.amount) * 100) / 100;
  if (!(amount > 0)) return { creditPaymentId: null, created: false };

  try {
    const columns = await gatewayColumnsAvailable();
    const references = [state.reference, state.sessionReference].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    // Held already: another payment carries this money's reference.
    if (columns) {
      const holder = await db.payment.findFirst({
        where: {
          gatewayProvider: gateway,
          gatewayPaymentId: state.reference,
          id: { not: payment.id },
          deletedAt: undefined,
        },
        select: { id: true },
      });
      if (holder) return { creditPaymentId: holder.id, created: false };
    }

    const now = new Date();
    const locale = await recipientLocale({ organizationId: payment.organizationId });
    const created = await runWithOrgTransaction(async (tx) => {
      // The payment settled at the desk still names this attempt (a gateway
      // whose checkout and payment share one id: PayTabs, Tap). The money is
      // the credit's, so the reference moves to it.
      if (columns && payment.gatewayPaymentId && references.includes(payment.gatewayPaymentId)) {
        await tx.payment.updateMany({
          where: { id: payment.id, gatewayPaymentId: payment.gatewayPaymentId },
          data: { gatewayProvider: null, gatewayPaymentId: null },
        });
      }
      return tx.payment.create({
        data: {
          organizationId: payment.organizationId,
          tenantId: payment.tenantId,
          propertyId: payment.propertyId,
          leaseId: payment.leaseId,
          parentPaymentId: payment.id,
          type: PaymentType.OTHER,
          amount,
          amountPaid: amount,
          currency: String(state.currency || "SAR").toUpperCase(),
          status: PaymentStatus.PAID,
          paymentMethod,
          dueDate: now,
          paidDate: now,
          recordedById: null,
          description: translateFor(locale, "payments.credit.description", { gateway: gatewayName }),
          allocations: [] as unknown as Prisma.InputJsonValue,
          paymentHistory: [
            tenantCreditEntry({
              amount,
              paymentMethod,
              at: now,
              creditOf: payment.id,
              reason,
              gateway,
              gatewayName,
              transactionId: state.reference,
            }),
          ] as unknown as Prisma.InputJsonValue,
          ...(columns ? { gatewayProvider: gateway, gatewayPaymentId: state.reference } : {}),
        },
        select: { id: true, tenant: { select: { firstName: true, lastName: true } } },
      });
    });

    const tenantName =
      [created.tenant?.firstName, created.tenant?.lastName].map((part) => part?.trim()).filter(Boolean).join(" ") ||
      "—";
    void recordActivity({
      action: AuditAction.PAYMENT_PROCESSED,
      messageKey: "admin.audit.msg.payment_held_as_credit",
      messageParams: { amount, currency: String(state.currency || "").toUpperCase() },
      recordType: "payment",
      recordId: created.id,
      recordName: payment.description ?? null,
      after: { status: PaymentStatus.PAID, amountPaid: amount, paymentMethod },
      details: {
        gateway,
        reason,
        creditOf: payment.id,
        transactionId: state.reference,
        leaseId: payment.leaseId ?? undefined,
      },
      organizationId: payment.organizationId,
    });
    void tellOffice({
      organizationId: payment.organizationId,
      creditPaymentId: created.id,
      amount,
      currency: String(state.currency || "SAR").toUpperCase(),
      gatewayName,
      tenantName,
    }).catch((error) => console.error("Could not tell the office about a held credit", error));
    // The books: money in, held against the tenant's account.
    postAfterCommit("payment", created.id);
    console.warn(
      `${gatewayName} took ${amount} ${state.currency} (${state.reference}) for payment ${payment.id}, ` +
        `which could not take it (${reason}); held as the tenant's credit on payment ${created.id}.`,
    );
    return { creditPaymentId: created.id, created: true };
  } catch (error) {
    // Two deliveries at once: the other one holds it.
    if (uniqueViolationTarget(error).includes("gatewayPaymentId")) {
      return { creditPaymentId: null, created: false };
    }
    console.error(
      `${gatewayName} took money that could not be recorded on payment ${payment.id}; NOT held yet`,
      { reason, reference: state.reference, amount: state.amount, currency: state.currency },
    );
    throw error;
  }
}
