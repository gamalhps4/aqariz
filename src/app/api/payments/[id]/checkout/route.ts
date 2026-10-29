/**
 * PropertyPro - Pay a payment on a gateway's hosted page
 *
 *   POST /api/payments/<id>/checkout   { gateway, returnPath? }
 *   → { url }                 send the payer there
 *   → { alreadyCompleted }    an earlier attempt turned out paid; recorded
 *
 * The gateway must be one the platform and the office's package allow, that
 * the office has connected, and that takes the payment's currency
 * (GET /api/payments/config lists them as `available`). The payer comes back
 * through /api/payments/return/…, which records the money; so does the
 * gateway's webhook if they never come back.
 */

import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db/prisma";
import { paymentAllows } from "@/lib/db/scopes";
import { PaymentStatus } from "@/types";
import { validateSchema } from "@/lib/validations";
import { onlinePaymentRefusal } from "@/lib/payments/payable-online";
import { ensureTenantProfile } from "@/lib/tenant-utils";
import { GATEWAY_IDS, type GatewayId } from "@/lib/payments/gateway-registry";
import { gatewayColumnsOmit } from "@/lib/payments/gateway-columns";
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
  withPermissionAndDB,
} from "@/lib/api-utils";

const bodySchema = z.object({
  gateway: z.enum(GATEWAY_IDS as [GatewayId, ...GatewayId[]]),
  returnPath: z.string().max(300).optional(),
});

/** Refusals that carry their own status: unavailable gateway, missing migration, gateway down. */
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
    try {
      const { id } = await params;
      const validation = validateSchema(bodySchema, await request.json().catch(() => ({})));
      if (!validation.success) {
        return createErrorResponse(validation.errors.join(", "), 400);
      }
      const { gateway, returnPath } = validation.data;

      const payment = await db.payment.findFirst({
        where: { id },
        omit: await gatewayColumnsOmit(),
        include: {
          tenant: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
          property: { select: { name: true } },
        },
      });
      if (!payment) return createErrorResponse("Payment not found", 404);

      if (user.isTenant && !(await ensureTenantProfile(user.id))) {
        return createErrorResponse("You can only pay your own payments", 403);
      }
      if (!paymentAllows(user, payment)) {
        return createErrorResponse("You can only pay your own payments", 403);
      }

      if (payment.status === PaymentStatus.PAID) {
        return createSuccessResponse({ alreadyCompleted: true }, "Payment is already completed");
      }
      const notPayable = onlinePaymentRefusal(payment);
      if (notPayable) {
        return createErrorResponse(
          `This payment cannot be paid online: ${notPayable}. Contact the office.`,
          409,
        );
      }
      // The installment may have been settled at the desk since.
      if (payment.invoiceId) {
        const installment = await db.invoice.findFirst({
          where: { id: payment.invoiceId },
          select: { status: true, balanceRemaining: true },
        });
        const cannotTakeIt = onlinePaymentRefusal(payment, installment);
        if (cannotTakeIt) {
          return createErrorResponse(
            `This payment cannot be paid online: ${cannotTakeIt}. Contact the office.`,
            409,
          );
        }
      }

      const result = await startGatewayCheckout({
        request,
        payment,
        gateway,
        returnPath: safeReturnPath(returnPath, `/dashboard/payments/${payment.id}`),
      });
      if ("alreadyPaid" in result) {
        return createSuccessResponse({ alreadyCompleted: true }, "Payment is already completed");
      }
      return createSuccessResponse({ url: result.url, gateway: result.gateway }, "Checkout opened");
    } catch (error) {
      return refusal(error) ?? handleApiError(error, "Failed to open the payment page");
    }
  },
);
