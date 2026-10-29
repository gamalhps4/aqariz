/**
 * PropertyPro - Amounts the way each gateway wants them
 *
 * Gateways disagree about units. Stripe and Moyasar take an integer in the
 * currency's smallest unit (halalas for the riyal: 1,234.50 SAR is 123450);
 * PayPal, PayTabs and Tap take the decimal amount (1234.50). Every adapter
 * goes through these helpers, so an amount is converted in one place and
 * through whole minor units — 0.1 + 0.2 never decides what a tenant pays.
 *
 * Unlike ./amounts.ts (the Stripe in-app path), this knows the three-decimal
 * currencies of the Gulf: 1.250 KWD is 1250 fils, not 125.
 */

/** Currencies with no minor unit (Stripe's zero-decimal list, trimmed). */
const ZERO_DECIMAL = new Set([
  "BIF", "CLP", "DJF", "GNF", "JPY", "KMF", "KRW", "MGA", "PYG", "RWF", "UGX",
  "VND", "VUV", "XAF", "XOF", "XPF",
]);

/** Currencies with three decimals: Bahraini, Jordanian, Kuwaiti, Omani, Tunisian, Iraqi, Libyan. */
const THREE_DECIMAL = new Set(["BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"]);

/** How many decimals a currency's amounts carry. */
export function currencyDecimals(currency: string): 0 | 2 | 3 {
  const code = String(currency || "").trim().toUpperCase();
  if (ZERO_DECIMAL.has(code)) return 0;
  if (THREE_DECIMAL.has(code)) return 3;
  return 2;
}

/** 1234.5 SAR → 123450 halalas. */
export function toMinor(amount: number, currency: string): number {
  const factor = 10 ** currencyDecimals(currency);
  // toFixed(6) first: 1.15 * 100 is 114.99999999999999 in binary floating point.
  return Math.round(Number((Number(amount) * factor).toFixed(6)));
}

/** 123450 halalas → 1234.5 SAR. */
export function fromMinor(value: number, currency: string): number {
  const decimals = currencyDecimals(currency);
  return Number((Number(value) / 10 ** decimals).toFixed(decimals));
}

/** 1234.5 SAR → "1234.50": the decimal string PayPal and Tap's signatures use. */
export function formatMajor(amount: number, currency: string): string {
  const decimals = currencyDecimals(currency);
  return (toMinor(amount, currency) / 10 ** decimals).toFixed(decimals);
}

/** Two amounts in the same currency are the same money. */
export function sameAmount(a: number, b: number, currency: string): boolean {
  return toMinor(a, currency) === toMinor(b, currency);
}
