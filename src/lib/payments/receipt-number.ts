/**
 * PropertyPro - A payment's number, which is its receipt number (السند)
 *
 * Every payment that money was received on carries one number, given by the
 * database in sequence per organization (`payments.number`, migration
 * 20261003100001_payment_numbers) and printed as RCP-000123. It is the
 * payment number on the payments list, the reports and the exports, and the
 * receipt voucher number (سند قبض) on the receipt and in the statements'
 * السند column — the same number everywhere, so a receipt in a tenant's hand
 * can be found on any screen.
 *
 * Receipts used to be numbered three ways — from the payment's id, by month
 * when a tenant generated one, and again by the receipt service — so one
 * payment could print under two numbers. Those schemes are retired. A
 * receipt stored under an older number keeps it in the database (its PDF is
 * filed under it), and that number is still read for a payment the backfill
 * has not numbered yet.
 *
 * No database here, so the client can import it and the tests can pin it.
 */

import { uniqueViolationTarget } from "@/lib/db/unique-violation";

export const PAYMENT_NUMBER_PREFIX = "RCP-";

/** Digits a number is padded to: RCP-000123. Longer numbers print in full. */
const PAYMENT_NUMBER_DIGITS = 6;

/**
 * RCP-000123, or null for a payment with no number — a charge nobody has
 * paid, which the screens show as "—".
 */
export function formatPaymentNumber(
  number: number | null | undefined,
): string | null {
  if (typeof number !== "number" || !Number.isInteger(number) || number <= 0) {
    return null;
  }
  return `${PAYMENT_NUMBER_PREFIX}${String(number).padStart(PAYMENT_NUMBER_DIGITS, "0")}`;
}

/**
 * The number a search names, when it names one: "RCP-000123", "rcp 123",
 * "#123", "000123" and "123" all mean payment 123. Anything else — a name, a
 * phone number with a "+", a contract reference — is null.
 */
export function parsePaymentNumber(text: string | null | undefined): number | null {
  if (!text) return null;
  const match = /^\s*(?:rcp[\s-]*|#)?0*(\d{1,9})\s*$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

/**
 * The receipt voucher number a payment prints under.
 *
 * Its payment number. A payment that has none yet — money received before
 * the backfill reached its organization — prints under the receipt it was
 * sent, if one was stored, and otherwise under a number made from its id, as
 * every receipt did before numbering; once the backfill has run, every paid
 * payment has its own number and those two never print again.
 */
export function receiptNumberFor(
  paymentId: string,
  storedNumber?: string | null,
  paymentNumber?: number | null,
): string {
  return (
    formatPaymentNumber(paymentNumber) ??
    (storedNumber?.trim() ||
      `${PAYMENT_NUMBER_PREFIX}${paymentId.slice(-8).toUpperCase()}`)
  );
}

/**
 * What a failed receipt insert collided with: another receipt for the same
 * payment (a concurrent generation won — use that one), a receipt number
 * already taken (try the next), or nothing unique at all (a real error).
 *
 * Read through `uniqueViolationTarget`, which finds the constraint whichever
 * shape the error takes. Under row-level security Postgres leaves the key out
 * of its message, so the old `meta.target` check saw neither and retried a
 * duplicate receipt as a number collision until it gave up.
 */
export function receiptCollision(
  error: unknown,
): "payment" | "number" | null {
  const target = uniqueViolationTarget(error);
  if (!target) return null;
  return target.includes("paymentId") ? "payment" : "number";
}
