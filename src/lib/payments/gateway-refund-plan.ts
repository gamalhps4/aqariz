/**
 * PropertyPro - How much of a payment is left to refund at its gateway
 *
 * An office can refund part of a payment in the gateway's own dashboard, and
 * then press "Refund" in the app for the rest. The gateway is asked first
 * what it has already sent back: 3,000 taken and 500 refunded there leaves
 * 2,500 to refund, and the books then take the whole 3,000 off — 500 that
 * went back earlier, 2,500 now. Asking for the full 3,000 again would be
 * refused by the gateway; treating "partly refunded" as "refunded" (as PayPal
 * once was) took 3,000 off the books while the tenant got 500.
 *
 * Pure: the amount received and the gateway's report in, the split out.
 */

import type { GatewayPaymentState } from "@/lib/payments/gateway-adapter";

export interface GatewayRefundPlan {
  /** Already refunded at the gateway before this refund (major units). */
  refundedEarlier: number;
  /** Left to refund through the gateway now (major units); 0 when nothing is. */
  toRefund: number;
}

const cents = (value: number) => Math.round((Number(value) || 0) * 100);

export function planGatewayRefund(
  received: number,
  state: Pick<GatewayPaymentState, "status" | "refundedAmount"> | null,
): GatewayRefundPlan {
  const total = Math.max(0, cents(received));
  let earlier = 0;
  if (typeof state?.refundedAmount === "number" && Number.isFinite(state.refundedAmount)) {
    earlier = Math.min(total, Math.max(0, cents(state.refundedAmount)));
  } else if (state?.status === "refunded") {
    // Refunded, and the gateway does not say how much: all of it.
    earlier = total;
  }
  return { refundedEarlier: earlier / 100, toRefund: (total - earlier) / 100 };
}
