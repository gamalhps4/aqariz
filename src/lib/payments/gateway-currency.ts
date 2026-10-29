/**
 * PropertyPro - Which currency an online payment is charged in
 *
 * Every charge goes out in the currency of the payment or invoice it settles.
 * The PayPal order routes and two of the Stripe paths used to send "USD"
 * whatever the invoice said, so a 5,000 SAR rent became a $5,000 charge —
 * 3.75 times the rent, recorded afterwards as 5,000 SAR paid.
 *
 * PayPal only settles in the currencies below, and the Saudi riyal is not one
 * of them: a SAR payment cannot go through PayPal at all, so the screens hide
 * it and the order routes refuse it rather than charging in another currency.
 */

import { DEFAULT_CURRENCY } from "@/lib/regional/region";
import { gatewaySupportsCurrency } from "@/lib/payments/gateway-registry";

/** The ISO code a charge goes out in: the record's own, else the market's. */
export function chargeCurrency(code: string | null | undefined): string {
  const value = typeof code === "string" ? code.trim() : "";
  return (value || DEFAULT_CURRENCY).toUpperCase();
}

/** Whether PayPal can take a payment in this currency. */
export function paypalSupports(code: string | null | undefined): boolean {
  return gatewaySupportsCurrency("paypal", chargeCurrency(code));
}

/**
 * Whether a gateway can take a payment in this currency — PayPal not the
 * riyal, Moyasar only the riyal (see each gateway's `currencies` in
 * ./gateway-registry.ts). A record with no currency is in the market's.
 */
export function gatewayCanCharge(
  gateway: string,
  code: string | null | undefined,
): boolean {
  return gatewaySupportsCurrency(gateway, chargeCurrency(code));
}
