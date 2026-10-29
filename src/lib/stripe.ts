/**
 * PropertyPro - Stripe Integration
 * Stripe payment processing utilities and webhook handling
 */

import Stripe from "stripe";
import { db, runWithOrgTransaction } from "@/lib/db/prisma";
import { PaymentStatus, PaymentMethod } from "@/types";
import { getStripeClient } from "@/lib/services/payment-config.service";
import { settleGatewayPayment } from "@/lib/payments/settlement";
import {
  GATEWAY_FINAL_STATUSES,
  isGatewayFinal,
} from "@/lib/payments/settlement-plan";
import { fromMinorUnits, toMinorUnits } from "@/lib/payments/amounts";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";

// The Stripe server client is resolved per call (DB-first, env-fallback) via
// getStripeClient() so admin-managed credentials take effect without a redeploy.
export { getStripeClient };

// ============================================================================
// PAYMENT INTENT CREATION
// ============================================================================

export interface CreatePaymentIntentParams {
  amount: number; // Amount in MAJOR units (dollars/euros/yen — not cents)
  currency?: string;
  paymentId: string;
  tenantEmail: string;
  description?: string;
  metadata?: Record<string, string>;
}

export async function createPaymentIntent({
  amount,
  currency = DEFAULT_CURRENCY.toLowerCase(),
  paymentId,
  tenantEmail,
  description,
  metadata = {},
}: CreatePaymentIntentParams): Promise<Stripe.PaymentIntent> {
  try {
    // Validate amount is within Stripe's limits
    if (amount < 0.50 || amount > 999999.99) {
      throw new Error("Amount must be between $0.50 and $999,999.99");
    }

    const stripe = await getStripeClient();
    const paymentIntent = await stripe.paymentIntents.create(
      {
        // Currency-aware: JPY/KRW/VND have no minor unit — `* 100` sent a
        // ¥50,000 charge to Stripe as ¥5,000,000.
        amount: toMinorUnits(amount, currency),
        currency,
        receipt_email: tenantEmail,
        description: description || "Property rent payment",
        metadata: {
          paymentId,
          source: "PropertyPro",
          ...metadata,
        },
        automatic_payment_methods: {
          enabled: true,
        },
      },
      {
        // Stable key: appending Date.now() made every retry a new key,
        // defeating idempotency and allowing duplicate PaymentIntents.
        idempotencyKey: `payment-intent-${paymentId}`,
      }
    );

    // Update payment record with Stripe payment intent ID
    const payment = await db.payment.findFirst({ where: { id: paymentId } });
    if (payment) {
      await db.payment.update({
        where: { id: payment.id },
        data: {
          stripePaymentIntentId: paymentIntent.id,
          status: PaymentStatus.PENDING,
        },
      });
    }

    return paymentIntent;
  } catch (error) {
    console.error("Error creating payment intent:", error);
    if (error instanceof Stripe.errors.StripeError) {
      throw new Error(`Stripe error (${error.type}): ${error.message}`);
    }
    throw error instanceof Error ? error : new Error("Failed to create payment intent");
  }
}

// ============================================================================
// PAYMENT CONFIRMATION
// ============================================================================

export async function confirmPayment(
  paymentIntentId: string
): Promise<boolean> {
  try {
    const stripe = await getStripeClient();
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

    if (paymentIntent.status === "succeeded") {
      // Find and settle the payment record through the shared path — the
      // direct PAID write here used to skip invoice application, after which
      // the webhook's settlement no-oped on the PAID status.
      const payment = await db.payment.findFirst({
        where: { stripePaymentIntentId: paymentIntentId },
      });

      if (payment) {
        await settleGatewayPayment(payment.id, {
          amount: fromMinorUnits(paymentIntent.amount, paymentIntent.currency),
          currency: paymentIntent.currency,
          paymentMethod: PaymentMethod.CREDIT_CARD,
          transactionId: paymentIntent.id,
          notes: "Payment confirmed via Stripe",
        });
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("Error confirming payment:", error);
    return false;
  }
}

// ============================================================================
// REFUND PROCESSING
// ============================================================================

export interface CreateRefundParams {
  paymentIntentId: string;
  amount?: number; // Amount in cents, if partial refund
  reason?: "duplicate" | "fraudulent" | "requested_by_customer";
  metadata?: Record<string, string>;
}

export async function createRefund({
  paymentIntentId,
  amount,
  reason = "requested_by_customer",
  metadata = {},
}: CreateRefundParams): Promise<Stripe.Refund> {
  try {
    const stripe = await getStripeClient();
    const payment = await db.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntentId },
    });

    const refundParams: Stripe.RefundCreateParams = {
      payment_intent: paymentIntentId,
      reason,
      metadata: {
        source: "PropertyPro",
        ...metadata,
      },
    };

    if (amount) {
      refundParams.amount = toMinorUnits(
        amount,
        String(payment?.currency ?? DEFAULT_CURRENCY).toLowerCase()
      );
    }

    const refund = await stripe.refunds.create(refundParams);

    // Reflect the refund in the books. Previously ANY refund (partial
    // included) flipped the whole payment to REFUNDED and the invoice kept
    // the money — the books said paid while the money went back.
    if (payment) {
      const paidAmount = Number(payment.amountPaid || payment.amount);
      const refundedAmount = amount ?? paidAmount;
      const fullRefund =
        Math.round(refundedAmount * 100) >= Math.round(paidAmount * 100);

      if (fullRefund) {
        await reverseSettledStripePayment(payment, refundedAmount);
      } else {
        // Partial refund: the payment stays settled; record the refund in
        // history for manual reconciliation of the difference.
        await db.payment.update({
          where: { id: payment.id },
          data: {
            paymentHistory: [
              ...(((payment.paymentHistory as unknown) as any[]) ?? []),
              {
                amount: -refundedAmount,
                paymentMethod: payment.paymentMethod,
                paidDate: new Date().toISOString(),
                transactionId: refund.id,
                notes: `Partial refund via Stripe (${reason})`,
              },
            ],
          },
        });
      }
    }

    return refund;
  } catch (error) {
    console.error("Error creating refund:", error);
    throw new Error("Failed to create refund");
  }
}

/**
 * Reverse a fully refunded payment: undo its invoice application and mark it
 * REFUNDED. Prefers the allocation-aware service reversal; payments applied
 * through the direct invoice link (no allocations recorded) are reversed by
 * hand against that one invoice in a transaction.
 */
async function reverseSettledStripePayment(
  payment: any,
  refundedAmount: number
): Promise<void> {
  const { paymentInvoiceLinkingService, computeInvoiceDerivedState } =
    await import("@/lib/services/payment-invoice-linking.service");

  try {
    await paymentInvoiceLinkingService.reversePaymentApplication(payment.id);
    return;
  } catch (error) {
    // Fall through to the direct-link reversal below.
    console.warn(
      `Allocation reversal unavailable for payment ${payment.id}: ` +
        `${error instanceof Error ? error.message : error}`
    );
  }

  await runWithOrgTransaction(async (tx) => {
    if (payment.invoiceId) {
      const invoice = await tx.invoice.findFirst({
        where: { id: payment.invoiceId, deletedAt: null },
      });
      if (invoice && (invoice.paymentIds ?? []).includes(payment.id)) {
        const amountPaid = Math.max(
          0,
          Math.round((Number(invoice.amountPaid) - refundedAmount) * 100) / 100
        );
        const derived = computeInvoiceDerivedState({ ...invoice, amountPaid });
        const updatedInvoice = await tx.invoice.updateMany({
          where: { id: invoice.id, version: invoice.version, deletedAt: null },
          data: {
            paymentIds: (invoice.paymentIds ?? []).filter(
              (id: string) => id !== payment.id
            ),
            amountPaid,
            subtotal: derived.subtotal,
            totalAmount: derived.totalAmount,
            balanceRemaining: derived.balanceRemaining,
            status: derived.status,
            version: { increment: 1 },
          },
        });
        if (updatedInvoice.count === 0) {
          throw new Error("Invoice was modified by another process");
        }
      }
    }

    const updated = await tx.payment.updateMany({
      where: { id: payment.id, version: payment.version, deletedAt: null },
      data: {
        status: PaymentStatus.REFUNDED,
        version: { increment: 1 },
        lastSyncedAt: new Date(),
      },
    });
    if (updated.count === 0) {
      throw new Error("Payment was modified by another process");
    }
  });
}

// ============================================================================
// CUSTOMER MANAGEMENT
// ============================================================================

export async function createOrUpdateCustomer(
  email: string,
  name: string,
  phone?: string,
  metadata?: Record<string, string>
): Promise<Stripe.Customer> {
  try {
    const stripe = await getStripeClient();
    // Check if customer already exists
    const existingCustomers = await stripe.customers.list({
      email,
      limit: 1,
    });

    if (existingCustomers.data.length > 0) {
      // Update existing customer
      const customer = await stripe.customers.update(
        existingCustomers.data[0].id,
        {
          name,
          phone,
          metadata: {
            source: "PropertyPro",
            ...metadata,
          },
        }
      );
      return customer;
    } else {
      // Create new customer
      const customer = await stripe.customers.create({
        email,
        name,
        phone,
        metadata: {
          source: "PropertyPro",
          ...metadata,
        },
      });
      return customer;
    }
  } catch (error) {
    console.error("Error creating/updating customer:", error);
    throw new Error("Failed to create/update customer");
  }
}

// ============================================================================
// WEBHOOK HANDLING
// ============================================================================

export async function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  secret: string
): Promise<Stripe.Event> {
  try {
    const stripe = await getStripeClient();
    return stripe.webhooks.constructEvent(payload, signature, secret);
  } catch (error) {
    console.error("Error constructing webhook event:", error);
    throw new Error("Invalid webhook signature");
  }
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  try {

    switch (event.type) {
      case "payment_intent.succeeded":
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.payment_failed":
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;

      case "payment_intent.processing":
        await handlePaymentProcessing(
          event.data.object as Stripe.PaymentIntent
        );
        break;

      case "payment_intent.requires_action":
        await handlePaymentRequiresAction(
          event.data.object as Stripe.PaymentIntent
        );
        break;

      case "payment_intent.canceled":
        await handlePaymentCanceled(event.data.object as Stripe.PaymentIntent);
        break;

      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        await handleCheckoutSessionCompleted(
          event.data.object as Stripe.Checkout.Session
        );
        break;

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed":
        await handleCheckoutSessionFailed(
          event.data.object as Stripe.Checkout.Session
        );
        break;

      case "charge.dispute.created":
        await handleChargeDispute(event.data.object as Stripe.Dispute);
        break;

      case "customer.created":
        await handleCustomerCreated(event.data.object as Stripe.Customer);
        break;

      case "payment_method.attached":
        await handlePaymentMethodAttached(
          event.data.object as Stripe.PaymentMethod
        );
        break;

      default:

    }


  } catch (error) {
    console.error(
      `Error handling webhook event ${event.type} (${event.id}):`,
      error
    );
    throw error;
  }
}

/**
 * Settle the payment a succeeded payment intent paid for: the amount it
 * captured, applied to its installment, or to the tenant's oldest open ones
 * when it names none.
 *
 * The webhook and GET /api/payments/status/[paymentIntentId] both call this.
 * The status route used to set PAID by itself — no amount received, nothing
 * applied to the installment, and no guard, so a refunded payment read as
 * paid again — and whichever of the two ran first decided what was recorded.
 */
export async function settleSucceededPaymentIntent(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  await handlePaymentSucceeded(paymentIntent);
}

async function handlePaymentSucceeded(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  try {
    const payment = await db.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      console.warn("Payment not found for Stripe payment intent:", paymentIntent.id);
      return;
    }

    // Not `/ 100`: JPY, KRW, VND and friends have no minor unit, so dividing
    // recorded a ¥50,000 rent payment as ¥500.
    const amountPaid = fromMinorUnits(
      paymentIntent.amount,
      paymentIntent.currency,
    );

    // Idempotent settle: marks the payment PAID, records the history entry,
    // and applies the amount to its invoice inside one transaction.
    const result = await settleGatewayPayment(payment.id, {
      amount: amountPaid,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      transactionId: paymentIntent.id,
      notes: "Payment processed via Stripe",
      currency: paymentIntent.currency,
    });

    // If no specific invoice, try to apply to oldest unpaid invoices for the tenant
    if (result.applied && !payment.invoiceId && payment.tenantId) {
      try {
        const { paymentInvoiceLinkingService } = await import(
          "@/lib/services/payment-invoice-linking.service"
        );
        await paymentInvoiceLinkingService.applyPaymentToInvoices(
          payment.id,
          payment.tenantId,
          amountPaid,
          payment.leaseId ?? undefined
        );
      } catch (error) {
        console.error("Error linking payment to invoices:", error);
      }
    }
  } catch (error) {
    console.error("Error handling payment success:", error);
    throw error;
  }
}

async function handlePaymentFailed(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  try {
    const payment = await db.payment.findFirst({
      where: { stripePaymentIntentId: paymentIntent.id },
    });

    if (!payment) {
      console.warn("Payment not found for failed Stripe payment intent:", paymentIntent.id);
      return;
    }

    // Update payment status with failure details in the history. Guarded:
    // Stripe does not order webhook deliveries, so a stale `payment_failed`
    // from attempt 1 must never regress a payment attempt 2 already settled.
    const errorMessage =
      paymentIntent.last_payment_error?.message || "Unknown error";
    await db.payment.updateMany({
      where: {
        id: payment.id,
        status: { notIn: [...GATEWAY_FINAL_STATUSES] },
      },
      data: {
        status: PaymentStatus.FAILED,
        paymentHistory: [
          ...(((payment.paymentHistory as unknown) as any[]) ?? []),
          {
            amount: 0,
            paymentMethod: PaymentMethod.CREDIT_CARD,
            paidDate: new Date().toISOString(),
            transactionId: paymentIntent.id,
            notes: `Payment failed: ${errorMessage}`,
          },
        ],
      },
    });
    console.error("Payment marked as failed:", payment.id, errorMessage);
  } catch (error) {
    console.error("Error handling payment failure:", error);
    throw error;
  }
}

async function handleChargeDispute(dispute: Stripe.Dispute): Promise<void> {
  // Handle charge disputes - could involve updating payment status
  // and notifying property managers

}

// Statuses a non-terminal webhook event must never overwrite: Stripe does not
// guarantee delivery order, so a late `processing` event otherwise reopened a
// settled payment to double settlement. The same list the settlement itself
// refuses to overwrite.
const SETTLED_OR_TERMINAL = [...GATEWAY_FINAL_STATUSES];

async function handlePaymentProcessing(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  await db.payment.updateMany({
    where: {
      stripePaymentIntentId: paymentIntent.id,
      status: { notIn: SETTLED_OR_TERMINAL },
    },
    data: { status: PaymentStatus.PENDING },
  });
}

async function handlePaymentRequiresAction(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  await db.payment.updateMany({
    where: {
      stripePaymentIntentId: paymentIntent.id,
      status: { notIn: SETTLED_OR_TERMINAL },
    },
    data: { status: PaymentStatus.PENDING },
  });
}

async function handlePaymentCanceled(
  paymentIntent: Stripe.PaymentIntent
): Promise<void> {
  await db.payment.updateMany({
    where: {
      stripePaymentIntentId: paymentIntent.id,
      status: { notIn: SETTLED_OR_TERMINAL },
    },
    data: { status: PaymentStatus.FAILED },
  });
}

async function handleCustomerCreated(customer: Stripe.Customer): Promise<void> {

  // Could update tenant records with Stripe customer ID if needed
}

async function handlePaymentMethodAttached(
  paymentMethod: Stripe.PaymentMethod
): Promise<void> {

  // Could store payment method details for future use
}


async function handleCheckoutSessionCompleted(
  checkoutSession: Stripe.Checkout.Session
): Promise<void> {
  try {
    const paymentId =
      checkoutSession.client_reference_id ||
      (checkoutSession.metadata?.paymentId as string | undefined);

    const payment = paymentId
      ? await db.payment.findFirst({ where: { id: paymentId } })
      : await db.payment.findFirst({
          where: { stripeCheckoutSessionId: checkoutSession.id },
        });

    if (!payment) {
      console.warn(
        "Payment not found for Checkout session:",
        checkoutSession.id
      );
      return;
    }

    // Idempotency at the Payment level — skip one that is already settled,
    // refunded or cancelled; the settlement below refuses them all the same.
    if (isGatewayFinal(payment.status)) {
      return;
    }

    const paymentIntentId =
      typeof checkoutSession.payment_intent === "string"
        ? checkoutSession.payment_intent
        : checkoutSession.payment_intent?.id;

    // Same zero-decimal rule as payment_intent.succeeded above: JPY/KRW/VND
    // have no minor unit, so `/ 100` recorded a ¥50,000 capture as ¥500.
    const amountPaid =
      typeof checkoutSession.amount_total === "number"
        ? fromMinorUnits(
            checkoutSession.amount_total,
            checkoutSession.currency ?? String(payment.currency ?? DEFAULT_CURRENCY).toLowerCase()
          )
        : payment.amount;

    const referenceFields: Record<string, string> = {
      stripeCheckoutSessionId: checkoutSession.id,
    };
    if (paymentIntentId) {
      referenceFields.stripePaymentIntentId = paymentIntentId;
    }

    // Idempotent settle: marks the payment PAID, records the history entry,
    // and applies the amount to its invoice inside one transaction.
    await settleGatewayPayment(payment.id, {
      amount: amountPaid,
      currency: checkoutSession.currency ?? undefined,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      transactionId: paymentIntentId || checkoutSession.id,
      notes: "Payment processed via Stripe Checkout",
      referenceFields,
    });
  } catch (error) {
    console.error("Error handling checkout.session.completed:", error);
    throw error;
  }
}

async function handleCheckoutSessionFailed(
  checkoutSession: Stripe.Checkout.Session
): Promise<void> {
  try {
    const paymentId =
      checkoutSession.client_reference_id ||
      (checkoutSession.metadata?.paymentId as string | undefined);

    const payment = paymentId
      ? await db.payment.findFirst({ where: { id: paymentId } })
      : await db.payment.findFirst({
          where: { stripeCheckoutSessionId: checkoutSession.id },
        });

    if (!payment) return;
    if (isGatewayFinal(payment.status)) return;

    // An expired session does not undo a refund or a cancellation, nor a
    // payment another route has since settled.
    await db.payment.updateMany({
      where: { id: payment.id, status: { notIn: SETTLED_OR_TERMINAL } },
      data: { status: PaymentStatus.FAILED },
    });
  } catch (error) {
    console.error("Error handling checkout session failure:", error);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

export function formatStripeAmount(amount: number): number {
  return Math.round(amount * 100); // Convert dollars to cents
}

export function formatDisplayAmount(stripeAmount: number): number {
  return stripeAmount / 100; // Convert cents to dollars
}

export function isValidStripeAmount(amount: number): boolean {
  return amount >= 0.5 && amount <= 999999.99; // Stripe limits
}

export async function getPaymentMethods(
  customerId: string
): Promise<Stripe.PaymentMethod[]> {
  try {
    const stripe = await getStripeClient();
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: "card",
    });
    return paymentMethods.data;
  } catch (error) {
    console.error("Error retrieving payment methods:", error);
    return [];
  }
}
