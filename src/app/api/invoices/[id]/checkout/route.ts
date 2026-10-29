/**
 * PropertyPro - Collect an invoice on a gateway's hosted page
 *
 *   POST /api/invoices/<id>/checkout   { gateway, amount, returnPath? }
 *   → { url }   send the payer there
 *
 * Opens a pending payment for the amount against the invoice, then the
 * gateway's page for it (lib/payments/gateway-checkout.ts). The money is
 * recorded, and applied to the invoice, when the gateway confirms it — on
 * the payer's return or by webhook. Replaces the Stripe-only
 * /checkout-session and the PayPal-only /paypal/* routes.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { invoiceAllows } from "@/lib/db/scopes";
import { PaymentStatus, PaymentType } from "@/types";
import { validateSchema } from "@/lib/validations";
import { GATEWAY_IDS, type GatewayId } from "@/lib/payments/gateway-registry";
import { chargeCurrency } from "@/lib/payments/gateway-currency";
import { gatewayPaymentMethod } from "@/lib/payments/gateway-settle";
import { requireUsableGateway } from "@/lib/payments/gateway-availability";
import { requireGatewayColumns } from "@/lib/payments/gateway-columns";
import {
  CheckoutRefusedError,
  safeReturnPath,
  startGatewayCheckout,
} from "@/lib/payments/gateway-checkout";
import {
  AuthenticatedAccessUser,
  createErrorResponse,
  createSuccessResponse,
  handleApiError,
  isValidObjectId,
  withPermissionAndDB,
} from "@/lib/api-utils";

const bodySchema = z.object({
  gateway: z.enum(GATEWAY_IDS as [GatewayId, ...GatewayId[]]),
  // coerce: the dialog may send a string; garbage like "12abc" must 400.
  amount: z.coerce
    .number({ invalid_type_error: "Invalid payment amount" })
    .finite()
    .positive("Invalid payment amount"),
  returnPath: z.string().max(300).optional(),
});

function refusal(error: unknown) {
  const status = (error as { statusCode?: unknown })?.statusCode;
  if (
    error instanceof Error &&
    typeof status === "number" &&
    status >= 400 &&
    status < 600 &&
    (error instanceof CheckoutRefusedError ||
      ["GatewayUnavailableError", "GatewayColumnsMissingError", "GatewayConfigError"].includes(error.name))
  ) {
    return createErrorResponse(error.message, status);
  }
  return null;
}

export const POST = withPermissionAndDB(["payment_portal", "payment_processing"])(
  async (
    user: AuthenticatedAccessUser,
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> },
  ) => {
    let openedPaymentId: string | null = null;
    try {
      const { id: invoiceId } = await params;
      if (!isValidObjectId(invoiceId)) return createErrorResponse("Invalid invoice ID", 400);

      const validation = validateSchema(bodySchema, await request.json().catch(() => ({})));
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { gateway, amount, returnPath } = validation.data;

      const invoice = await db.invoice.findFirst({
        where: { id: invoiceId },
        include: {
          tenant: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          property: { select: { id: true, name: true } },
        },
      });
      if (!invoice) return createErrorResponse("Invoice not found", 404);
      // An owner's or a customer's invoice has no tenant, nor a building for
      // a payment row to belong to.
      if (!invoice.tenant?.id || !invoice.propertyId) {
        return createErrorResponse(
          "This invoice is not linked to a tenant. Record its payment manually.",
          400,
        );
      }
      if (!invoiceAllows(user, { tenantId: invoice.tenant.id })) {
        return createErrorResponse("Access denied", 403);
      }
      if (invoice.status === "paid") return createErrorResponse("Invoice is already paid", 400);
      if (invoice.status === "cancelled") return createErrorResponse("Cannot pay cancelled invoice", 400);
      if (invoice.balanceRemaining <= 0) {
        return createErrorResponse("Invoice has no remaining balance", 400);
      }
      if (amount > invoice.balanceRemaining + 0.005) {
        return createErrorResponse("Payment amount exceeds remaining balance", 400);
      }

      // Refuse before a payment row exists for nothing.
      await requireUsableGateway(invoice.organizationId, gateway, invoice.currency);
      await requireGatewayColumns();

      const payment = await db.payment.create({
        data: {
          organizationId: invoice.organizationId,
          tenantId: invoice.tenant.id,
          propertyId: invoice.propertyId,
          leaseId: invoice.leaseId,
          invoiceId: invoice.id,
          amount,
          currency: chargeCurrency(invoice.currency),
          paymentMethod: gatewayPaymentMethod(gateway),
          status: PaymentStatus.PENDING,
          type: PaymentType.INVOICE,
          dueDate: invoice.dueDate,
          description: `Online payment for invoice ${invoice.invoiceNumber}`,
        },
      });
      openedPaymentId = payment.id;

      const result = await startGatewayCheckout({
        request,
        payment: { ...payment, tenant: invoice.tenant, property: invoice.property },
        gateway,
        returnPath: safeReturnPath(returnPath, `/dashboard/accounting/invoices/${invoice.id}`),
      });
      if ("alreadyPaid" in result) {
        return createSuccessResponse({ alreadyCompleted: true }, "Payment is already completed");
      }
      openedPaymentId = null;
      return createSuccessResponse(
        { url: result.url, gateway: result.gateway, paymentId: payment.id },
        "Checkout opened",
      );
    } catch (error) {
      // No page was opened: the pending payment made for it goes to the archive.
      if (openedPaymentId) {
        await db.payment
          .updateMany({
            where: { id: openedPaymentId, status: PaymentStatus.PENDING },
            data: { deletedAt: new Date() },
          })
          .catch(() => undefined);
      }
      return refusal(error) ?? handleApiError(error, "Failed to open the payment page");
    }
  },
);
