/**
 * PropertyPro - Payment Amount / Minor-Unit Helpers
 *
 * Gateways charge in the currency's smallest unit (cents, pence). Most currencies use 2 decimal places, but a handful are
 * "zero-decimal" (no minor unit) and must be sent as-is. These helpers convert
 * between the major-unit amounts we store on Payment and the minor-unit integers
 * the gateways expect.
 */

/**
 * Currencies that have no minor unit (amount is sent without multiplying by 100).
 * Aligned with Stripe's zero-decimal list, restricted to codes our currency
 * catalogue can surface.
 */
export const ZERO_DECIMAL_CURRENCIES = new Set<string>([
  "BIF",
  "CLP",
  "DJF",
  "GNF",
  "JPY",
  "KMF",
  "KRW",
  "MGA",
  "PYG",
  "RWF",
  "UGX",
  "VND",
  "VUV",
  "XAF",
  "XOF",
  "XPF",
]);

function isZeroDecimal(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has((currency || "").toUpperCase());
}

/** Convert a major-unit amount (e.g. 120.50) to the gateway's minor unit (12050). */
export function toMinorUnits(amount: number, currency: string): number {
  if (isZeroDecimal(currency)) {
    return Math.round(amount);
  }
  return Math.round(amount * 100);
}

/** Convert a gateway minor-unit integer back to a major-unit amount. */
export function fromMinorUnits(value: number, currency: string): number {
  if (isZeroDecimal(currency)) {
    return value;
  }
  return Number((value / 100).toFixed(2));
}
