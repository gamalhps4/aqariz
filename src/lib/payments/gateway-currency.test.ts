/**
 * An online payment is charged in the invoice's own currency.
 *
 * The gateways used to be handed "usd" whatever the invoice said, so a
 * 5,000 SAR installment was charged as 5,000 US dollars. And PayPal cannot
 * take Saudi riyals at all — offering it for a SAR invoice ended in an error
 * after the tenant had already left for PayPal.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { chargeCurrency, paypalSupports } from "@/lib/payments/gateway-currency";
import { DEFAULT_CURRENCY } from "@/lib/regional/region";

describe("the currency a payment is charged in", () => {
  test("the record's own currency, normalised", () => {
    assert.equal(chargeCurrency("sar"), "SAR");
    assert.equal(chargeCurrency(" eur "), "EUR");
  });

  test("a record without one falls back to the region's currency, not USD", () => {
    assert.equal(chargeCurrency(null), DEFAULT_CURRENCY);
    assert.equal(chargeCurrency(undefined), DEFAULT_CURRENCY);
    assert.equal(chargeCurrency("  "), DEFAULT_CURRENCY);
  });

  test("PayPal is offered only for currencies it can take", () => {
    assert.equal(paypalSupports("SAR"), false);
    assert.equal(paypalSupports("AED"), false);
    assert.equal(paypalSupports("usd"), true);
    assert.equal(paypalSupports("EUR"), true);
  });
});
