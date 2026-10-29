/**
 * PropertyPro - Which account a payment method moves
 *
 * The payment methods themselves are lib/payments/methods.ts — one list for
 * every screen. This only says where each one's money is in the books:
 *
 *   cash                                  → the cash box
 *   POS (mada, the office's own terminal)  → POS clearing, until the
 *                                            acquirer settles to the bank
 *   transfers, cheques, ACH, money orders  → the bank
 *   gateway payments (Stripe card, PayPal,
 *   Razorpay, Paystack, "online")          → gateway clearing, until the
 *                                            gateway pays out
 *   cash to the owner, transfer to the
 *   owner, Ejar                            → nowhere of the office's: the
 *                                            owner received it
 *
 * A card recorded by hand without a gateway reference (an older row, from
 * before POS had its own method) was taken on the office's terminal, so it is
 * POS clearing; with a gateway reference it is the gateway's. An unknown or
 * missing method is taken to be the bank — the commonest way rent arrives.
 */

import { PaymentMethod } from "@/types";
import { isReceivedByOwner } from "@/lib/payments/methods";
import type { SystemKey } from "../system-keys";

export { isReceivedByOwner };

const GATEWAY_METHODS: ReadonlySet<string> = new Set([
  PaymentMethod.PAYPAL,
  PaymentMethod.RAZORPAY,
  PaymentMethod.PAYSTACK,
  "online",
]);

const CARD_METHODS: ReadonlySet<string> = new Set([
  PaymentMethod.CREDIT_CARD,
  PaymentMethod.DEBIT_CARD,
]);

/**
 * The account money received by the office lands in.
 *
 * `online` says a payment gateway captured it (the payment carries a gateway
 * reference — see `isOnlinePayment` in lib/payments/recorder.ts).
 */
export function receiptAccountKey(
  method: string | null | undefined,
  options: { online?: boolean } = {},
): SystemKey {
  const value = (method ?? "").trim().toLowerCase();
  if (value === PaymentMethod.CASH) return "cash_on_hand";
  if (value === PaymentMethod.POS) return "pos_clearing";
  if (GATEWAY_METHODS.has(value)) return "gateway_clearing";
  if (CARD_METHODS.has(value)) {
    return options.online ? "gateway_clearing" : "pos_clearing";
  }
  if (!value && options.online) return "gateway_clearing";
  return "bank";
}

/**
 * The account money paid out by the office leaves: the cash box for cash,
 * the bank for everything else (a card the office pays with is drawn on its
 * bank).
 */
export function disbursementAccountKey(method: string | null | undefined): SystemKey {
  const value = (method ?? "").trim().toLowerCase();
  return value === PaymentMethod.CASH ? "cash_on_hand" : "bank";
}
