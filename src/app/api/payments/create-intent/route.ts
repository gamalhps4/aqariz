/**
 * PropertyPro - Create Payment Intent API
 *
 * Stripe's in-app card flow, for the mobile app (POST
 * /api/v1/payments/create-intent, then confirm the client secret with
 * Stripe's SDK). The web pay screens send the payer to a gateway's hosted
 * page instead (POST /api/payments/[id]/checkout). Either way Stripe must be
 * allowed by the platform and the office's package and connected by the
 * office (lib/payments/gateway-availability.ts).
 */

import { chargeCurrency } from "@/lib/payments/gateway-currency";
import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { paymentAllows } from "@/lib/db/scopes";
import { PaymentMethod, PaymentStatus } from "@/types";
import { validateSchema } from "@/lib/validations";
import {
  stripePaymentService,
  type StripePaymentIntent,
} from "@/lib/services/stripe-payment.service";
import {
  InstallmentPaymentError,
  recordInstallmentPayment,
} from "@/lib/services/payment-invoice-linking.service";
import { settleGatewayPayment } from "@/lib/payments/settlement";
import {
  intentMismatch,
  storedIntentAction,
} from "@/lib/payments/stored-intent";
import { onlinePaymentRefusal } from "@/lib/payments/payable-online";
import {
  GatewayUnavailableError,
  requireUsableGateway,
} from "@/lib/payments/gateway-availability";
import {
  gatewayColumnsAvailable,
  gatewayColumnsOmit,
} from "@/lib/payments/gateway-columns";
import {
  CheckoutRefusedError,
  settledByEarlierAttempt,
} from "@/lib/payments/gateway-checkout";
import { ensureTenantProfile } from "@/lib/tenant-utils";
import {
  AuthenticatedAccessUser,
  createSuccessResponse as createApiSuccessResponse,
  createErrorResponse as createApiErrorResponse,
  withPermissionAndDB,
} from "@/lib/api-utils";
import type { Payment as PaymentModel } from "@/generated/prisma/client";
import type { MoneyAsNumber } from "@/lib/db/prisma";
// Money fields arrive as numbers via the money result extension.
type PaymentRow = MoneyAsNumber<PaymentModel>;

// Helper functions
function createSuccessResponse(
  data: any,
  message: string,
  status: number = 200
) {
  return createApiSuccessResponse(data, message);
}

function createErrorResponse(message: string, status: number = 400) {
  return createApiErrorResponse(message, status, message);
}

/**
 * Record a card payment the gateway has confirmed as this payment's own.
 *
 * Through the path staff payments take (recordInstallmentPayment), so the
 * installment is paid in the same transaction as the payment. The write this
 * replaces set the payment to PAID and stopped there: the installment went on
 * showing the debt, and the webhook, finding the payment already paid, never
 * applied the money either.
 *
 * Nobody recorded it, so it carries no recorder — the payments page reads
 * "Online" for it, as it does for a payment the webhook settled.
 */
async function recordConfirmedIntent(
  payment: PaymentRow,
  intent: StripePaymentIntent
): Promise<void> {
  if (payment.invoiceId) {
    await recordInstallmentPayment({
      invoiceId: payment.invoiceId,
      amount: payment.amount,
      paymentMethod: PaymentMethod.CREDIT_CARD,
      paidDate: new Date(),
      reference: intent.id,
      convertPaymentId: payment.id,
      recordedBy: null,
    });
    return;
  }

  // A charge with no installment behind it has nothing to apply the money to.
  // The shared gateway settlement marks the row paid, claimed by version, so
  // the webhook for the same intent cannot settle it a second time.
  await settleGatewayPayment(payment.id, {
    amount: intent.amount,
    currency: intent.currency,
    paymentMethod: PaymentMethod.CREDIT_CARD,
    transactionId: intent.id,
    notes: "Stripe payment intent already succeeded",
  });
}

// ============================================================================
// POST /api/payments/create-intent - Create a Stripe payment intent
// ============================================================================

export const POST = withPermissionAndDB(["payment_portal", "payment_processing"])(
  async (user: AuthenticatedAccessUser, request: NextRequest) => {
  try {
    const body = await request.json();

    const validation = validateSchema(
      z.object({ paymentId: z.string().min(1, "Payment ID is required") }),
      body
    );
    if (!validation.success) {
      return createErrorResponse(validation.errors.join(", "), 400);
    }
    const { paymentId } = validation.data;

    // Find the payment
    const payment = await db.payment.findFirst({
      where: { id: paymentId },
      omit: await gatewayColumnsOmit(),
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

    if (!payment) {
      return createErrorResponse("Payment not found", 404);
    }

    // Ownership per lib/db/scopes.ts, plus the tenant profile this route
    // needs to exist before it can raise an intent at all.
    if (user.isTenant && !(await ensureTenantProfile(user.id))) {
      return createErrorResponse(
        "You can only create payment intents for your own payments",
        403
      );
    }
    if (!paymentAllows(user, payment)) {
      return createErrorResponse(
        "You can only create payment intents for your own payments",
        403
      );
    }

    // Already settled: there is nothing to raise and nothing to write.
    if (payment.status === PaymentStatus.PAID) {
      return createSuccessResponse(
        {
          alreadyCompleted: true,
          status: PaymentStatus.PAID,
          paymentIntentId: payment.stripePaymentIntentId ?? null,
        },
        "Payment is already completed"
      );
    }

    // A refunded, cancelled or part-paid payment is not a bill: no charge is
    // raised for it, and the intent it may still carry settles nothing.
    const notPayable = onlinePaymentRefusal(payment);
    if (notPayable) {
      return createErrorResponse(
        `This payment cannot be paid online: ${notPayable}. Contact the office.`,
        409
      );
    }

    // A hosted-page attempt (any gateway) may have been paid and not yet
    // reported: asked before Stripe raises another charge. The payment
    // intent this route raised itself is handled just below.
    if (
      payment.gatewayPaymentId &&
      payment.gatewayPaymentId !== payment.stripePaymentIntentId
    ) {
      try {
        if (await settledByEarlierAttempt(payment)) {
          return createSuccessResponse(
            { alreadyCompleted: true, status: PaymentStatus.PAID, paymentIntentId: null },
            "Payment is already completed"
          );
        }
      } catch (error) {
        if (error instanceof CheckoutRefusedError) {
          return createErrorResponse(error.message, error.statusCode);
        }
        throw error;
      }
    }

    // Handle existing payment intent if present. What the gateway says about
    // it decides what happens — see lib/payments/stored-intent.ts for why its
    // status alone is not enough.
    let reusableIntent: StripePaymentIntent | null = null;
    if (payment.stripePaymentIntentId) {
      let existingIntent: StripePaymentIntent | null;
      try {
        existingIntent = await stripePaymentService.findPaymentIntent(
          payment.stripePaymentIntentId
        );
      } catch (intentError) {
        // Could not ask — which is not "no such intent". It may already have
        // taken the money, so the payment keeps it: forgetting it here left
        // the webhook no payment to record the charge on, and handed the
        // tenant a second one.
        console.error(
          "Existing Stripe payment intent could not be checked",
          intentError
        );
        return createErrorResponse(
          "The payment provider could not be reached to check this payment. Try again in a moment.",
          502
        );
      }

      const action = existingIntent
        ? storedIntentAction(existingIntent, payment)
        : "replace";

      if (existingIntent && action === "complete") {
        let refusal: string | null = null;
        try {
          await recordConfirmedIntent(payment, existingIntent);
        } catch (error) {
          if (!(error instanceof InstallmentPaymentError)) throw error;
          refusal = error.message;
        }

        // Read back rather than trusting the call above: the webhook for this
        // same intent may have recorded it a moment earlier, which refuses
        // ours and is exactly the outcome wanted.
        const current = await db.payment.findFirst({
          where: { id: payment.id },
          select: { status: true },
        });
        if (current?.status === PaymentStatus.PAID) {
          return createSuccessResponse(
            {
              alreadyCompleted: true,
              status: PaymentStatus.PAID,
              paymentIntentId: existingIntent.id,
            },
            "Payment is already completed"
          );
        }

        // The money was taken and the books cannot take it — the installment
        // was settled another way, or is gone. Never retried with a new
        // intent: that would charge the tenant twice.
        console.error("Stripe payment succeeded but could not be recorded", {
          paymentId: payment.id,
          paymentIntentId: existingIntent.id,
          reason: refusal ?? `payment is ${current?.status ?? "missing"}`,
        });
        return createErrorResponse(
          "The card payment went through, but it could not be recorded" +
            (refusal ? `: ${refusal.replace(/\.$/, "")}. ` : ". ") +
            "Contact the office.",
          409
        );
      }

      if (existingIntent && action === "review") {
        console.error("Stripe payment intent on file does not match its payment", {
          paymentId: payment.id,
          paymentStatus: payment.status,
          paymentIntentId: existingIntent.id,
          mismatch: intentMismatch(existingIntent, payment),
        });
        return createErrorResponse(
          "A completed card payment is on file for this payment, but it does not match it, so nothing was recorded. Contact the office.",
          409
        );
      }

      if (existingIntent && action === "reuse") {
        reusableIntent = existingIntent;
      }
    }

    // From here on the tenant is about to be asked for money: Stripe has to
    // be one the office may collect through.
    try {
      await requireUsableGateway(payment.organizationId, "stripe", payment.currency);
    } catch (error) {
      if (error instanceof GatewayUnavailableError) {
        return createErrorResponse(error.message, error.statusCode);
      }
      throw error;
    }

    // And the installment has to be able to take it — the office may have
    // settled it at the desk since. recordInstallmentPayment would refuse the money for
    // the same reasons, after the card had been charged.
    if (payment.invoiceId) {
      const installment = await db.invoice.findFirst({
        where: { id: payment.invoiceId },
        select: { status: true, balanceRemaining: true },
      });
      const cannotTakeIt = onlinePaymentRefusal(payment, installment);
      if (cannotTakeIt) {
        return createErrorResponse(
          `This payment cannot be paid online: ${cannotTakeIt}. Contact the office.`,
          409
        );
      }
    }

    if (reusableIntent) {
      return createSuccessResponse(
        {
          clientSecret: reusableIntent.clientSecret,
          paymentIntentId: reusableIntent.id,
          amount: reusableIntent.amount,
          currency: reusableIntent.currency,
          customerId: payment.stripeCustomerId ?? null,
          status: reusableIntent.status,
        },
        "Existing payment intent retrieved"
      );
    }

    if (payment.stripePaymentIntentId) {
      // Cancelled, unknown to the gateway, or raised for another payment:
      // forget it and raise this payment its own below.
      await db.payment.update({
        where: { id: payment.id },
        data: {
          stripePaymentIntentId: null,
          stripePaymentMethodId: null,
        },
      });
    }

    // Create or update Stripe customer
    const tenantUser = payment.tenant;

    if (!tenantUser?.email) {
      return createErrorResponse(
        "Tenant contact information is incomplete",
        400
      );
    }
    const tenantFullName = `${tenantUser.firstName ?? ""} ${
      tenantUser.lastName ?? ""
    }`
      .trim()
      .replace(/\s+/g, " ");
    const customer = await stripePaymentService.createOrGetCustomer(
      tenantUser.id,
      tenantUser.email,
      tenantFullName || tenantUser.email
    );

    // Create payment intent
    const paymentIntent = await stripePaymentService.createPaymentIntent(
      payment.amount,
      customer.id,
      undefined, // No payment method specified yet
      {
        // What lets this route recognise the intent as this payment's own
        // when it meets it again — see lib/payments/stored-intent.ts.
        paymentId: payment.id,
        paymentType: payment.type,
        propertyName: payment.property?.name ?? "",
        tenantName: tenantFullName || tenantUser.email,
        dueDate: payment.dueDate.toISOString(),
        tenantId: payment.tenantId,
        propertyId: payment.propertyId,
        // Stamped so a charge can be traced back from the Stripe dashboard
        // during a dispute or refund. This is the organization's own Stripe
        // account, but a property manager may run several PropertyPro
        // organizations against one account.
        organizationId: payment.organizationId,
      },
      // The payment's own currency — this defaulted to "usd", so a SAR rent
      // was charged as dollars. See lib/payments/gateway-currency.ts.
      chargeCurrency(payment.currency).toLowerCase(),
    );

    await db.payment.update({
      where: { id: payment.id },
      data: {
        stripePaymentIntentId: paymentIntent.id,
        stripeCustomerId: customer.id,
        stripePaymentMethodId: null,
        // The generic reference too, once the database has it.
        ...((await gatewayColumnsAvailable())
          ? { gatewayProvider: "stripe", gatewayPaymentId: paymentIntent.id }
          : {}),
      },
    });

    return createSuccessResponse(
      {
        clientSecret: paymentIntent.clientSecret,
        paymentIntentId: paymentIntent.id,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        customerId: customer.id,
      },
      "Payment intent created successfully"
    );
  } catch (error) {
    console.error("Error in POST /api/payments/create-intent:", error);
    return createErrorResponse("Failed to create payment intent", 500);
  }
  }
);
