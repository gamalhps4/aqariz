/**
 * Every gateway adapter, against a fake gateway.
 *
 * No live or sandbox keys exist for this project, so each test answers for the
 * gateway through the `fetch` the adapter is given, shaped after the
 * gateway's documented API. What is pinned: the amount each gateway is sent
 * (halalas for Moyasar and Stripe, a decimal for the others), the riyal, our
 * payment id travelling with the charge, the office's credentials on every
 * call, and webhook signatures that hold — or are refused.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";

import type { AdapterContext, CreateCheckoutInput } from "@/lib/payments/gateway-adapter";
import { GatewayConfigError, hmacSha256Hex, type FetchLike } from "@/lib/payments/gateway-http";
import { formatMajor, fromMinor, toMinor } from "@/lib/payments/gateway-money";
import { moyasarAdapter } from "./moyasar";
import { paytabsAdapter } from "./paytabs";
import { tapAdapter, tapHashString } from "./tap";
import { paypalAdapter } from "./paypal";
import { stripeAdapter } from "./stripe";
import { getGatewayAdapter } from "./index";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
  json: any;
}

type Reply = { status?: number; body: unknown };
type Route = (call: Call) => Reply | undefined;

/** A fake gateway: answers by route, remembers every call. */
function fakeGateway(...routes: Route[]): { fetch: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers as HeadersInit).forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const body = typeof init?.body === "string" ? init.body : "";
    let json: any = undefined;
    try {
      json = body ? JSON.parse(body) : undefined;
    } catch {
      json = undefined;
    }
    const call: Call = { url: String(input), method: init?.method ?? "GET", headers, body, json };
    calls.push(call);
    for (const route of routes) {
      const reply = route(call);
      if (reply) {
        return new Response(JSON.stringify(reply.body), {
          status: reply.status ?? 200,
          headers: { "content-type": "application/json", "request-id": "req_test" },
        });
      }
    }
    return new Response(JSON.stringify({ message: "not found" }), {
      status: 404,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fetchImpl, calls };
}

const when =
  (method: string, pattern: RegExp, body: unknown, status = 200): Route =>
  (call) =>
    call.method === method && pattern.test(call.url) ? { status, body } : undefined;

const checkout = (overrides: Partial<CreateCheckoutInput> = {}): CreateCheckoutInput => ({
  paymentId: "pay_123",
  organizationId: "org_1",
  amount: 1234.5,
  currency: "SAR",
  description: "Rent — Building A",
  customer: { name: "Omar Al Harbi", email: "omar@example.com" },
  returnUrl: "https://app.example/api/payments/return/x/office?payment=pay_123",
  cancelUrl: "https://app.example/api/payments/return/x/office?payment=pay_123&outcome=cancel",
  webhookUrl: "https://app.example/api/payments/webhook/x/office",
  locale: "ar",
  idempotencyKey: "checkout-pay_123-1",
  ...overrides,
});

const headersOf = (entries: Record<string, string>) => new Headers(entries);

describe("amounts", () => {
  test("riyals go to halalas through whole numbers", () => {
    assert.equal(toMinor(1234.5, "SAR"), 123450);
    assert.equal(toMinor(0.1 + 0.2, "SAR"), 30);
    assert.equal(toMinor(1.15, "SAR"), 115);
    assert.equal(fromMinor(123450, "SAR"), 1234.5);
    assert.equal(formatMajor(1234.5, "SAR"), "1234.50");
  });

  test("three-decimal and zero-decimal currencies keep their own units", () => {
    assert.equal(toMinor(1.25, "KWD"), 1250);
    assert.equal(formatMajor(1.25, "KWD"), "1.250");
    assert.equal(toMinor(5000, "JPY"), 5000);
    assert.equal(formatMajor(5000, "JPY"), "5000");
  });
});

describe("Moyasar", () => {
  const ctx = (extra: Partial<AdapterContext> = {}): AdapterContext => ({
    credentials: { secretKey: "sk_test_moyasar", webhookSecret: "hook-secret" },
    ...extra,
  });

  test("opens an invoice in halalas, in riyals, carrying our payment id", async () => {
    const gateway = fakeGateway(
      when("POST", /api\.moyasar\.com\/v1\/invoices$/, {
        id: "inv-uuid-1",
        status: "initiated",
        url: "https://checkout.moyasar.com/invoices/inv-uuid-1",
      }, 201),
    );
    const session = await moyasarAdapter.createCheckout(ctx({ fetch: gateway.fetch }), checkout());
    assert.deepEqual(session, {
      reference: "inv-uuid-1",
      redirectUrl: "https://checkout.moyasar.com/invoices/inv-uuid-1",
    });
    const [call] = gateway.calls;
    assert.equal(call.json.amount, 123450);
    assert.equal(call.json.currency, "SAR");
    assert.equal(call.json.metadata.paymentId, "pay_123");
    assert.equal(call.json.success_url, checkout().returnUrl);
    assert.equal(call.json.back_url, checkout().cancelUrl);
    assert.equal(
      call.headers.authorization,
      `Basic ${Buffer.from("sk_test_moyasar:").toString("base64")}`,
    );
  });

  test("a webhook with the office's secret token is accepted, and read back from the API", async () => {
    const body = JSON.stringify({
      id: "evt-1",
      type: "payment_paid",
      secret_token: "hook-secret",
      data: {
        id: "pay-uuid-9",
        status: "paid",
        amount: 123450,
        currency: "SAR",
        invoice_id: "inv-uuid-1",
        source: { type: "creditcard", company: "mada" },
      },
    });
    const event = await moyasarAdapter.verifyWebhook(ctx(), { headers: headersOf({}), rawBody: body });
    assert.ok(event);
    assert.equal(event.eventId, "evt-1");
    assert.equal(event.confirmWithApi, true);
    assert.deepEqual(
      { ...event.payment },
      {
        reference: "pay-uuid-9",
        sessionReference: "inv-uuid-1",
        status: "paid",
        amount: 1234.5,
        currency: "SAR",
        paymentId: null,
        method: "mada",
        failureReason: null,
      },
    );
  });

  test("a webhook with another token is refused; with no stored secret it cannot be checked", async () => {
    const forged = JSON.stringify({ id: "evt-2", type: "payment_paid", secret_token: "guess", data: {} });
    assert.equal(
      await moyasarAdapter.verifyWebhook(ctx(), { headers: headersOf({}), rawBody: forged }),
      null,
    );
    await assert.rejects(
      moyasarAdapter.verifyWebhook({ credentials: { secretKey: "sk" } }, { headers: headersOf({}), rawBody: forged }),
      GatewayConfigError,
    );
  });

  test("an invoice reference is read as the payment that paid it", async () => {
    const gateway = fakeGateway(
      when("GET", /\/v1\/payments\/inv-uuid-1$/, { type: "invalid_request_error" }, 404),
      when("GET", /\/v1\/invoices\/inv-uuid-1$/, {
        id: "inv-uuid-1",
        status: "paid",
        amount: 123450,
        currency: "SAR",
        metadata: { paymentId: "pay_123" },
        payments: [
          { id: "pay-a", status: "failed", amount: 123450, currency: "SAR", source: { type: "creditcard", message: "Declined" } },
          { id: "pay-b", status: "paid", amount: 123450, currency: "SAR", source: { type: "stcpay" } },
        ],
      }),
    );
    const state = await moyasarAdapter.fetchPayment(ctx({ fetch: gateway.fetch }), "inv-uuid-1");
    assert.equal(state?.status, "paid");
    assert.equal(state?.reference, "pay-b");
    assert.equal(state?.sessionReference, "inv-uuid-1");
    assert.equal(state?.paymentId, "pay_123");
    assert.equal(state?.method, "stcpay");
    assert.equal(state?.amount, 1234.5);
  });

  test("refunds the payment in halalas", async () => {
    const gateway = fakeGateway(
      when("POST", /\/v1\/payments\/pay-b\/refund$/, { id: "pay-b", status: "refunded", refunded: 123450, currency: "SAR" }),
    );
    const result = await moyasarAdapter.refund(ctx({ fetch: gateway.fetch }), {
      reference: "pay-b",
      amount: 1234.5,
      currency: "SAR",
      paymentId: "pay_123",
    });
    assert.equal(gateway.calls[0].json.amount, 123450);
    assert.deepEqual(result, { refundId: "pay-b", status: "succeeded", amount: 1234.5 });
  });

  test("a payment refunded in part is still paid, with what went back", async () => {
    // 3,000 taken, 500 refunded in Moyasar's dashboard: Moyasar says "refunded".
    const gateway = fakeGateway(
      when("GET", /\/v1\/payments\/pay-c$/, {
        id: "pay-c",
        status: "refunded",
        amount: 300000,
        refunded: 50000,
        currency: "SAR",
        metadata: { paymentId: "pay_123" },
      }),
    );
    const state = await moyasarAdapter.fetchPayment(ctx({ fetch: gateway.fetch }), "pay-c");
    assert.equal(state?.status, "paid");
    assert.equal(state?.amount, 3000);
    assert.equal(state?.refundedAmount, 500);
  });

  test("a payment refunded in full reads as refunded", async () => {
    const gateway = fakeGateway(
      when("GET", /\/v1\/payments\/pay-d$/, {
        id: "pay-d",
        status: "refunded",
        amount: 300000,
        refunded: 300000,
        currency: "SAR",
      }),
    );
    const state = await moyasarAdapter.fetchPayment(ctx({ fetch: gateway.fetch }), "pay-d");
    assert.equal(state?.status, "refunded");
    assert.equal(state?.refundedAmount, 3000);
  });

  test("refunding the rest reports this refund, not the running total", async () => {
    const gateway = fakeGateway(
      when("POST", /\/v1\/payments\/pay-c\/refund$/, { id: "pay-c", status: "refunded", amount: 300000, refunded: 300000, currency: "SAR" }),
    );
    const result = await moyasarAdapter.refund(ctx({ fetch: gateway.fetch }), {
      reference: "pay-c",
      amount: 2500,
      currency: "SAR",
      paymentId: "pay_123",
    });
    assert.equal(gateway.calls[0].json.amount, 250000);
    assert.equal(result.amount, 2500);
  });
});

describe("PayTabs", () => {
  const credentials = { region: "SAU", profileId: "98765", serverKey: "SKEY-123" };

  test("opens a hosted page on the Saudi domain with the decimal amount", async () => {
    const gateway = fakeGateway(
      when("POST", /^https:\/\/secure\.paytabs\.sa\/payment\/request$/, {
        tran_ref: "TST2300000001",
        redirect_url: "https://secure.paytabs.sa/payment/page/ABC",
      }),
    );
    const session = await paytabsAdapter.createCheckout({ credentials, fetch: gateway.fetch }, checkout());
    assert.deepEqual(session, {
      reference: "TST2300000001",
      redirectUrl: "https://secure.paytabs.sa/payment/page/ABC",
    });
    const [call] = gateway.calls;
    assert.equal(call.headers.authorization, "SKEY-123");
    assert.equal(call.json.profile_id, 98765);
    assert.equal(call.json.tran_type, "sale");
    assert.equal(call.json.cart_id, "pay_123");
    assert.equal(call.json.cart_currency, "SAR");
    assert.equal(call.json.cart_amount, 1234.5);
    assert.equal(call.json.callback, checkout().webhookUrl);
    assert.equal(call.json.return, checkout().returnUrl);
  });

  const notification = {
    tran_ref: "TST2300000001",
    tran_type: "Sale",
    cart_id: "pay_123",
    cart_currency: "SAR",
    cart_amount: "1234.50",
    tran_currency: "SAR",
    tran_total: "1234.50",
    payment_result: { response_status: "A", response_code: "G123", response_message: "Authorised" },
    payment_info: { payment_method: "mada", card_scheme: "mada" },
  };

  test("a notification signed with the server key is accepted", async () => {
    const rawBody = JSON.stringify(notification);
    const event = await paytabsAdapter.verifyWebhook(
      { credentials },
      { headers: headersOf({ signature: hmacSha256Hex("SKEY-123", rawBody) }), rawBody },
    );
    assert.ok(event);
    assert.equal(event.eventId, "TST2300000001:A");
    assert.equal(event.payment?.status, "paid");
    assert.equal(event.payment?.amount, 1234.5);
    assert.equal(event.payment?.paymentId, "pay_123");
    assert.equal(event.payment?.method, "mada");
  });

  test("a changed body, or a missing signature, is refused", async () => {
    const signed = JSON.stringify(notification);
    const tampered = signed.replace("1234.50", "1.00");
    assert.equal(
      await paytabsAdapter.verifyWebhook(
        { credentials },
        { headers: headersOf({ signature: hmacSha256Hex("SKEY-123", signed) }), rawBody: tampered },
      ),
      null,
    );
    assert.equal(
      await paytabsAdapter.verifyWebhook({ credentials }, { headers: headersOf({}), rawBody: signed }),
      null,
    );
  });

  test("a declined transaction reads as failed", async () => {
    const gateway = fakeGateway(
      when("POST", /\/payment\/query$/, {
        ...notification,
        payment_result: { response_status: "D", response_message: "Insufficient funds" },
      }),
    );
    const state = await paytabsAdapter.fetchPayment({ credentials, fetch: gateway.fetch }, "TST2300000001");
    assert.equal(state?.status, "failed");
    assert.equal(state?.failureReason, "Insufficient funds");
    assert.equal(gateway.calls[0].json.tran_ref, "TST2300000001");
  });

  test("refunds against the original transaction", async () => {
    const gateway = fakeGateway(
      when("POST", /\/payment\/request$/, {
        tran_ref: "TST2300000099",
        tran_total: "1234.50",
        payment_result: { response_status: "A" },
      }),
    );
    const result = await paytabsAdapter.refund({ credentials, fetch: gateway.fetch }, {
      reference: "TST2300000001",
      amount: 1234.5,
      currency: "SAR",
      paymentId: "pay_123",
    });
    const [call] = gateway.calls;
    assert.equal(call.json.tran_type, "refund");
    assert.equal(call.json.tran_ref, "TST2300000001");
    assert.equal(call.json.cart_amount, 1234.5);
    assert.deepEqual(result, { refundId: "TST2300000099", status: "succeeded", amount: 1234.5 });
  });
});

describe("Tap", () => {
  const credentials = { secretKey: "sk_test_tap" };

  test("opens a charge on every method, with the decimal amount", async () => {
    const gateway = fakeGateway(
      when("POST", /api\.tap\.company\/v2\/charges$/, {
        id: "chg_TS01",
        status: "INITIATED",
        amount: 1234.5,
        currency: "SAR",
        transaction: { url: "https://checkout.tap.company/?mode=page&token=abc" },
      }),
    );
    const session = await tapAdapter.createCheckout({ credentials, fetch: gateway.fetch }, checkout());
    assert.deepEqual(session, {
      reference: "chg_TS01",
      redirectUrl: "https://checkout.tap.company/?mode=page&token=abc",
    });
    const [call] = gateway.calls;
    assert.equal(call.headers.authorization, "Bearer sk_test_tap");
    assert.equal(call.json.amount, 1234.5);
    assert.equal(call.json.currency, "SAR");
    assert.equal(call.json.source.id, "src_all");
    assert.equal(call.json.metadata.paymentId, "pay_123");
    assert.equal(call.json.post.url, checkout().webhookUrl);
    assert.equal(call.json.redirect.url, checkout().returnUrl);
    assert.equal(call.json.customer.first_name, "Omar");
  });

  const charge = {
    id: "chg_TS01",
    object: "charge",
    status: "CAPTURED",
    amount: 1234.5,
    currency: "SAR",
    metadata: { paymentId: "pay_123" },
    reference: { gateway: "123456", payment: "7890", transaction: "pay_123" },
    transaction: { created: "1700000000000" },
    source: { payment_method: "MADA" },
  };

  test("the hashstring follows Tap's documented order, amount to two decimals", () => {
    assert.equal(
      tapHashString(charge),
      "x_idchg_TS01x_amount1234.50x_currencySARx_gateway_reference123456" +
        "x_payment_reference7890x_statusCAPTUREDx_created1700000000000",
    );
  });

  test("a notification signed with the secret key is accepted; a forged one is not", async () => {
    const rawBody = JSON.stringify(charge);
    const signature = hmacSha256Hex("sk_test_tap", tapHashString(charge));
    const event = await tapAdapter.verifyWebhook({ credentials }, { headers: headersOf({ hashstring: signature }), rawBody });
    assert.equal(event?.payment?.status, "paid");
    assert.equal(event?.payment?.amount, 1234.5);
    assert.equal(event?.payment?.method, "mada");
    assert.equal(event?.eventId, "chg_TS01:CAPTURED");

    const cheaper = JSON.stringify({ ...charge, amount: 1 });
    assert.equal(
      await tapAdapter.verifyWebhook({ credentials }, { headers: headersOf({ hashstring: signature }), rawBody: cheaper }),
      null,
    );
    // Signed with "1234.5" instead of "1234.50": Tap's would never match.
    const sloppy = hmacSha256Hex("sk_test_tap", tapHashString(charge).replace("1234.50", "1234.5"));
    assert.equal(
      await tapAdapter.verifyWebhook({ credentials }, { headers: headersOf({ hashstring: sloppy }), rawBody }),
      null,
    );
  });

  test("refunds the charge", async () => {
    const gateway = fakeGateway(
      when("POST", /\/v2\/refunds$/, { id: "re_TS01", status: "PENDING", amount: 1234.5 }),
    );
    const result = await tapAdapter.refund({ credentials, fetch: gateway.fetch }, {
      reference: "chg_TS01",
      amount: 1234.5,
      currency: "SAR",
      paymentId: "pay_123",
    });
    assert.equal(gateway.calls[0].json.charge_id, "chg_TS01");
    assert.equal(gateway.calls[0].json.amount, 1234.5);
    assert.deepEqual(result, { refundId: "re_TS01", status: "pending", amount: 1234.5 });
  });
});

describe("PayPal", () => {
  const credentials = { mode: "sandbox", clientId: "client-1", clientSecret: "secret-1", webhookId: "WH-1" };
  const token = when("POST", /\/v1\/oauth2\/token$/, { access_token: "A21AA-token", expires_in: 3600 });

  test("opens an order in the payment's currency, with an idempotency key", async () => {
    const gateway = fakeGateway(
      token,
      when("POST", /\/v2\/checkout\/orders$/, {
        id: "5O190127TN364715T",
        status: "CREATED",
        links: [{ rel: "approve", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O190127TN364715T" }],
      }),
    );
    const session = await paypalAdapter.createCheckout(
      { credentials: { ...credentials, clientId: "client-create" }, fetch: gateway.fetch },
      checkout({ amount: 100, currency: "USD" }),
    );
    assert.equal(session.reference, "5O190127TN364715T");
    const order = gateway.calls.find((call) => call.url.endsWith("/v2/checkout/orders"))!;
    assert.equal(order.headers["paypal-request-id"], "checkout-pay_123-1");
    assert.equal(order.headers.authorization, "Bearer A21AA-token");
    assert.deepEqual(order.json.purchase_units[0].amount, { currency_code: "USD", value: "100.00" });
    assert.equal(order.json.purchase_units[0].custom_id, "pay_123");
  });

  const signed = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1",
    "paypal-transmission-id": "tx-1",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-10-03T10:00:00Z",
  };
  const captureEvent = JSON.stringify({
    id: "WH-EVT-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: {
      id: "CAP-1",
      status: "COMPLETED",
      amount: { value: "100.00", currency_code: "USD" },
      custom_id: "pay_123",
      supplementary_data: { related_ids: { order_id: "5O190127TN364715T" } },
    },
  });

  test("a webhook PayPal vouches for is accepted, as the capture", async () => {
    const gateway = fakeGateway(
      token,
      when("POST", /verify-webhook-signature$/, { verification_status: "SUCCESS" }),
    );
    const event = await paypalAdapter.verifyWebhook(
      { credentials: { ...credentials, clientId: "client-hook" }, fetch: gateway.fetch },
      { headers: headersOf(signed), rawBody: captureEvent },
    );
    assert.equal(event?.payment?.reference, "CAP-1");
    assert.equal(event?.payment?.sessionReference, "5O190127TN364715T");
    assert.equal(event?.payment?.status, "paid");
    assert.equal(event?.payment?.paymentId, "pay_123");
    const verify = gateway.calls.find((call) => call.url.endsWith("verify-webhook-signature"))!;
    assert.equal(verify.json.webhook_id, "WH-1");
  });

  test("one PayPal does not vouch for, or with no signature headers, is refused", async () => {
    const gateway = fakeGateway(
      token,
      when("POST", /verify-webhook-signature$/, { verification_status: "FAILURE" }),
    );
    const ctx = { credentials: { ...credentials, clientId: "client-forged" }, fetch: gateway.fetch };
    assert.equal(await paypalAdapter.verifyWebhook(ctx, { headers: headersOf(signed), rawBody: captureEvent }), null);
    const before = gateway.calls.length;
    assert.equal(await paypalAdapter.verifyWebhook(ctx, { headers: headersOf({}), rawBody: captureEvent }), null);
    assert.equal(gateway.calls.length, before, "nothing asked of PayPal for an unsigned delivery");
  });

  test("coming back captures the approved order", async () => {
    const gateway = fakeGateway(
      token,
      when("GET", /\/v2\/checkout\/orders\/ORDER-9$/, {
        id: "ORDER-9",
        status: "APPROVED",
        purchase_units: [{ custom_id: "pay_123", amount: { value: "100.00", currency_code: "USD" } }],
      }),
      when("POST", /\/v2\/checkout\/orders\/ORDER-9\/capture$/, {
        id: "ORDER-9",
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: "pay_123",
            payments: {
              captures: [{ id: "CAP-9", status: "COMPLETED", amount: { value: "100.00", currency_code: "USD" }, custom_id: "pay_123" }],
            },
          },
        ],
      }),
    );
    const state = await paypalAdapter.confirmPayment(
      { credentials: { ...credentials, clientId: "client-confirm" }, fetch: gateway.fetch },
      "ORDER-9",
    );
    assert.equal(state?.status, "paid");
    assert.equal(state?.reference, "CAP-9");
    assert.equal(state?.amount, 100);
    const capture = gateway.calls.find((call) => call.url.endsWith("/capture"))!;
    assert.equal(capture.headers["paypal-request-id"], "capture-ORDER-9");
  });

  test("a capture refunded in part is still paid, with what its order refunded", async () => {
    // 3,000 captured, 500 refunded in PayPal's dashboard (a failed refund
    // attempt does not count).
    const gateway = fakeGateway(
      token,
      when("GET", /\/v2\/checkout\/orders\/CAP-7$/, { name: "RESOURCE_NOT_FOUND" }, 404),
      when("GET", /\/v2\/payments\/captures\/CAP-7$/, {
        id: "CAP-7",
        status: "PARTIALLY_REFUNDED",
        amount: { value: "3000.00", currency_code: "USD" },
        custom_id: "pay_123",
        supplementary_data: { related_ids: { order_id: "ORDER-7" } },
      }),
      when("GET", /\/v2\/checkout\/orders\/ORDER-7$/, {
        id: "ORDER-7",
        status: "COMPLETED",
        purchase_units: [
          {
            custom_id: "pay_123",
            payments: {
              captures: [{ id: "CAP-7", status: "PARTIALLY_REFUNDED", amount: { value: "3000.00", currency_code: "USD" } }],
              refunds: [
                { id: "RF-1", status: "COMPLETED", amount: { value: "500.00", currency_code: "USD" } },
                { id: "RF-2", status: "FAILED", amount: { value: "100.00", currency_code: "USD" } },
              ],
            },
          },
        ],
      }),
    );
    const state = await paypalAdapter.fetchPayment(
      { credentials: { ...credentials, clientId: "client-partial" }, fetch: gateway.fetch },
      "CAP-7",
    );
    assert.equal(state?.status, "paid");
    assert.equal(state?.reference, "CAP-7");
    assert.equal(state?.amount, 3000);
    assert.equal(state?.refundedAmount, 500);
  });

  test("refunding the rest asks for that amount, under its own request id", async () => {
    const gateway = fakeGateway(
      token,
      when("POST", /\/v2\/payments\/captures\/CAP-7\/refund$/, {
        id: "RF-3",
        status: "COMPLETED",
        amount: { value: "2500.00", currency_code: "USD" },
      }),
    );
    const result = await paypalAdapter.refund(
      { credentials: { ...credentials, clientId: "client-refund" }, fetch: gateway.fetch },
      { reference: "CAP-7", amount: 2500, currency: "USD", paymentId: "pay_123" },
    );
    const call = gateway.calls.find((entry) => entry.url.endsWith("/refund"))!;
    assert.deepEqual(call.json.amount, { value: "2500.00", currency_code: "USD" });
    assert.equal(call.headers["paypal-request-id"], "refund-pay_123-2500.00");
    assert.deepEqual(result, { refundId: "RF-3", status: "succeeded", amount: 2500 });
  });
});

describe("Stripe", () => {
  const credentials = { secretKey: "sk_test_office", webhookSecret: "whsec_office" };

  test("opens a hosted checkout in halalas, with our payment id and an idempotency key", async () => {
    const gateway = fakeGateway(
      when("POST", /api\.stripe\.com\/v1\/checkout\/sessions$/, {
        id: "cs_test_1",
        object: "checkout.session",
        url: "https://checkout.stripe.com/c/pay/cs_test_1",
      }),
    );
    const session = await stripeAdapter.createCheckout({ credentials, fetch: gateway.fetch }, checkout());
    assert.deepEqual(session, { reference: "cs_test_1", redirectUrl: "https://checkout.stripe.com/c/pay/cs_test_1" });
    const [call] = gateway.calls;
    const form = new URLSearchParams(call.body);
    assert.equal(form.get("line_items[0][price_data][unit_amount]"), "123450");
    assert.equal(form.get("line_items[0][price_data][currency]"), "sar");
    assert.equal(form.get("client_reference_id"), "pay_123");
    assert.equal(form.get("payment_intent_data[metadata][paymentId]"), "pay_123");
    assert.equal(call.headers["idempotency-key"], "checkout-pay_123-1");
    assert.equal(call.headers.authorization, "Bearer sk_test_office");
  });

  const completed = JSON.stringify({
    id: "evt_1",
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: "cs_test_1",
        object: "checkout.session",
        payment_status: "paid",
        status: "complete",
        amount_total: 123450,
        currency: "sar",
        client_reference_id: "pay_123",
        payment_intent: "pi_test_1",
        payment_method_types: ["card"],
        metadata: { paymentId: "pay_123" },
      },
    },
  });

  test("a webhook signed with the office's secret settles as the payment intent", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload: completed, secret: "whsec_office" });
    const event = await stripeAdapter.verifyWebhook(
      { credentials },
      { headers: headersOf({ "stripe-signature": header }), rawBody: completed },
    );
    assert.equal(event?.eventId, "evt_1");
    assert.deepEqual(
      { ...event?.payment },
      {
        reference: "pi_test_1",
        sessionReference: "cs_test_1",
        status: "paid",
        amount: 1234.5,
        currency: "SAR",
        paymentId: "pay_123",
        method: "card",
      },
    );
  });

  test("one signed with another secret is refused", async () => {
    const header = Stripe.webhooks.generateTestHeaderString({ payload: completed, secret: "whsec_someone_else" });
    assert.equal(
      await stripeAdapter.verifyWebhook({ credentials }, { headers: headersOf({ "stripe-signature": header }), rawBody: completed }),
      null,
    );
  });

  test("refunds the payment intent in halalas, once per payment", async () => {
    const gateway = fakeGateway(
      when("POST", /\/v1\/refunds$/, { id: "re_1", object: "refund", status: "succeeded", amount: 123450 }),
    );
    const result = await stripeAdapter.refund({ credentials, fetch: gateway.fetch }, {
      reference: "pi_test_1",
      amount: 1234.5,
      currency: "SAR",
      paymentId: "pay_123",
    });
    const form = new URLSearchParams(gateway.calls[0].body);
    assert.equal(form.get("payment_intent"), "pi_test_1");
    assert.equal(form.get("amount"), "123450");
    assert.equal(gateway.calls[0].headers["idempotency-key"], "refund-pay_123-123450");
    assert.deepEqual(result, { refundId: "re_1", status: "succeeded", amount: 1234.5 });
  });

  test("a payment intent refunded in part is still paid, with what went back", async () => {
    const gateway = fakeGateway(
      when("GET", /\/v1\/payment_intents\/pi_test_7/, {
        id: "pi_test_7",
        object: "payment_intent",
        status: "succeeded",
        amount: 300000,
        amount_received: 300000,
        currency: "sar",
        metadata: { paymentId: "pay_123" },
        payment_method_types: ["card"],
        latest_charge: { id: "ch_7", object: "charge", refunded: false, amount_refunded: 50000 },
      }),
    );
    const state = await stripeAdapter.fetchPayment({ credentials, fetch: gateway.fetch }, "pi_test_7");
    assert.equal(state?.status, "paid");
    assert.equal(state?.amount, 3000);
    assert.equal(state?.refundedAmount, 500);
  });

  test("an unknown session reads as no payment", async () => {
    const gateway = fakeGateway(
      when("GET", /checkout\/sessions\/cs_missing$/, {
        error: { type: "invalid_request_error", code: "resource_missing", message: "No such checkout.session" },
      }, 404),
    );
    assert.equal(await stripeAdapter.fetchPayment({ credentials, fetch: gateway.fetch }, "cs_missing"), null);
  });
});

test("every registered gateway has an adapter", () => {
  for (const id of ["stripe", "paypal", "moyasar", "paytabs", "tap"] as const) {
    assert.equal(getGatewayAdapter(id).id, id);
  }
});
