/**
 * PropertyPro - What to do with the payment intent already on a payment
 *
 * POST /api/payments/create-intent usually finds a Stripe payment-intent id
 * on the payment row: the tenant opened the pay screen before, or has paid
 * and the webhook has not said so yet. What it did next was decided by the
 * intent's status alone — "succeeded" marked the payment paid, anything still
 * open handed back its client secret.
 *
 * Status says nothing about WHICH payment the intent was raised for, and the
 * id on the row could be written by the caller (PATCH /api/payments/[id],
 * action "processPayment", now retired). A tenant could point this month's
 * rent at the intent of something already paid — last month's receipt, a
 * small fee — and create-intent marked the rent paid.
 *
 * So the gateway's own copy of the intent has to say it is this payment's.
 * create-intent stamps the row's id in the metadata of every intent it
 * raises (the hosted checkout does the same), and before an intent settles
 * anything it must also be for this payment's amount, in this payment's
 * currency, on a payment that is still waiting for its money.
 */

import { toMinorUnits } from "@/lib/payments/amounts";
import { chargeCurrency } from "@/lib/payments/gateway-currency";
import {
  isAwaitingMoney,
  type PayablePayment,
} from "@/lib/payments/payable-online";

/** The intent as the gateway reports it. */
export interface StoredIntent {
  status: string;
  /** Major units, in `currency` — as stripePaymentService returns it. */
  amount: number;
  currency: string;
  metadata?: Record<string, string> | null;
}

/** The payment row the intent's id was found on. */
export interface IntentPayment extends PayablePayment {
  id: string;
  currency?: string | null;
}

/** The first way an intent fails to be this payment's own charge. */
export type IntentMismatch = "payment" | "currency" | "amount";

/**
 * What create-intent does with the intent it found:
 *
 *   complete  it is this payment's charge and it went through — record it
 *   reuse     nothing was taken on it yet — hand back its client secret
 *   replace   it cannot take this payment's money — forget it, raise a new one
 *   review    money was taken on it that cannot be booked here — touch
 *             nothing and leave it for a person
 */
export type StoredIntentAction = "complete" | "reuse" | "replace" | "review";

/** The payment the gateway says the intent was raised for, when it says. */
function namedPayment(intent: StoredIntent): string | null {
  const id = intent.metadata?.paymentId;
  return typeof id === "string" && id !== "" ? id : null;
}

/**
 * How the intent differs from the charge this payment would raise, or null
 * when it is exactly that charge.
 *
 * Amounts are compared in the currency's smallest unit, the integer the
 * gateway itself holds, so 0.1 + 0.2 never decides whether rent was paid.
 */
export function intentMismatch(
  intent: StoredIntent,
  payment: IntentPayment,
): IntentMismatch | null {
  if (!payment.id || namedPayment(intent) !== payment.id) {
    return "payment";
  }

  const currency = chargeCurrency(payment.currency);
  if (String(intent.currency ?? "").trim().toUpperCase() !== currency) {
    return "currency";
  }

  if (
    toMinorUnits(intent.amount, currency) !==
    toMinorUnits(payment.amount, currency)
  ) {
    return "amount";
  }

  return null;
}

export function storedIntentAction(
  intent: StoredIntent,
  payment: IntentPayment,
): StoredIntentAction {
  if (intent.status === "succeeded") {
    // Money moved on this intent. Only this payment's own charge, for what it
    // owes, on a row still waiting for it, may be recorded. Anything else is
    // neither recorded nor replaced: a fresh intent would charge the tenant
    // again for money the office may already hold.
    return intentMismatch(intent, payment) === null && isAwaitingMoney(payment)
      ? "complete"
      : "review";
  }

  if (intent.status === "canceled") return "replace";

  // Nothing has been taken on it, so handing it back settles nothing by
  // itself: whatever it goes on to capture is recorded at what was captured.
  // The one intent never handed back is one the gateway says was raised for
  // another payment. An intent that names no payment is kept — the invoice
  // route raises those before its payment row exists — because dropping a
  // live intent leaves a card form somewhere that can still be paid, with no
  // payment pointing at the charge.
  const named = namedPayment(intent);
  if (named !== null && named !== payment.id) return "replace";

  return "reuse";
}

/**
 * Whether the gateway answered "there is no such intent" — as opposed to not
 * answering at all.
 *
 * Only the first lets the id on the payment be forgotten. A timeout, a rate
 * limit or a rejected key says nothing about the intent, which may already
 * have taken the money: forget it then, and the webhook finds no payment to
 * record the charge on while the tenant is handed a second one.
 */
export function isUnknownIntentError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const { code, statusCode } = error as {
    code?: unknown;
    statusCode?: unknown;
  };
  return code === "resource_missing" || statusCode === 404;
}
